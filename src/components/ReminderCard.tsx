import { useState, type MouseEvent } from 'react';
import { HeartHandshake, Clock3, Moon, ArrowUpRight } from 'lucide-react';
import type { ReminderAction, TaskReminder } from '../state/proactive';

export function ReminderCard({ reminder, onSuccess, onDragStart }: {
  reminder: TaskReminder;
  onSuccess: (message: string) => void;
  onDragStart: (event: MouseEvent) => void;
}) {
  const [progress, setProgress] = useState(String(reminder.progress));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = (action: ReminderAction) => {
    if (busy) return;
    const value = Number(progress);
    if (action === 'update' && (!progress.trim() || !Number.isFinite(value) || value < 0 || value > 100)) {
      setError('请填写 0 到 100 之间的进度。');
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
        onSuccess(action === 'update' ? '进度已保存' : action === 'snooze' ? '已设为 30 分钟后提醒' : '今天先好好休息');
      }
    } catch {
      setError('操作未保存，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="任务进度提醒" className="flex h-full w-full flex-col overflow-y-auto rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-amber-50 p-4 text-slate-700 shadow-lg">
      <div onMouseDown={onDragStart} className="mb-2.5 flex shrink-0 cursor-move items-center gap-2.5 select-none">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-100 text-sky-600"><HeartHandshake className="h-5 w-5" /></div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">陪你往前一点点</h2>
          <p className="text-[10px] text-slate-500">没有更新记录，不代表没有努力。</p>
        </div>
      </div>
      <p className="mb-2.5 shrink-0 text-xs leading-relaxed text-slate-600">{reminder.message}</p>
      <div className="mb-2.5 shrink-0 rounded-xl border border-sky-100/80 bg-white/80 px-3 py-2">
        <p className="line-clamp-2 break-words text-sm font-semibold text-slate-800" title={reminder.taskName}>{reminder.taskName}</p>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>任务日期 {reminder.taskDate}</span><span>当前进度 {reminder.progress}%</span></div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(0, Math.min(100, reminder.progress))}%` }} /></div>
      </div>
      <form onSubmit={event => { event.preventDefault(); act('update'); }} className="mb-2 flex shrink-0 items-center gap-2">
        <label htmlFor="reminder-progress" className="text-xs text-slate-600">记录进度</label>
        <div className="relative w-20">
          <input id="reminder-progress" aria-label="提醒任务进度" type="number" min="0" max="100" step="any" value={progress} disabled={busy}
            onChange={event => { setProgress(event.target.value); setError(''); }}
            className="w-full rounded-lg border border-sky-200 bg-white py-1.5 pl-2 pr-5 text-xs outline-none focus:ring-2 focus:ring-sky-200" />
          <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-slate-400">%</span>
        </div>
        <button type="submit" disabled={busy} className="ml-auto rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50">保存进度</button>
      </form>
      {error && <p role="alert" className="mb-2 shrink-0 text-xs leading-relaxed text-rose-600">{error}</p>}
      <button type="button" disabled={busy} onClick={() => act('help')} className="mb-2 flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 py-2 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50">
        有点卡住了 <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
      <div className="mt-auto flex shrink-0 items-center justify-between gap-2 text-[11px]">
        <button type="button" disabled={busy} onClick={() => act('snooze')} className="flex items-center gap-1 rounded-lg py-1.5 text-slate-500 hover:text-sky-700 disabled:opacity-50"><Clock3 className="h-3 w-3" />30分钟后提醒</button>
        <button type="button" disabled={busy} onClick={() => act('today')} className="flex items-center gap-1 rounded-lg py-1.5 text-slate-500 hover:text-sky-700 disabled:opacity-50"><Moon className="h-3 w-3" />今天先休息</button>
      </div>
    </section>
  );
}
