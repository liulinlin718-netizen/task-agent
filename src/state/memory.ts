import type { AppState } from '../Store';

export type MemoryFact = {
  id: string;
  key: string;
  category: 'background' | 'preference' | 'goal' | 'constraint';
  content: string;
  evidence: string;
  sourceSessionId: string;
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
};

export type LongTermMemory = {
  version: 1;
  epoch: string;
  enabled: boolean;
  facts: MemoryFact[];
};

// A stable initial epoch also makes migration safe when several windows open.
export function emptyMemory(): LongTermMemory {
  return { version: 1, epoch: 'initial', enabled: true, facts: [] };
}

export function getMemory(state: Pick<AppState, 'memory'>): LongTermMemory {
  return state.memory || emptyMemory();
}

export function normalizeMemory(value: unknown): LongTermMemory {
  if (value === undefined) return emptyMemory();
  const memory = value as LongTermMemory;
  if (!memory || memory.version !== 1 || typeof memory.epoch !== 'string' || !memory.epoch
    || typeof memory.enabled !== 'boolean' || !Array.isArray(memory.facts) || memory.facts.length > 100
    || memory.facts.some(fact => !fact || !['background', 'preference', 'goal', 'constraint'].includes(fact.category)
      || !['id', 'key', 'content', 'evidence', 'sourceSessionId', 'sourceMessageId', 'createdAt', 'updatedAt']
        .every(key => typeof fact[key as keyof MemoryFact] === 'string' && fact[key as keyof MemoryFact].length > 0)
      || fact.key.length > 100 || fact.content.length > 500 || fact.evidence.length > 500)
    || new Set(memory.facts.map(fact => fact.id)).size !== memory.facts.length
    || new Set(memory.facts.map(fact => fact.key)).size !== memory.facts.length) {
    throw new Error('长期记忆格式无效');
  }
  return memory;
}

/** User edits invalidate any extraction that started before the edit. */
export function reviseMemory(state: AppState, update: (memory: LongTermMemory) => LongTermMemory): AppState {
  return { ...state, memory: normalizeMemory({ ...update(getMemory(state)), epoch: crypto.randomUUID() }) };
}
