import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { StoreProvider, useStore } from "./Store";
import { TaskHub } from "./components/TaskHub";
import { Profile } from "./components/Profile";
import { History } from "./components/History";
import { Settings } from "./components/Settings";
import { AgentChat } from "./components/AgentChat";
import { useRolloverEngine } from "./components/RolloverEngine";
import { User, CheckSquare, History as HistoryIcon, Settings as SettingsIcon } from "lucide-react";

export default function App() {
  return (
    <StoreProvider>
      <MainLayout />
    </StoreProvider>
  );
}

function MainLayout() {
  useRolloverEngine();
  const [activeTab, setActiveTab] = useState<"profile" | "tasks" | "history" | "settings">("tasks");
  const { state } = useStore();
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsDragging(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (isDragging && containerRef.current) {
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      // Calculate new width (container width - mouse X position)
      let newWidth = containerWidth - mouseMoveEvent.clientX;
      if (newWidth < 250) newWidth = 250;
      if (newWidth > 600) newWidth = 600;
      setSidebarWidth(newWidth);
    }
  }, [isDragging]);

  useEffect(() => {
    let timer: number | null = null;
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList && target.classList.contains('auto-hide-scrollbar')) {
        target.classList.add('is-scrolling');
        if (timer) clearTimeout(timer);
        timer = window.setTimeout(() => {
          target.classList.remove('is-scrolling');
        }, 800);
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isDragging, resize, stopResizing]);

  return (
    <div ref={containerRef} className={`flex h-screen w-full overflow-hidden font-sans select-none ${state.settings.theme === 'dark' ? 'dark bg-[#121212] text-[#F5F5F7]' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`}>
      {/* Left Navigation */}
      <div className="w-20 bg-white/80 dark:bg-neutral-900/80 border-r border-gray-200 dark:border-neutral-800 flex flex-col items-center py-10 space-y-8 z-20 shrink-0">
        {state.profile.avatar ? (
          <img src={state.profile.avatar} alt="Avatar" className="w-10 h-10 rounded-xl object-cover shadow-md" />
        ) : (
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/20">
            <User className="w-6 h-6" />
          </div>
        )}
        <NavButton icon={<CheckSquare />} active={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
        <NavButton icon={<HistoryIcon />} active={activeTab === "history"} onClick={() => setActiveTab("history")} />
        <NavButton icon={<User />} active={activeTab === "profile"} onClick={() => setActiveTab("profile")} />
        <NavButton icon={<SettingsIcon />} active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
      </div>

      {/* Middle Main Content */}
      <div className="flex-1 overflow-hidden relative min-w-[300px]">
        <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]" />
        <div className="relative h-full w-full">
          {activeTab === "tasks" && <TaskHub />}
          {activeTab === "profile" && <Profile />}
          {activeTab === "history" && <History />}
          {activeTab === "settings" && <Settings />}
        </div>
      </div>

      {/* Right Agent Chat */}
      <div 
        style={{ width: sidebarWidth }}
        className="relative shrink-0 overflow-hidden z-20 bg-white/60 dark:bg-neutral-900/60 border-l border-gray-200 dark:border-neutral-800 backdrop-blur-2xl transition-[background-color,border-color,width] duration-0"
      >
        {/* Resizer Handle */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group flex items-center justify-center"
          onMouseDown={startResizing}
        >
          {/* Visual Indicator */}
          <div className={`w-1 h-12 rounded-full transition-colors duration-200 ${isDragging ? 'bg-gray-400 dark:bg-gray-500' : 'bg-transparent group-hover:bg-gray-300 dark:group-hover:bg-gray-600'}`} />
          {/* Full height vertical line while dragging */}
          <div className={`absolute left-0 top-0 bottom-0 w-[2px] transition-opacity duration-200 ${isDragging ? 'bg-blue-400/50 dark:bg-blue-500/50 opacity-100' : 'opacity-0'}`} />
        </div>
        <AgentChat />
      </div>
    </div>
  );
}

function NavButton({ icon, active, onClick }: { icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center justify-center p-3 transition-colors ${active ? "text-white" : "text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"} w-12 h-12 rounded-xl group`}
    >
      {active && (
        <motion.div
          layoutId="activeTabIndicator"
          className="absolute inset-0 bg-blue-600 rounded-xl shadow-lg shadow-blue-200 dark:shadow-blue-900/20"
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
      )}
      <span className="relative z-10 w-6 h-6 flex items-center justify-center pointer-events-none">
        {icon}
      </span>
    </button>
  );
}


