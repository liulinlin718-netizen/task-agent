import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import { AppState } from "../Store";
import { callChatCompletion, getChatConfig } from "./AgentService";

/**
 * Extract plain text from uploaded file.
 * Supports .txt and .docx.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt") {
    return file.text();
  }

  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (ext === "pdf") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return fullText;
  }

  throw new Error(`不支持的文件格式: .${ext}（目前支持 .txt、.docx 和 .pdf）`);
}

/**
 * Send extracted text to LLM and get back a list of TODO items.
 */
export async function extractTasksFromText(
  text: string,
  state: AppState
): Promise<string[]> {
  const { apiKey, baseUrl, model } = getChatConfig(state);

  const prompt = `从以下文档中提取所有待办事项、行动项和任务。
只返回一个 JSON 数组，每个元素是一个任务描述字符串。不要返回任何其他内容。
示例输出：["完成实验报告", "预约导师会议"]

文档内容：
${text.slice(0, 8000)}`;

  const res = await callChatCompletion({
    baseUrl,
    apiKey,
    model,
    messages: [{ role: "user", content: prompt }],
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Extract JSON array from response (may be wrapped in markdown code block)
  const match = content.match(/\[[\s\S]*?\]/);
  if (!match) return [];

  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.filter((s: any) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}
