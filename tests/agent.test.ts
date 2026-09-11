import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { AGENT_MAX_ROUNDS, callChatCompletion, generateCustomSummary, runAgent, type AgentStore } from "../src/services/AgentService";
import type { AppState, ChatMessage, Task } from "../src/Store";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function setup(history: ChatMessage[] = [], tasks: Task[] = []) {
  let state: AppState = {
    profile: { major: "计算机", goal: "研究", skills: "编程", bio: "私人背景" }, tasks,
    settings: { rolloverTime: "02:00", agentStyle: "gentle", sidebarEnabled: true, floatingBallEnabled: false, theme: "light", agentName: "小助理", apiBaseUrl: "https://chat.example/v1", apiModel: "chosen-chat", apiKey: "test-chat", reportApiBaseUrl: "https://report.example/v1", reportModel: "chosen-report", reportApiKey: "test-report" },
    chatSessions: [{ id: "s", title: "测试", messages: [...history, { id: "u", role: "user", text: "请求" }, { id: "a", role: "model", text: "" }], updatedAt: "" }],
    activeChatSessionId: "s", activeDate: "2026-09-11", lastRolloverDate: "2026-09-11", historySummaries: [], reports: [],
  };
  const store: AgentStore = { getState: () => state, setState: update => { state = update(state); } };
  const options = { sessionId: "s", assistantMessageId: "a", history };
  const events = () => state.chatSessions.find(session => session.id === "s")?.messages.find(message => message.id === "a")?.toolEvents || [];
  return { store, options, events };
}
function json(message: any, finishReason?: string) {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: finishReason || (message.tool_calls?.length ? "tool_calls" : "stop") }] }), { headers: { "content-type": "application/json" } });
}
function call(id: string, name: string, args: unknown) { return { id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }; }
function sse(events: any[], width = 7) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
function mock(handler: (body: any, url: string, init: RequestInit, index: number) => Response | Promise<Response>) {
  let count = 0;
  const bodies: any[] = [];
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(init!.body as string); bodies.push(body);
    return handler(body, String(url), init!, count++);
  }) as typeof fetch;
  return bodies;
}

test("real SSE aggregates every tool call and sends protocol-correct results before final JSON response", async () => {
  const { store, options, events } = setup();
  const requests = mock((body, _url, _init, index) => {
    assert.equal(body.model, "chosen-chat");
    assert.equal(body.stream, true);
    assert.ok(body.tools.some((tool: any) => tool.function.name === "add_tasks"));
    assert.equal(body.response_format, undefined);
    if (index === 0) return sse([
      { choices: [{ index: 0, delta: { content: "我来安排。" } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "create", type: "function", function: { name: "add_", arguments: '{"tasks":[' } }, { index: 1, id: "suggest", type: "function", function: { name: "propose_tasks", arguments: '{"tasks":[{"name":"检查结果",' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '"date":"2026-09-13"}]}' } }, { index: 0, function: { name: "tasks", arguments: '{"name":"写代码","date":"2026-09-12"}]}' } }] }, finish_reason: "tool_calls" }] },
    ], 1);
    const assistant = body.messages.at(-3);
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.content, "我来安排。");
    assert.equal(assistant.tool_calls.length, 2);
    assert.equal(assistant.tool_calls[0].function.name, "add_tasks");
    assert.deepEqual(body.messages.slice(-2).map((item: any) => [item.role, item.tool_call_id, JSON.parse(item.content).ok]), [["tool", "create", true], ["tool", "suggest", true]]);
    assert.equal(store.getState().tasks[0].name, "写代码");
    return json({ content: "已创建任务并给出一项建议。" });
  });
  const chunks: string[] = [];
  const result = await runAgent("添加写代码任务", store, { ...options, onTextChunk: chunk => chunks.push(chunk) });
  assert.equal(result.reply, "我来安排。\n\n已创建任务并给出一项建议。");
  assert.equal(chunks.join(""), result.reply);
  assert.equal(requests.length, 2);
  assert.equal(store.getState().tasks.length, 1);
  assert.equal(store.getState().tasks[0].date, "2026-09-12");
  assert.deepEqual(store.getState().chatSessions[0].messages.at(-1)?.proposedTasks, [{ name: "检查结果", date: "2026-09-13", added: false }]);
  assert.equal(events().length, 2);
  assert.match(events()[0].message, /已添加 1 项/);
});

test("plain conversation streams text before the HTTP response completes", { timeout: 2000 }, async () => {
  const { store, options } = setup();
  let source: ReadableStreamDefaultController<Uint8Array>;
  let sawText!: () => void;
  const firstText = new Promise<void>(resolve => { sawText = resolve; });
  mock(() => new Response(new ReadableStream({ start(controller) { source = controller; } }), { headers: { "content-type": "text/event-stream" } }));
  let done = false;
  const pending = runAgent("你好", store, { ...options, onTextChunk(chunk) { if (chunk === "你好") sawText(); } }).then(result => { done = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  source!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'));
  await firstText;
  assert.equal(done, false);
  source!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  source!.close();
  assert.equal((await pending).reply, "你好");
  assert.equal(store.getState().tasks.length, 0);
});

test("unknown tools, malformed arguments, nonexistent IDs and invalid dates/progress are returned as tool errors", async () => {
  const existing = { id: "t", name: "原任务", date: "2026-09-11", progress: 20 };
  const { store, options, events } = setup([], [existing]);
  mock((body, _url, _init, index) => index === 0 ? json({ content: null, tool_calls: [
    call("1", "destroy_everything", {}), call("2", "add_tasks", "{broken"),
    call("3", "update_task", { taskId: "missing", progress: 30 }), call("4", "update_task", { taskId: "t", progress: 101 }),
    call("5", "add_tasks", { tasks: [{ name: "无效日期", date: "2026-02-30" }] }), call("6", "delete_task", { taskId: "t", extra: true }),
  ] }) : (assert.equal(body.messages.filter((message: any) => message.role === "tool").every((message: any) => JSON.parse(message.content).ok === false), true), json({ content: "参数有误，任务未改动。" })));
  await runAgent("测试参数", store, options);
  assert.deepEqual(store.getState().tasks, [existing]);
  assert.equal(events().length, 6);
  assert.equal(events().every(event => event.status === "error"), true);
});

test("valid lookup, update and delete execute in order using current state", async () => {
  const { store, options } = setup([], [{ id: "t", name: "论文", date: "2026-09-11", progress: 10 }]);
  mock((body, _url, _init, index) => {
    if (index === 0) return json({ tool_calls: [call("lookup", "list_tasks", { query: "论文" })] });
    if (index === 1) { assert.equal(JSON.parse(body.messages.at(-1).content).data.tasks[0].id, "t"); return json({ tool_calls: [call("update", "update_task", { taskId: "t", progress: 100, date: "2026-09-12", notes: "已完成", priority: "high" })] }); }
    if (index === 2) { assert.equal(store.getState().tasks[0].progress, 100); return json({ tool_calls: [call("delete", "delete_task", { taskId: "t" })] }); }
    assert.equal(store.getState().tasks.length, 0);
    return json({ content: "已处理。" });
  });
  await runAgent("更新再删除", store, options);
});

test("repeated call IDs, equivalent arguments and existing tasks cannot duplicate side effects", async () => {
  const { store, options, events } = setup();
  mock((body, _url, _init, index) => {
    if (index === 0) return json({ tool_calls: [call("one", "add_tasks", { tasks: [{ name: "任务", date: "2026-09-11" }] })] });
    if (index === 1) return json({ tool_calls: [call("two", "add_tasks", { tasks: [{ date: "2026-09-11", name: "任务" }] })] });
    if (index === 2) { assert.equal(JSON.parse(body.messages.at(-1).content).duplicate, true); return json({ tool_calls: [call("one", "delete_task", { taskId: store.getState().tasks[0].id })] }); }
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return json({ content: "任务只有一项。" });
  });
  await runAgent("新增", store, options);
  assert.equal(store.getState().tasks.length, 1);
  assert.equal(events().length, 3);
});

test("read-only regeneration rejects all task/report mutations but permits proposals", async () => {
  const { store, options, events } = setup([], [{ id: "t", name: "已有任务", progress: 0, date: "2026-09-11" }]);
  mock((body, _url, _init, index) => {
    assert.deepEqual(body.tools.map((tool: any) => tool.function.name), ["list_tasks", "propose_tasks"]);
    return index === 0 ? json({ tool_calls: [
      call("1", "add_tasks", { tasks: [{ name: "不应添加" }] }), call("2", "update_task", { taskId: "t", progress: 100 }), call("3", "delete_task", { taskId: "t" }),
      call("4", "generate_report", { startDate: "2026-09-11", endDate: "2026-09-11" }), call("5", "propose_tasks", { tasks: [{ name: "供考虑" }] }),
    ] }) : json({ content: "仅提供建议。" });
  });
  await runAgent("重新生成", store, { ...options, readOnly: true });
  assert.equal(store.getState().tasks.length, 1);
  assert.equal(store.getState().tasks[0].progress, 0);
  assert.equal(store.getState().reports.length, 0);
  assert.deepEqual(events().map(event => event.status), ["error", "error", "error", "error", "success"]);
});

test("report tool calls the separately configured model and saves its actual result", async () => {
  const { store, options } = setup([], [{ id: "t", name: "论文", progress: 100, date: "2026-09-11" }]);
  mock((body, url, init, index) => {
    if (index === 0) return json({ tool_calls: [call("report", "generate_report", { startDate: "2026-09-11", endDate: "2026-09-12", title: "两日总结" })] });
    if (index === 1) {
      assert.equal(url, "https://report.example/v1/chat/completions");
      assert.equal(body.model, "chosen-report");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-report");
      assert.ok(body.messages[1].content.includes("论文"));
      return json({ content: "# 报告\n论文已完成。" });
    }
    assert.equal(store.getState().reports[0].content, "# 报告\n论文已完成。");
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, true);
    return json({ content: "报告已保存。" });
  });
  await runAgent("生成报告", store, options);
  assert.equal(store.getState().reports[0].title, "两日总结");
  assert.deepEqual(store.getState().reports[0].dates, ["2026-09-11", "2026-09-12"]);
});

test("report failure is a tool error and never saves placeholder content", async () => {
  const { store, options } = setup();
  mock((body, _url, _init, index) => {
    if (index === 0) return json({ tool_calls: [call("report", "generate_report", { startDate: "2026-09-11", endDate: "2026-09-11" })] });
    if (index === 1) return new Response("bad", { status: 503 });
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return json({ content: "报告服务暂时不可用。" });
  });
  await runAgent("报告", store, options);
  assert.equal(store.getState().reports.length, 0);
});

test("cancellation after one committed tool preserves its audit and prevents later mutations", async () => {
  const setupResult = setup();
  const controller = new AbortController();
  const setState = setupResult.store.setState;
  setupResult.store.setState = updater => { setState(updater); if (setupResult.store.getState().tasks.length) controller.abort(); };
  mock(() => json({ tool_calls: [call("one", "add_tasks", { tasks: [{ name: "已完成操作" }] }), call("two", "add_tasks", { tasks: [{ name: "不能执行" }] })] }));
  await assert.rejects(runAgent("添加任务", setupResult.store, { ...setupResult.options, signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(setupResult.store.getState().tasks.map(task => task.name), ["已完成操作"]);
  assert.equal(setupResult.events().length, 1);
});

test("canceling report generation prevents saving even when the custom transport resolves later", async () => {
  const { store, options } = setup();
  const controller = new AbortController();
  mock((_body, _url, _init, index) => {
    if (index === 0) return json({ tool_calls: [call("report", "generate_report", { startDate: "2026-09-11", endDate: "2026-09-11" })] });
    controller.abort();
    return json({ content: "不应保存" });
  });
  await assert.rejects(runAgent("生成报告", store, { ...options, signal: controller.signal }), { name: "AbortError" });
  assert.equal(store.getState().reports.length, 0);
});

test("switching active sessions never redirects tool mutations or audit messages", async () => {
  const { store, options } = setup();
  store.setState(state => ({ ...state, chatSessions: [...state.chatSessions, { id: "other", title: "另一对话", messages: [], updatedAt: "" }] }));
  mock((_body, _url, _init, index) => {
    store.setState(state => ({ ...state, activeChatSessionId: "other", activeDate: "2026-09-20" }));
    return index === 0 ? json({ tool_calls: [call("add", "add_tasks", { tasks: [{ name: "原日期" }] }), call("propose", "propose_tasks", { tasks: [{ name: "原对话建议" }] })] }) : json({ content: "完成" });
  });
  await runAgent("添加任务", store, options);
  assert.equal(store.getState().tasks[0].date, "2026-09-11");
  assert.equal(store.getState().chatSessions[1].messages.length, 0);
  assert.equal(store.getState().chatSessions[0].messages.at(-1)?.proposedTasks?.[0].name, "原对话建议");
});

test("a partial tool stream cannot execute side effects", async () => {
  const { store, options } = setup();
  mock(() => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "partial", function: { name: "add_tasks", arguments: '{"tasks":[{"name":"不可执行"}]}' } }] } }] }]));
  await assert.rejects(runAgent("添加", store, options), /完成前中断/);
  assert.equal(store.getState().tasks.length, 0);
});

test("a bounded loop requests a final answer with tool_choice none and refuses further calls", async () => {
  const { store, options, events } = setup();
  const requests = mock((body, _url, _init, index) => {
    if (index === AGENT_MAX_ROUNDS - 1) assert.equal(body.tool_choice, "none");
    return json({ tool_calls: [call(`lookup-${index}`, "list_tasks", {})] });
  });
  const result = await runAgent("查询", store, options);
  assert.equal(requests.length, AGENT_MAX_ROUNDS);
  assert.equal(events().length, AGENT_MAX_ROUNDS - 1);
  assert.match(result.reply, /调用上限/);
});

test("history preserves the last answer, attachment context and all unsummarized messages", async () => {
  const history: ChatMessage[] = Array.from({ length: 10 }, (_, index) => ({ id: `h${index}`, role: index % 2 ? "model" : "user", text: `内容${index}` }));
  history[8].contextText = "附件中的关键内容";
  const { store, options } = setup(history);
  store.setState(state => ({ ...state, chatSessions: state.chatSessions.map(session => ({ ...session, summary: "早先摘要", summarizedUpTo: 2 })) }));
  mock((body, _url, _init, index) => {
    if (index === 0) {
      const conversation = body.messages.slice(1, -1).map((message: any) => message.content);
      assert.ok(conversation.includes("[较早对话摘要]\n早先摘要"));
      assert.ok(conversation.includes("内容2"));
      assert.ok(conversation.includes("内容9"));
      assert.ok(conversation.includes("附件中的关键内容"));
      assert.equal(conversation.includes("内容0"), false);
      assert.equal(body.messages.at(-1).content, "新问题");
      assert.equal(body.messages[0].content.includes("私人背景"), false);
      return json({ content: "回答" });
    }
    assert.ok(body.messages[1].content.includes("内容2"));
    return json({ content: "更新摘要" });
  });
  await runAgent("新问题", store, options);
  assert.equal(store.getState().chatSessions[0].summarizedUpTo, 4);
});

test("timeout applies to a response body stalled after headers", async () => {
  mock(() => new Response(new ReadableStream({}), { headers: { "content-type": "application/json" } }));
  const response = await callChatCompletion({ baseUrl: "https://example.com/v1", apiKey: "", model: "test", messages: [{ role: "user", content: "test" }], timeoutMs: 10 });
  // Keep the event loop alive: AbortSignal.timeout itself intentionally uses an unref timer.
  const hold = setTimeout(() => {}, 1000);
  try { await assert.rejects(response.json(), { name: "TimeoutError" }); } finally { clearTimeout(hold); }
});

test("custom unauthenticated endpoints work and summary rejects impossible dates before fetch", async () => {
  const { store } = setup();
  let called = false;
  mock((_body, _url, init) => { called = true; assert.equal((init.headers as any).Authorization, undefined); return json({ content: "ok" }); });
  const response = await callChatCompletion({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "local-model", messages: [{ role: "user", content: "hi" }] });
  assert.equal((await response.json()).choices[0].message.content, "ok");
  assert.equal(called, true);
  await assert.rejects(generateCustomSummary(["2026-02-30"], store.getState()), /日期不存在/);
});

test("legacy intent JSON is just text and can never execute an operation", async () => {
  const { store, options } = setup();
  const legacy = JSON.stringify({ intent: "add_tasks", data: { proposedTasks: ["不能自动添加"] } });
  mock(() => json({ content: legacy }));
  const result = await runAgent("添加", store, options);
  assert.equal(result.reply, legacy);
  assert.equal(store.getState().tasks.length, 0);
});

test("without a valid summary, older history is retained and then summarized safely", async () => {
  const history: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({ id: `h${index}`, role: index % 2 ? "model" : "user", text: `完整内容${index}` }));
  const { store, options } = setup(history);
  mock((body, _url, _init, index) => {
    if (index === 0) {
      assert.deepEqual(body.messages.filter((message: any) => message.role !== 'system').slice(0, -1).map((message: any) => message.content), history.map(message => message.text));
      return json({ content: "回复" });
    }
    return json({ content: "旧消息摘要" });
  });
  await runAgent("新的问题", store, options);
  assert.equal(store.getState().chatSessions[0].summarizedUpTo, 2);
});

test("the same tool call ID cannot cause a second report model request or save", async () => {
  const { store, options } = setup();
  let reportRequests = 0;
  const args = { startDate: "2026-09-11", endDate: "2026-09-11" };
  mock((body, url, _init, index) => {
    if (url.includes("report.example")) { reportRequests++; return json({ content: "完整报告" }); }
    if (index === 0 || index === 2) return json({ tool_calls: [call("same-id", "generate_report", args)] });
    assert.equal(JSON.parse(body.messages.at(-1).content).duplicate, true);
    return json({ content: "报告已保存一份。" });
  });
  await runAgent("生成报告", store, options);
  assert.equal(reportRequests, 1);
  assert.equal(store.getState().reports.length, 1);
});

test("truncated report output is not saved and cancellation before send avoids network requests", async () => {
  const { store, options } = setup();
  mock((body, _url, _init, index) => {
    if (index === 0) return json({ tool_calls: [call("report", "generate_report", { startDate: "2026-09-11", endDate: "2026-09-11" })] });
    if (index === 1) return json({ content: "被截断的报告" }, "length");
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return json({ content: "报告未完整生成。" });
  });
  await runAgent("生成报告", store, options);
  assert.equal(store.getState().reports.length, 0);
  const controller = new AbortController();
  controller.abort();
  mock(() => { assert.fail("a pre-aborted request must not reach fetch"); });
  await assert.rejects(runAgent("取消", store, { ...options, signal: controller.signal }), { name: "AbortError" });
});

test("a successful answer learns only from its real user source and the fact is recalled in another session", async () => {
  const { store, options } = setup();
  const disclosure = "我长期使用Python做数据分析。";
  store.getState().chatSessions[0].messages[0].text = disclosure;
  let captureRequests = 0;
  mock((body, _url, _init, index) => {
    if (index === 0) { assert.equal(body.tools.length, 6); return json({ content: "了解你的数据分析背景。" }); }
    if (index === 1) {
      captureRequests++;
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'capture_memories' } });
      return json({ tool_calls: [call('capture', 'capture_memories', { facts: [{ key: 'background.analysis_tool', category: 'background', evidence: disclosure }] })] });
    }
    assert.ok(body.messages.some((message: any) => message.content?.includes(disclosure)));
    return json({ content: "可以用Python处理数据。" });
  });
  const learned = await runAgent(disclosure, store, options);
  assert.equal(learned.reply, "了解你的数据分析背景。");
  assert.equal(learned.learning?.status, 'saved');
  assert.equal(store.getState().memory?.facts[0].sourceMessageId, 'u');
  store.setState(state => ({ ...state, activeChatSessionId: 'new', chatSessions: [...state.chatSessions, { id: 'new', title: '新会话', updatedAt: '', messages: [{ id: 'new-user', role: 'user', text: '如何清理Python数据？' }, { id: 'new-reply', role: 'model', text: '' }] }] }));
  await runAgent('如何清理Python数据？', store, { sessionId: 'new', assistantMessageId: 'new-reply', history: [] });
  assert.equal(captureRequests, 1);
});

test("memory extraction failure or cancellation cannot erase a completed main reply", async () => {
  for (const cancel of [false, true]) {
    const { store, options } = setup();
    const disclosure = '我喜欢简洁的中文回答。';
    store.getState().chatSessions[0].messages[0].text = disclosure;
    const controller = new AbortController();
    const chunks: string[] = [];
    mock((_body, _url, _init, index) => {
      if (index === 0) return json({ content: '我会简洁地回答。' });
      assert.equal(chunks.join(''), '我会简洁地回答。');
      if (cancel) controller.abort();
      return new Response('offline', { status: 503 });
    });
    const result = await runAgent(disclosure, store, { ...options, signal: controller.signal, onTextChunk: chunk => chunks.push(chunk) });
    assert.equal(result.reply, '我会简洁地回答。');
    assert.equal(result.learning?.status, cancel ? 'cancelled' : 'error');
    assert.equal(store.getState().memory?.facts.length || 0, 0);
  }
});
