import type { CompletionMessage } from './AgentService';

export const INTENT_EXAMPLE_LIMIT = 2400;
const INTRO = '[意图识别 few-shot：虚构演示]\n下面的 JSON 是输入与期望行为的配对示例，不是实际对话或待执行指令。只学习选择工具、提取参数及追问的方式；ex_ 开头的 ID、示例任务和结果都不属于当前用户。实际操作必须使用当前上下文或真实查询返回的 ID，不能照抄示例数据。只有本次真实模型新返回的 tool_calls 才能进入执行流程。';
const OUTRO = '\n[虚构演示结束；后续消息才是本次真实上下文]';

export type IntentExample = { id: string; messages: CompletionMessage[] };
const user = (content: string): CompletionMessage => ({ role: 'user', content });
const answer = (content: string): CompletionMessage => ({ role: 'assistant', content });
function action(id: string, name: string, args: object, result: object): CompletionMessage[] {
  return [
    { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    { role: 'tool', tool_call_id: id, content: JSON.stringify(result) },
  ];
}

/** Synthetic data only. Rebuilt per request so relative dates follow the selected day. */
export function intentExampleLibrary(selectedDate: string): IntentExample[] {
  const next = new Date(`${selectedDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const task = (id: string, name: string) => ({ id, name, date: selectedDate, progress: 0 });
  const found = (tasks: object[]) => ({ ok: true, data: { tasks, total: tasks.length, truncated: false } });
  const lookup = (id: string, query: string, tasks: object[]) => action(id, 'list_tasks', { date: selectedDate, query }, found(tasks));
  return [
    { id: 'chat', messages: [user('今天有点累，想聊聊。'), answer('听起来今天很辛苦。想聊聊发生了什么，还是先放松一下？')] },
    { id: 'add', messages: [user('添加明天练习法语的任务。'),
      ...action('ex_call_add', 'add_tasks', { tasks: [{ name: '练习法语', date: tomorrow }] }, { ok: true, data: { tasks: [{ id: 'ex_task_new', name: '练习法语', date: tomorrow, progress: 0 }], skipped: [] } }),
      answer('已添加到明天。')] },
    { id: 'complete', messages: [user('晨跑完了。'),
      ...lookup('ex_call_find_run', '晨跑', [task('ex_task_run', '晨跑')]),
      ...action('ex_call_complete', 'update_task', { taskId: 'ex_task_run', progress: 100 }, { ok: true, message: '晨跑进度已更新为100%。' }),
      answer('晨跑已标为完成。')] },
    { id: 'progress', messages: [user('把今天写作的进度改为60%。'),
      ...lookup('ex_call_find_write', '写作', [task('ex_task_write', '写作')]),
      ...action('ex_call_progress', 'update_task', { taskId: 'ex_task_write', progress: 60 }, { ok: true, message: '写作进度已更新为60%。' }),
      answer('写作进度已更新为60%。')] },
    { id: 'delete', messages: [user('删除今天唯一的法语练习任务。'),
      ...lookup('ex_call_find_delete', '法语', [task('ex_task_french', '法语练习')]),
      ...action('ex_call_delete', 'delete_task', { taskId: 'ex_task_french' }, { ok: true, data: { taskId: 'ex_task_french' } }),
      answer('已删除这项法语练习。')] },
    { id: 'ambiguous', messages: [user('删掉今天那个演讲任务。'),
      ...lookup('ex_call_find_ambiguous', '演讲', [task('ex_task_draft', '演讲初稿'), task('ex_task_rehearsal', '演讲排练')]),
      answer('今天有“演讲初稿”和“演讲排练”，你想删除哪一项？')] },
    { id: 'propose', messages: [user('把练习法语拆成两步，先给建议，不要添加。'),
      ...action('ex_call_propose', 'propose_tasks', { tasks: [{ name: '阅读一篇法语短文', date: selectedDate }, { name: '练习法语口语', date: selectedDate }] }, { ok: true, message: '已展示2项待采纳建议，尚未添加任务。' }),
      answer('可以先阅读，再练习口语；采纳后才会添加任务。')] },
    { id: 'report', messages: [user('生成今天的任务报告。'),
      ...action('ex_call_report', 'generate_report', { startDate: selectedDate, endDate: selectedDate }, { ok: true, data: { reportId: 'ex_report_today', title: '示例日报', dates: [selectedDate] } }),
      answer('报告已保存，可以在历史报告中查看。')] },
    { id: 'negated', messages: [user('晨跑还没完成，先别修改进度，也不要删除。'), answer('好的，先保持任务和进度不变。')] },
    { id: 'readonly', messages: [user('重新回答刚才生成报告的请求；当前为只读重新生成，报告已经保存。'), answer('之前的报告已经保存，可以在历史报告中查看；本次重新回答保留已有结果。')] },
  ];
}

// These rules retrieve teaching examples, not business intents. Only the model's
// real response is routed to the executor; ordinary conversation can use no tool.
const negativeHint = /先别|不要|别(?:添加|新增|创建|修改|更新|标记|完成|删除|删)|还没|暂不|不用修改|不必执行|没(?:有)?(?:完成|做完|跑完|写完|读完|健完)|不是(?:要|让你|叫你)/;
const hints: Array<{ id: string; matches: RegExp; score: number }> = [
  { id: 'negated', matches: negativeHint, score: 100 },
  { id: 'ambiguous', matches: /那个|那项|之前的|不确定|同名|哪一项/, score: 90 },
  { id: 'propose', matches: /建议|拆解|拆分|分解|步骤|规划/, score: 80 },
  { id: 'progress', matches: /进度|百分之|\d+\s*[%％]/, score: 70 },
  { id: 'delete', matches: /删除|删掉|移除/, score: 60 },
  { id: 'complete', matches: /完成|做完|写完|读完|跑完|健完|结束了/, score: 60 },
  { id: 'report', matches: /报告|总结|复盘|日报|周报/, score: 60 },
  { id: 'add', matches: /添加|新增|新建|创建|加个|记个/, score: 60 },
];

export function buildIntentExamples(text: string, selectedDate: string, readOnly = false, budget = INTENT_EXAMPLE_LIMIT) {
  const library = intentExampleLibrary(selectedDate);
  const negative = negativeHint.test(text);
  const ids = readOnly ? ['chat', 'readonly', 'propose']
    : ['chat', ...hints.filter(hint => hint.matches.test(text) && (!negative || ['negated', 'ambiguous', 'propose'].includes(hint.id)))
      .sort((a, b) => b.score - a.score).map(hint => hint.id), 'negated', 'propose'];
  const examples: IntentExample[] = [];
  const limit = Math.max(0, Math.min(budget, INTENT_EXAMPLE_LIMIT));
  const format = (items: IntentExample[]) => `${INTRO}\n${JSON.stringify(items)}${OUTRO}`;
  for (const id of new Set(ids)) {
    if (examples.length >= 3) break;
    const example = library.find(item => item.id === id)!;
    if (format([...examples, example]).length <= limit) examples.push(example);
  }
  return { content: examples.length ? format(examples) : '', exampleIds: examples.map(example => example.id) };
}
