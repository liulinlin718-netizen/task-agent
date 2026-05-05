import { useState, useRef, useEffect } from "react";
import { useStore } from "../Store";
import { processAgentRequest, processAgentRequestStream, generateCustomSummary } from "../services/AgentService";
import { Send, Plus, History, X, MessageSquare, Trash2, RefreshCw, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";

export function AgentChat() {
  const { state, addTask, updateTask, deleteTask, addChatMessage, updateChatMessage, appendChatMessageText, deleteChatMessage, acceptProposedTask, acceptAllProposedTasks, dismissProposedTasks, updateMessageProposedTasks, setActiveDate, setState, createNewChat, setActiveChatSession, deleteChatSession, updateChatSessionTitle } = useStore();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [refreshingMsgId, setRefreshingMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentSession = state.chatSessions.find(cs => cs.id === state.activeChatSessionId) || state.chatSessions[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, isTyping]);

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null);

  const handleRegenerateMessage = async (messageId: string) => {
    const msgs = currentSession?.messages || [];
    const idx = msgs.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    
    // Find the immediately preceding user message
    let userText = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        userText = msgs[i].text;
        break;
      }
    }
    
    if (!userText) return;

    setRegeneratingMsgId(messageId);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Create a temporary state that excludes the message we are regenerating
      // This ensures AgentService doesn't see the old message in previousHistory
      const fakeState = {
        ...state,
        chatSessions: state.chatSessions.map(cs => 
          cs.id === state.activeChatSessionId 
            ? { ...cs, messages: cs.messages.filter(m => m.id !== messageId) }
            : cs
        )
      };

      const res = await processAgentRequest(userText, fakeState, abortController.signal);
      
      let replyText = res.data.reply || "";
      let proposedTasks: {name: string, added: boolean}[] | undefined = undefined;

      if (res.intent === "add_tasks" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        replyText = replyText || "好的，为你生成了以下规划，请确认是否并入任务表：";
        proposedTasks = res.data.proposedTasks.map(name => ({name, added: false}));
        if (res.data.targetDate && res.data.targetDate !== state.activeDate) {
          setActiveDate(res.data.targetDate);
        }
      } else if (res.intent === "update_task" && res.data.taskId) {
        const updates: any = {};
        if (res.data.progress !== undefined) updates.progress = res.data.progress;
        if (res.data.date) updates.date = res.data.date;
        if (res.data.notes) updates.notes = res.data.notes;
        if (res.data.priority) updates.priority = res.data.priority;
        updateTask(res.data.taskId, updates);
        const taskName = state.tasks.find(t => t.id === res.data.taskId)?.name || "任务";
        replyText = replyText || `已更新 **${taskName}**。`;
      } else if (res.intent === "delete_task" && res.data.taskId) {
        const taskName = state.tasks.find(t => t.id === res.data.taskId)?.name || "任务";
        deleteTask(res.data.taskId);
        replyText = replyText || `已删除任务：**${taskName}**。`;
      } else if (res.intent === "decompose" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        const taskName = state.tasks.find(t => t.id === res.data.taskId)?.name || "该任务";
        replyText = replyText || `这是 **${taskName}** 的拆解步骤，请确认需要添加哪些进度：`;
        proposedTasks = res.data.proposedTasks.map(name => ({name, added: false}));
      }

      updateChatMessage(messageId, { text: replyText, proposedTasks, proposedTasksTargetDate: res.data.targetDate, proposedTasksDismissed: false });
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message?.includes('abort')) {
        console.log('Request aborted by user');
        updateChatMessage(messageId, { text: "已停止生成。" });
      } else {
        console.error(e);
        updateChatMessage(messageId, { text: e.message || "抱歉，处理您的请求时出错。" });
      }
    } finally {
      setRegeneratingMsgId(null);
      abortControllerRef.current = null;
    }
  };

  const handleRefreshTasks = async (messageId: string) => {
    setRefreshingMsgId(messageId);
    try {
      const msgs = currentSession?.messages || [];
      const idx = msgs.findIndex(m => m.id === messageId);
      let prevText = "请给我更多建议";
      if (idx > 0 && msgs[idx-1].role === 'user') {
        prevText = msgs[idx-1].text;
      }
      const res = await processAgentRequest(`针对我之前的请求：“${prevText}”，请提供三个**完全不同**的新任务建议。`, state);
      if (res.intent === "add_tasks" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        updateMessageProposedTasks(messageId, res.data.proposedTasks);
      } else if (res.intent === "decompose" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        updateMessageProposedTasks(messageId, res.data.proposedTasks);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setRefreshingMsgId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userText = input.trim();
    setInput("");
    addChatMessage("user", userText);
    setIsTyping(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Create a placeholder message for streaming
      addChatMessage("model", "");

      const res = await processAgentRequestStream(
        userText, state,
        (chunk) => {
          // Typewriter effect: append text to the last model message
          appendChatMessageText(chunk);
        },
        abortController.signal,
        // Rolling summary callback — update session in background
        (summary, summarizedUpTo) => {
          setState(s => {
            const idx = s.chatSessions.findIndex(cs => cs.id === s.activeChatSessionId);
            if (idx === -1) return s;
            const sessions = [...s.chatSessions];
            sessions[idx] = { ...sessions[idx], summary, summarizedUpTo };
            return { ...s, chatSessions: sessions };
          });
        }
      );

      if (res.intent === "chat") {
        // Text was already streamed — nothing more to do
      } else if (res.intent === "add_tasks" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        let replyText = res.data.reply || "好的，为你生成了以下规划，请确认是否并入任务表：";
        const firstTaskName = res.data.proposedTasks[0];
        const targetDate = res.data.targetDate || state.activeDate;
        addTask(firstTaskName, targetDate);
        addChatMessage("model", replyText, res.data.proposedTasks, res.data.targetDate);
        if (res.data.targetDate && res.data.targetDate !== state.activeDate) {
          setActiveDate(res.data.targetDate);
        }
      } else if (res.intent === "update_task" && res.data.taskId) {
        // FC parameter validation: check taskId exists
        const task = state.tasks.find(t => t.id === res.data.taskId);
        if (!task) {
          addChatMessage("model", "未找到对应的任务，请确认任务名称后重试。");
        } else {
          const updates: any = {};
          if (res.data.progress !== undefined) {
            updates.progress = Math.max(0, Math.min(100, res.data.progress)); // Clamp 0-100
          }
          if (res.data.date) updates.date = res.data.date;
          if (res.data.notes) updates.notes = res.data.notes;
          if (res.data.priority) updates.priority = res.data.priority;
          updateTask(res.data.taskId, updates);
          addChatMessage("model", res.data.reply || `已更新 **${task.name}**。`);
        }
      } else if (res.intent === "delete_task" && res.data.taskId) {
        const task = state.tasks.find(t => t.id === res.data.taskId);
        if (!task) {
          addChatMessage("model", "未找到对应的任务，可能已被删除。");
        } else {
          deleteTask(res.data.taskId);
          addChatMessage("model", res.data.reply || `已删除任务：**${task.name}**。`);
        }
      } else if (res.intent === "generate_report" && res.data.startDate && res.data.endDate) {
        addChatMessage("model", "正在生成报告，请稍候...");
        try {
          const dates: string[] = [];
          let d = new Date(res.data.startDate);
          const end = new Date(res.data.endDate);
          while (d <= end) {
            dates.push(d.toISOString().split('T')[0]);
            d.setDate(d.getDate() + 1);
          }
          const report = await generateCustomSummary(dates, state);
          addChatMessage("model", report);
        } catch {
          addChatMessage("model", "报告生成失败，请检查 API 配置。");
        }
      } else if (res.intent === "decompose" && res.data.proposedTasks && res.data.proposedTasks.length > 0) {
        const task = state.tasks.find(t => t.id === res.data.taskId);
        if (!task) {
          addChatMessage("model", "未找到要拆解的任务。");
        } else {
          addChatMessage("model", res.data.reply || `这是 **${task.name}** 的拆解步骤：`, res.data.proposedTasks);
        }
      }

      if (res.data.chatTitle && res.data.chatTitle.length > 0) {
        updateChatSessionTitle(state.activeChatSessionId, res.data.chatTitle);
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message?.includes('abort')) {
        console.log('Request aborted by user');
        addChatMessage("model", "已停止生成。");
      } else if (e.message?.includes('超时')) {
        addChatMessage("model", "网络超时，请检查网络连接后重试。");
      } else {
        console.error(e);
        addChatMessage("model", e.message || "抱歉，处理您的请求时出错。");
      }
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const updateAgentStyle = (style: 'academic' | 'gentle' | 'strict') => {
    setState(s => ({ ...s, settings: { ...s.settings, agentStyle: style } }));
  };

  const cycleAgentStyle = () => {
    const styles: ('academic' | 'gentle' | 'strict')[] = ['academic', 'gentle', 'strict'];
    const currentIndex = styles.indexOf(state.settings.agentStyle);
    const nextIndex = (currentIndex + 1) % styles.length;
    updateAgentStyle(styles[nextIndex]);
  };

  return (
    <div className="flex flex-col h-full bg-white/60 dark:bg-neutral-900/60 backdrop-blur-2xl relative">
      <div className="p-4 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full animate-pulse ${
            state.settings.agentStyle === 'gentle' ? 'bg-green-500' :
            state.settings.agentStyle === 'strict' ? 'bg-orange-500' : 'bg-blue-500'
          }`}></div>
          <h2 className="font-semibold text-sm tracking-wide text-foreground">
            {state.settings.agentName || '任务助理'}
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
            title="历史记录"
          >
            <History className="w-4 h-4" />
          </button>
          <button 
            onClick={() => { createNewChat(); setShowHistory(false); }}
            className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
            title="开启新对话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-20 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl flex flex-col"
          >
            <div className="p-4 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2"><History className="w-4 h-4" /> 对话历史</h3>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {state.chatSessions.map(session => (
                <div 
                  key={session.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer ${
                    session.id === state.activeChatSessionId 
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20' 
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-neutral-800'
                  }`}
                  onClick={() => { setActiveChatSession(session.id); setShowHistory(false); }}
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <MessageSquare className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="truncate text-sm">{session.title}</div>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteChatSession(session.id); }}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-white dark:hover:bg-neutral-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto w-full" ref={scrollRef}>
        <div className="p-6 space-y-6 min-h-max">
          <AnimatePresence>
            {currentSession?.messages.map((msg, i) => (
              <motion.div 
                key={i} 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className={`flex flex-col ${msg.role === "model" ? "items-start" : "items-end"}`}
              >
                <div 
                  className={`group relative max-w-[85%] px-4 py-3 shadow-sm text-sm leading-relaxed overflow-hidden break-words ${
                    msg.role === "model" 
                      ? "bg-white dark:bg-neutral-800 rounded-2xl rounded-tl-none border border-gray-100 dark:border-neutral-700 text-[#1D1D1F] dark:text-[#F5F5F7]" 
                      : "bg-blue-500 dark:bg-blue-600 text-white rounded-2xl rounded-tr-none border border-blue-500 dark:border-blue-600"
                  }`}
                >
                  <div className="markdown-body prose prose-sm dark:prose-invert break-words max-w-full prose-pre:max-w-full prose-pre:overflow-x-auto">
                    <Markdown>{msg.text}</Markdown>
                  </div>
                  {msg.proposedTasks && msg.proposedTasks.length > 0 && !msg.proposedTasksDismissed && (
                    <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-neutral-700 pt-3">
                      <div className="flex items-center justify-between xl:mb-2">
                        <span className="text-xs text-gray-500 font-medium">推荐任务</span>
                        <button 
                          disabled={refreshingMsgId === msg.id}
                          onClick={() => handleRefreshTasks(msg.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${refreshingMsgId === msg.id ? 'animate-spin' : ''}`} />
                          刷新
                        </button>
                      </div>
                      <div className="space-y-1.5 mb-2">
                        {msg.proposedTasks.map((pt, taskIndex) => (
                          <div key={taskIndex} className="group/task flex items-center gap-2 text-xs">
                            <div className={`w-1 h-1 rounded-full ${pt.added ? 'bg-gray-300 dark:bg-gray-600' : 'bg-blue-400'}`}></div>
                            <span className={`font-medium flex-1 truncate transition-colors ${pt.added ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                              {pt.name}
                            </span>
                            <button
                              onClick={() => acceptProposedTask(msg.id, taskIndex, state.activeDate)}
                              className="p-1 rounded-md text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors shrink-0 opacity-0 group-hover/task:opacity-100 focus:opacity-100"
                              title="添加到任务中心"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      
                      {!msg.proposedTasks.every(pt => pt.added) && (
                        <div className="flex space-x-2 mt-4 pt-1">
                           <button 
                             className="flex-1 py-1.5 bg-blue-500 hover:bg-blue-600 transition-colors text-white rounded-[6px] text-[11px] font-medium" 
                             onClick={() => acceptAllProposedTasks(msg.id, state.activeDate)}
                           >
                             全部应用
                           </button>
                           <button 
                             className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-colors text-gray-600 dark:text-gray-300 rounded-[6px] text-[11px] font-medium" 
                             onClick={() => dismissProposedTasks(msg.id)}
                           >
                             暂时不用
                           </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === 'model' && msg.id !== 'initial' && !isTyping && i === currentSession.messages.length - 1 && (
                  <div className="flex justify-start mt-1.5 ml-1">
                      <button 
                        disabled={regeneratingMsgId !== null}
                        onClick={() => handleRegenerateMessage(msg.id)}
                        className="flex items-center space-x-1.5 px-2.5 py-1 mt-0.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white dark:hover:bg-neutral-800 rounded-lg transition-colors border border-transparent shadow-sm hover:border-gray-200 dark:hover:border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="重新生成回答"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${regeneratingMsgId === msg.id ? 'animate-spin' : ''}`} />
                        <span>{regeneratingMsgId === msg.id ? '重新生成中...' : '重新生成'}</span>
                      </button>
                  </div>
                )}
              </motion.div>
            ))}
            {isTyping && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex items-start"
              >
                <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-white dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 shadow-sm text-gray-400 dark:text-gray-500 text-sm flex items-center space-x-1">
                  <span className="animate-bounce inline-block w-1 h-1 bg-current rounded-full"></span>
                  <span className="animate-bounce inline-block w-1 h-1 bg-current rounded-full" style={{ animationDelay: '0.2s' }}></span>
                  <span className="animate-bounce inline-block w-1 h-1 bg-current rounded-full" style={{ animationDelay: '0.4s' }}></span>
                </div>
                <button 
                  onClick={handleStopGenerating}
                  className="ml-3 self-center px-3 py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium transition-colors border border-gray-200 dark:border-neutral-700"
                >
                  停止生成
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-6 bg-white/40 dark:bg-neutral-900/40 border-t border-gray-100 dark:border-neutral-800">
        <form onSubmit={handleSubmit} className="relative">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="输入指令..."
            className="w-full bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-2xl px-4 py-3 pr-10 text-sm focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 transition-all outline-none text-foreground placeholder:text-gray-400"
          />
          <button type="submit" disabled={!input.trim() || isTyping} className="absolute right-3 bottom-0 top-0 m-auto text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50">
            <Send className="w-5 h-5" />
          </button>
        </form>
        <div className="mt-3 flex justify-between items-center">
          <div 
            onClick={cycleAgentStyle}
            className={`w-12 h-1.5 rounded-full cursor-pointer transition-colors shadow-sm ${
              state.settings.agentStyle === 'academic' ? 'bg-blue-500 hover:bg-blue-600' : 
              state.settings.agentStyle === 'gentle' ? 'bg-green-500 hover:bg-green-600' : 
              'bg-orange-500 hover:bg-orange-600'
            }`}
            title="点击切换模式"
          ></div>
          <div 
            onClick={cycleAgentStyle}
            className="text-xs text-gray-400 dark:text-gray-500 font-medium cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors select-none"
          >
            {state.settings.agentStyle === 'academic' ? '专业导师' : 
             state.settings.agentStyle === 'gentle' ? '贴心助手' : 
             '严厉督导'}
          </div>
        </div>
      </div>
    </div>
  );
}
