import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { acceptSuggestions, createDefaultState, newSession, normalizeState, updateMessage } from './state/appState';
import type { LongTermMemory } from './state/memory';
import { readBrowserState, writeBrowserState } from './state/browserStorage';
import type { ProactiveState } from './state/proactive';
import { trackTaskActivity } from './state/taskActivity';

export type Task = {
  id: string;
  name: string;
  progress: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  priority?: 'low' | 'medium' | 'high';
  lastProgressAt?: string;
};

export type TaskContext = { taskId: string; taskName: string; taskDate: string };

export type HistorySummary = {
  date: string; // YYYY-MM-DD
  summary: string;
};

export type Report = {
  id: string;
  title: string;
  dates: string[];
  content: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'model';
  text: string;
  taskContext?: TaskContext;
  contextText?: string; // Bounded extracted attachment text; the UI displays text instead.
  memoryStatus?: string;
  proposedTasks?: { name: string; added: boolean; date?: string }[];
  toolEvents?: { id: string; name: string; status: 'success' | 'error'; message: string }[];
  proposedTasksTargetDate?: string;
  proposedTasksDismissed?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
  summary?: string;        // 滑动摘要缓存
  summarizedUpTo?: number; // 已摘要到第几条消息的 index
};

export type AppState = {
  memory?: LongTermMemory;
  proactive?: ProactiveState;
  profile: {
    major: string;
    goal: string;
    skills: string;
    bio?: string;
    avatar?: string;
  };
  tasks: Task[];
  settings: {
    rolloverTime: string; // HH:mm
    agentStyle: 'academic' | 'gentle' | 'strict';
    sidebarEnabled: boolean;
    floatingBallEnabled: boolean;
    proactiveEnabled?: boolean;
    proactiveIntervalMinutes?: number;
    proactiveQuietStart?: string;
    proactiveQuietEnd?: string;
    theme: 'light' | 'dark';
    apiKey?: string;
    agentName: string;
    apiBaseUrl: string;
    apiModel?: string;
    // Report Agent overrides (empty = fallback to global)
    reportApiKey?: string;
    reportApiBaseUrl?: string;
    reportModel?: string;
  };
  chatSessions: ChatSession[];
  activeChatSessionId: string;
  activeDate: string; // YYYY-MM-DD
  lastRolloverDate: string; // YYYY-MM-DD
  historySummaries: HistorySummary[];
  reports: Report[];
};

export type StoreContextType = {
  state: AppState;
  getState: () => AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  updateAgentState: (updater: (state: AppState) => AppState, sessionId: string, messageId: string) => void;
  addTask: (name: string, date: string) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  addChatMessage: (role: 'user' | 'model', text: string, proposedTasks?: string[], targetDate?: string, sessionId?: string) => string;
  updateChatMessage: (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) => void;
  acceptProposedTask: (messageId: string, taskIndex: number, date: string) => void;
  acceptAllProposedTasks: (messageId: string, date: string) => void;
  dismissProposedTasks: (messageId: string) => void;
  setActiveDate: (date: string) => void;
  createNewChat: () => void;
  setActiveChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;
  addReport: (title: string, dates: string[], content: string) => void;
  deleteReport: (id: string) => void;
};

function loadState(): { state: AppState; error: string } {
  let loaded: AppState | undefined;
  try {
    const desktop = window.electronAPI;
    const saved = desktop?.storeGet?.() || readBrowserState(localStorage);
    const state = saved ? normalizeState(JSON.parse(saved)) : createDefaultState();
    loaded = state;
    const json = JSON.stringify(state);
    if (desktop?.storeSet) {
      if (!desktop.storeSet(json)) throw new Error('无法保存本地数据');
    } else writeBrowserState(localStorage, json);
    return { state, error: '' };
  } catch (error) {
    return { state: loaded || createDefaultState(), error: `${loaded ? '数据已读取，但保存失败' : '读取数据失败，原文件未覆盖'}：${error instanceof Error ? error.message : String(error)}` };
  }
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(loadState);
  const [state, renderState] = useState(initial.state);
  const [persistenceError, setPersistenceError] = useState(initial.error);
  const stateRef = useRef(state);
  const getState = useCallback(() => stateRef.current, []);

  // Commit outside React's updater: side effects must not run twice in StrictMode.
  // The main process merges changes against base, serializes writes and broadcasts the committed state.
  const commit = useCallback((update: React.SetStateAction<AppState>, guard?: { sessionId: string; messageId: string }) => {
    const previous = stateRef.current;
    let next = typeof update === 'function' ? update(previous) : update;
    if (next === previous) return;
    try {
      if (!window.electronAPI?.storeCommit) next = trackTaskActivity(previous, next);
      const json = JSON.stringify(next);
      const desktop = window.electronAPI;
      let committed = next;
      if (desktop?.storeCommit) {
        const result = desktop.storeCommit(json, JSON.stringify(previous), guard);
        if (!result) throw new Error('写入失败，请检查磁盘空间或数据格式');
        committed = JSON.parse(result);
      } else if (desktop?.storeSet) {
        if (!desktop.storeSet(json)) throw new Error('写入失败，请检查磁盘空间或数据格式');
      } else writeBrowserState(localStorage, json);
      stateRef.current = committed;
      renderState(committed);
      setPersistenceError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPersistenceError(`修改未保存：${message}`);
      throw new Error(message);
    }
  }, []);
  const setState = useCallback<React.Dispatch<React.SetStateAction<AppState>>>((update) => commit(update), [commit]);
  const updateAgentState = useCallback((updater: (state: AppState) => AppState, sessionId: string, messageId: string) => {
    commit(updater, { sessionId, messageId });
  }, [commit]);

  useEffect(() => {
    const receive = (json: string) => {
      try {
        const next = normalizeState(JSON.parse(json));
        stateRef.current = next;
        renderState(next);
      } catch { setPersistenceError('收到的数据格式无效，请检查备份文件。'); }
    };
    if (window.electronAPI?.onStoreChanged) return window.electronAPI.onStoreChanged(receive);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'taskagent-state' || event.key === 'taskagent-memory') {
        try { const saved = readBrowserState(localStorage); if (saved) receive(saved); }
        catch { setPersistenceError('读取长期记忆失败，请检查本地数据。'); }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => { window.electronAPI?.updateBall(state.settings.floatingBallEnabled); }, [state.settings.floatingBallEnabled]);
  useEffect(() => { window.electronAPI?.updateTaskCenter(state.settings.sidebarEnabled); }, [state.settings.sidebarEnabled]);

  const addTask = (name: string, date: string) => {
    if (!name.trim()) return;
    setState(s => ({ ...s, tasks: [...s.tasks, { id: crypto.randomUUID(), name: name.trim(), progress: 0, date }] }));
  };
  const updateTask = (id: string, updates: Partial<Task>) => setState(s => ({ ...s,
    tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates, id: t.id,
      progress: updates.progress === undefined ? t.progress : Math.max(0, Math.min(100, updates.progress)) } : t),
  }));
  const deleteTask = (id: string) => setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }));

  const addChatMessage = (role: 'user' | 'model', text: string, proposedTasks?: string[], targetDate?: string, sessionId?: string) => {
    const id = crypto.randomUUID();
    setState(s => ({ ...s, chatSessions: s.chatSessions.map(session => {
      if (session.id !== (sessionId || s.activeChatSessionId)) return session;
      const title = role === 'user' && ['新对话', '旧对话'].includes(session.title)
        ? text.slice(0, 15) + (text.length > 15 ? '…' : '') : session.title;
      return { ...session, title, updatedAt: new Date().toISOString(), messages: [...session.messages,
        { id, role, text, proposedTasks: proposedTasks?.map(name => ({ name, added: false })), proposedTasksTargetDate: targetDate }] };
    }) }));
    return id;
  };
  const updateChatMessage = (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) =>
    setState(s => updateMessage(s, messageId, m => ({ ...m, ...updates }), sessionId));
  const acceptProposedTask = (messageId: string, taskIndex: number, date: string) => setState(s => acceptSuggestions(s, messageId, date, taskIndex));
  const acceptAllProposedTasks = (messageId: string, date: string) => setState(s => acceptSuggestions(s, messageId, date));
  const dismissProposedTasks = (messageId: string) => updateChatMessage(messageId, { proposedTasksDismissed: true });
  const setActiveDate = (date: string) => setState(s => ({ ...s, activeDate: date }));
  const createNewChat = () => {
    const session = newSession();
    setState(s => ({ ...s, chatSessions: [session, ...s.chatSessions], activeChatSessionId: session.id }));
  };
  const setActiveChatSession = (id: string) => setState(s => s.chatSessions.some(cs => cs.id === id) ? { ...s, activeChatSessionId: id } : s);
  const deleteChatSession = (id: string) => setState(s => {
    const remaining = s.chatSessions.filter(cs => cs.id !== id);
    const chatSessions = remaining.length ? remaining : [newSession()];
    return { ...s, chatSessions, activeChatSessionId: s.activeChatSessionId === id ? chatSessions[0].id : s.activeChatSessionId };
  });
  const addReport = (title: string, dates: string[], content: string) => setState(s => ({ ...s,
    reports: [{ id: crypto.randomUUID(), title, dates, content, createdAt: new Date().toISOString() }, ...s.reports],
  }));
  const deleteReport = (id: string) => setState(s => ({ ...s, reports: s.reports.filter(r => r.id !== id) }));

  return <StoreContext.Provider value={{ state, getState, setState, updateAgentState, addTask, updateTask, deleteTask,
    addChatMessage, updateChatMessage, acceptProposedTask, acceptAllProposedTasks, dismissProposedTasks,
    setActiveDate, createNewChat, setActiveChatSession, deleteChatSession, addReport, deleteReport }}>
    {persistenceError && <div role="alert" className="fixed top-0 inset-x-0 z-50 bg-red-100 p-3 text-sm text-red-900">{persistenceError}</div>}
    {children}
  </StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within a StoreProvider');
  return context;
}
