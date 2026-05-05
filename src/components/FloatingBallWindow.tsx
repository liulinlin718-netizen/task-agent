import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, Pin, PinOff } from 'lucide-react';
import { StoreProvider, useStore } from '../Store';
import { processAgentRequest } from '../services/AgentService';
import Markdown from 'react-markdown';

function FloatingBallContent() {
  const [expanded, setExpanded] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [nearEdge, setNearEdge] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const dragStartScreen = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const handleBallMouseDown = useCallback((e: React.MouseEvent) => {
    if (expanded) return;
    e.preventDefault();
    setIsDragging(true);
    hasMoved.current = false;
    dragStartOffset.current = { x: e.clientX, y: e.clientY };
    dragStartScreen.current = { x: e.screenX, y: e.screenY };
    window.electronAPI?.windowDragStart();
  }, [expanded]);

  useEffect(() => {
    if (!isDragging) return;
    let raf: number | null = null;
    const onMove = (e: MouseEvent) => {
      const dx = e.screenX - dragStartScreen.current.x;
      const dy = e.screenY - dragStartScreen.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true;
      if (hasMoved.current) {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const targetX = e.screenX - dragStartOffset.current.x;
          const targetY = e.screenY - dragStartOffset.current.y;
          window.electronAPI?.windowDragTo(targetX, targetY);
          // Near-edge snap feedback
          const workArea = window.electronAPI?.screenGetWorkArea();
          if (workArea) {
            const near = targetX < 100 || targetX + 48 > workArea.width - 100;
            setNearEdge(near);
          }
        });
      }
    };
    const onUp = () => {
      setIsDragging(false);
      setNearEdge(false);
      window.electronAPI?.windowDragEnd();
      window.electronAPI?.ballCheckSnap();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDragging]);

  const handleBallClick = () => {
    if (hasMoved.current) return;
    if (!expanded) {
      window.electronAPI?.ballExpand();
      setExpanded(true);
    }
  };

  const collapseTimer = useRef<number | null>(null);

  const clearCollapseTimer = () => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
  };

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    setIsPinned(false);
    window.electronAPI?.ballCollapse();
  }, []);

  // Auto-collapse on mouse leave if not pinned
  const handlePanelMouseLeave = () => {
    if (!isPinned && expanded) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      clearCollapseTimer();
      collapseTimer.current = window.setTimeout(handleCollapse, 400);
    }
  };

  useEffect(() => {
    const onBlur = () => {
      if (!isPinned && expanded) {
        handleCollapse();
      }
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [isPinned, expanded, handleCollapse]);

  const handlePanelMouseEnter = () => {
    clearCollapseTimer();
  };

  // Prevent zoom on wheel
  useEffect(() => {
    const preventZoom = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    window.addEventListener('wheel', preventZoom, { passive: false });
    return () => window.removeEventListener('wheel', preventZoom);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <AnimatePresence>
        {!expanded ? (
          <motion.div
            key="ball"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onMouseDown={handleBallMouseDown}
            onClick={handleBallClick}
            className="cursor-pointer flex items-center justify-center select-none absolute w-12 h-12 rounded-full inset-0 m-auto"
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)',
              boxShadow: nearEdge
                ? '0 0 16px 4px rgba(96,165,250,0.6), 0 0 0 2px rgba(255,255,255,0.3) inset'
                : '0 4px 20px rgba(37,99,235,0.45), 0 0 0 2px rgba(255,255,255,0.15) inset',
              transition: 'box-shadow 0.15s ease',
            }}
          >
            <Sparkles className="w-5 h-5 text-white drop-shadow-lg pointer-events-none" />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onMouseLeave={handlePanelMouseLeave}
            onMouseEnter={handlePanelMouseEnter}
            className="w-full h-full flex flex-col rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(15,15,20,0.92)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}
          >
            <ChatPanel isPinned={isPinned} onTogglePin={() => setIsPinned(p => !p)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatPanel({ isPinned, onTogglePin }: { isPinned: boolean; onTogglePin: () => void }) {
  const { state, addTask, addChatMessage, updateTask, deleteTask, setActiveDate, updateChatSessionTitle } = useStore();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const session = state.chatSessions.find(cs => cs.id === state.activeChatSessionId) || state.chatSessions[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [session?.messages, isTyping]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const text = input.trim(); setInput('');
    addChatMessage('user', text); setIsTyping(true);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await processAgentRequest(text, state, ac.signal);
      let reply = res.data.reply || '';
      if (res.intent === 'add_tasks' && res.data.proposedTasks?.length) {
        reply = reply || '好的，为你生成了以下规划：';
        const firstTaskName = res.data.proposedTasks[0];
        const targetDate = res.data.targetDate || state.activeDate;
        addTask(firstTaskName, targetDate);
        addChatMessage('model', reply, res.data.proposedTasks, res.data.targetDate);
      } else if (res.intent === 'update_task' && res.data.taskId) {
        const updates: any = {};
        if (res.data.progress !== undefined) updates.progress = res.data.progress;
        if (res.data.date) updates.date = res.data.date;
        if (res.data.notes) updates.notes = res.data.notes;
        if (res.data.priority) updates.priority = res.data.priority;
        updateTask(res.data.taskId, updates);
        const name = state.tasks.find(t => t.id === res.data.taskId)?.name || '任务';
        reply = reply || `已更新 **${name}**。`;
        addChatMessage('model', reply);
      } else if (res.intent === 'delete_task' && res.data.taskId) {
        const name = state.tasks.find(t => t.id === res.data.taskId)?.name || '任务';
        deleteTask(res.data.taskId);
        reply = reply || `已删除任务：**${name}**。`;
        addChatMessage('model', reply);
      } else { addChatMessage('model', reply); }
      if (res.data.chatTitle?.length) updateChatSessionTitle(state.activeChatSessionId, res.data.chatTitle);
    } catch (err: any) {
      addChatMessage('model', err.name === 'AbortError' ? '已停止生成。' : (err.message || '处理请求时出错。'));
    } finally { 
      setIsTyping(false); 
      abortRef.current = null;
      // Refocus input after response if it's still expanded
      requestAnimationFrame(() => {
        document.querySelector('input')?.focus();
      });
    }
  };

  const msgs = (session?.messages || []).slice(-20);

  return (
    <>
      <div 
        onMouseDown={(e) => {
          e.preventDefault();
          window.electronAPI?.windowDragStart();
          const startX = e.clientX; const startY = e.clientY;
          let rafId = 0;
          const onMove = (ev: MouseEvent) => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
              window.electronAPI?.windowDragTo(ev.screenX - startX, ev.screenY - startY);
            });
          };
          const onUp = () => {
            cancelAnimationFrame(rafId);
            window.electronAPI?.windowDragEnd();
            window.electronAPI?.ballCheckSnap();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        className="flex items-center justify-between px-4 py-2.5 cursor-move border-b border-white/5 shrink-0"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-xs font-semibold text-white/80">{state.settings.agentName || '科研助理'}</span>
        </div>
        <button
          onClick={onTogglePin}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${isPinned ? 'text-blue-400 bg-blue-500/20' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
          title={isPinned ? '取消固定' : '固定在桌面'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 hide-scrollbar">
        {msgs.map((msg, i) => (
          <motion.div key={msg.id + i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed rounded-xl ${
              msg.role === 'user' ? 'bg-blue-500/80 text-white rounded-tr-sm' : 'bg-white/[0.06] text-white/85 rounded-tl-sm border border-white/5'
            }`}>
              <div className="prose prose-sm prose-invert break-words max-w-full [&_p]:my-0.5"><Markdown>{msg.text}</Markdown></div>
            </div>
          </motion.div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-1 px-3 py-2">
            {[0, 0.15, 0.3].map((d, i) => <span key={i} className="animate-bounce inline-block w-1 h-1 bg-blue-400 rounded-full" style={{ animationDelay: `${d}s` }} />)}
            <button onClick={() => abortRef.current?.abort()} className="ml-2 text-[10px] text-white/40 hover:text-white/70">停止</button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-3 border-t border-white/5 shrink-0">
        <form onSubmit={handleSubmit} className="relative">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="输入指令..."
            className="w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2.5 pr-9 text-xs text-white placeholder:text-white/25 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/30 outline-none transition-all" />
          <button type="submit" disabled={!input.trim() || isTyping} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 disabled:opacity-30">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </>
  );
}

export default function FloatingBallWindow() {
  return (
    <StoreProvider>
      <div className="w-full h-full" style={{ background: 'transparent' }}><FloatingBallContent /></div>
    </StoreProvider>
  );
}
