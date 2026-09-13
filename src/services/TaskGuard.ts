import type { AppState, Task, TaskContext } from '../Store';

export class TaskGuardError extends Error {
  constructor(message: string) { super(`需要先确认任务：${message} 本轮未执行这项修改，请先向用户澄清。`); this.name = 'TaskGuardError'; }
}

type DateMention = { date?: string; index: number; end: number; destination: boolean };
export type TaskDateIntent = { sourceDate?: string; destinationDate?: string; ambiguous: boolean };
const DATE_PATTERN = /\d{4}-\d{1,2}-\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|\d{1,2}\/\d{1,2}|大前天|大后天|前天|昨天|昨日|今天|今日|明天|明日|后天/g;
const MOVE_SUFFIX = /(?:改期到|改期至|改期为|改到|改至|改为|改成|移到|移至|挪到|挪至|调整到|调整至|推迟到|提前到|延期到)\s*$/;

function calendarDate(year: number, month: number, day: number): string | undefined {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return year > 0 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
function resolveDate(text: string, selectedDate: string): string | undefined {
  const offsets: Record<string, number> = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 };
  if (Object.hasOwn(offsets, text)) {
    const base = new Date(`${selectedDate}T00:00:00Z`);
    if (!Number.isFinite(base.getTime())) return undefined;
    base.setUTCDate(base.getUTCDate() + offsets[text]);
    return base.toISOString().slice(0, 10);
  }
  const parts = text.match(/\d+/g)!.map(Number);
  return parts.length === 3 ? calendarDate(parts[0], parts[1], parts[2]) : calendarDate(Number(selectedDate.slice(0, 4)), parts[0], parts[1]);
}

// New names/notes are literal data, not evidence identifying the old task.
function subjectText(text: string): string {
  const replacement = /(?:备注|名称|名字)(?:修改|更新)?(?:改为|改成|设置为|设为|写成|[：:])|(?:重命名|改名)(?:为|成)/.exec(text);
  return replacement ? text.slice(0, replacement.index) : text;
}

/** Deliberately limited calendar parser. It distinguishes source dates from a
 * destination after “改到/移到…”, and asks instead of guessing several sources. */
export function parseTaskDateIntent(text: string, selectedDate: string): TaskDateIntent {
  const subject = subjectText(text);
  const mentions: DateMention[] = [...subject.matchAll(DATE_PATTERN)].map(match => ({
    date: resolveDate(match[0], selectedDate), index: match.index!, end: match.index! + match[0].length,
    destination: MOVE_SUFFIX.test(subject.slice(0, match.index)),
  }));
  const sources = [...new Set(mentions.filter(item => !item.destination).map(item => item.date))];
  const destinations = [...new Set(mentions.filter(item => item.destination).map(item => item.date))];
  return { sourceDate: sources[0], destinationDate: destinations[0],
    ambiguous: mentions.some(item => !item.date) || sources.length > 1 || destinations.length > 1
      || /(?:上|下|本)周|周[一二三四五六日天]|星期[一二三四五六日天]|下个月|下月|月底|月末|明年/.test(subject) };
}

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/完(?=[身文书步])/g, '')
    .replace(/(?:已经|刚刚|完成了|做完了|写完了|读完了|跑完了|完成|做完|写完|读完|跑完|完了|了)/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
function referenceText(text: string): string {
  return normalized(subjectText(text).replace(DATE_PATTERN, '').replace(MOVE_SUFFIX, '')
    .replace(/(?:把|将|请|帮我|帮忙|我的|这个|这项|那个|那项|它|的|任务|待办|进度|更新|修改|标记|设置|设为|改为|改成|改到|移到|删除|删掉|移除|然后|再|已经|刚刚|百分之|请求)/g, '')
    .replace(/\d+(?:\.\d+)?\s*%?/g, ''));
}
function commonTerms(query: string, name: string): boolean {
  const right = normalized(name);
  if (query.length >= 2 && (right.includes(query) || query.includes(right))) return true;
  for (const run of query.match(/[\p{Script=Han}]+/gu) || []) {
    for (let index = 0; index < run.length - 1; index++) if (right.includes(run.slice(index, index + 2))) return true;
  }
  return (query.match(/[a-z][a-z0-9_+-]+/g) || []).some(word => right.includes(word));
}
function namedCandidates(tasks: Task[], request: string): Task[] {
  const query = referenceText(request);
  if (!query) return [];
  const full = tasks.filter(task => normalized(task.name).length >= 2 && query.includes(normalized(task.name)));
  if (full.length) {
    const longest = Math.max(...full.map(task => normalized(task.name).length));
    return full.filter(task => normalized(task.name).length === longest);
  }
  return tasks.filter(task => commonTerms(query, task.name));
}

export function assertTaskContextCurrent(state: AppState, context: TaskContext): Task {
  const task = state.tasks.find(item => item.id === context.taskId);
  if (!task || task.name !== context.taskName || task.date !== context.taskDate) {
    throw new TaskGuardError('关联任务已删除、改名或改期，请重新选择关联任务后再发送。');
  }
  return task;
}

export type TaskGuardOptions = { activeDate: string; currentDate?: string; requestText?: string; previousRequestText?: string; taskContext?: TaskContext };

/** Check the binding for every non-query tool, including attempts to work around
 * a stale reference by creating a replacement task instead. */
export function assertBoundRequest(state: AppState, options: TaskGuardOptions): void {
  const context = options.taskContext;
  if (!context) return;
  const bound = assertTaskContextCurrent(state, context);
  const request = options.requestText || '';
  const intent = parseTaskDateIntent(request, options.currentDate || options.activeDate);
  if (intent.ambiguous || intent.sourceDate && intent.sourceDate !== bound.date) {
    throw new TaskGuardError(`本次关联的是 ${bound.date} 的「${bound.name}」，请求中的任务日期不一致或不明确，请先解除/重新选择关联。`);
  }
  const candidates = namedCandidates(state.tasks, request);
  if (candidates.some(task => task.id !== bound.id && normalized(task.name) !== normalized(bound.name))) {
    throw new TaskGuardError(`请求提到了其他任务；本次仅关联「${bound.name}」，请先确认要操作哪一项。`);
  }
  const query = referenceText(request);
  // Pronouns and progress-only statements can use an explicit binding. A named
  // request with no lexical match (including unsupported pinyin) needs review.
  const generic = query.replace(/(?:我|已|做|写|读|跑|健|结束|好了|搞定|好|确认|是|没问题|到|全部|全|一半|一部分|部分|一点|目前|现在|先|继续|帮|给|一下|拆解|分解|拆成|步骤|步|建议|说明|计划|怎么|如何|为)/g, '');
  if (query && !candidates.some(task => task.id === bound.id) && generic
    && /(?:任务|把|将|删|改|写|读|跑|健|面|完)/.test(request)) {
    throw new TaskGuardError(`无法确认请求中的名称是否指关联任务「${bound.name}」，请明确任务名称。`);
  }
}

/** Deterministic write gate: model-supplied IDs alone do not establish intent.
 * It does not transliterate pinyin or claim full natural-language coverage. */
export function assertTaskWrite(state: AppState, taskId: string, updates: Partial<Task> | undefined, options: TaskGuardOptions): void {
  assertBoundRequest(state, options);
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new TaskGuardError('任务已不存在，请重新查询。');
  if (options.taskContext && task.id !== options.taskContext.taskId) {
    throw new TaskGuardError('模型选择了本次关联之外的任务，不能自动切换目标。');
  }
  if (options.requestText === undefined) return;
  const intent = parseTaskDateIntent(options.requestText, options.currentDate || options.activeDate);
  if (intent.ambiguous) throw new TaskGuardError('请求包含多个来源日期或无效日期，请明确原任务日期。');
  const rescheduleCandidates = intent.destinationDate && !intent.sourceDate ? namedCandidates(state.tasks, options.requestText) : [];
  const uniqueRescheduleSource = rescheduleCandidates.length === 1 && rescheduleCandidates[0].id === taskId
    && referenceText(options.requestText).includes(normalized(task.name)) ? task.date : undefined;
  const sourceDate = intent.sourceDate || options.taskContext?.taskDate || uniqueRescheduleSource || options.activeDate;
  if (task.date !== sourceDate) throw new TaskGuardError(`请求对应 ${sourceDate}，但模型选择了 ${task.date} 的「${task.name}」，请明确原任务日期。`);
  if (updates?.date && (intent.destinationDate ? updates.date !== intent.destinationDate : updates.date !== task.date)) {
    throw new TaskGuardError('改期需要明确目标日期，例如“把明天的任务改到今天”。');
  }
  if (options.taskContext) return;
  const scoped = state.tasks.filter(item => item.date === sourceDate);
  const candidates = namedCandidates(scoped, options.requestText);
  const query = referenceText(options.requestText);
  // After a clarifying question, “9/14那项” selects the date while the prior
  // user's own task name supplies the subject. Never infer a date from “是的”.
  const clarified = !query && intent.sourceDate && options.previousRequestText ? namedCandidates(scoped, options.previousRequestText) : [];
  const matching = candidates.length ? candidates : !query ? clarified.length ? clarified : scoped : [];
  if (matching.length !== 1 || matching[0].id !== taskId) {
    throw new TaskGuardError(matching.length > 1 ? '有多项任务匹配这个名称，请用户选择具体任务。' : '无法从本次请求唯一确认任务名称，请用户提供完整名称或选择关联任务。');
  }
}
