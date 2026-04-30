import { useState, useRef } from "react";
import { useStore, Task } from "../Store";
import { format, addDays, subDays } from "date-fns";
import { Button } from "../../components/ui/button";
import { Plus, Trash2, CalendarIcon, ChevronDown, Flag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Calendar } from "../../components/ui/calendar";
import { motion, AnimatePresence } from "motion/react";

export function TaskHub() {
  const { state, updateTask, deleteTask, addTask, setActiveDate } = useStore();
  const [newTaskName, setNewTaskName] = useState("");

  const activeDateObj = new Date(state.activeDate + "T12:00:00");
  const yesterday = subDays(activeDateObj, 1);
  const tomorrow = addDays(activeDateObj, 1);

  const activeTasks = state.tasks.filter(t => t.date === state.activeDate);

  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dates = [-2, -1, 0, 1, 2].map(offset => addDays(activeDateObj, offset));

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskName.trim()) return;
    addTask(newTaskName, state.activeDate);
    setNewTaskName("");
    
    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  return (
    <main className="flex-1 flex flex-col h-full animate-in fade-in zoom-in-95 duration-300 relative">
      <div className="flex-1 overflow-y-auto auto-hide-scrollbar w-full" ref={scrollContainerRef}>
        <div className="px-12 py-10 max-w-[900px] mx-auto min-h-max space-y-8 pb-32">
          <header className="flex items-center justify-between">
            <div className="flex flex-col">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">任务中心</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">专注你的所有任务计划。</p>
            </div>
            <div className="flex items-center space-x-2">
              <Popover>
                <PopoverTrigger render={
                  <button className="flex items-center space-x-2 bg-white dark:bg-neutral-800 rounded-full px-4 py-2 border border-gray-100 dark:border-neutral-700 shadow-sm hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                    <span className="text-sm font-medium text-foreground">
                      {state.activeDate === format(new Date(), 'yyyy-MM-dd') ? "今天" : format(activeDateObj, 'yyyy-MM-dd')}
                    </span>
                    <CalendarIcon className="w-4 h-4 text-gray-400" />
                  </button>
                } />
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={activeDateObj}
                    onSelect={(d) => d && setActiveDate(format(d, 'yyyy-MM-dd'))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </header>

          <div className="relative w-full overflow-hidden py-6">
            <div className="flex items-center justify-center space-x-3 w-full">
              <AnimatePresence mode="popLayout" initial={false}>
                {dates.map((date, i) => {
                  const isCenter = i === 2; // Offset 0
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const displayDate = format(date, 'MM-dd');
                  const dayName = weekdays[date.getDay()];
                  return (
                    <motion.button
                      layout
                      initial={{ opacity: 0, scale: 0.8, x: i < 2 ? -30 : 30 }}
                      animate={{ opacity: 1, scale: isCenter ? 1.1 : 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.8, x: isCenter ? 0 : (i < 2 ? -30 : 30) }}
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      key={dateStr}
                      onClick={() => setActiveDate(dateStr)}
                      className={`flex-shrink-0 cursor-pointer rounded-2xl flex flex-col items-center justify-center z-10 ${
                        isCenter 
                          ? 'w-24 h-24 bg-blue-600 shadow-lg shadow-blue-600/30 text-white'
                          : dateStr === format(new Date(), 'yyyy-MM-dd')
                            ? 'w-20 h-20 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                            : 'w-20 h-20 bg-white dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-blue-600 dark:hover:text-blue-400'
                      }`}
                    >
                      <span className={`text-xs ${isCenter ? 'opacity-80' : dateStr === format(new Date(), 'yyyy-MM-dd') ? 'text-blue-500/80 dark:text-blue-400/80' : 'text-gray-400 dark:text-gray-500'}`}>{dayName}</span>
                      <span className={`font-bold mt-1 ${isCenter ? 'text-lg' : dateStr === format(new Date(), 'yyyy-MM-dd') ? 'text-sm text-blue-700 dark:text-blue-300' : 'text-sm text-foreground'}`}>{displayDate}</span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          <div className="space-y-4">
            {activeTasks.length === 0 ? (
              <div className="text-center mt-20 text-gray-400 dark:text-gray-500">
                今天没有记录任务。享受你的空闲时间，或者添加一个新任务！
              </div>
            ) : (
              activeTasks.map(task => (
                <TaskCard key={task.id} task={task} onUpdate={(u) => updateTask(task.id, u)} onDelete={() => deleteTask(task.id)} />
              ))
            )}
          </div>
          
          <div className="sticky bottom-8 z-50 pt-4">
            <form onSubmit={handleAddTask} className="flex relative items-center">
              <input
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder="新的任务计划..."
                className="w-full bg-white/[.65] dark:bg-neutral-800/[.65] backdrop-blur-md border border-blue-400 dark:border-blue-500 rounded-2xl px-6 py-4 pr-14 text-sm focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-500 transition-all outline-none shadow-xl shadow-black/5 text-foreground placeholder:text-gray-400"
              />
              <button type="submit" className="absolute right-3 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors bg-blue-50 dark:bg-blue-900/30 p-2 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/50">
                <Plus className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function TaskCard({ task, onUpdate, onDelete }: { task: Task, onUpdate: (u: Partial<Task>) => void, onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(task.notes || "");
  const isDone = task.progress >= 100;

  const priorityLabel = {
    low: "低优先级",
    medium: "中优先级",
    high: "高优先级"
  };

  const cyclePriority = () => {
    if (!task.priority || task.priority === 'low') onUpdate({ priority: 'medium' });
    else if (task.priority === 'medium') onUpdate({ priority: 'high' });
    else onUpdate({ priority: 'low' });
  };

  const getPriorityClasses = () => {
    if (task.priority === 'high') return "text-red-600 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-900/50";
    if (task.priority === 'medium') return "text-orange-600 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-900/50";
    return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-900/50";
  };

  return (
    <div className={`group relative bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-gray-100 dark:border-neutral-700 hover:shadow-md transition-shadow flex flex-col ${isDone ? 'opacity-60 grayscale' : ''}`}>
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1 mr-4">
            {editing ? (
              <input
                autoFocus
                className="bg-transparent border-b border-gray-300 dark:border-gray-600 outline-none text-lg font-medium w-full text-foreground"
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => { setEditing(false); onUpdate({ name }); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onUpdate({ name }); } }}
              />
            ) : (
              <h3 
                onDoubleClick={() => setEditing(true)} 
                className={`text-lg font-medium text-foreground ${isDone ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}
              >
                {task.name}
              </h3>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" onClick={() => setNotesOpen(!notesOpen)} className={`opacity-0 group-hover:opacity-100 transition-all text-gray-400 hover:text-blue-500 h-6 w-6 ${notesOpen ? 'rotate-180 opacity-100 bg-blue-50 dark:bg-blue-900/30 text-blue-600' : ''}`}>
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 h-6 w-6">
              <Trash2 className="h-4 w-4" />
            </Button>
            <span className={`font-mono text-sm font-bold ${isDone ? 'text-emerald-500 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
              {task.progress}%
            </span>
          </div>
        </div>
        
        <div className="flex items-center w-full relative h-6 group/slider">
          <input
            type="range"
            min="0"
            max="100"
            value={task.progress}
            onChange={(e) => onUpdate({ progress: Number(e.target.value) })}
            className="w-full appearance-none bg-transparent absolute inset-0 z-10 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:ring-4 hover:[&::-webkit-slider-thumb]:ring-blue-100 transition-all focus:outline-none"
          />
          <div className="w-full h-2 bg-gray-100 dark:bg-neutral-700 rounded-full overflow-hidden absolute inset-0 my-auto p-0 z-0">
            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${task.progress}%` }}></div>
          </div>
        </div>
        
        {!isDone && (
          <div className="mt-4 flex items-center space-x-3 select-none">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 border border-gray-100 dark:border-neutral-700 px-2 py-0.5 rounded">任务</span>
            <button 
              onClick={cyclePriority}
              title="点击切换优先级"
              className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[10px] uppercase font-bold transition-colors ${getPriorityClasses()}`}
            >
              <Flag className="w-3 h-3" />
              <span>{priorityLabel[task.priority || 'low']}</span>
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {notesOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-gray-100 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-800/50 rounded-b-2xl"
          >
            <div className="p-4">
              <textarea
                placeholder="添加任务备注或心得体验..."
                className="w-full text-sm bg-transparent border-none outline-none resize-none min-h-[80px] text-gray-600 dark:text-gray-300 placeholder:text-gray-400"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => onUpdate({ notes })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
