import { useState, useMemo, useRef, useEffect } from "react";
import { useStore } from "../Store";
import Markdown from "react-markdown";
import { format, parseISO, startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear, isWithinInterval, isSameDay } from "date-fns";
import { generateCustomSummary } from "../services/AgentService";
import { Calendar as CalendarIcon, Sparkles, ChevronUp, CheckSquare, Square, X, Loader2, ListFilter, FileText, CheckCircle2, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export function History() {
  const { state, addReport } = useStore();
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'year'>('day');
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'day' | 'week' | 'month' | 'year'>('day');
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showReports, setShowReports] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [newlyGeneratedId, setNewlyGeneratedId] = useState<string | null>(null);
  const [activeNavIdx, setActiveNavIdx] = useState(0);

  const datesContainerRef = useRef<HTMLDivElement>(null);
  const generatorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (generatorRef.current && !generatorRef.current.contains(event.target as Node)) {
        setIsGeneratorOpen(false);
      }
    }
    
    if (isGeneratorOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isGeneratorOpen]);

  // Collect all unique dates from tasks
  const allDates = useMemo(() => {
    const dates = new Set<string>();
    state.tasks.forEach(t => dates.add(t.date));
    state.historySummaries.forEach(h => dates.add(h.date));
    return Array.from(dates).sort((a, b) => b.localeCompare(a)); // Descending
  }, [state.tasks, state.historySummaries]);

  // Grouped history summaries based on viewMode
  // However, historySummaries is currently pre-generated daily summaries.
  // For 'day', we render normal summaries + raw tasks for dates without summaries.
  // For 'week', 'month', 'year', we could either just group the daily summaries or just group the tasks.
  // Let's simple group the `allDates`
  const groupedData = useMemo(() => {
    const groups: { label: string; dates: string[] }[] = [];
    allDates.forEach(date => {
      const d = parseISO(date);
      let label = date;
      if (viewMode === 'week') {
        label = `${format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')} 至 ${format(endOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')}`;
      } else if (viewMode === 'month') {
        label = format(d, 'yyyy-MM');
      } else if (viewMode === 'year') {
        label = format(d, 'yyyy');
      }
      
      let group = groups.find(g => g.label === label);
      if (!group) {
        group = { label, dates: [] };
        groups.push(group);
      }
      group.dates.push(date);
    });
    return groups;
  }, [allDates, viewMode]);

  // Build continuous date nav items for reports (based on report target dates, not creation time)
  const reportNavItems = useMemo(() => {
    const reports = state.reports || [];
    if (reports.length === 0) return [];
    // Collect all first-dates from report target ranges
    const reportDates = reports.map(r => r.dates?.[0] || r.createdAt.split('T')[0]).sort();
    if (reportDates.length === 0) return [];
    // Build continuous date range from min to max
    const minDate = new Date(reportDates[0]);
    const maxDate = new Date(reportDates[reportDates.length - 1]);
    const items: { label: string }[] = [];
    const d = new Date(minDate);
    while (d <= maxDate) {
      items.push({ label: format(d, 'MM-dd') });
      d.setDate(d.getDate() + 1);
    }
    return items;
  }, [state.reports]);

  const toggleDate = (date: string) => {
    const next = new Set(selectedDates);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    setSelectedDates(next);
  };

  // Grouping for the Selection Calendar
  const selectableGroups = useMemo(() => {
    const groups: { label: string; dates: string[] }[] = [];
    allDates.forEach(date => {
      const d = parseISO(date);
      let label = date;
      if (selectionMode === 'week') {
        label = `${format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')} 至 ${format(endOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')}`;
      } else if (selectionMode === 'month') {
        label = format(d, 'yyyy-MM');
      } else if (selectionMode === 'year') {
        label = format(d, 'yyyy');
      }
      
      let group = groups.find(g => g.label === label);
      if (!group) {
        group = { label, dates: [] };
        groups.push(group);
      }
      group.dates.push(date);
    });
    return groups;
  }, [allDates, selectionMode]);

  const toggleSelectGroup = (groupDates: string[]) => {
    const next = new Set(selectedDates);
    const allSelected = groupDates.every(d => next.has(d));
    if (allSelected) {
      groupDates.forEach(d => next.delete(d));
    } else {
      groupDates.forEach(d => next.add(d));
    }
    setSelectedDates(next);
  };

  const toggleAll = () => {
    if (selectedDates.size === allDates.length) {
      setSelectedDates(new Set());
    } else {
      setSelectedDates(new Set(allDates));
    }
  };

  const scrollToDate = (labelOrId: string, isReport: boolean = false) => {
    const elId = isReport ? labelOrId : `history-group-${labelOrId}`;
    const el = document.getElementById(elId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    let elements: HTMLElement[] = [];
    if (!showReports && groupedData.length > 0) {
      elements = groupedData.map(g => document.getElementById(`history-group-${g.label}`)).filter(Boolean) as HTMLElement[];
    } else if (showReports && !selectedReportId && state.reports && state.reports.length > 0) {
      elements = state.reports.map((_, idx) => document.getElementById(`report-group-${idx}`)).filter(Boolean) as HTMLElement[];
    }

    if (elements.length === 0) return;

    let activeIndex = 0;
    const containerTop = container.getBoundingClientRect().top;
    const offset = 150; // Activation line 150px below container top

    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect();
      if (rect.top <= containerTop + offset) {
        activeIndex = i;
      } else {
        break; // Assuming elements are ordered from top to bottom
      }
    }

    if (activeIndex !== activeNavIdx) {
      setActiveNavIdx(activeIndex);
    }
  };

  const handleGenerate = async () => {
    if (selectedDates.size === 0) return;
    setIsGenerating(true);
    setErrorMsg("");
    setNewlyGeneratedId(null);
    try {
      const dates = Array.from(selectedDates).sort();
      const res = await generateCustomSummary(dates, state);
      
      const newId = Date.now().toString();
      let title = "日期总结报告";
      if (dates.length === 1) title = `日总结 (${dates[0]})`;
      else if (dates.length <= 7) title = `周总结 (${dates[0]} 至 ${dates[dates.length - 1]})`;
      else title = `阶段总结 (${dates[0]} 至 ${dates[dates.length - 1]})`;

      addReport(title, dates, res);
      setNewlyGeneratedId(newId); // Flag for the checkmark
      setIsGeneratorOpen(false);
      setSelectedDates(new Set()); // Reset selection
    } catch (e: any) {
      setErrorMsg(e.message || "生成失败，请重试。");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 w-full h-full relative overflow-hidden flex bg-gray-50/50 dark:bg-neutral-900/50">
      
      {/* Main Content Area */}
      <div 
        className="flex-1 overflow-y-auto h-full px-6 py-12 auto-hide-scrollbar pr-12 lg:pr-14" 
        id="history-scroll-container"
        onScroll={handleScroll}
      >
        <div className="w-full max-w-4xl mx-auto pb-[60vh] animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 border-b border-gray-100 dark:border-neutral-800 pb-6">
            <div className="flex items-center gap-4">
              {showReports && (
                <button 
                  onClick={() => selectedReportId ? setSelectedReportId(null) : setShowReports(false)}
                  className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors text-gray-500"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                  {showReports ? (selectedReportId ? "报告详情" : "总结报告") : "历史与总结"}
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                  {showReports ? "查看智能生成的历史总结分析。" : "回顾你的研究进展、任务记录及总结报告。"}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              {!showReports && (
                <div className="flex bg-white dark:bg-neutral-800 p-1 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-700">
                  {['day', 'week', 'month', 'year'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode as any)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        viewMode === mode 
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-sm' 
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      {mode === 'day' ? '日' : mode === 'week' ? '周' : mode === 'month' ? '月' : '年'}视图
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  if (selectedReportId) setSelectedReportId(null);
                  else setShowReports(!showReports);
                }}
                className={`p-2 rounded-xl border flex items-center justify-center transition-colors ${
                  showReports || selectedReportId
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 border-blue-200 dark:border-blue-900/50'
                    : 'bg-white dark:bg-neutral-800 text-gray-500 border-gray-100 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700'
                }`}
                title={showReports ? "返回历史" : "查看报告"}
              >
                <FileText className="w-5 h-5" />
              </button>
            </div>
          </div>

          {showReports ? (
            selectedReportId ? (
              <div className="animate-in slide-in-from-right-4 duration-300">
                {state.reports?.filter(r => r.id === selectedReportId).map(report => (
                   <div key={report.id} className="bg-white dark:bg-neutral-800 border border-border p-8 rounded-3xl space-y-6 shadow-sm">
                     <div className="border-b border-border pb-6 mb-6">
                       <h3 className="text-2xl font-semibold mb-2">{report.title}</h3>
                       <p className="text-sm text-muted-foreground">生成时间: {format(parseISO(report.createdAt), 'yyyy-MM-dd HH:mm')}</p>
                     </div>
                     <div className="prose prose-sm dark:prose-invert max-w-none">
                       <Markdown>{report.content}</Markdown>
                     </div>
                   </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-left-4 duration-300">
                {!state.reports || state.reports.length === 0 ? (
                  <div className="col-span-full py-20 text-center text-gray-500 border border-dashed rounded-3xl">暂无报告。</div>
                ) : (
                  state.reports.map((report, idx) => (
                    <button 
                      key={report.id}
                      id={`report-group-${idx}`}
                      onClick={() => setSelectedReportId(report.id)}
                      className="text-left bg-white dark:bg-neutral-800 border border-border p-6 rounded-3xl shadow-sm hover:shadow-md transition-shadow group relative"
                    >
                      <h4 className="font-semibold text-lg mb-2 truncate pr-8">{report.title}</h4>
                      <p className="text-xs text-muted-foreground mb-4">{format(parseISO(report.createdAt), 'yyyy-MM-dd HH:mm')}</p>
                      <div className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3">
                        <Markdown>{report.content.replace(/[^a-zA-Z0-9\u4e00-\u9fa5，。？！]/g, ' ').substring(0, 100) + '...'}</Markdown>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )
          ) : (
            groupedData.length === 0 ? (
              <div className="text-center py-20 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-neutral-700 border-dashed rounded-3xl bg-white/50 dark:bg-neutral-800/50">
                暂无历史记录。
              </div>
            ) : (
              <div className="space-y-8">
                {groupedData.map((group, i) => (
                  <div key={group.label} id={`history-group-${group.label}`} className="bg-white dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 p-6 rounded-3xl space-y-4 shadow-sm">
                    <h3 className="text-xl font-semibold text-foreground sticky top-0 bg-white/90 dark:bg-neutral-800/90 py-2 backdrop-blur-sm z-10 border-b border-gray-100 dark:border-neutral-700">
                      {group.label}
                    </h3>
                    
                    {group.dates.map(date => {
                      const dayTasks = state.tasks.filter(t => t.date === date);
                      const summary = state.historySummaries.find(h => h.date === date);
                      return (
                        <div key={date} className="pt-4 first:pt-2">
                          {viewMode !== 'day' && <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{date}</div>}
                          
                          {summary && !(dayTasks.length > 0 && summary.summary.includes("没有记录任何任务")) && (
                            <div className="prose prose-sm dark:prose-invert text-gray-600 dark:text-gray-300 italic mb-4 bg-gray-50 dark:bg-neutral-700/30 p-4 rounded-xl">
                              <Markdown>{summary.summary}</Markdown>
                            </div>
                          )}
                          
                          {dayTasks.length > 0 && (
                            <ul className="text-sm space-y-3 mb-2">
                              {dayTasks.map(t => (
                                <li key={t.id} className="flex flex-col text-gray-800 dark:text-gray-200">
                                  <div className="flex justify-between items-center">
                                    <span className={t.progress >= 100 ? "line-through text-gray-400 dark:text-gray-500" : ""}>{t.name}</span>
                                    <span className={`text-xs ${t.progress >= 100 ? "text-emerald-500 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"}`}>{t.progress}%</span>
                                  </div>
                                  {t.notes && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 pl-3 border-l-2 border-gray-200 dark:border-neutral-700 whitespace-pre-wrap"><Markdown>{t.notes}</Markdown></div>}
                                </li>
                              ))}
                            </ul>
                          )}

                          {dayTasks.length === 0 && !summary && (
                            <div className="text-sm text-gray-400">无记录</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Side Scrollbar Navigation */}
      <div 
        className="hidden lg:flex w-16 flex-col z-10 absolute right-0 top-1/2 -translate-y-1/2 bottom-auto bg-transparent items-end pr-3 py-4"
        onWheel={(e) => {
          const items = !showReports ? groupedData : reportNavItems;
          if (e.deltaY > 0 && activeNavIdx < items.length - 1) {
            const nextIdx = activeNavIdx + 1;
            scrollToDate(showReports ? `report-group-${nextIdx}` : items[nextIdx].label, showReports);
          } else if (e.deltaY < 0 && activeNavIdx > 0) {
            const prevIdx = activeNavIdx - 1;
            scrollToDate(showReports ? `report-group-${prevIdx}` : items[prevIdx].label, showReports);
          }
        }}
      >
        <div className="relative h-[160px] w-full flex flex-col justify-end overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)' }}>
          <motion.div
            className="absolute top-[74px] w-full flex flex-col items-end gap-[12px]"
            animate={{ y: -activeNavIdx * 24 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          >
            {(!showReports ? groupedData : reportNavItems).map((item, idx) => {
              const isCenter = idx === activeNavIdx;
              const distance = Math.abs(idx - activeNavIdx);
              
              // Fade and scale based on distance
              let opacity = 0;
              let scale = 0.8;
              let colorClasses = "text-gray-400 dark:text-gray-500 font-medium";
              
              if (distance === 0) {
                opacity = 1;
                scale = 1;
                colorClasses = "text-blue-500 font-bold";
              } else if (distance === 1) {
                opacity = 0.6;
                scale = 0.9;
              } else if (distance === 2) {
                opacity = 0.3;
                scale = 0.8;
              }

              return (
                <button
                  key={`${item.label}-${idx}`}
                  onClick={() => scrollToDate(showReports ? `report-group-${idx}` : item.label, showReports)}
                  className="flex items-center justify-end w-full h-[12px] group"
                  title={item.label}
                >
                  <span 
                    className={`text-[11px] whitespace-nowrap transition-all duration-300 tracking-wider select-none tabular-nums ${colorClasses}`}
                    style={{ opacity, transform: `scale(${scale})`, transformOrigin: "right center" }}
                  >
                    {item.label.length > 5 ? item.label.slice(-5) : item.label}
                  </span>
                </button>
              );
            })}
          </motion.div>
        </div>
      </div>

      {/* Floating Summary Generator */}
      <div ref={generatorRef} className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
        <AnimatePresence>
          {isGeneratorOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-80 bg-white dark:bg-neutral-800 rounded-2xl shadow-xl border border-gray-200 dark:border-neutral-700 overflow-hidden flex flex-col"
            >
              <div className="p-3 border-b border-gray-100 dark:border-neutral-700 flex flex-col gap-2 bg-gray-50 dark:bg-neutral-800/80">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">生成总结范围选项</span>
                  <button 
                    onClick={toggleAll}
                    className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-2 py-1 rounded"
                  >
                    {selectedDates.size === allDates.length ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                    全选
                  </button>
                </div>
                <div className="flex bg-white dark:bg-neutral-800 p-1 rounded-lg shadow-sm border border-gray-200 dark:border-neutral-700">
                  {['day', 'week', 'month', 'year'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => { setSelectionMode(mode as any); setSelectedDates(new Set()); }}
                      className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        selectionMode === mode 
                          ? 'bg-blue-100/50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-sm' 
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      {mode === 'day' ? '按日' : mode === 'week' ? '按周' : mode === 'month' ? '按月' : '按年'}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="max-h-60 overflow-y-auto p-2" ref={datesContainerRef}>
                {selectableGroups.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-400">暂无日期可供选择</div>
                ) : (
                  selectableGroups.map(group => {
                    const allSelected = group.dates.every(d => selectedDates.has(d));
                    return (
                      <button
                        key={group.label}
                        onClick={() => toggleSelectGroup(group.dates)}
                        className="w-full flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-neutral-700/50 rounded-lg transition-colors text-sm"
                      >
                        <span className="text-gray-700 dark:text-gray-300 relative pl-6">
                          <span className="absolute left-1 top-1/2 -translate-y-1/2">
                            {allSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-500" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                            )}
                          </span>
                          {group.label} <span className="text-xs text-gray-400 ml-1">({group.dates.length})</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              
              {errorMsg && (
                <div className="p-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 text-center border-t border-red-100 dark:border-red-900/50">
                  {errorMsg}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-white dark:bg-neutral-800 shadow-xl border border-gray-200 dark:border-neutral-700 p-2 rounded-full flex items-center gap-2">
          <button
            onClick={() => setIsGeneratorOpen(!isGeneratorOpen)}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
          >
            {isGeneratorOpen ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <CalendarIcon className="w-5 h-5 text-gray-500" />}
          </button>
          
          <button
            disabled={selectedDates.size === 0 || isGenerating}
            onClick={handleGenerate}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-medium rounded-full transition-all shadow-md hover:shadow-lg disabled:shadow-none whitespace-nowrap"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isGenerating ? "生成中..." : `生成总结 ${selectedDates.size > 0 ? `(${selectedDates.size})` : ''}`}
          </button>

          {newlyGeneratedId && (
            <AnimatePresence>
              <motion.button
                initial={{ opacity: 0, scale: 0.5, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                onClick={() => {
                  setShowReports(true);
                  setSelectedReportId(newlyGeneratedId);
                  setNewlyGeneratedId(null);
                }}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 transition-colors shadow-sm ml-1"
                title="查看最新报告"
              >
                <CheckCircle2 className="w-5 h-5" />
              </motion.button>
            </AnimatePresence>
          )}
        </div>
      </div>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
