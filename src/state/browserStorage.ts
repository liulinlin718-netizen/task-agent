type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const DATA = 'taskagent-state';
const MEMORY = 'taskagent-memory';
const JOURNAL = 'taskagent-storage-transaction';

function restore(storage: StorageLike, previous: { data: string | null; memory: string | null }) {
  for (const [key, value] of [[MEMORY, previous.memory], [DATA, previous.data]] as const) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
  storage.removeItem(JOURNAL);
}

/** A prepared transaction is rolled back if the tab closed during a write. */
export function readBrowserState(storage: StorageLike): string | null {
  const journal = storage.getItem(JOURNAL);
  if (journal) {
    const previous = JSON.parse(journal);
    if (!previous || !['data', 'memory'].every(key => previous[key] === null || typeof previous[key] === 'string')) {
      throw new Error('本地存储事务损坏，请从备份恢复');
    }
    restore(storage, previous);
  }
  const saved = storage.getItem(DATA) || storage.getItem('scholaragent-state');
  if (!saved) return null;
  const data = JSON.parse(saved);
  if (data.profile) return saved; // Legacy combined storage; migrated on the next write.
  const memory = JSON.parse(storage.getItem(MEMORY) || 'null');
  if (memory?.version !== 1 || !memory.profile || !memory.memory) throw new Error('独立长期记忆缺失或损坏');
  return JSON.stringify({ ...data, profile: memory.profile, memory: memory.memory });
}

export function writeBrowserState(storage: StorageLike, text: string) {
  const { profile, memory, ...data } = JSON.parse(text);
  if (!profile || !memory) throw new Error('缺少长期记忆数据');
  const previous = { data: storage.getItem(DATA), memory: storage.getItem(MEMORY) };
  const nextData = JSON.stringify(data);
  const nextMemory = JSON.stringify({ version: 1, profile, memory });
  if (nextData === previous.data && nextMemory === previous.memory) return;
  storage.setItem(JOURNAL, JSON.stringify(previous));
  try {
    storage.setItem(MEMORY, nextMemory);
    storage.setItem(DATA, nextData);
    storage.removeItem(JOURNAL);
  } catch (error) {
    try { restore(storage, previous); } catch { /* The journal preserves the prior state for recovery. */ }
    throw error;
  }
}
