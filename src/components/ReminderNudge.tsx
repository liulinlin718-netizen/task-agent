import { useState, type MouseEvent } from 'react';
import { Sparkles } from 'lucide-react';
import type { TaskReminder } from '../state/proactive';

export function ReminderNudge({ reminder, anchor, onOpen, onSuccess, onDragStart, onPetClick }: {
  reminder: TaskReminder;
  anchor: { x: number; y: number };
  onOpen: () => string | undefined;
  onSuccess: (message: string) => void;
  onDragStart: (event: MouseEvent) => void;
  onPetClick: () => string | undefined;
}) {
  const [error, setError] = useState('');
  const minutes = reminder.snoozeMinutes ?? 30;
  const petOnRight = anchor.x > 140;
  const open = () => setError(onOpen() || '');
  const snooze = () => {
    try {
      const result = window.electronAPI?.reminderAction(reminder.id, 'snooze');
      if (!result?.ok) { setError(result?.error || '暂未保存，请重试'); return; }
      onSuccess(`已设为 ${minutes} 分钟后提醒`);
    } catch { setError('暂未保存，请重试'); }
  };
  return (
    <div aria-label="桌宠轻提醒" className="relative h-full w-full select-none">
      <div className="absolute w-[268px] rounded-2xl border border-blue-200/80 bg-white px-3 py-2 text-slate-700"
        style={{ left: petOnRight ? 0 : 60, top: Math.max(0, Math.min(anchor.y - 24, 24)) }}>
        <button type="button" aria-label="展开任务进度提醒" onClick={open} className="block w-full text-left text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded">
          <span className="line-clamp-2 break-words" title={`${reminder.taskName}有新进展吗？`}>{reminder.taskName}有新进展吗？</span>
        </button>
        <div className="mt-1 flex items-center justify-between text-[10px]">
          <button type="button" onClick={open} className="text-blue-600 hover:text-blue-800">点击记录</button>
          <button type="button" onClick={snooze} aria-label={`${minutes}分钟后提醒`} className="text-slate-400 hover:text-slate-600">稍后 · {minutes} 分钟</button>
        </div>
        {error && <p role="alert" className="text-[10px] text-rose-600">{error}</p>}
      </div>
      <button type="button" aria-label="提醒中的桌宠" title="点击展开提醒，可拖动桌宠" onMouseDown={onDragStart} onClick={event => { if (event.detail === 0) open(); else setError(onPetClick() || ''); }}
        className="absolute flex h-12 w-12 cursor-pointer items-center justify-center rounded-full text-white"
        style={{ left: anchor.x, top: anchor.y, background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)' }}>
        <Sparkles className="h-5 w-5 pointer-events-none" />
      </button>
    </div>
  );
}
