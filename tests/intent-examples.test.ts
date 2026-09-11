import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntentExamples, intentExampleLibrary, INTENT_EXAMPLE_LIMIT } from '../src/services/IntentExamples';
import { AGENT_TOOLS, createToolExecutor } from '../src/services/AgentTools';
import { buildAgentContext, CONTEXT_LIMITS } from '../src/services/AgentContext';
import { runAgent, type AgentStore } from '../src/services/AgentService';
import { createDefaultState } from '../src/state/appState';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const date = '2028-02-28';

test('every demonstration has complete tool exchanges and its arguments work with the real executor', async () => {
  const library = intentExampleLibrary(date);
  assert.equal(library.length, 10);
  const names = new Set<string>();
  for (const example of library) {
    let state = createDefaultState();
    state.activeDate = date;
    const sessionId = state.activeChatSessionId;
    state.chatSessions[0].messages.push({ id: 'demo-reply', role: 'model', text: '' });
    state.tasks = example.messages.filter(message => message.role === 'tool')
      .flatMap(message => JSON.parse(message.content!).data?.tasks || [])
      .filter(task => task.id?.startsWith('ex_task_') && !task.id.includes('new'));
    const store: AgentStore = { getState: () => state, setState: update => { state = update(state); } };
    const execute = createToolExecutor(store, { sessionId, assistantMessageId: 'demo-reply', activeDate: date, generateReport: async () => '# 示例报告' });
    const pending = new Set<string>();
    for (const message of example.messages) {
      for (const call of message.tool_calls || []) {
        assert.equal(message.role, 'assistant');
        assert.ok(!pending.has(call.id));
        pending.add(call.id);
        names.add(call.function.name);
        assert.equal((await execute(call)).ok, true, `${example.id}: ${call.function.name}`);
      }
      if (message.role === 'tool') {
        assert.ok(pending.delete(message.tool_call_id!), `orphan tool result in ${example.id}`);
        assert.equal(JSON.parse(message.content!).ok, true);
      }
    }
    assert.equal(pending.size, 0);
    assert.equal(example.messages.at(-1)?.role, 'assistant');
  }
  assert.deepEqual(names, new Set(AGENT_TOOLS.map(tool => tool.function.name)));
});

test('retrieval selects the relevant intent example, with no more than three per request', () => {
  for (const [text, id] of [
    ['帮我添加明天的任务', 'add'], ['我健完身了', 'complete'], ['进度改为60%', 'progress'],
    ['删掉今天的任务', 'delete'], ['那个同名任务', 'ambiguous'], ['先给拆解建议', 'propose'], ['生成周报', 'report'],
  ]) {
    const result = buildIntentExamples(text, date);
    assert.ok(result.exampleIds.includes('chat'));
    assert.ok(result.exampleIds.includes(id), `${text}: ${result.exampleIds}`);
    assert.ok(result.exampleIds.length >= 2 && result.exampleIds.length <= 3);
    assert.ok(result.content.length <= INTENT_EXAMPLE_LIMIT);
  }
});

test('negative and ambiguous examples teach non-action; readonly examples cannot demonstrate writes', () => {
  const library = intentExampleLibrary(date);
  const negative = library.find(example => example.id === 'negated')!;
  assert.ok(negative.messages.every(message => !message.tool_calls));
  const ambiguous = library.find(example => example.id === 'ambiguous')!;
  assert.deepEqual(ambiguous.messages.flatMap(message => message.tool_calls?.map(call => call.function.name) || []), ['list_tasks']);
  assert.match(ambiguous.messages.at(-1)?.content || '', /哪一项/);
  const proposal = library.find(example => example.id === 'propose')!;
  assert.deepEqual(proposal.messages.flatMap(message => message.tool_calls?.map(call => call.function.name) || []), ['propose_tasks']);
  assert.ok(buildIntentExamples('先别删除，也还没完成', date).exampleIds.includes('negated'));
  for (const text of ['只给我拆解建议，别添加', '没跑完', '别更新进度', '不是让你新增任务']) {
    const selected = buildIntentExamples(text, date);
    assert.ok(selected.exampleIds.includes('negated'));
    assert.ok(selected.exampleIds.every(id => ['chat', 'negated', 'ambiguous', 'propose'].includes(id)));
  }
  for (const text of ['删除任务', '添加任务', '生成报告', '全部完成']) {
    const result = buildIntentExamples(text, date, true);
    const calls = library.filter(example => result.exampleIds.includes(example.id)).flatMap(example => example.messages.flatMap(message => message.tool_calls || []));
    assert.ok(calls.every(call => ['list_tasks', 'propose_tasks'].includes(call.function.name)));
    assert.ok(result.exampleIds.includes('readonly'));
  }
});

test('date examples follow the selected date through leap days and year boundaries', () => {
  for (const [selected, tomorrow] of [['2028-02-28', '2028-02-29'], ['2028-12-31', '2029-01-01']]) {
    const example = intentExampleLibrary(selected).find(example => example.id === 'add')!;
    const call = example.messages.flatMap(message => message.tool_calls || [])[0];
    assert.equal(JSON.parse(call.function.arguments).tasks[0].date, tomorrow);
  }
});

test('tight budgets drop whole examples, never leaving partial JSON or dangling tool results', () => {
  for (const budget of [0, 100, 500, 800, 1500, 2400, 9000]) {
    const result = buildIntentExamples('删除那个任务', date, false, budget);
    assert.ok(result.content.length <= Math.min(budget, INTENT_EXAMPLE_LIMIT));
    if (!result.content) { assert.deepEqual(result.exampleIds, []); continue; }
    const serialized = result.content.split('\n').find(line => line.startsWith('[{'))!;
    const examples = JSON.parse(serialized);
    assert.deepEqual(examples.map((example: { id: string }) => example.id), result.exampleIds);
    assert.ok(examples.every((example: { messages: Array<{ role: string }> }) => example.messages.at(-1)?.role === 'assistant'));
  }
});

test('few-shot content counts toward the existing initial budget and never replaces the current user message', () => {
  const state = createDefaultState();
  const text = '把任务进度改为60%。' + '背景资料'.repeat(2200);
  const history = Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, role: 'user' as const, text: '旧对话'.repeat(1500) }));
  const context = buildAgentContext({ state, session: state.chatSessions[0], history, text });
  assert.equal(context.messages.at(-1)?.content, text);
  assert.ok(context.stats.exampleIds.includes('progress'));
  assert.ok(context.stats.exampleCharacters > 0);
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
  assert.equal(context.stats.characters, context.messages.reduce((sum, message) => sum + (message.content?.length || 0), 0));
  assert.ok(context.messages.every(message => !message.tool_calls && message.role !== 'tool'));
});

test('runAgent sends demonstrations as system data and never executes or persists their synthetic operations', async () => {
  let state = createDefaultState();
  const sessionId = state.activeChatSessionId;
  state.chatSessions[0].messages = [{ id: 'u', role: 'user', text: '今天有点累' }, { id: 'a', role: 'model', text: '' }];
  const before = JSON.stringify(state);
  let requests = 0;
  globalThis.fetch = (async (_url, init) => {
    requests++;
    const body = JSON.parse(init!.body as string);
    assert.ok(body.messages.some((message: { role: string; content: string }) => message.role === 'system' && message.content.includes('意图识别 few-shot')));
    assert.ok(body.messages.every((message: { role: string; tool_calls?: unknown }) => message.role !== 'tool' && !message.tool_calls));
    assert.equal(body.messages.at(-1).content, '今天有点累');
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '可以先休息一下。' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const store: AgentStore = { getState: () => state, setState: update => { state = update(state); } };
  const result = await runAgent('今天有点累', store, { sessionId, assistantMessageId: 'a', history: [] });
  assert.equal(result.reply, '可以先休息一下。');
  assert.equal(requests, 1);
  assert.equal(JSON.stringify(state), before);
});
