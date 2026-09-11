import type { ChatMessage } from '../Store';

export function ToolActivity({ events, memoryStatus }: { events?: ChatMessage['toolEvents']; memoryStatus?: string }) {
  if (!events?.length && !memoryStatus) return null;
  return <div className="mt-2 space-y-1 border-t border-current/10 pt-2 text-xs opacity-80">
    {!!events?.length && <ul aria-label="操作记录">{events.map(event => <li key={event.id} className={event.status === 'error' ? 'text-red-500' : ''}>
      {event.status === 'success' ? '✓' : '✕'} {event.message}
    </li>)}</ul>}
    {memoryStatus && <p role="status" aria-label="记忆状态">{memoryStatus}</p>}
  </div>;
}
