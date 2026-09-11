/** OpenAI Chat Completions SSE deltas. Tools are executed only after collection. */
export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; index: number; id?: string; toolName: string; toolArgs: string }
  | { type: "finish"; reason: string };

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason || new DOMException("操作已取消。", "AbortError");
}

/** Also handles test/custom transports that do not implement fetch cancellation. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("操作已取消。", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason || new DOMException("操作已取消。", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function* parseSSEStream(response: Response, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型返回了空响应流。");
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let eventType = "";
  let doneEvent = false;
  let bytesRead = 0;

  function parseEvent(): StreamChunk[] {
    const raw = dataLines.join("\n");
    const type = eventType;
    dataLines = [];
    eventType = "";
    if (!raw) return [];
    if (raw.trim() === "[DONE]") { doneEvent = true; return []; }
    let event: any;
    try { event = JSON.parse(raw); } catch { throw new Error("模型返回了无效的 SSE JSON，未执行未完成的工具调用。"); }
    if (type === "error" || event.error) throw new Error("模型流返回错误，未执行未完成的工具调用。");
    const choice = event.choices?.find((item: any) => item.index === 0) || event.choices?.[0];
    if (!choice) return [];
    const chunks: StreamChunk[] = [];
    const delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content) chunks.push({ type: "text", content: delta.content });
    if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw new Error("模型工具调用格式无效。");
    for (const call of delta.tool_calls || []) {
      if (!Number.isInteger(call.index) || call.index < 0 || call.index > 31) throw new Error("模型工具调用索引无效。");
      if (call.type && call.type !== "function") throw new Error("不支持该工具调用类型。");
      if (call.id !== undefined && typeof call.id !== "string") throw new Error("模型工具调用 ID 无效。");
      if (call.function?.name !== undefined && typeof call.function.name !== "string") throw new Error("模型工具名称无效。");
      if (call.function?.arguments !== undefined && typeof call.function.arguments !== "string") throw new Error("模型工具参数无效。");
      chunks.push({ type: "tool_call", index: call.index, id: call.id, toolName: call.function?.name || "", toolArgs: call.function?.arguments || "" });
    }
    if (choice.finish_reason) chunks.push({ type: "finish", reason: choice.finish_reason });
    return chunks;
  }

  function consumeLine(line: string): StreamChunk[] {
    if (line === "") return parseEvent();
    if (line.startsWith(":")) return [];
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    if (field === "event") eventType = value;
    return [];
  }

  try {
    while (!doneEvent) {
      throwIfAborted(signal);
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) { buffer += decoder.decode(); break; }
      bytesRead += value.byteLength;
      if (bytesRead > 4_000_000) throw new Error("模型响应过大，已停止读取。");
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/[\r\n]/)) !== -1) {
        if (buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        const width = buffer[newline] === "\r" && buffer[newline + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(newline + width);
        for (const chunk of consumeLine(line)) yield chunk;
        if (doneEvent) break;
      }
    }
    if (!doneEvent) {
      for (const line of buffer.split(/\r\n|\r|\n/)) for (const chunk of consumeLine(line)) yield chunk;
      for (const chunk of parseEvent()) yield chunk;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
