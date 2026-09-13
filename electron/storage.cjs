const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { stampTaskActivity, reconcileReminder, validProactive, validProactiveSettings } = require('./proactive.cjs');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BACKUP_FORMAT = 'taskagent-backup';
const ITERATIONS = 210000;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string';
const optional = (value, check) => value === undefined || check(value);
const isTimestamp = value => isString(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const validMemory = value => isObject(value) && value.version === 1
  && isString(value.epoch) && value.epoch.length > 0 && typeof value.enabled === 'boolean'
  && Array.isArray(value.facts) && value.facts.length <= 100 && value.facts.every(fact => isObject(fact)
    && ['id', 'key', 'content', 'evidence', 'sourceSessionId', 'sourceMessageId', 'createdAt', 'updatedAt']
      .every(key => isString(fact[key]) && fact[key].length > 0)
    && fact.id.length > 0 && fact.key.length > 0 && fact.key.length <= 100
    && fact.content.length > 0 && fact.content.length <= 500 && fact.evidence.length <= 500
    && ['background', 'preference', 'goal', 'constraint'].includes(fact.category))
  && new Set(value.facts.map(fact => fact.id)).size === value.facts.length
  && new Set(value.facts.map(fact => fact.key)).size === value.facts.length;
const isDate = value => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// Validate fields used by the renderer before replacing any saved data. Missing
// v2 fields remain accepted so the renderer can migrate existing v1 backups.
function validateState(data) {
  const message = value => isObject(value) && isString(value.id)
    && ['user', 'model'].includes(value.role) && isString(value.text)
    && optional(value.contextText, isString)
    && optional(value.memoryStatus, isString)
    && optional(value.taskContext, reference => isObject(reference)
      && isString(reference.taskId) && reference.taskId.length > 0 && isString(reference.taskName) && isDate(reference.taskDate))
    && optional(value.proposedTasks, items => Array.isArray(items) && items.every(item =>
      isObject(item) && isString(item.name) && typeof item.added === 'boolean' && optional(item.date, isDate)))
    && optional(value.toolEvents, items => Array.isArray(items) && items.every(item => isObject(item)
      && ['id', 'name', 'message'].every(key => isString(item[key])) && ['success', 'error'].includes(item.status)))
    && optional(value.proposedTasksTargetDate, isDate)
    && optional(value.proposedTasksDismissed, item => typeof item === 'boolean');
  const settings = data?.settings;
  const profile = data?.profile;
  if (!isObject(data) || !isObject(settings) || !isObject(profile)
    || !['major', 'goal', 'skills'].every(key => isString(profile[key]))
    || !['bio', 'avatar'].every(key => optional(profile[key], isString))
    || !optional(data.memory, validMemory)
    || !validProactive(data.proactive) || !validProactiveSettings(settings)
    || !isString(settings.rolloverTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.rolloverTime)
    || !['academic', 'gentle', 'strict'].includes(settings.agentStyle)
    || typeof settings.sidebarEnabled !== 'boolean' || typeof settings.floatingBallEnabled !== 'boolean'
    || !optional(settings.theme, value => ['light', 'dark'].includes(value))
    || !['apiKey', 'agentName', 'apiBaseUrl', 'apiModel', 'reportApiKey', 'reportApiBaseUrl', 'reportModel', 'apiFormat', 'apiUrl']
      .every(key => optional(settings[key], isString))
    || !Array.isArray(data.tasks) || !data.tasks.every(task => isObject(task)
      && isString(task.id) && isString(task.name) && isDate(task.date)
      && Number.isFinite(task.progress) && task.progress >= 0 && task.progress <= 100
      && optional(task.lastProgressAt, isTimestamp)
      && optional(task.notes, isString) && optional(task.priority, value => ['low', 'medium', 'high'].includes(value)))
    || new Set(data.tasks.map(task => task.id)).size !== data.tasks.length
    || !isDate(data.activeDate) || !optional(data.lastRolloverDate, isDate)
    || !optional(data.historySummaries, values => Array.isArray(values) && values.every(value =>
      isObject(value) && isDate(value.date) && isString(value.summary)))
    || !optional(data.reports, values => Array.isArray(values) && values.every(value => isObject(value)
      && ['id', 'title', 'content', 'createdAt'].every(key => isString(value[key]))
      && Array.isArray(value.dates) && value.dates.every(isDate)))) {
    throw new Error('Invalid TaskAgent data');
  }
  if (Array.isArray(data.chatSessions)) {
    if (!data.chatSessions.every(session => isObject(session)
      && ['id', 'title', 'updatedAt'].every(key => isString(session[key]))
      && Array.isArray(session.messages) && session.messages.every(message)
      && optional(session.summary, isString)
      && optional(session.summarizedUpTo, value => Number.isInteger(value) && value >= 0))
      || !isString(data.activeChatSessionId)
      || (data.chatSessions.length > 0 && !data.chatSessions.some(session => session.id === data.activeChatSessionId))
      || new Set(data.chatSessions.map(session => session.id)).size !== data.chatSessions.length) {
      throw new Error('Invalid TaskAgent chat sessions');
    }
  } else if (!Array.isArray(data.chatHistory) || !data.chatHistory.every(message)) {
    throw new Error('Invalid TaskAgent chat history');
  }
  return data;
}

function parseState(text) {
  if (!isString(text) || Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error('Invalid data size');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Invalid TaskAgent JSON'); }
  return validateState(data);
}

function readText(file, limit = MAX_FILE_BYTES) {
  if (fs.statSync(file).size > limit) throw new Error('File is too large');
  return fs.readFileSync(file, 'utf8');
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

const memoryFile = file => path.join(path.dirname(file), 'taskagent-memory.json');
const journalFile = file => `${file}.journal`;

function jsonFile(file, limit) {
  try { return JSON.parse(readText(file, limit)); }
  catch (error) { if (error.code === 'ENOENT') throw error; throw new Error(`Invalid or unreadable ${path.basename(file)}`); }
}

function readSnapshot(file) {
  const data = jsonFile(file);
  if (!isObject(data)) throw new Error('Invalid TaskAgent data file');
  if (Object.hasOwn(data, 'profile')) return { state: validateState(data), legacy: true };
  const savedMemory = jsonFile(memoryFile(file));
  if (!isObject(savedMemory) || savedMemory.version !== 1 || Object.hasOwn(data, 'memory')) throw new Error('Invalid memory store');
  const state = { ...data, profile: savedMemory.profile };
  if (Object.hasOwn(savedMemory, 'memory')) state.memory = savedMemory.memory;
  return { state: validateState(state), legacy: false };
}

function installSnapshot(file, state) {
  const { profile, memory, ...data } = state;
  atomicWrite(memoryFile(file), JSON.stringify({ version: 1, profile, ...(memory === undefined ? {} : { memory }) }));
  atomicWrite(file, JSON.stringify(data));
}

function removeIfPresent(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// A prepared transaction rolls back; a committed transaction rolls forward.
// The marker is replaced atomically only after BOTH data files are durable.
function recoverTransaction(file) {
  let journal;
  try { journal = jsonFile(journalFile(file), MAX_FILE_BYTES * 3); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!isObject(journal) || journal.version !== 1 || !['prepared', 'committed'].includes(journal.phase)
    || !Object.hasOwn(journal, 'previous')) throw new Error('Invalid storage transaction journal');
  validateState(journal.next);
  if (journal.previous !== null) validateState(journal.previous);
  const snapshot = journal.phase === 'committed' ? journal.next : journal.previous;
  if (snapshot === null) {
    removeIfPresent(file);
    removeIfPresent(memoryFile(file));
  } else installSnapshot(file, snapshot);
  removeIfPresent(journalFile(file));
}

function writeTransaction(file, next, previous) {
  const journal = { version: 1, phase: 'prepared', previous, next };
  atomicWrite(journalFile(file), JSON.stringify(journal));
  try {
    if (previous !== null) atomicWrite(`${file}.bak`, JSON.stringify(previous));
    installSnapshot(file, next);
    atomicWrite(journalFile(file), JSON.stringify({ ...journal, phase: 'committed' }));
  } catch (error) {
    // A rejected synchronous commit must not become accepted on the next read.
    // Leave the prepared journal if disk failure also prevents rollback, so no
    // reader can observe a mixed pair until recovery succeeds.
    try { recoverTransaction(file); } catch { /* keep the journal for the next startup */ }
    throw error;
  }
  try { removeIfPresent(journalFile(file)); }
  catch (error) { console.error('[store] Committed transaction cleanup deferred:', error.message); }
}

function readState(file) {
  recoverTransaction(file);
  try {
    const { state, legacy } = readSnapshot(file);
    if (legacy) writeTransaction(file, state, state);
    return JSON.stringify(state);
  } catch (error) {
    if (!fs.existsSync(file) && !fs.existsSync(memoryFile(file)) && !fs.existsSync(`${file}.bak`)) return null;
    let backup;
    try { backup = parseState(readText(`${file}.bak`)); }
    catch { throw new Error('本地数据或长期记忆损坏且没有可用备份，请导入备份恢复。'); }
    console.error(`[store] Recovering complete last-good snapshot: ${error.message}`);
    writeTransaction(file, backup, null);
    return JSON.stringify(backup);
  }
}

function writeState(file, text, { restore = false, preserveProactive = false, now = new Date() } = {}) {
  let next = parseState(text);
  let interrupted = false;
  try { recoverTransaction(file); }
  catch (error) { if (!restore) throw error; interrupted = true; }
  let previous = null, legacy = false;
  try {
    if (interrupted) throw new Error('Unrecoverable journal');
    ({ state: previous, legacy } = readSnapshot(file));
  }
  catch (error) {
    if (fs.existsSync(file) || fs.existsSync(memoryFile(file))) {
      if (!restore) throw new Error('本地数据或长期记忆无法读取，已拒绝覆盖。请先恢复备份。');
      try { previous = parseState(readText(`${file}.bak`)); } catch { /* explicit validated restore */ }
    } else if (fs.existsSync(`${file}.bak`) && !restore) throw new Error('请先读取并恢复本地备份。');
  }
  if (!restore && previous) {
    const previousTasks = new Map(previous.tasks.map(task => [task.id, task]));
    next = { ...next, tasks: next.tasks.map(task => {
      const old = previousTasks.get(task.id);
      return old && old.progress === task.progress && isTimestamp(old.lastProgressAt)
        && (!isTimestamp(task.lastProgressAt) || Date.parse(task.lastProgressAt) < Date.parse(old.lastProgressAt))
        ? { ...task, lastProgressAt: old.lastProgressAt } : task;
    }) };
    if (preserveProactive) next.proactive = previous.proactive;
  }
  next = stampTaskActivity(restore ? null : previous, next, now);
  next = reconcileReminder(next, now);
  validateState(next);
  if (!legacy && unchanged(previous, next)) return JSON.stringify(next);
  writeTransaction(file, next, previous);
  return JSON.stringify(next);
}

const entityKeys = { tasks: 'id', reports: 'id', chatSessions: 'id', messages: 'id', historySummaries: 'date', facts: 'id' };
const unchanged = isDeepStrictEqual;

// Each window submits its local change against the snapshot it read. Preserve
// unrelated newer changes from other windows, including newly added entities.
function mergeValue(current, base, next, field) {
  if (unchanged(base, next)) return current;
  if (field === 'memory' && current?.epoch !== base?.epoch && next?.epoch === base?.epoch) return current;
  const key = entityKeys[field];
  if (key && Array.isArray(base) && Array.isArray(next) && Array.isArray(current)) {
    const baseById = new Map(base.map(item => [item[key], item]));
    const nextById = new Map(next.map(item => [item[key], item]));
    const currentIds = new Set(current.map(item => item[key]));
    const result = current.filter(item => !baseById.has(item[key]) || nextById.has(item[key]))
      .map(item => nextById.has(item[key]) && baseById.has(item[key])
        ? mergeValue(item, baseById.get(item[key]), nextById.get(item[key])) : item);
    for (let index = 0; index < next.length; index++) {
      const item = next[index];
      // A deleted entity stays deleted even when a stale stream edits it later.
      if (!currentIds.has(item[key]) && !baseById.has(item[key])) {
        if (index === 0 && !['tasks', 'messages'].includes(field)) result.unshift(item);
        else if (index === next.length - 1) result.push(item);
        else {
          const following = next.slice(index + 1).map(value => value[key]);
          const position = result.findIndex(value => following.includes(value[key]));
          result.splice(position < 0 ? result.length : position, 0, item);
        }
      }
    }
    if (field === 'facts') {
      // Different windows may independently assign different UUIDs to the same
      // semantic key. Keep the latest changed fact's own ID for save receipts.
      for (const fact of next) {
        if (!unchanged(baseById.get(fact.id), fact) && result.some(item => item.id === fact.id)) {
          for (let index = result.length - 1; index >= 0; index--) {
            if (result[index].key === fact.key && result[index].id !== fact.id) result.splice(index, 1);
          }
        }
      }
    }
    return result;
  }
  if (isObject(base) && isObject(next)) {
    const result = isObject(current) ? { ...current } : {};
    for (const name of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!unchanged(base[name], next[name])) {
        if (Object.hasOwn(next, name)) result[name] = mergeValue(result[name], base[name], next[name], name);
        else delete result[name];
      }
    }
    // An explicit clear (or deleting the final fact) wins over facts learned
    // concurrently, while other manual edits keep unrelated concurrent facts.
    if (field === 'memory' && next.epoch !== base.epoch && next.facts.length === 0) result.facts = [];
    return result;
  }
  return next;
}

function commitState(file, text, baseText, guard) {
  const next = parseState(text);
  const base = parseState(baseText);
  const currentText = readState(file);
  const current = currentText === null ? null : parseState(currentText);
  // Check the persisted target in this synchronous transaction. A renderer may
  // still hold a stale snapshot after another window deleted its conversation.
  if (guard !== undefined) {
    if (!isObject(guard) || !isString(guard.sessionId) || !isString(guard.messageId)) return null;
    const session = current?.chatSessions?.find(value => value.id === guard.sessionId);
    if (!session?.messages.some(message => message.id === guard.messageId)) return null;
    const baseTasks = new Map(base.tasks.map(task => [task.id, task]));
    const nextTasks = new Map(next.tasks.map(task => [task.id, task]));
    const changedIds = [...new Set([...baseTasks.keys(), ...nextTasks.keys()])]
      .filter(id => !unchanged(baseTasks.get(id), nextTasks.get(id)));
    // Only task mutations need this gate. Streaming text and unsaved proposals
    // must remain writable when a task changes while the model is replying.
    if (changedIds.length) {
      const staleTask = () => {
        const error = new Error('任务已在其他窗口删除、改名或改期，请重新确认任务名称和日期后再发送。');
        error.code = 'TASK_CONTEXT_STALE';
        throw error;
      };
      const currentTasks = new Map(current.tasks.map(task => [task.id, task]));
      for (const id of changedIds) {
        const before = baseTasks.get(id), persisted = currentTasks.get(id);
        // Compare the pre-operation identities: an explicit rename/reschedule
        // in next is allowed if the selected original task is still current.
        if (before && (!persisted || persisted.name !== before.name || persisted.date !== before.date)) staleTask();
      }
      const sourceUser = messages => {
        const index = messages?.findIndex(message => message.id === guard.messageId) ?? -1;
        return index < 0 ? undefined : messages.slice(0, index).findLast(message => message.role === 'user');
      };
      const oldSource = sourceUser(base.chatSessions?.find(value => value.id === guard.sessionId)?.messages);
      const source = sourceUser(session.messages);
      const reference = source?.taskContext || oldSource?.taskContext;
      if (reference) {
        if (oldSource && (!source || source.id !== oldSource.id || !unchanged(source.taskContext, oldSource.taskContext))) staleTask();
        const bound = currentTasks.get(reference.taskId);
        if (!bound || bound.name !== reference.taskName || bound.date !== reference.taskDate) staleTask();
      }
    }
  }
  if (next.memory && next.memory.epoch === base.memory?.epoch && current?.memory?.epoch === base.memory?.epoch) {
    const previousFacts = new Map(base.memory.facts.map(fact => [fact.id, fact]));
    for (const fact of next.memory.facts) {
      if (unchanged(previousFacts.get(fact.id), fact)) continue;
      const source = current.chatSessions?.find(session => session.id === fact.sourceSessionId)
        ?.messages.find(message => message.id === fact.sourceMessageId);
      if (source?.role !== 'user' || source.contextText !== undefined || !source.text.includes(fact.evidence)) return null;
    }
  }
  const merged = current === null ? next : mergeValue(current, base, next);
  // Desktop reminder metadata is owned by the scheduler/action IPC. A delayed
  // renderer snapshot cannot restore a dismissed card or roll back its quota.
  if (current) {
    merged.proactive = current.proactive;
    if (base.proactive && next.proactive && current.proactive) {
      const changedFields = [...new Set([...Object.keys(base.proactive), ...Object.keys(next.proactive)])]
        .filter(key => !unchanged(base.proactive[key], next.proactive[key])
          && !(key === 'taskStates' && [base.proactive[key], next.proactive[key]]
            .every(value => value === undefined || (isObject(value) && Object.keys(value).length === 0))));
      const clearedTaskDismissals = [];
      const clearsTaskDismissalsOnly = () => {
        const before = base.proactive.taskStates, after = next.proactive.taskStates;
        if (!isObject(before) || !isObject(after)) return false;
        const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        for (const id of ids) {
          const oldStatus = Object.hasOwn(before, id) ? before[id] : undefined;
          const newStatus = Object.hasOwn(after, id) ? after[id] : undefined;
          if (unchanged(oldStatus, newStatus)) continue;
          if (!oldStatus || !newStatus || oldStatus.dismissedDate === undefined || newStatus.dismissedDate !== undefined) return false;
          const { dismissedDate, ...retained } = oldStatus;
          if (!unchanged(retained, newStatus)) return false;
          clearedTaskDismissals.push(id);
        }
        return clearedTaskDismissals.length > 0;
      };
      if (changedFields.length && changedFields.every(key => key === 'taskStates' ? clearsTaskDismissalsOnly()
        : ['snoozedUntil', 'dismissedDate'].includes(key) && next.proactive[key] === undefined)) {
        merged.proactive = { ...current.proactive };
        for (const key of changedFields) {
          if (key !== 'taskStates' && unchanged(current.proactive[key], base.proactive[key])) delete merged.proactive[key];
        }
        for (const id of clearedTaskDismissals) {
          const states = merged.proactive.taskStates;
          const status = states && Object.hasOwn(states, id) ? states[id] : undefined;
          if (status && status.dismissedDate === base.proactive.taskStates[id].dismissedDate) {
            const { dismissedDate, ...retained } = status;
            merged.proactive.taskStates = { ...states, [id]: retained };
          }
        }
      }
    }
    const clearingAll = base.proactive && next.proactive === undefined && next.tasks.length === 0
      && ['major', 'goal', 'skills', 'bio', 'avatar'].every(key => !next.profile[key])
      && next.memory?.epoch !== base.memory?.epoch && next.memory?.facts.length === 0
      && next.reports?.length === 0 && next.historySummaries?.length === 0
      && next.chatSessions?.length === 1 && !base.chatSessions?.some(session => session.id === next.chatSessions[0].id)
      && next.chatSessions[0].messages.every(message => message.role === 'model');
    if (clearingAll) merged.proactive = undefined;
  }
  if (Array.isArray(merged.chatSessions)) {
    if (merged.chatSessions.length === 0) {
      merged.chatSessions = [{ id: crypto.randomUUID(), title: '新对话', messages: [], updatedAt: new Date().toISOString() }];
    }
    if (!merged.chatSessions.some(session => session.id === merged.activeChatSessionId)) {
      merged.activeChatSessionId = merged.chatSessions[0].id;
    }
  }
  return writeState(file, JSON.stringify(merged));
}

function requirePassword(password) {
  if (!isString(password) || password.length === 0) throw new Error('A password is required');
}

function encryptData(text, password) {
  parseState(text);
  requirePassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return {
    format: BACKUP_FORMAT, version: 1, iterations: ITERATIONS,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64'),
  };
}

function decodeBase64(value, length) {
  if (!isString(value) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid backup encoding');
  }
  const result = Buffer.from(value, 'base64');
  if ((length !== undefined && result.length !== length) || result.length > MAX_FILE_BYTES) throw new Error('Invalid backup size');
  return result;
}

function decryptData(envelope, password) {
  requirePassword(password);
  if (!isObject(envelope)) throw new Error('Invalid backup');
  const legacy = envelope.format === undefined && envelope.version === undefined && envelope.iterations === undefined;
  if (!legacy && (envelope.format !== BACKUP_FORMAT || envelope.version !== 1 || envelope.iterations !== ITERATIONS)) {
    throw new Error('Unsupported backup version');
  }
  const salt = decodeBase64(envelope.salt, 16);
  const iv = decodeBase64(envelope.iv, 12);
  const tag = decodeBase64(envelope.tag, 16);
  const encrypted = decodeBase64(envelope.data);
  const key = crypto.pbkdf2Sync(password, salt, legacy ? 100000 : ITERATIONS, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  parseState(text);
  return text;
}

module.exports = { atomicWrite, readText, parseState, readState, writeState, commitState, encryptData, decryptData };
