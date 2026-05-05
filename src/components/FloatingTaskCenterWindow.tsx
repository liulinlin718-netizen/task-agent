import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Plus, GripVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { StoreProvider, useStore } from '../Store';
import { format } from 'date-fns';

function TaskCenterContent() {
  const { state, addTask, updateTask } = useStore();
  const [newTaskInput, setNewTaskInput] = useState('');
  const [snappedEdge, setSnappedEdge] = useState<'left' | 'right' | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 320, h: 480 });
  const [panelSize, setPanelSize] = useState({ w: 320, h: 480 });

  const today = format(new Date(), 'yyyy-MM-dd');
  const todayTasks = state.tasks.filter(t => t.date === today);

  // Prevent zoom
  useEffect(() => {
    const prevent = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    window.addEventListener('wheel', prevent, { passive: false });
    return () => window.removeEventListener('wheel', prevent);
  }, []);

  const dragStartScreen = useRef({ x: 0, y: 0 });

  useEffect(() => {
    window.electronAPI?.onTaskCenterAutoSnap((edge) => {
      setSnappedEdge(edge);
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartOffset.current = { x: e.clientX, y: e.clientY };
    dragStartScreen.current = { x: e.screenX, y: e.screenY };
    window.electronAPI?.windowDragStart();

    if (snappedEdge) {
      setSnappedEdge(null);
      setIsHovering(false);
    }
  }, [snappedEdge]);

  useEffect(() => {
    if (!isDragging) return;
    let raf: number | null = null;
    const onMove = (e: MouseEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const targetX = e.screenX - dragStartOffset.current.x;
        const targetY = e.screenY - dragStartOffset.current.y;
        window.electronAPI?.windowDragTo(targetX, targetY);
      });
    };
    const onUp = () => {
      setIsDragging(false);
      window.electronAPI?.windowDragEnd();
      const edge = window.electronAPI?.taskCenterCheckSnap();
      if (edge) {
        setSnappedEdge(edge);
        window.electronAPI?.taskCenterSnapToEdge(edge, panelSize.h);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDragging, panelSize.h]);

  // --- Resize ---
  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsResizing(true);
    const b = window.electronAPI?.windowGetBounds();
    resizeStart.current = { x: e.screenX, y: e.screenY, w: b?.width || 320, h: b?.height || 480 };
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const dw = e.screenX - resizeStart.current.x;
      const dh = e.screenY - resizeStart.current.y;
      const newW = Math.max(260, Math.min(500, resizeStart.current.w + dw));
      const newH = Math.max(300, Math.min(800, resizeStart.current.h + dh));
      const b = window.electronAPI?.windowGetBounds();
      if (b) window.electronAPI?.windowSetBounds({ x: b.x, y: b.y, width: newW, height: newH });
    };
    const onUp = () => {
      setIsResizing(false);
      const b = window.electronAPI?.windowGetBounds();
      if (b) setPanelSize({ w: b.width, h: b.height });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isResizing]);

  // --- Edge hover ---
  const handleEdgeHover = () => {
    if (snappedEdge) {
      setIsHovering(true);
      window.electronAPI?.taskCenterExpandFromEdge(snappedEdge, panelSize.w, panelSize.h);
    }
  };

  const handleEdgeLeave = () => {
    if (snappedEdge) {
      setIsHovering(false);
      window.electronAPI?.taskCenterSnapToEdge(snappedEdge, panelSize.h);
    }
  };

  const handlePanelEnter = () => { };
  const handlePanelLeave = () => { if (snappedEdge) handleEdgeLeave(); };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskInput.trim()) return;
    addTask(newTaskInput.trim(), today);
    setNewTaskInput('');
  };

  // --- Snapped edge indicator ---
  if (snappedEdge && !isHovering) {
    return (
      <div
        onMouseEnter={handleEdgeHover}
        className="w-full h-full cursor-pointer"
        style={{ background: 'transparent' }}
      />
    );
  }

  // --- Full panel ---
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onMouseEnter={handlePanelEnter}
      onMouseLeave={handlePanelLeave}
      className="w-full h-full flex flex-col rounded-2xl overflow-hidden relative"
      style={{
        background: 'rgba(15,15,20,0.90)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div 
        onMouseDown={handleMouseDown} 
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 shrink-0 cursor-move"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5 text-white/30" />
          <span className="text-xs font-semibold text-white/80">今日任务</span>
          <span className="text-[10px] text-white/30 font-mono">{today}</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">{todayTasks.length} 项</span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 hide-scrollbar">
        <AnimatePresence>
          {todayTasks.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full text-white/20 py-12">
              <CheckCircle2 className="w-8 h-8 mb-2" />
              <span className="text-xs">今天还没有任务</span>
              <span className="text-[10px] mt-1">在下方输入框添加</span>
            </motion.div>
          ) : todayTasks.map((task, i) => (
            <TaskCard key={task.id} task={task} index={i} updateTask={updateTask} />
          ))}
        </AnimatePresence>
      </div>

      {/* Add task */}
      <div className="px-3 py-3 border-t border-white/5 shrink-0">
        <form onSubmit={handleAddTask} className="relative">
          <input value={newTaskInput} onChange={e => setNewTaskInput(e.target.value)} placeholder="添加新任务..."
            className="w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2.5 pr-9 text-xs text-white placeholder:text-white/25 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/30 outline-none transition-all" />
          <button type="submit" disabled={!newTaskInput.trim()} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 disabled:opacity-30">
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Resize handle */}
      {!snappedEdge && (
        <div onMouseDown={handleResizeDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize group"
          style={{ zIndex: 50 }}>
          <svg className="w-3 h-3 text-white/15 group-hover:text-white/30 transition absolute bottom-0.5 right-0.5" viewBox="0 0 12 12">
            <path d="M11 1L1 11M11 5L5 11M11 9L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </motion.div>
  );
}

// --- Task Card with wheel scroll progress ---
function TaskCard({ task, index, updateTask }: { task: any; index: number; updateTask: (id: string, u: any) => void }) {
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    if (e.deltaY < 0) {
      updateTask(task.id, { progress: Math.min(task.progress + 1, 100) });
    } else {
      updateTask(task.id, { progress: Math.max(task.progress - 1, 0) });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ delay: index * 0.02 }}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] transition-all"
      onWheel={handleWheel}
      title="滚动滚轮更改进度"
    >
      {/* Progress ring */}
      <div className="relative w-7 h-7 shrink-0 select-none">
        <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
          <circle cx="14" cy="14" r="11" fill="none"
            stroke={task.progress >= 100 ? '#22c55e' : '#3b82f6'}
            strokeWidth="2.5"
            strokeDasharray={`${2 * Math.PI * 11}`}
            strokeDashoffset={`${2 * Math.PI * 11 * (1 - task.progress / 100)}`}
            strokeLinecap="round"
            className="transition-all duration-150"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white/60">{task.progress}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium truncate ${task.progress >= 100 ? 'text-white/30 line-through' : 'text-white/80'}`}>{task.name}</div>
        {task.priority && (
          <span className={`text-[9px] mt-0.5 inline-block px-1.5 py-0.5 rounded-full font-medium ${
            task.priority === 'high' ? 'bg-red-500/15 text-red-400' :
            task.priority === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'
          }`}>{task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}</span>
        )}
      </div>
    </motion.div>
  );
}

export default function FloatingTaskCenterWindow() {
  return (
    <StoreProvider>
      <div className="w-full h-full" style={{ background: 'transparent' }}><TaskCenterContent /></div>
    </StoreProvider>
  );
}
