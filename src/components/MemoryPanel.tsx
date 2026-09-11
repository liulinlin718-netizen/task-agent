import { useState } from 'react';
import { useStore } from '../Store';
import { getMemory, reviseMemory, type LongTermMemory, type MemoryFact } from '../state/memory';

const categories: Record<MemoryFact['category'], string> = {
  background: '背景', preference: '偏好', goal: '目标', constraint: '限制',
};

export function MemoryPanel() {
  const { state, setState } = useStore();
  const memory = getMemory(state);
  const [editing, setEditing] = useState<Pick<MemoryFact, 'id' | 'content' | 'category'> | null>(null);
  const [error, setError] = useState('');

  const changeMemory = (update: (memory: LongTermMemory) => LongTermMemory) => {
    try {
      setState(current => reviseMemory(current, update));
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '记忆修改未保存，请重试。');
      return false;
    }
  };

  return (
    <section aria-label="长期记忆" className="space-y-4 border-t border-gray-100 dark:border-neutral-800 pt-8">
      <div>
        <h3 className="text-lg font-semibold text-foreground">长期记忆</h3>
        <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          保存你在对话中自述的稳定背景、偏好、目标与限制，帮助助理在相关的新对话里理解你。个人档案在上方单独编辑。
        </p>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-[#1C1C1E] p-4">
        <div>
          <p className="text-sm font-medium text-foreground">自动学习对话记忆</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {memory.enabled ? '已开启。新对话中的稳定自述可被保存，你可以随时编辑或删除。' : '已暂停自动学习。已有记忆仍会用于相关回复，可在下方删除。'}
          </p>
        </div>
        <button
          type="button" role="switch" aria-label="自动学习对话记忆" aria-checked={memory.enabled}
          onClick={() => changeMemory(current => ({ ...current, enabled: !current.enabled }))}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${memory.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-neutral-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${memory.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">已保存 {memory.facts.length} 条对话记忆，最多 100 条</p>
        <button
          type="button" aria-label="清除全部对话记忆" disabled={!memory.facts.length}
          onClick={() => {
            if (window.confirm('确定清除全部对话记忆吗？个人档案和历史对话会保留。')) {
              if (changeMemory(current => ({ ...current, facts: [] }))) setEditing(null);
            }
          }}
          className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
        >清除全部对话记忆</button>
      </div>
      {memory.facts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 dark:border-neutral-700 p-5 text-sm text-gray-500 dark:text-gray-400">
          还没有保存对话记忆。你可以在对话中介绍自己的背景、偏好或长期目标。
        </p>
      ) : (
        <div className="space-y-3">
          {memory.facts.map(fact => (
            <article key={fact.id} aria-label={`长期记忆：${fact.content}`} className="rounded-2xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-[#1C1C1E] p-4">
              {editing?.id === fact.id ? (
                <form aria-label="编辑长期记忆" onSubmit={event => {
                  event.preventDefault();
                  const content = editing.content.trim();
                  if (!content || content.length > 500) { setError('记忆内容需要 1 到 500 个字符。'); return; }
                  if (changeMemory(current => ({ ...current, facts: current.facts.map(item => item.id === editing.id
                    ? { ...item, content, category: editing.category, updatedAt: new Date().toISOString() } : item) }))) setEditing(null);
                }} className="space-y-3">
                  <select aria-label="记忆类别" value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value as MemoryFact['category'] })}
                    className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-foreground">
                    {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <textarea aria-label="记忆内容" value={editing.content} maxLength={500} required
                    onChange={event => setEditing({ ...editing, content: event.target.value })}
                    className="min-h-24 w-full resize-y rounded-lg border border-gray-200 dark:border-neutral-700 bg-transparent p-3 text-sm text-foreground outline-none focus:border-blue-500" />
                  <div className="flex gap-2">
                    <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">保存记忆</button>
                    <button type="button" aria-label="取消编辑记忆" onClick={() => { setEditing(null); setError(''); }} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-neutral-800">取消</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="rounded-md bg-blue-50 dark:bg-blue-900/20 px-2 py-1 text-xs text-blue-600 dark:text-blue-400">{categories[fact.category]}</span>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{fact.content}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`编辑记忆：${fact.content}`} onClick={() => { setEditing({ id: fact.id, content: fact.content, category: fact.category }); setError(''); }}
                      className="rounded-lg px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20">编辑</button>
                    <button type="button" aria-label={`删除记忆：${fact.content}`} onClick={() => changeMemory(current => ({ ...current, facts: current.facts.filter(item => item.id !== fact.id) }))}
                      className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">删除</button>
                  </div>
                </div>
              )}
              <details className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer">来源原句</summary>
                <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{fact.evidence}</p>
              </details>
            </article>
          ))}
        </div>
      )}
      <p className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">清除对话记忆不会清除个人档案或历史对话；修改记忆内容后，来源原句仍保留供核对。</p>
    </section>
  );
}
