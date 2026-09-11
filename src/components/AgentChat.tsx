import { useState, useRef, useEffect } from "react";
import { useStore } from "../Store";
import { useAgentChat } from "../hooks/useAgentChat";
import { ToolActivity } from "./ToolActivity";
import { Send, Plus, History, X, MessageSquare, Trash2, RefreshCw, ArrowLeft, Paperclip } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";

export function AgentChat() {
  const { state, acceptProposedTask, acceptAllProposedTasks, dismissProposedTasks, setState, createNewChat, setActiveChatSession, deleteChatSession } = useStore();
  const { busy: isTyping, send, regenerate, stop: handleStopGenerating } = useAgentChat();
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [refreshingMsgId, setRefreshingMsgId] = useState<string | null>(null);
  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; name: string } | null>(null);
  const currentSession = state.chatSessions.find(cs => cs.id === state.activeChatSessionId) || state.chatSessions[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [currentSession?.messages, isTyping]);
  const handleAttachFile = (file: File) => { if (!isTyping) setPendingFile({ file, name: file.name }); };
  const removePendingFile = () => setPendingFile(null);
  const handleRegenerateMessage = async (messageId: string) => {
    if (isTyping) return;
    setRegeneratingMsgId(messageId);
    try { await regenerate(messageId); } finally { setRegeneratingMsgId(null); }
  };
  const handleRefreshTasks = async (messageId: string) => {
    if (isTyping) return;
    setRefreshingMsgId(messageId);
    try { await regenerate(messageId, true); } finally { setRefreshingMsgId(null); }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTyping || (!input.trim() && !pendingFile)) return;
    const text = input.trim();
    const file = pendingFile?.file;
    setInput(""); setPendingFile(null);
    await send(text, file);
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
            {currentSession?.messages.map((msg, i) => {
              // Skip empty model messages (streaming placeholder before text arrives)
              if (msg.role === "model" && !msg.text && !msg.proposedTasks?.length && !msg.toolEvents?.length) return null;
              return (
              <motion.div 
                key={msg.id}
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
                    <ToolActivity events={msg.toolEvents} memoryStatus={msg.memoryStatus} />
                  </div>
                  {msg.proposedTasks && msg.proposedTasks.length > 0 && !msg.proposedTasksDismissed && (
                    <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-neutral-700 pt-3">
                      <div className="flex items-center justify-between xl:mb-2">
                        <span className="text-xs text-gray-500 font-medium">推荐任务</span>
                        <button 
                          disabled={isTyping}
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
                              {pt.name}{pt.date ? ` · ${pt.date}` : ''}
                            </span>
                            <button
                              disabled={pt.added}
                              onClick={() => acceptProposedTask(msg.id, taskIndex, state.activeDate)}
                              className="p-1 rounded-md text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors shrink-0 opacity-0 group-hover/task:opacity-100 focus:opacity-100"
                              title={pt.added ? "已添加" : "添加到任务中心"}
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
              );
            })}
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

      <div
        className="p-6 bg-white/40 dark:bg-neutral-900/40 border-t border-gray-100 dark:border-neutral-800"
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          const file = e.dataTransfer.files?.[0];
          if (file) handleAttachFile(file);
        }}
      >
        {/* Pending file badge */}
        <AnimatePresence>
          {pendingFile && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mb-2 flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 text-sm"
            >
              <Paperclip className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="text-blue-700 dark:text-blue-300 truncate flex-1">{pendingFile.name}</span>
              <button
                type="button"
                onClick={removePendingFile}
                className="text-blue-400 hover:text-red-500 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
          <input
            ref={fileInputRef}
            aria-label="上传文档"
            type="file"
            accept=".txt,.docx,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAttachFile(f); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isTyping}
            className="p-2.5 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors disabled:opacity-50 shrink-0"
            title="上传文档 (.txt, .docx, .pdf)"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            aria-label="对话输入"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingFile ? `对 ${pendingFile.name} 说点什么...` : "输入指令..."}
            className="flex-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-2xl px-4 py-3 pr-10 text-sm focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 transition-all outline-none text-foreground placeholder:text-gray-400"
          />
          <button type="submit" aria-label="发送消息" disabled={(!input.trim() && !pendingFile) || isTyping} className="absolute right-3 bottom-0 top-0 m-auto text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50">
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
