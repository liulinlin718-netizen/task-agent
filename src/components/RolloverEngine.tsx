import { useEffect } from "react";
import { format, subDays, isAfter, isBefore } from "date-fns";
import { useStore, AppState } from "../Store";
import { GoogleGenAI } from "@google/genai";

export function useRolloverEngine() {
  const { state, setState } = useStore();

  useEffect(() => {
    const checkRollover = async () => {
      const now = new Date();
      const currentLogicalDateStr = getLogicalDateString(now, state.settings.rolloverTime);

      if (currentLogicalDateStr > state.lastRolloverDate) {
        // Time to rollover for ALL days missed
        // We will just do a macro catch-up
        console.log("Rolling over... Current Logical Date:", currentLogicalDateStr, "Last Rollover:", state.lastRolloverDate);
        
        // 1. Generate summary for old lastRolloverDate (the logic: summarize yesterday)
        const summary = await generateSummary(state);
        
        setState(s => {
          const newTasks = [...s.tasks];
          // 2. Clone active tasks that were unfinished
          const targetDayTasks = s.tasks.filter(t => t.date === s.lastRolloverDate);
          
          targetDayTasks.forEach(task => {
            if (task.progress < 100) {
              newTasks.push({
                ...task,
                id: Date.now().toString() + Math.random(),
                date: currentLogicalDateStr
              });
            }
          });

          return {
            ...s,
            lastRolloverDate: currentLogicalDateStr,
            activeDate: currentLogicalDateStr,
            tasks: newTasks,
            historySummaries: [
              { date: s.lastRolloverDate, summary },
              ...s.historySummaries
            ]
          };
        });
      }
    };

    const interval = setInterval(checkRollover, 60000); // Check every minute
    checkRollover(); // Initial check

    return () => clearInterval(interval);
  }, [state.settings.rolloverTime, state.lastRolloverDate]); // Re-run if these change
}

function getLogicalDateString(date: Date, rolloverTime: string) {
  const [hours, minutes] = rolloverTime.split(":").map(Number);
  const rolloverDateObj = new Date(date);
  rolloverDateObj.setHours(hours, minutes, 0, 0);

  if (date.getTime() < rolloverDateObj.getTime()) {
    // Before rollover time -> still counts as previous day
    return format(subDays(date, 1), "yyyy-MM-dd");
  } else {
    // After rollover time -> counts as current day
    return format(date, "yyyy-MM-dd");
  }
}

async function generateSummary(state: AppState): Promise<string> {
  // Extract yesterday's tasks
  const tasks = state.tasks.filter(t => t.date === state.lastRolloverDate);
  const isGemini = state.settings.apiFormat === 'gemini';
  const isOpenAI = !isGemini;
  const apiKey = state.settings.apiKey || process.env.GEMINI_API_KEY;
  const apiUrl = state.settings.apiUrl;
  const apiModel = state.settings.apiModel || (isOpenAI ? "gpt-3.5-turbo" : "gemini-3-flash-preview");
  
  if (tasks.length === 0) return "今天没有记录任何任务。";

  const text = `
    Yesterday's Tasks for the User:
    ${tasks.map(t => `- [${t.progress}%] ${t.name}`).join("\n")}
    
    Provide a very short positive motivational summary (2 sentences max) in Chinese, in the persona of: ${state.settings.agentStyle}.
  `;

  try {
    if (isOpenAI) {
      if (!apiUrl) throw new Error("No URL");
      const baseUrl = apiUrl.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: apiModel,
          messages: [{ role: "user", content: text }]
        })
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "生成摘要失败。";
    } else {
      const config: any = { apiKey };
      if (apiUrl) config.baseUrl = apiUrl;
      const ai = new GoogleGenAI(config);
      const res = await ai.models.generateContent({
        model: apiModel,
        contents: text
      });
      return res.text || "生成摘要失败。";
    }
  } catch (e) {
    return "无法生成摘要。请检查 API 配置。";
  }
}
