import { format, subDays } from 'date-fns';
import type { AppState, ChatMessage, ChatSession, Task } from '../Store';
import { emptyMemory, normalizeMemory } from './memory';

export const DEFAULT_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export function logicalDate(now: Date, rolloverTime: string): string {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(rolloverTime);
  const hours = match ? Number(match[1]) : 2;
  const minutes = match ? Number(match[2]) : 0;
  const boundary = new Date(now);
  boundary.setHours(hours <= 23 ? hours : 2, minutes <= 59 ? minutes : 0, 0, 0);
  return format(now < boundary ? subDays(now, 1) : now, 'yyyy-MM-dd');
}

export function newSession(): ChatSession {
  return {
    id: crypto.randomUUID(), title: '新对话', updatedAt: new Date().toISOString(),
    messages: [{ id: crypto.randomUUID(), role: 'model', text: '你好！我是你的任务助理。今天我能帮你做些什么？' }],
  };
}

export function createDefaultState(now = new Date()): AppState {
  const session = newSession();
  const date = logicalDate(now, '02:00');
  return {
    profile: { major: '', goal: '', skills: '' }, memory: emptyMemory(), tasks: [],
    settings: { rolloverTime: '02:00', agentStyle: 'academic', sidebarEnabled: true, floatingBallEnabled: false,
      theme: 'light', agentName: '任务助理', apiBaseUrl: DEFAULT_API_URL, apiModel: 'gemini-2.5-flash',
      proactiveEnabled: true, proactiveIntervalMinutes: 120, proactiveQuietStart: '22:00', proactiveQuietEnd: '09:00' },
    chatSessions: [session], activeChatSessionId: session.id,
    activeDate: date, lastRolloverDate: date, historySummaries: [], reports: [],
  };
}

/** Migrate persisted v1/v2 data without replacing existing task or message IDs. */
export function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('存储数据格式无效');
  const p = value as Record<string, any>;
  if (!Array.isArray(p.tasks) || !p.settings || typeof p.settings !== 'object') throw new Error('存储缺少任务或设置');
  const defaults = createDefaultState();
  const settings = { ...defaults.settings, ...p.settings };
  if (!p.settings.apiBaseUrl && p.settings.apiFormat) {
    const oldUrl = (p.settings.apiUrl || '').replace(/\/+$/, '');
    settings.apiBaseUrl = p.settings.apiFormat === 'gemini'
      ? (oldUrl ? (oldUrl.endsWith('/openai') ? oldUrl : `${oldUrl}/openai`) : DEFAULT_API_URL)
      : oldUrl || 'https://api.openai.com/v1';
  }
  delete settings.apiFormat;
  delete settings.apiUrl;
  let sessions: ChatSession[] = Array.isArray(p.chatSessions) ? p.chatSessions : [];
  if (!sessions.length && Array.isArray(p.chatHistory)) {
    sessions = [{ ...newSession(), title: '旧对话', messages: p.chatHistory }];
  }
  if (!sessions.length) sessions = [newSession()];
  if (sessions.some(s => !s || typeof s.id !== 'string' || !Array.isArray(s.messages))) throw new Error('对话数据格式无效');
  return {
    ...defaults, ...p, profile: { ...defaults.profile, ...p.profile }, memory: normalizeMemory(p.memory), settings,
    chatSessions: sessions,
    activeChatSessionId: sessions.some(s => s.id === p.activeChatSessionId) ? p.activeChatSessionId : sessions[0].id,
    reports: Array.isArray(p.reports) ? p.reports : [],
    historySummaries: Array.isArray(p.historySummaries) ? p.historySummaries : [],
  };
}

export function updateMessage(state: AppState, messageId: string, update: (message: ChatMessage) => ChatMessage, sessionId?: string): AppState {
  const index = state.chatSessions.findIndex(s => (!sessionId || s.id === sessionId) && s.messages.some(m => m.id === messageId));
  if (index < 0) return state;
  const session = state.chatSessions[index];
  const chatSessions = [...state.chatSessions];
  chatSessions[index] = { ...session, updatedAt: new Date().toISOString(),
    messages: session.messages.map(m => m.id === messageId ? update(m) : m) };
  return { ...state, chatSessions };
}

export function acceptSuggestions(state: AppState, messageId: string, date: string, taskIndex?: number): AppState {
  const message = state.chatSessions.flatMap(s => s.messages).find(m => m.id === messageId);
  if (!message?.proposedTasks || message.proposedTasksDismissed) return state;
  const tasks = [...state.tasks];
  const proposedTasks = message.proposedTasks.map((proposal, index) => {
    if (proposal.added || (taskIndex !== undefined && index !== taskIndex)) return proposal;
    const targetDate = proposal.date || message.proposedTasksTargetDate || date;
    if (!tasks.some(t => t.name === proposal.name && t.date === targetDate)) {
      tasks.push({ id: crypto.randomUUID(), name: proposal.name, date: targetDate, progress: 0 });
    }
    return { ...proposal, added: true };
  });
  return { ...updateMessage(state, messageId, m => ({ ...m, proposedTasks })), tasks };
}

/** Commit the date change before any AI request, so a slow/offline model cannot duplicate rollover. */
export function rolloverState(state: AppState, date: string): AppState {
  if (date <= state.lastRolloverDate) return state;
  const previousDate = state.lastRolloverDate;
  const previousTasks = state.tasks.filter(t => t.date === previousDate);
  const carried: Task[] = previousTasks.filter(t => t.progress < 100).map(t => ({
    ...t, id: `rollover:${date}:${t.id}`, date,
  }));
  const completed = previousTasks.filter(t => t.progress >= 100).length;
  return { ...state, activeDate: date, lastRolloverDate: date,
    tasks: [...state.tasks, ...carried.filter(t => !state.tasks.some(existing => existing.id === t.id))],
    historySummaries: [{ date: previousDate, summary: `记录了 ${previousTasks.length} 项任务，完成 ${completed} 项，${carried.length} 项已保留进度结转。` },
      ...state.historySummaries.filter(s => s.date !== previousDate)],
  };
}
