/**
 * SSE Stream Parser for OpenAI-compatible streaming responses.
 * Parses Server-Sent Events and yields incremental chunks.
 */

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; toolName: string; toolArgs: string };

/**
 * Async generator that parses an SSE response stream.
 * Handles both text content and tool_call increments.
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6); // Remove "data: " prefix
        if (data === "[DONE]") return;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            yield { type: "text", content: delta.content };
          }

          // Tool call
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            const tc = delta.tool_calls[0];
            yield {
              type: "tool_call",
              toolName: tc.function?.name || "",
              toolArgs: tc.function?.arguments || "",
            };
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
