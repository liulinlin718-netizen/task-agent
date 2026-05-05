import React, { createContext, useContext, useState, useEffect } from 'react';
import { format, formatISO } from 'date-fns';

export type Task = {
  id: string;
  name: string;
  progress: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  priority?: 'low' | 'medium' | 'high';
};

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
  proposedTasks?: { name: string; added: boolean }[];
  proposedTasksTargetDate?: string;
  proposedTasksDismissed?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

export type AppState = {
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
    theme: 'light' | 'dark';
    apiKey?: string;
    agentName: string;
    apiBaseUrl: string;
    apiModel?: string;
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
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  addTask: (name: string, date: string) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  addChatMessage: (role: 'user' | 'model', text: string, proposedTasks?: string[], targetDate?: string) => void;
  updateChatMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  appendChatMessageText: (chunk: string) => void;
  deleteChatMessage: (messageId: string) => void;
  acceptProposedTask: (messageId: string, taskIndex: number, date: string) => void;
  acceptAllProposedTasks: (messageId: string, date: string) => void;
  dismissProposedTasks: (messageId: string) => void;
  updateMessageProposedTasks: (messageId: string, newTasks: string[]) => void;
  setActiveDate: (date: string) => void;
  createNewChat: () => void;
  setActiveChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;
  updateChatSessionTitle: (id: string, title: string) => void;
  addReport: (title: string, dates: string[], content: string) => void;
  deleteReport: (id: string) => void;
};

const defaultSessionId = Date.now().toString();

const defaultState: AppState = {
  profile: { major: '', goal: '', skills: '' },
  tasks: [
    { id: '1', name: '阅读文献：多模态大模型综述', progress: 30, date: format(new Date(), 'yyyy-MM-dd') },
    { id: '2', name: '撰写引言部分', progress: 0, date: format(new Date(), 'yyyy-MM-dd') }
  ],
  settings: { rolloverTime: '02:00', agentStyle: 'academic', sidebarEnabled: true, floatingBallEnabled: false, theme: 'light', agentName: '任务助理', apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiModel: 'gemini-2.5-flash' },
  chatSessions: [{
    id: defaultSessionId,
    title: '新对话',
    messages: [
      { id: 'initial', role: 'model', text: '你好！我是你的任务助理。今天我能帮你做些什么？' }
    ],
    updatedAt: new Date().toISOString()
  }],
  activeChatSessionId: defaultSessionId,
  activeDate: format(new Date(), 'yyyy-MM-dd'),
  lastRolloverDate: format(new Date(), 'yyyy-MM-dd'),
  historySummaries: [],
  reports: [],
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    // Try new key first, fall back to old key for backward compatibility
    const saved = localStorage.getItem('taskagent-state') || localStorage.getItem('scholaragent-state');
    if (saved) {
      const p = JSON.parse(saved);
      // migrations
      if (!p.lastRolloverDate) p.lastRolloverDate = format(new Date(), 'yyyy-MM-dd');
      if (!p.historySummaries) p.historySummaries = [];
      if (!p.settings.theme) p.settings.theme = 'light';
      if (!p.settings.agentName) p.settings.agentName = '任务助理';
      // v1 → v2 migration: apiFormat + apiUrl → apiBaseUrl
      if (p.settings.apiFormat && !p.settings.apiBaseUrl) {
        const oldUrl = p.settings.apiUrl || '';
        if (p.settings.apiFormat === 'gemini') {
          p.settings.apiBaseUrl = oldUrl
            ? (oldUrl.replace(/\/$/, '') + '/openai')
            : 'https://generativelanguage.googleapis.com/v1beta/openai';
        } else {
          // openai / deepseek / qwen / mimo / glm / minimax / doubao
          p.settings.apiBaseUrl = oldUrl || 'https://generativelanguage.googleapis.com/v1beta/openai';
        }
        delete p.settings.apiFormat;
        delete p.settings.apiUrl;
      }
      if (!p.settings.apiBaseUrl) p.settings.apiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';

      // migrate chatHistory to chatSessions
      if (!p.chatSessions && p.chatHistory) {
        const defaultSessionId = Date.now().toString();
        p.chatSessions = [{
          id: defaultSessionId,
          title: '旧对话',
          messages: p.chatHistory,
          updatedAt: new Date().toISOString()
        }];
        p.activeChatSessionId = defaultSessionId;
        delete p.chatHistory;
      }
      if (!p.reports) p.reports = [];
      return p;
    }
    return defaultState;
  });

  useEffect(() => {
    localStorage.setItem('taskagent-state', JSON.stringify(state));
  }, [state]);

  // Cross-window sync: when another Electron window updates localStorage, sync here
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'taskagent-state' && e.newValue) {
        try {
          const newState = JSON.parse(e.newValue);
          setState(newState);
        } catch { /* ignore parse errors */ }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sync settings with Electron windows — independently
  useEffect(() => {
    window.electronAPI?.updateBall(state.settings.floatingBallEnabled);
  }, [state.settings.floatingBallEnabled]);

  useEffect(() => {
    window.electronAPI?.updateTaskCenter(state.settings.sidebarEnabled);
  }, [state.settings.sidebarEnabled]);

  const addTask = (name: string, date: string) => {
    setState(s => ({
      ...s,
      tasks: [...s.tasks, { id: Date.now().toString() + Math.random().toString(), name, progress: 0, date }]
    }));
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setState(s => ({
      ...s,
      tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    }));
  };

  const deleteTask = (id: string) => {
    setState(s => ({
      ...s,
      tasks: s.tasks.filter(t => t.id !== id)
    }));
  };

  const addChatMessage = (role: 'user' | 'model', text: string, proposedTasks?: string[], targetDate?: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;

      const session = s.chatSessions[sessionIndex];
      const newMessage: ChatMessage = {
        id: Date.now().toString() + Math.random().toString(),
        role,
        text,
        proposedTasks: proposedTasks?.map(name => ({ name, added: false })),
        proposedTasksTargetDate: targetDate
      };

      let newTitle = session.title;
      // Auto-generate title from first user message if it's "新对话" or "旧对话"
      if (role === 'user' && (session.title === '新对话' || session.title === '旧对话') && session.messages.length <= 2) {
        newTitle = text.slice(0, 15) + (text.length > 15 ? '...' : '');
      }

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = {
        ...session,
        title: newTitle,
        messages: [...session.messages, newMessage],
        updatedAt: new Date().toISOString()
      };

      return {
        ...s,
        chatSessions: newSessions
      };
    });
  };

  const updateChatMessage = (messageId: string, updates: Partial<ChatMessage>) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      const msgIndex = newMessages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return s;

      newMessages[msgIndex] = { ...newMessages[msgIndex], ...updates };
      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };
      return { ...s, chatSessions: newSessions };
    });
  };

  const appendChatMessageText = (chunk: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      // Append to the last message (the streaming placeholder)
      const lastIdx = newMessages.length - 1;
      if (lastIdx < 0) return s;
      newMessages[lastIdx] = { ...newMessages[lastIdx], text: newMessages[lastIdx].text + chunk };
      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };
      return { ...s, chatSessions: newSessions };
    });
  };

  const deleteChatMessage = (messageId: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = session.messages.filter(m => m.id !== messageId);

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };
      return { ...s, chatSessions: newSessions };
    });
  };

  const acceptProposedTask = (messageId: string, taskIndex: number, date: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      const msgIndex = newMessages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return s;
      const msg = newMessages[msgIndex];
      if (!msg.proposedTasks || !msg.proposedTasks[taskIndex]) return s;

      msg.proposedTasks = [...msg.proposedTasks];
      msg.proposedTasks[taskIndex] = { ...msg.proposedTasks[taskIndex], added: true };
      newMessages[msgIndex] = { ...msg, proposedTasks: msg.proposedTasks };

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };

      const targetDate = msg.proposedTasksTargetDate || date;
      const newTask = { id: Date.now().toString() + Math.random().toString(), name: msg.proposedTasks[taskIndex].name, progress: 0, date: targetDate };

      return {
        ...s,
        chatSessions: newSessions,
        tasks: [...s.tasks, newTask]
      };
    });
  };

  const acceptAllProposedTasks = (messageId: string, date: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      const msgIndex = newMessages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return s;
      const msg = newMessages[msgIndex];
      if (!msg.proposedTasks || msg.proposedTasksDismissed) return s;

      const targetDate = msg.proposedTasksTargetDate || date;
      const newTasksToAdd: Task[] = [];
      const updatedProposedTasks = msg.proposedTasks.map(pt => {
        if (!pt.added) {
          newTasksToAdd.push({ id: Date.now().toString() + Math.random().toString(), name: pt.name, progress: 0, date: targetDate });
          return { ...pt, added: true };
        }
        return pt;
      });

      newMessages[msgIndex] = { ...msg, proposedTasks: updatedProposedTasks };

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };

      return {
        ...s,
        chatSessions: newSessions,
        tasks: [...s.tasks, ...newTasksToAdd]
      };
    });
  };

  const dismissProposedTasks = (messageId: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      const msgIndex = newMessages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return s;

      newMessages[msgIndex] = { ...newMessages[msgIndex], proposedTasksDismissed: true };

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };

      return { ...s, chatSessions: newSessions };
    });
  };

  const updateMessageProposedTasks = (messageId: string, newTasks: string[]) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
      if (sessionIndex === -1) return s;
      const session = s.chatSessions[sessionIndex];
      const newMessages = [...session.messages];
      const msgIndex = newMessages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return s;

      newMessages[msgIndex] = {
        ...newMessages[msgIndex],
        proposedTasks: newTasks.map(name => ({ name, added: false }))
      };

      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...session, messages: newMessages, updatedAt: new Date().toISOString() };

      return { ...s, chatSessions: newSessions };
    });
  };

  const setActiveDate = (date: string) => {
    setState(s => ({ ...s, activeDate: date }));
  };

  const createNewChat = () => {
    setState(s => {
      const newId = Date.now().toString();
      return {
        ...s,
        chatSessions: [
          {
            id: newId,
            title: '新对话',
            messages: [{ id: 'initial', role: 'model', text: '你好！我是你的任务助理。今天我能帮你做些什么？' }],
            updatedAt: new Date().toISOString()
          },
          ...s.chatSessions
        ],
        activeChatSessionId: newId
      }
    });
  };

  const setActiveChatSession = (id: string) => {
    setState(s => ({ ...s, activeChatSessionId: id }));
  };

  const deleteChatSession = (id: string) => {
    setState(s => {
      const newSessions = s.chatSessions.filter(cs => cs.id !== id);
      if (newSessions.length === 0) {
        const newId = Date.now().toString();
        return {
          ...s,
          chatSessions: [{
            id: newId,
            title: '新对话',
            messages: [{ id: 'initial', role: 'model', text: '你好！我是你的任务助理。今天我能帮你做些什么？' }],
            updatedAt: new Date().toISOString()
          }],
          activeChatSessionId: newId
        }
      }
      return {
        ...s,
        chatSessions: newSessions,
        activeChatSessionId: s.activeChatSessionId === id ? newSessions[0].id : s.activeChatSessionId
      }
    });
  };

  const updateChatSessionTitle = (id: string, title: string) => {
    setState(s => {
      const sessionIndex = s.chatSessions.findIndex(cs => cs.id === id);
      if (sessionIndex === -1) return s;
      const newSessions = [...s.chatSessions];
      newSessions[sessionIndex] = { ...newSessions[sessionIndex], title };
      return { ...s, chatSessions: newSessions };
    });
  };

  const addReport = (title: string, dates: string[], content: string) => {
    setState(s => ({
      ...s,
      reports: [
        { id: Date.now().toString(), title, dates, content, createdAt: new Date().toISOString() },
        ...(s.reports || [])
      ]
    }));
  };

  const deleteReport = (id: string) => {
    setState(s => ({ ...s, reports: (s.reports || []).filter(r => r.id !== id) }));
  };

  return (
    <StoreContext.Provider value={{
      state, setState, addTask, updateTask, deleteTask,
      addChatMessage, updateChatMessage, appendChatMessageText, deleteChatMessage, acceptProposedTask, acceptAllProposedTasks, dismissProposedTasks, updateMessageProposedTasks, setActiveDate,
      createNewChat, setActiveChatSession, deleteChatSession,
      updateChatSessionTitle, addReport, deleteReport
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within a StoreProvider');
  return context;
}
