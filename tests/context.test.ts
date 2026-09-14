import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext, CONTEXT_LIMITS, historyContent, retrieveMemories, selectTaskContext } from '../src/services/AgentContext';
import { createDefaultState } from '../src/state/appState';
import { emptyMemory, type MemoryFact } from '../src/state/memory';
import type { ChatMessage } from '../src/Store';

function fact(id: string, category: MemoryFact['category'], content: string): MemoryFact {
  return { id, key: `${category}.${id}`, category, content, evidence: content, sourceSessionId: 'previous-session', sourceMessageId: `source-${id}`, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
}

test('relevant memories are recalled across sessions while unrelated facts and profile fields are excluded', () => {
  const state = createDefaultState();
  state.profile = { major: '古典音乐', skills: '钢琴', goal: '参加钢琴比赛', bio: '与本次数据分析无关的个人档案' };
  state.memory = { ...emptyMemory(), facts: [
    fact('python', 'background', '我长期使用Python做数据分析。'), fact('food', 'preference', '我喜欢喝咖啡。'), fact('goal', 'goal', '我的目标是成为音乐老师。'),
  ] };
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '如何用Python清理数据？' });
  assert.deepEqual(context.stats.memoryIds, ['python']);
  const request = context.messages.map(message => message.content).join('\n');
  assert.match(request, /我长期使用Python做数据分析/);
  assert.doesNotMatch(request, /我喜欢喝咖啡|成为音乐老师|钢琴|古典音乐/);
  assert.notEqual(state.chatSessions[0].id, state.memory.facts[0].sourceSessionId);
});

test('response preferences and relevant constraints are applicable without identical topic wording', () => {
  const state = createDefaultState();
  state.memory = { ...emptyMemory(), enabled: false, facts: [
    fact('style', 'preference', '我喜欢简洁的中文回答。'), fact('time', 'constraint', '我每天最多只有两小时空闲时间。'), fact('diet', 'constraint', '我对花生过敏。'),
  ] };
  assert.deepEqual(retrieveMemories(state, '解释一下递归').map(item => item.id), ['style']);
  assert.deepEqual(new Set(retrieveMemories(state, '帮我安排学习计划').map(item => item.id)), new Set(['style', 'time']));
  assert.deepEqual(new Set(retrieveMemories(state, '推荐晚饭食谱').map(item => item.id)), new Set(['style', 'diet']));
  assert.deepEqual(retrieveMemories(state, '不要使用我的个人记忆，解释递归'), []);
});

test('initial messages stay within the character budget and the current attachment question remains last', () => {
  const state = createDefaultState();
  state.profile = { major: '数据分析'.repeat(1000), goal: '学习数据科学'.repeat(1000), skills: 'Python'.repeat(1000), bio: '个人背景'.repeat(1000) };
  state.memory = { ...emptyMemory(), facts: Array.from({ length: 20 }, (_, index) => fact(`${index}`, 'background', '我长期使用Python做数据分析。'.repeat(15))) };
  state.tasks = Array.from({ length: 100 }, (_, index) => ({ id: `task-${index}`, name: `数据分析任务${index}`, progress: 0, date: state.activeDate, notes: '很多任务备注'.repeat(500) }));
  const history: ChatMessage[] = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'model' : 'user', text: `历史${index}：` + '大量历史内容'.repeat(1000) }));
  const session = { ...state.chatSessions[0], messages: history, summary: '早先数据分析背景'.repeat(1000), summarizedUpTo: 40 };
  const question = '结合我的背景安排数据分析任务\n<document>\n' + '附件内容'.repeat(2000) + '\n</document>\n请按要求分析。';
  const before = JSON.stringify({ state, session, history });
  const context = buildAgentContext({ state, session, history, text: question });
  assert.equal(context.messages.at(-1)?.role, 'user');
  assert.equal(context.messages.at(-1)?.content, question);
  assert.equal(context.stats.currentTruncated, false);
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
  assert.equal(context.stats.characters, context.messages.reduce((sum, message) => sum + (message.content?.length || 0), 0));
  assert.ok(context.stats.historyOmitted > 0);
  assert.ok(context.stats.taskIds.length <= 12);
  assert.equal(JSON.stringify({ state, session, history }), before);
});

test('an overlong current message has an explicit truncation marker without losing its place', () => {
  const state = createDefaultState();
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '当前问题：' + '长'.repeat(30000) });
  assert.equal(context.messages.at(-1)?.role, 'user');
  assert.ok(context.messages.at(-1)?.content?.startsWith('当前问题：'));
  assert.match(context.messages.at(-1)?.content || '', /字符预算截断/);
  assert.equal(context.messages.at(-1)?.content?.length, CONTEXT_LIMITS.current);
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
});

test('implicit completion still recalls the correct task and unrelated conversation includes no tasks', () => {
  const state = createDefaultState();
  state.tasks = [
    { id: 'gym', name: '健身30分钟', date: state.activeDate, progress: 0 },
    { id: 'book', name: '读完一章教材', date: state.activeDate, progress: 0 },
  ];
  assert.equal(selectTaskContext(state, '我健完身了')[0]?.id, 'gym');
  assert.equal(selectTaskContext(state, '教材读完了')[0]?.id, 'book');
  assert.deepEqual(selectTaskContext(state, '我今天心情有些低落'), []);
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '给我讲一个笑话' });
  assert.deepEqual(context.stats.taskIds, []);
  assert.doesNotMatch(context.messages.map(message => message.content).join('\n'), /健身30分钟|读完一章教材/);
});

test('history is selected from the newest unsummarized messages and preserves attachment text', () => {
  const state = createDefaultState();
  const history: ChatMessage[] = [
    { id: 'old', role: 'user', text: '旧'.repeat(10000) }, { id: 'new', role: 'user', text: '附件名称', contextText: '附件实际内容' }, { id: 'reply', role: 'model', text: '最近助手回答' },
  ];
  const context = buildAgentContext({ state, session: { ...state.chatSessions[0], messages: history }, history, text: '继续' });
  const strings = context.messages.map(message => message.content);
  assert.ok(strings.includes('附件实际内容'));
  assert.ok(strings.includes('最近助手回答'));
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
  assert.equal(history[0].text.length, 10000);
});

test('manual major and goal retain reserved space ahead of several long learned facts', () => {
  const state = createDefaultState();
  state.profile = { major: '手动档案：临床医学专业', goal: '手动目标：取得医学博士', skills: '医学统计', bio: '手动背景' };
  state.memory = { ...emptyMemory(), facts: Array.from({ length: 5 }, (_, index) => fact(`long-${index}`, 'background', '我长期从事临床医学研究。'.repeat(35))) };
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '根据我的背景和目标，帮我规划下一步。' });
  const prompt = context.messages.map(message => message.content).join('\n');
  assert.match(prompt, /手动档案：临床医学专业/);
  assert.match(prompt, /手动目标：取得医学博士/);
  assert.match(prompt, /本次用户明确表述 > 手动个人档案 > 旧的自动学习事实/);
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
});

test('an explicit request not to use personal background excludes both facts and manual profile', () => {
  const state = createDefaultState();
  state.profile = { major: '我是临床医学专业', goal: '临床医学博士', skills: '临床医学研究', bio: '我的临床医学背景' };
  state.memory = { ...emptyMemory(), facts: [fact('medicine', 'background', '我长期从事临床医学。')] };
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '不要使用我的背景，请解释临床医学' });
  const prompt = context.messages.map(message => message.content).join('\n');
  assert.deepEqual(context.stats.memoryIds, []);
  assert.doesNotMatch(prompt, /我是临床医学专业|临床医学博士|我的临床医学背景|我长期从事临床医学/);
  assert.equal(context.messages.at(-1)?.content, '不要使用我的背景，请解释临床医学');
});

test('legacy task metadata survives as historical data without reserving or binding current tasks', () => {
  const state = createDefaultState();
  const taskContext = { taskId: 'bound', taskName: '历史日期的阅读', taskDate: '2026-09-01' };
  state.tasks = [{ id: 'bound', name: taskContext.taskName, date: taskContext.taskDate, progress: 42 }];
  const source: ChatMessage = JSON.parse(JSON.stringify({ id: 'source', role: 'user', text: '完成了', taskContext }));
  assert.match(historyContent(source), /旧版消息的任务来源/);
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [source], text: '给我一点建议' });
  const text = context.messages.map(message => message.content).join('\n');
  assert.match(text, /不约束当前请求，也不代表新的操作授权/);
  assert.match(text, /2026-09-01/);
  assert.doesNotMatch(text, /本次用户主动关联|referenceStatus|"progress":42/);
  assert.deepEqual(context.stats.taskIds, []);
  assert.ok(context.stats.characters <= CONTEXT_LIMITS.total);
  state.tasks = [];
  const stale = buildAgentContext({ state, session: state.chatSessions[0], history: [source], text: '换个话题聊聊' });
  assert.doesNotMatch(stale.messages.map(message => message.content).join('\n'), /已过期，请先重新选择/);
  assert.deepEqual(source.taskContext, taskContext);
});

test('today in context is the actual logical day rather than the selected historical date', () => {
  const state = createDefaultState(); state.activeDate = '2026-09-01';
  state.tasks = [{ id: 'actual-today', name: '健身', progress: 0, date: '2026-09-13' }];
  const context = buildAgentContext({ state, session: state.chatSessions[0], history: [], text: '今天健身完成了', currentDate: '2026-09-13' });
  const prompt = context.messages.map(message => message.content).join('\n');
  assert.match(prompt, /实际生物钟今天：2026-09-13；当前选中日期：2026-09-01/);
  assert.ok(context.stats.taskIds.includes('actual-today'));
});
