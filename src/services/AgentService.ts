import { AppState } from "../Store";
import { parseSSEStream } from "./StreamParser";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentResponse = {
  intent: "add_tasks" | "update_task" | "delete_task" | "decompose" | "generate_report" | "chat";
  data: {
    proposedTasks?: string[];
    targetDate?: string;
    progress?: number;
    taskId?: string;
    date?: string;
    notes?: string;
    priority?: string;
    startDate?: string;
    endDate?: string;
    reply?: string;
    chatTitle?: string;
  };
};

// ─── Unified API Client ──────────────────────────────────────────────────────

export async function callChatCompletion(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<Response> {
  const url = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: any = {
    model: params.model,
    messages: params.messages,
  };
  if (params.tools && params.tools.length > 0) body.tools = params.tools;
  if (params.stream) body.stream = true;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    if (res.status === 401)
      throw new Error(`API Error 401: 请检查 API Key 是否正确或已过期。`);
    if (res.status === 429)
      throw new Error(`API 调用次数已达上限，请稍后再试或更换 Key。`);
    throw new Error(`API Error ${res.status}: ${errText.substring(0, 100)}`);
  }

  return res;
}

// ─── Tool Definitions (5 Tools) ──────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_tasks",
      description: "当用户要求添加、新增任务或待办事项时调用",
      parameters: {
        type: "object",
        properties: {
          proposedTasks: { type: "array", items: { type: "string" }, description: "待添加的任务名称列表，每项不超过20字。第一项必须是用户原文要求的任务，后续2项为相关推荐" },
          targetDate: { type: "string", description: "目标日期 YYYY-MM-DD，仅当用户明确指定日期时才提供" },
          reply: { type: "string", description: "给用户的中文回复" },
          chatTitle: { type: "string", description: "3-10字的对话标题摘要，仅在对话历史少于2条时提供" },
        },
        required: ["proposedTasks", "reply"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "当用户要求更新任务的进度、日期、备注或优先级时调用",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "要更新的任务 ID" },
          progress: { type: "number", description: "新进度值 0-100" },
          date: { type: "string", description: "新日期 YYYY-MM-DD" },
          notes: { type: "string", description: "备注内容" },
          priority: { type: "string", enum: ["low", "medium", "high"], description: "优先级" },
          reply: { type: "string", description: "给用户的中文回复" },
          chatTitle: { type: "string", description: "3-10字的对话标题摘要" },
        },
        required: ["taskId", "reply"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "当用户要求删除某个任务时调用",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "要删除的任务 ID" },
          reply: { type: "string", description: "给用户的中文回复" },
          chatTitle: { type: "string", description: "3-10字的对话标题摘要" },
        },
        required: ["taskId", "reply"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decompose",
      description: "当用户要求拆解、分解某个任务为子任务时调用",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "要拆解的任务 ID" },
          proposedTasks: { type: "array", items: { type: "string" }, description: "拆解后的子任务列表，每项不超过20字" },
          reply: { type: "string", description: "给用户的中文回复" },
          chatTitle: { type: "string", description: "3-10字的对话标题摘要" },
        },
        required: ["taskId", "proposedTasks", "reply"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "当用户要求生成进度总结、报告、回顾时调用",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "报告起始日期 YYYY-MM-DD" },
          endDate: { type: "string", description: "报告结束日期 YYYY-MM-DD" },
          reply: { type: "string", description: "给用户的中文回复" },
          chatTitle: { type: "string", description: "3-10字的对话标题摘要" },
        },
        required: ["startDate", "endDate", "reply"],
      },
    },
  },
];

// ─── Local Rule Layer ────────────────────────────────────────────────────────

function matchLocalRule(text: string): string | null {
  if (/^(添加|新增|加个|帮我加).*(任务|事项|待办)/.test(text)) return "add_tasks";
  if (/^(删除|删掉|去掉|移除).*(任务)/.test(text)) return "delete_task";
  if (/(进度|更新到|完成了|做到了)\s*\d+/.test(text)) return "update_task";
  if (/(拆解|拆分|细化|分解)/.test(text)) return "decompose";
  if (/(总结|报告|回顾|复盘).*(周|天|号|月)/.test(text)) return "generate_report";
  return null;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildSystemPrompt(state: AppState, _ruleHint: string | null): string {
  const profileContext =
    state.profile.major || state.profile.goal || state.profile.skills || state.profile.bio
      ? `
    [User Profile Context]
    Profession/Field: ${state.profile.major}
    Core Goal: ${state.profile.goal}
    Skills: ${state.profile.skills}
    Bio/Background: ${state.profile.bio || ""}
    CRITICAL: DO NOT mention this profile in your response UNLESS the user explicitly asks about their identity/background.
  `
      : "";

  const tasksContext = state.tasks
    .filter((t) => t.date === state.activeDate)
    .map(
      (t) =>
        `${t.id}: ${t.name} (Progress: ${t.progress}%)${t.notes ? ` [Notes: ${t.notes}]` : ""}`
    )
    .join("\n");

  const currentSession = state.chatSessions.find(
    (cs) => cs.id === state.activeChatSessionId
  );
  const previousHistory =
    currentSession?.messages
      .slice(0, -1)
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.text}`)
      .join("\n") || "";

  return `You are ${state.settings.agentName || "任务助理"}, a professional task management AI assistant. Reply in Chinese.
Your style is: ${state.settings.agentStyle} (academic = 专业导师, gentle = 贴心助手, strict = 严厉督导).

${profileContext}

Current Date: ${state.activeDate}.
Current Tasks for today:
${tasksContext || "No tasks yet."}

Previous Chat History:
${previousHistory}

If chat history is empty or has fewer than 2 messages, include a 'chatTitle' (3-10 chars) summarizing this conversation.
`;
}

function getToolsForRequest(ruleHint: string | null): any[] {
  if (!ruleHint) return TOOLS;
  const matched = TOOLS.find((t) => t.function.name === ruleHint);
  return matched ? [matched] : TOOLS;
}

// ─── Parse Tool Call Response ────────────────────────────────────────────────

function parseToolCallToResponse(toolName: string, argsStr: string): AgentResponse {
  try {
    const args = JSON.parse(argsStr);
    return {
      intent: toolName as AgentResponse["intent"],
      data: {
        ...args,
      },
    };
  } catch {
    return { intent: "chat", data: { reply: "抱歉，我在处理你的请求时遇到了问题，请再试一次。" } };
  }
}

// ─── Main Agent Request (non-streaming, kept for regeneration etc.) ──────────

export async function processAgentRequest(
  text: string,
  state: AppState,
  abortSignal?: AbortSignal
): Promise<AgentResponse> {
  const apiKey = state.settings.apiKey || "";
  const baseUrl = state.settings.apiBaseUrl;
  const apiModel = state.settings.apiModel || "gemini-2.5-flash";

  const ruleHint = matchLocalRule(text);
  const systemPrompt = buildSystemPrompt(state, ruleHint);
  const tools = getToolsForRequest(ruleHint);

  const res = await callChatCompletion({
    baseUrl,
    apiKey,
    model: apiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
    tools,
    stream: false,
    signal: abortSignal,
  });

  const data = await res.json();
  const choice = data.choices?.[0];

  if (!choice) {
    return { intent: "chat", data: { reply: "收到！还有其他需要帮忙的吗？" } };
  }

  // Function Calling response
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    const tc = choice.message.tool_calls[0];
    return parseToolCallToResponse(tc.function.name, tc.function.arguments);
  }

  // Plain text response (chat)
  const replyText = choice.message?.content || "";
  // Try to extract chatTitle if model included it in text
  return { intent: "chat", data: { reply: replyText } };
}

// ─── Streaming Agent Request ────────────────────────────────────────────────────

export async function processAgentRequestStream(
  text: string,
  state: AppState,
  onTextChunk: (chunk: string) => void,
  abortSignal?: AbortSignal
): Promise<AgentResponse> {
  const apiKey = state.settings.apiKey || "";
  const baseUrl = state.settings.apiBaseUrl;
  const apiModel = state.settings.apiModel || "gemini-2.5-flash";

  const ruleHint = matchLocalRule(text);
  const systemPrompt = buildSystemPrompt(state, ruleHint);
  const tools = getToolsForRequest(ruleHint);

  const res = await callChatCompletion({
    baseUrl,
    apiKey,
    model: apiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
    tools,
    stream: true,
    signal: abortSignal,
  });

  let toolName = "";
  let toolArgsBuffer = "";
  let isToolCall = false;
  let fullText = "";

  for await (const chunk of parseSSEStream(res)) {
    if (chunk.type === "text") {
      fullText += chunk.content;
      onTextChunk(chunk.content);
    } else if (chunk.type === "tool_call") {
      isToolCall = true;
      if (chunk.toolName) toolName = chunk.toolName;
      toolArgsBuffer += chunk.toolArgs;
    }
  }

  if (isToolCall && toolName) {
    return parseToolCallToResponse(toolName, toolArgsBuffer);
  }

  return { intent: "chat", data: { reply: fullText } };
}

// ─── Report Generation (Report Agent) ────────────────────────────────────────

export async function generateCustomSummary(
  dates: string[],
  state: AppState
): Promise<string> {
  const apiKey = state.settings.apiKey || "";
  const baseUrl = state.settings.apiBaseUrl;
  const apiModel = state.settings.apiModel || "gemini-2.5-flash";

  const tasksContext = dates
    .map((date) => {
      const dayTasks = state.tasks.filter((t) => t.date === date);
      return (
        `Date: ${date}\n` +
        dayTasks
          .map(
            (t) =>
              `- [${t.progress >= 100 ? "x" : " "}] ${t.name} (Progress: ${t.progress}%)${t.notes ? `\n   Notes: ${t.notes}` : ""}`
          )
          .join("\n")
      );
    })
    .join("\n\n");

  const systemInstruction = `
    You are ${state.settings.agentName || "任务助理"}, a professional task management AI assistant. Reply in Chinese.
    Your style is: ${state.settings.agentStyle} (academic = 专业导师, gentle = 贴心助手, strict = 严厉督导).
    
    Please act as a data analyst and summarize the user's progress across the selected dates.
    Here are the tasks from those dates:
    ${tasksContext}

    Write a cohesive, insightful, and motivating summary report in Markdown.

    原则：
    1. 拒绝爹味与说教：充分理解研究生多线并行的压力。
    2. 包容多样性：任务可能涉及生活、求职、娱乐，不要强行将其与学术研究挂钩。

    生成报告的结构：
    1. 整体概览
    2. 任务进度审计
    3. 关键问题和建议
    4. 抓紧行动
    5. 结语
  `;

  const res = await callChatCompletion({
    baseUrl,
    apiKey,
    model: apiModel,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: "请为我生成这份总结报告。" },
    ],
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "生成报告失败，请检查 API 配置。";
}
