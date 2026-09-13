import type { AppState, Task, TaskContext } from "../Store";
import type { AgentStore } from "./AgentService";
import { throwIfAborted } from "./StreamParser";
import { assertBoundRequest, assertTaskWrite, TaskGuardError } from './TaskGuard';

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolResult = { ok: boolean; message: string; data?: unknown; duplicate?: boolean };
export type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

const string = { type: "string" };
const date = { type: "string", description: "真实的 YYYY-MM-DD 日历日期", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const priority = { type: "string", enum: ["low", "medium", "high"] };
const taskFields = { name: { ...string, minLength: 1, maxLength: 200 }, date, notes: { ...string, maxLength: 10000 }, priority };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const defineTool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({ type: "function", function: { name, description, parameters } });

export const AGENT_TOOLS: ToolDefinition[] = [
  defineTool("list_tasks", "查询任务及真实 ID。可查某日、日期区间或名称；不填过滤条件时查询所有日期。修改和删除前如 ID 不确定，先查询；有多个可能匹配项时询问用户。", object({ date, startDate: date, endDate: date, query: { ...string, maxLength: 200 } })),
  defineTool("add_tasks", "添加用户明确要求的新任务；自动创建的任务只包含用户要求的内容，额外建议请用 propose_tasks。每项日期缺省为当前选中日期。", object({ tasks: { type: "array", minItems: 1, maxItems: 20, items: object(taskFields, ["name"]) } }, ["tasks"])),
  defineTool("update_task", "更新现有任务。用户说已完成时可设置 progress=100。必须使用实际存在的任务 ID；只传需要改动的字段。", object({ taskId: string, ...taskFields, progress: { type: "number", minimum: 0, maximum: 100 } }, ["taskId"])),
  defineTool("delete_task", "删除用户明确要求删除的任务，必须使用查询得到的真实任务 ID。", object({ taskId: string }, ["taskId"])),
  defineTool("propose_tasks", "展示待用户采纳的任务建议或拆解步骤，不直接创建任务。拆解可提供原任务 ID。每项可指定日期。", object({ tasks: { type: "array", minItems: 1, maxItems: 20, items: object({ name: taskFields.name, date }, ["name"]) }, taskId: string }, ["tasks"])),
  defineTool("generate_report", "调用独立配置的报告模型总结指定日期区间，并保存到历史报告。最多 366 天；仅在用户要求生成报告时调用。", object({ startDate: date, endDate: date, title: { ...string, minLength: 1, maxLength: 200 } }, ["startDate", "endDate"])),
];

function asObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("参数必须是 JSON 对象。");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new Error("包含未知参数，请按工具定义调用。");
  return result;
}
function text(value: unknown, name: string, max = 200, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`${name} 必须是${allowEmpty ? "" : "非空"}字符串，且不超过 ${max} 字符。`);
  return allowEmpty ? value : value.trim();
}
export function validateDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) throw new Error("日期必须为真实的 YYYY-MM-DD 日期。");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("日期不存在，请使用真实日历日期。");
  return value;
}
function range(start: unknown, end: unknown): { startDate: string; endDate: string } {
  const startDate = validateDate(start), endDate = validateDate(end);
  if (startDate > endDate) throw new Error("开始日期不得晚于结束日期。");
  return { startDate, endDate };
}
function fields(input: Record<string, unknown>): Partial<Task> {
  const result: Partial<Task> = {};
  if (input.name !== undefined) result.name = text(input.name, "任务名称");
  if (input.date !== undefined) result.date = validateDate(input.date);
  if (input.notes !== undefined) result.notes = text(input.notes, "备注", 10000, true);
  if (input.priority !== undefined) {
    if (!["low", "medium", "high"].includes(input.priority as string)) throw new Error("优先级必须是 low、medium 或 high。");
    result.priority = input.priority as Task["priority"];
  }
  if (input.progress !== undefined) {
    if (typeof input.progress !== "number" || !Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100) throw new Error("进度必须是 0 到 100 的数字。");
    result.progress = input.progress;
  }
  return result;
}
function taskArray(value: unknown, activeDate: string, proposed: boolean): Array<{ name: string; date: string; notes?: string; priority?: Task["priority"] }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error("每次应提供 1 到 20 项任务。");
  return value.map(item => {
    const input = asObject(item, proposed ? ["name", "date"] : ["name", "date", "notes", "priority"]);
    const parsed = fields(input);
    return { ...parsed, name: text(input.name, "任务名称"), date: parsed.date || validateDate(activeDate) };
  });
}

function normalize(name: string, raw: string, activeDate: string): Record<string, any> {
  if (!AGENT_TOOLS.some(tool => tool.function.name === name)) throw new Error(`未知工具：${name}`);
  if (typeof raw !== "string" || raw.length > 64000) throw new Error("工具参数过长或格式不正确。");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error("工具参数不是完整有效的 JSON。"); }
  if (name === "list_tasks") {
    const value = asObject(input, ["date", "startDate", "endDate", "query"]);
    if (value.date !== undefined && (value.startDate !== undefined || value.endDate !== undefined)) throw new Error("date 和日期区间不能同时指定。");
    if ((value.startDate === undefined) !== (value.endDate === undefined)) throw new Error("日期区间必须同时包含 startDate 和 endDate。");
    return { ...(value.date !== undefined ? { date: validateDate(value.date) } : {}), ...(value.startDate !== undefined ? range(value.startDate, value.endDate) : {}), ...(value.query !== undefined ? { query: text(value.query, "查询词") } : {}) };
  }
  if (name === "add_tasks" || name === "propose_tasks") {
    const value = asObject(input, name === "add_tasks" ? ["tasks"] : ["tasks", "taskId"]);
    return { tasks: taskArray(value.tasks, activeDate, name === "propose_tasks"), ...(value.taskId !== undefined ? { taskId: text(value.taskId, "任务 ID", 200) } : {}) };
  }
  if (name === "update_task") {
    const value = asObject(input, ["taskId", "name", "progress", "date", "notes", "priority"]);
    const updates = fields(value);
    if (!Object.keys(updates).length) throw new Error("至少提供一个要更新的字段。");
    return { taskId: text(value.taskId, "任务 ID"), updates };
  }
  if (name === "delete_task") {
    const value = asObject(input, ["taskId"]);
    return { taskId: text(value.taskId, "任务 ID") };
  }
  const value = asObject(input, ["startDate", "endDate", "title"]);
  const dates = range(value.startDate, value.endDate);
  if ((Date.parse(dates.endDate) - Date.parse(dates.startDate)) / 86400000 >= 366) throw new Error("每份报告最多包含 366 天。");
  return { ...dates, title: value.title === undefined ? `${dates.startDate} 至 ${dates.endDate} 任务总结` : text(value.title, "报告标题") };
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createToolExecutor(store: AgentStore, options: {
  sessionId: string;
  assistantMessageId: string;
  activeDate: string;
  currentDate?: string;
  taskContext?: TaskContext;
  requestText?: string;
  previousRequestText?: string;
  signal?: AbortSignal;
  readOnly?: boolean;
  generateReport: (dates: string[], state: AppState, signal?: AbortSignal) => Promise<string>;
}) {
  const results = new Map<string, ToolResult>();
  const callIds = new Map<string, { key: string; result: ToolResult }>();
  let clarificationRequired: string | undefined;

  function updateWithEvent(call: ToolCall, result: ToolResult, mutation?: (state: AppState) => AppState) {
    throwIfAborted(options.signal);
    store.setState(state => {
      throwIfAborted(options.signal);
      const session = state.chatSessions.find(item => item.id === options.sessionId);
      if (!session?.messages.some(message => message.id === options.assistantMessageId)) {
        if (mutation) throw new Error("原对话或回复已删除，未执行该操作。");
        return state;
      }
      if (mutation) assertBoundRequest(state, options);
      const next = mutation ? mutation(state) : state;
      const event = { id: crypto.randomUUID(), name: call.function.name, status: result.ok ? "success" as const : "error" as const, message: result.message };
      return { ...next, chatSessions: next.chatSessions.map(item => item.id !== options.sessionId ? item : { ...item, updatedAt: new Date().toISOString(), messages: item.messages.map(message => message.id !== options.assistantMessageId ? message : { ...message, toolEvents: [...(message.toolEvents || []), event] }) }) };
    });
  }

  return async function execute(call: ToolCall): Promise<ToolResult> {
    throwIfAborted(options.signal);
    const name = call.function.name;
    let key = `${name}:${call.function.arguments}`;
    let result: ToolResult;
    try {
      const args = normalize(name, call.function.arguments, name === 'propose_tasks' && options.taskContext ? options.taskContext.taskDate : options.activeDate);
      key = `${name}:${canonical(args)}`;
      const previousId = callIds.get(call.id);
      if (previousId && previousId.key !== key) throw new Error("同一个工具调用 ID 携带了不同参数，已拒绝执行。");
      const previous = previousId?.result || (name !== "list_tasks" ? results.get(key) : undefined);
      if (previous) {
        result = { ...previous, duplicate: true, message: `该调用已处理，未重复执行。${previous.message}` };
        updateWithEvent(call, result);
        return result;
      }
      if (options.readOnly && !["list_tasks", "propose_tasks"].includes(name)) throw new Error("重新生成处于只读模式，只能查询任务或提供待采纳建议，不能修改任务或保存报告。");
      const state = store.getState();
      if (name !== 'list_tasks') {
        if (clarificationRequired) throw new TaskGuardError(clarificationRequired);
        assertBoundRequest(state, options);
      }
      if (name === "list_tasks") {
        const tasks = state.tasks.filter(task => (!args.date || task.date === args.date) && (!args.startDate || task.date >= args.startDate && task.date <= args.endDate) && (!args.query || task.name.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())));
        result = { ok: true, message: `查询到 ${tasks.length} 项任务。`, data: { tasks: tasks.slice(0, 300), total: tasks.length, truncated: tasks.length > 300 } };
        updateWithEvent(call, result);
      } else if (name === "add_tasks") {
        const added: Task[] = [], skipped: string[] = [];
        result = { ok: true, message: "", data: { tasks: added, skipped } };
        updateWithEvent(call, result, current => {
          assertBoundRequest(current, options);
          const existing = new Set(current.tasks.map(task => `${task.date}\n${task.name.trim()}`));
          for (const task of args.tasks) {
            const taskKey = `${task.date}\n${task.name}`;
            if (existing.has(taskKey)) { skipped.push(task.name); continue; }
            existing.add(taskKey);
            added.push({ id: crypto.randomUUID(), progress: 0, ...task });
          }
          result.message = `已添加 ${added.length} 项任务${skipped.length ? `，跳过 ${skipped.length} 项同名同日期任务` : ""}。`;
          return { ...current, tasks: [...current.tasks, ...added] };
        });
      } else if (name === "update_task" || name === "delete_task") {
        const task = state.tasks.find(item => item.id === args.taskId);
        if (!task) throw new Error("任务 ID 不存在，请先调用 list_tasks 查询，必要时请用户澄清。");
        assertTaskWrite(state, args.taskId, name === 'update_task' ? args.updates : undefined, options);
        result = { ok: true, message: name === "delete_task" ? `已删除任务「${task.name}」。` : `已更新任务「${args.updates.name || task.name}」。`, data: name === "delete_task" ? { taskId: task.id } : { task: { ...task, ...args.updates } } };
        updateWithEvent(call, result, current => {
          assertTaskWrite(current, args.taskId, name === 'update_task' ? args.updates : undefined, options);
          if (!current.tasks.some(item => item.id === args.taskId)) throw new Error("任务已不存在，未执行该操作。");
          return { ...current, tasks: name === "delete_task" ? current.tasks.filter(item => item.id !== args.taskId) : current.tasks.map(item => item.id === args.taskId ? { ...item, ...args.updates } : item) };
        });
      } else if (name === "propose_tasks") {
        if (options.taskContext && args.taskId && args.taskId !== options.taskContext.taskId) throw new TaskGuardError('建议引用了本次关联之外的任务，请确认关联。');
        if (args.taskId && !state.tasks.some(task => task.id === args.taskId)) throw new Error("要拆解的任务 ID 不存在，请先查询任务。");
        result = { ok: true, message: `已展示 ${args.tasks.length} 项待采纳建议，尚未添加到任务表。`, data: { tasks: args.tasks } };
        updateWithEvent(call, result, current => ({ ...current, chatSessions: current.chatSessions.map(session => session.id !== options.sessionId ? session : { ...session, messages: session.messages.map(message => {
          if (message.id !== options.assistantMessageId) return message;
          const proposed = [...(message.proposedTasks || [])];
          for (const task of args.tasks) if (!proposed.some(item => item.name === task.name && (item.date || message.proposedTasksTargetDate || options.activeDate) === task.date)) proposed.push({ ...task, added: false });
          return { ...message, proposedTasks: proposed, proposedTasksDismissed: false };
        }) }) }));
      } else {
        const dates: string[] = [];
        for (let time = Date.parse(args.startDate); time <= Date.parse(args.endDate); time += 86400000) dates.push(new Date(time).toISOString().slice(0, 10));
        const content = await options.generateReport(dates, state, options.signal);
        throwIfAborted(options.signal);
        if (typeof content !== "string" || !content.trim()) throw new Error("报告模型返回了空内容，未保存报告。");
        const report = { id: crypto.randomUUID(), title: args.title, dates, content, createdAt: new Date().toISOString() };
        result = { ok: true, message: `已生成并保存报告「${report.title}」。`, data: { reportId: report.id, title: report.title, dates } };
        updateWithEvent(call, result, current => ({ ...current, reports: [...current.reports, report] }));
      }
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof TaskGuardError) clarificationRequired ||= error.message;
      result = { ok: false, message: error instanceof Error ? error.message : "工具执行失败。" };
      updateWithEvent(call, result);
    }
    // Retain first ID binding even if a provider reuses it with different arguments.
    if (!callIds.has(call.id)) callIds.set(call.id, { key, result });
    if (name !== "list_tasks") results.set(key, result);
    return result;
  };
}
