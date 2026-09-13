import { useRef, useState, type MouseEvent } from 'react';
import { Sparkles, Clock3, Moon, ArrowUpRight, ChevronLeft } from 'lucide-react';
import type { ReminderAction, TaskReminder } from '../state/proactive';

export function ReminderCard({ reminder, onSuccess, onDragStart, onBack }: {
  reminder: TaskReminder;
  onSuccess: (message: string) => void;
  onDragStart: (event: MouseEvent) => void;
  onBack: () => string | undefined;
}) {
  const [progress, setProgress] = useState(reminder.progress);
  const progressRef = useRef(reminder.progress);
  const pointerId = useRef<number | null>(null);
  const changed = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = (action: ReminderAction, value = progressRef.current) => {
    if (busy) return;
    if (action === 'update' && (!Number.isFinite(value) || value < 0 || value > 100)) {
      setError('请选择 0 到 100 之间的进度。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = window.electronAPI?.reminderAction(reminder.id, action, action === 'update' ? value : undefined);
      if (!result?.ok) {
        setError(result?.error || '提醒操作暂不可用，请稍后重试。');
        return;
      }
      if (action !== 'help') {
        const messages: Partial<Record<ReminderAction, string>> = {
          update: '进度已保存', complete: '完成啦，辛苦了！', advance: '已记录这一步进展', unchanged: '已记下，慢慢来就好',
          snooze: `已设为 ${reminder.snoozeMinutes ?? 30} 分钟后提醒`, 'dismiss-task': '今天不再提醒这项任务', today: '今天先好好休息',
        };
        onSuccess(messages[action] || '已保存');
      }
    } catch {
      setError('操作未保存，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const saveProgress = () => {
    pointerId.current = null;
    changed.current = false;
    act('update');
  };
  const cancelDrag = () => {
    pointerId.current = null;
    changed.current = false;
    progressRef.current = reminder.progress;
    setProgress(reminder.progress);
  };

  return (
    <section aria-label="任务进度提醒" className="flex h-full w-full flex-col overflow-y-auto rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-amber-50 p-4 text-slate-700 shadow-lg">
      <div onMouseDown={onDragStart} className="mb-2.5 flex shrink-0 cursor-move items-center gap-2.5 select-none">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white"><Sparkles className="h-5 w-5" /></div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">陪你往前一点点</h2>
          <p className="text-[10px] text-slate-500">没有更新记录，不代表没有努力。</p>
        </div>
        <button type="button" aria-label="收起为小气泡" title="收起为小气泡" onMouseDown={event => event.stopPropagation()} onClick={() => setError(onBack() || '')} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-blue-100"><ChevronLeft className="h-4 w-4" /></button>
      </div>
      <p className="mb-2.5 shrink-0 text-xs leading-relaxed text-slate-600">{reminder.message}</p>
      <div className="mb-2.5 shrink-0 rounded-xl border border-blue-100/80 bg-white/80 px-3 py-2">
        <p className="line-clamp-2 break-words text-sm font-semibold text-slate-800" title={reminder.taskName}>{reminder.taskName}</p>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>任务日期 {reminder.taskDate}</span><output htmlFor="reminder-progress" aria-label="当前进度" className="font-semibold tabular-nums text-blue-700">当前进度 {progress}%</output></div>
        <div className="relative flex h-7 items-center">
          <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
          </div>
          <input id="reminder-progress" aria-label="提醒任务进度" aria-valuetext={`${progress}%`} type="range" min="0" max="100" step="any" value={progress} disabled={busy}
            onChange={event => {
              progressRef.current = Math.round(Number(event.target.value));
              setProgress(progressRef.current);
              changed.current = true;
              setError('');
            }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              pointerId.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => { if (pointerId.current === event.pointerId) saveProgress(); }}
            onPointerCancel={cancelDrag}
            onKeyUp={event => {
              if (changed.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) saveProgress();
            }}
            onBlur={() => { if (pointerId.current !== null) cancelDrag(); else if (changed.current) saveProgress(); }}
            className="absolute inset-0 h-full touch-none w-full cursor-pointer appearance-none rounded-lg bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-default disabled:opacity-50 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm hover:[&::-webkit-slider-thumb]:ring-4 hover:[&::-webkit-slider-thumb]:ring-blue-100 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-600 [&::-moz-range-thumb]:bg-white" />
        </div>
      </div>
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2">
        <button type="button" disabled={busy} onClick={() => act('complete')} className="rounded-xl bg-blue-600 px-1 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">完成了</button>
        <button type="button" disabled={busy} onClick={() => act('advance')} className="rounded-xl border border-blue-200 bg-blue-50 px-1 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">推进了一点</button>
        <button type="button" disabled={busy} onClick={() => act('unchanged')} className="rounded-xl border border-slate-200 bg-white px-1 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">还没变化</button>
      </div>
      {error && <p role="alert" className="mb-2 shrink-0 text-xs leading-relaxed text-rose-600">{error}</p>}
      <button type="button" disabled={busy} onClick={() => act('help')} className="mb-2 flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50">
        有点卡住了 <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
      <div className="mt-auto flex shrink-0 items-center justify-between gap-2 text-[11px]">
        <button type="button" disabled={busy} onClick={() => act('snooze')} className="flex items-center gap-1 rounded-lg py-1.5 text-slate-500 hover:text-blue-700 disabled:opacity-50"><Clock3 className="h-3 w-3" />{reminder.snoozeMinutes ?? 30}分钟后提醒</button>
        <button type="button" disabled={busy} onClick={() => act('dismiss-task')} className="rounded-lg py-1.5 text-slate-500 hover:text-blue-700 disabled:opacity-50">今天不提醒这项</button>
      </div>
      <button type="button" disabled={busy} onClick={() => act('today')} className="mt-1 flex shrink-0 items-center justify-center gap-1 rounded-lg border-t border-blue-100 pt-2 text-[10px] text-slate-400 hover:text-blue-700 disabled:opacity-50"><Moon className="h-3 w-3" />今天先休息</button>
    </section>
  );
}
