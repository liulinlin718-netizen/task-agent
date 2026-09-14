import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, Pin, PinOff, Check, Minus } from 'lucide-react';
import { StoreProvider, useStore } from '../Store';
import { useAgentChat } from '../hooks/useAgentChat';
import { ToolActivity } from './ToolActivity';
import { ReminderCard } from './ReminderCard';
import { ReminderNudge } from './ReminderNudge';
import Markdown from 'react-markdown';

function FloatingBallContent() {
  const { state } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [nearEdge, setNearEdge] = useState(false);
  const [notice, setNotice] = useState('');
  const [helpDraft, setHelpDraft] = useState<{ id: string; text: string } | null>(null);
  const [presentation, setPresentation] = useState<{ mode: string; anchor: { x: number; y: number } }>({ mode: 'ball', anchor: { x: 280, y: 64 } });
  const noticeTimer = useRef<number | null>(null);
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
            const near = targetX < workArea.x + 100 || targetX + 48 > workArea.x + workArea.width - 100;
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
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const handleBallClick = () => {
    if (hasMoved.current) return;
    if (!expanded) {
      window.electronAPI?.ballExpand();
      setExpanded(true);
    }
  };

  const collapseTimer = useRef<number | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
  }, []);

  const showReminderSuccess = (message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500);
  };

  const consumeHelpDraft = useCallback(() => setHelpDraft(null), []);

  useEffect(() => {
    const unsubscribePresentation = window.electronAPI?.onBallPresentation(detail => setPresentation(detail));
    const unsubscribe = window.electronAPI?.onReminderHelp(detail => {
      clearCollapseTimer();
      setHelpDraft({ id: crypto.randomUUID(), text: detail.prompt });
      setIsPinned(true);
      setExpanded(true);
    });
    window.electronAPI?.ballReady();
    return () => {
      unsubscribe?.();
      unsubscribePresentation?.();
      clearCollapseTimer();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [clearCollapseTimer]);

  const expandReminder = (expanded: boolean) => {
    const reminder = state.proactive?.active;
    if (!reminder) return;
    try {
      const result = window.electronAPI?.reminderExpand(reminder.id, expanded);
      return result?.ok ? undefined : result?.error || '提醒暂不可用';
    } catch { return '提醒暂不可用，请重试'; }
  };

  const handleCollapse = useCallback(() => {
    clearCollapseTimer();
    setExpanded(false);
    setIsPinned(false);
    window.electronAPI?.ballCollapse();
  }, [clearCollapseTimer]);

  // Auto-collapse on mouse leave if not pinned
  const handlePanelMouseLeave = () => {
    if (!isPinned && expanded) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;
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
        {!expanded && state.proactive?.active ? (
          presentation.mode === 'reminder' ? <ReminderCard key={state.proactive.active.id} reminder={state.proactive.active} onSuccess={showReminderSuccess} onDragStart={handleBallMouseDown} onBack={() => expandReminder(false)} />
          : <ReminderNudge key={`nudge-${state.proactive.active.id}`} reminder={state.proactive.active} anchor={presentation.anchor} onOpen={() => expandReminder(true)} onSuccess={showReminderSuccess} onDragStart={handleBallMouseDown} onPetClick={() => { if (!hasMoved.current) return expandReminder(true); }} />
        ) : !expanded ? (
          <motion.div
            key="ball"
            role="button"
            aria-label={notice ? `${notice}，打开悬浮球对话` : '打开悬浮球对话'}
            title={notice || '打开悬浮球对话'}
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hasMoved.current = false; handleBallClick(); } }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onMouseDown={handleBallMouseDown}
            onClick={handleBallClick}
            className="cursor-pointer flex items-center justify-center select-none absolute w-12 h-12 rounded-full inset-0 m-auto"
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)',
              boxShadow: nearEdge
                ? '0 0 0 3px rgba(96,165,250,0.6) inset'
                : 'none',
              transition: 'box-shadow 0.15s ease',
            }}
          >
            {notice ? <Check className="w-5 h-5 text-white pointer-events-none" /> : <Sparkles className="w-5 h-5 text-white pointer-events-none" />}
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
            <ChatPanel isPinned={isPinned} onTogglePin={() => setIsPinned(p => !p)} onCollapse={handleCollapse} helpDraft={helpDraft} onDraftConsumed={consumeHelpDraft} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatPanel({ isPinned, onTogglePin, onCollapse, helpDraft, onDraftConsumed }: {
  isPinned: boolean;
  onTogglePin: () => void;
  onCollapse: () => void;
  helpDraft: { id: string; text: string } | null;
  onDraftConsumed: () => void;
}) {
  const { state, acceptProposedTask, acceptAllProposedTasks } = useStore();
  const { busy: isTyping, send, stop } = useAgentChat();
  const [input, setInput] = useState('');
  const [isHelpDraft, setIsHelpDraft] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const session = state.chatSessions.find(cs => cs.id === state.activeChatSessionId) || state.chatSessions[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [session?.messages, isTyping]);

  useEffect(() => {
    if (!helpDraft) return;
    setInput(helpDraft.text);
    setIsHelpDraft(true);
    onDraftConsumed();
  }, [helpDraft, onDraftConsumed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const text = input.trim(); setInput(''); setIsHelpDraft(false);
    await send(text);
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
        <div className="flex items-center gap-1">
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onTogglePin}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${isPinned ? 'text-blue-400 bg-blue-500/20' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
          title={isPinned ? '取消固定' : '固定在桌面'}
          aria-label={isPinned ? '取消固定' : '固定在桌面'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>
        <button onMouseDown={event => event.stopPropagation()} onClick={onCollapse} aria-label="收起悬浮球对话" title="收起对话"
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"><Minus className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 hide-scrollbar">
        {msgs.map((msg, i) => (
          <motion.div key={msg.id + i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed rounded-xl ${
              msg.role === 'user' ? 'bg-blue-500/80 text-white rounded-tr-sm' : 'bg-white/[0.06] text-white/85 rounded-tl-sm border border-white/5'
            }`}>
              <div className="prose prose-sm prose-invert break-words max-w-full [&_p]:my-0.5"><Markdown>{msg.text}</Markdown></div>
              <ToolActivity events={msg.toolEvents} memoryStatus={msg.memoryStatus} />
              {!!msg.proposedTasks?.length && !msg.proposedTasksDismissed && <div className="mt-2 space-y-2">
                {msg.proposedTasks.map((task, index) => <button key={index} disabled={task.added}
                  onClick={() => acceptProposedTask(msg.id, index, state.activeDate)}
                  className="block text-left text-blue-300 disabled:opacity-40">{task.added ? '✓' : '+'} {task.name}{task.date ? ` · ${task.date}` : ''}</button>)}
                {!msg.proposedTasks.every(t => t.added) && <button className="text-blue-300" onClick={() => acceptAllProposedTasks(msg.id, state.activeDate)}>全部应用</button>}
              </div>}
            </div>
          </motion.div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-1 px-3 py-2">
            {[0, 0.15, 0.3].map((d, i) => <span key={i} className="animate-bounce inline-block w-1 h-1 bg-blue-400 rounded-full" style={{ animationDelay: `${d}s` }} />)}
            <button onClick={stop} className="ml-2 text-[10px] text-white/40 hover:text-white/70">停止</button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-3 border-t border-white/5 shrink-0">
        {isHelpDraft && <p className="mb-2 text-[10px] leading-relaxed text-blue-300/80">已准备求助内容，可以修改，点击发送后再一起想办法。</p>}
        <form onSubmit={handleSubmit} className="relative">
          <input aria-label="悬浮球对话输入" value={input} onChange={e => setInput(e.target.value)} placeholder="输入指令..."
            className="w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2.5 pr-9 text-xs text-white placeholder:text-white/25 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/30 outline-none transition-all" />
          <button type="submit" aria-label="发送消息" disabled={!input.trim() || isTyping} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 disabled:opacity-30">
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
