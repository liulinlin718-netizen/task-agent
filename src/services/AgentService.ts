import { GoogleGenAI, Type } from "@google/genai";
import { AppState, Task } from "../Store";

export type AgentResponse = {
  intent: "add_tasks" | "update_progress" | "decompose" | "chat";
  data: {
    proposedTasks?: string[];
    targetDate?: string; // YYYY-MM-DD format
    progress?: number;
    taskId?: string; // used for updating or decomposing
    reply?: string;
    chatTitle?: string;
  };
};

export async function generateCustomSummary(
  dates: string[], 
  state: AppState
): Promise<string> {
  const isGemini = state.settings.apiFormat === 'gemini';
  const isOpenAI = !isGemini;
  const apiKey = state.settings.apiKey || process.env.GEMINI_API_KEY;
  const apiUrl = state.settings.apiUrl;
  const apiModel = state.settings.apiModel || (isOpenAI ? "gpt-3.5-turbo" : "gemini-3-flash-preview");

  const tasksContext = dates.map(date => {
    const dayTasks = state.tasks.filter(t => t.date === date);
    return `Date: ${date}\n` + dayTasks.map(t => `- [${t.progress >= 100 ? 'x' : ' '}] ${t.name} (Progress: ${t.progress}%)${t.notes ? `\n   Notes: ${t.notes}` : ''}`).join("\n");
  }).join("\n\n");

  const systemInstruction = `
    You are ${state.settings.agentName || '任务助理'}, a professional task management AI assistant. Reply in Chinese.
    Your style is: ${state.settings.agentStyle} (academic = 专业导师, gentle = 贴心助手, strict = 严厉督导).
    
    Please act as a data analyst and summarize the user's progress across the selected dates.
    Here are the tasks from those dates:
    ${tasksContext}

    Write a cohesive, insightful, and motivating summary report in Markdown. Highlight completions, overall progress, and areas where focus is needed. Keep it relatively concise but structural.

    原则：
    1. 拒绝爹味与说教：充分理解研究生多线并行的压力。
    2. 包容多样性：任务可能涉及生活、求职、娱乐，不要强行将其与学术研究挂钩，就事论事地评价其进展。

    生成报告的结构（请严格按顺序包含以下部分）：
    1. 整体概览
    2. 任务进度审计（请分段落、总结性地概述进展，不需要一条一条罗列和评价）
    3. 关键问题和建议
    4. 抓紧行动（敦促用户要做的事）
    5. 结语
  `;

  if (isOpenAI) {
    const defaultApiUrl = "https://api.openai.com/v1";
    const baseUrl = (apiUrl || defaultApiUrl).replace(/\/$/, "");

    if (baseUrl.includes('api.openai.com') && !apiKey) {
      throw new Error("使用官方 OpenAI 服务请输入 API Key。");
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: apiModel || "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: "请为我生成这份总结报告。" }
        ]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      if (res.status === 401) throw new Error(`API Error 401: 请检查 API Key 是否正确或已过期。(${errText.substring(0, 50)})`);
      throw new Error(`API Error: ${res.status} HTTP. ${errText.substring(0, 100)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  const aiOptions: any = { apiKey };
  if (apiUrl) aiOptions.baseUrl = apiUrl;
  const ai = new GoogleGenAI(aiOptions);

  const response = await ai.models.generateContent({
    model: apiModel,
    contents: "请为我生成这份总结报告。",
    config: { systemInstruction }
  });

  return response.text || "";
}

export async function processAgentRequest(
  text: string, 
  state: AppState,
  abortSignal?: AbortSignal
): Promise<AgentResponse> {
  const isGemini = state.settings.apiFormat === 'gemini';
  const isOpenAI = !isGemini;
  const apiKey = state.settings.apiKey || process.env.GEMINI_API_KEY;
  const apiUrl = state.settings.apiUrl;
  const apiModel = state.settings.apiModel || (isOpenAI ? "gpt-3.5-turbo" : "gemini-3-flash-preview");

  const tasksContext = state.tasks
    .filter(t => t.date === state.activeDate)
    .map(t => `${t.id}: ${t.name} (Progress: ${t.progress}%)${t.notes ? ` [Notes: ${t.notes}]` : ''}`)
    .join("\n");

  const currentSession = state.chatSessions.find(cs => cs.id === state.activeChatSessionId);
  const previousHistory = currentSession?.messages.slice(0, -1).map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`).join('\n') || '';

  const profileContext = (state.profile.major || state.profile.goal || state.profile.skills || state.profile.bio) ? `
    [User Profile Context]
    Profession/Field: ${state.profile.major}
    Core Goal: ${state.profile.goal}
    Skills: ${state.profile.skills}
    Bio/Background: ${state.profile.bio || ''}
    CRITICAL INSTRUCTION: Absolutely DO NOT mention, refer to, or use this profile information in your response UNLESS the user's current prompt explicitly mentions their identity, skills, background, major, or goals. For normal task management, act as if you do not know this profile information.
  ` : '';

  const systemInstruction = `
    You are ${state.settings.agentName || '任务助理'}, a professional task management AI assistant. Reply in Chinese.
    Your style is: ${state.settings.agentStyle} (academic = 专业导师, gentle = 贴心助手, strict = 严厉督导).
    
    ${profileContext}

    Current Date: ${state.activeDate}.
    Current Tasks for today:
    ${tasksContext || "No tasks yet."}

    Previous Chat History:
    ${previousHistory}

    Analyze the user's input and determine the intent.
    If the user asks to add or propose tasks, intent="add_tasks", provide an array of task names in 'proposedTasks' to suggest to the user. 
    If the user explicitly specifies a date (e.g. "April 29", "tomorrow", "next Monday"), calculate that exact date and return it in 'targetDate' (format: YYYY-MM-DD). If no date is specified, omit 'targetDate' and it will default to the current active date.
    CRITICAL: The FIRST item in 'proposedTasks' MUST be exactly what the user asked for (keep their original phrasing unless it's extremely unclear). Then provide 2 additional related recommendations.
    ENSURE each proposed task is highly concise, no more than 20 characters maximum!
    
    If the user asks to update progress, intent="update_progress", find the best matching taskId and set progress (0-100).
    If the user asks to break down a task, intent="decompose", provide an array of subTasks in 'proposedTasks' and the target taskId. ENSURE each proposed task is highly concise, no more than 20 characters maximum!
    Otherwise, intent="chat" and provide a reply in Chinese.

    NOTE: If 'Previous Chat History' is empty or has fewer than 2 messages, you MUST provide a concise 3-10 character summary of the user's first message and intent in 'chatTitle'. This will be used as the conversation title.
  `;

  if (isOpenAI) {
    const defaultApiUrl = "https://api.openai.com/v1";
    const baseUrl = (apiUrl || defaultApiUrl).replace(/\/$/, "");

    if (baseUrl.includes('api.openai.com') && !apiKey) {
      throw new Error("使用官方 OpenAI 服务请输入 API Key。");
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: apiModel || "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemInstruction + "\\n\\nYou must output ONLY raw valid JSON inside. Format: {\"intent\": \"add_tasks\", \"data\": {\"reply\": \"...\", \"chatTitle\": \"...\", \"targetDate\": \"YYYY-MM-DD\", \"proposedTasks\": [\"...\"]}}" },
          { role: "user", content: text }
        ]
      }),
      signal: abortSignal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      if (res.status === 401) throw new Error(`API Error 401: 请检查 API Key 是否正确或已过期。(${errText.substring(0, 50)})`);
      throw new Error(`API Error: ${res.status} HTTP. ${errText.substring(0, 100)}`);
    }
    const data = await res.json();
    const responseText = data.choices?.[0]?.message?.content || "";
    const cleanJSON = responseText.replace(/```json/gi, "").replace(/```/gi, "").trim();
    return JSON.parse(cleanJSON);
  }

  const aiOptions: any = { apiKey };
  if (apiUrl) aiOptions.baseUrl = apiUrl;
  const ai = new GoogleGenAI(aiOptions);

  const requestPromise = ai.models.generateContent({
    model: apiModel,
    contents: text,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: {
            type: Type.STRING,
            enum: ["add_tasks", "update_progress", "decompose", "chat"],
            description: "The intended action"
          },
          data: {
            type: Type.OBJECT,
            properties: {
              proposedTasks: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              targetDate: { type: Type.STRING },
              progress: { type: Type.NUMBER },
              taskId: { type: Type.STRING },
              reply: { type: Type.STRING },
              chatTitle: { type: Type.STRING }
            }
          }
        },
        required: ["intent", "data"]
      }
    }
  });

  const response = await (abortSignal ? Promise.race([
    requestPromise,
    new Promise<any>((_, reject) => {
      const onAbort = () => {
        reject(new Error("AbortError"));
        abortSignal.removeEventListener('abort', onAbort);
      };
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort);
    })
  ]) : requestPromise);

  const rawText = response.text || "{}";
  let parsed: AgentResponse;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    parsed = { intent: "chat", data: { reply: "I'm having trouble understanding right now." } };
  }

  if (parsed.intent === "chat" && !parsed.data.reply) {
    parsed.data.reply = "收到！还有其他需要帮忙的吗？";
  }

  return parsed;
}
