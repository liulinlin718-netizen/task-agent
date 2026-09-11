import test from "node:test";
import assert from "node:assert/strict";
import { parseSSEStream } from "../src/services/StreamParser";

function stream(text: string, byteSize = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += byteSize) controller.enqueue(bytes.slice(i, i + byteSize));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
async function collect(response: Response) {
  const result = [];
  for await (const chunk of parseSSEStream(response)) result.push(chunk);
  return result;
}

test("SSE handles byte-split Unicode, CRLF, comments, and all interleaved tool deltas", async () => {
  const content = ': ping\r\n\r\ndata:{"choices":[{"index":0,"delta":{"content":"你好"}}]}\r\n\r\n' +
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"two","type":"function","function":{"name":"list_tasks","arguments":"{"}},{"index":0,"id":"one","function":{"name":"add_","arguments":"{\\"tasks\\":"}}]}}]}\r\n\r\n' +
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"tasks","arguments":"[]}"}},{"index":1,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const result = await collect(stream(content, 1));
  assert.deepEqual(result[0], { type: "text", content: "你好" });
  assert.equal(result.filter(item => item.type === "tool_call").length, 4);
  assert.deepEqual(result.at(-1), { type: "finish", reason: "tool_calls" });
});

test("SSE flushes an EOF event and accepts multiple data lines", async () => {
  const result = await collect(stream('data: {"choices":\ndata: [{"delta":{"content":"末尾"},"finish_reason":"stop"}]}'));
  assert.deepEqual(result, [{ type: "text", content: "末尾" }, { type: "finish", reason: "stop" }]);
});

test("malformed events and provider errors propagate instead of silently dropping tools", async () => {
  await assert.rejects(collect(stream('data: not-json\n\n')), /无效.*JSON/);
  await assert.rejects(collect(stream('event: error\ndata: {"message":"bad"}\n\n')), /模型流返回错误/);
});

test("canceling a stalled SSE reader rejects promptly and cancels the source", async () => {
  const controller = new AbortController();
  let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }));
  const iterator = parseSSEStream(response, controller.signal);
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true);
});
