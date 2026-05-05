import { useEffect } from "react";
import { format, subDays } from "date-fns";
import { useStore, AppState } from "../Store";
import { callChatCompletion } from "../services/AgentService";

export function useRolloverEngine() {
  const { state, setState } = useStore();

  useEffect(() => {
    const checkRollover = async () => {
      const now = new Date();
      const currentLogicalDateStr = getLogicalDateString(now, state.settings.rolloverTime);

      if (currentLogicalDateStr > state.lastRolloverDate) {
        console.log("Rolling over... Current Logical Date:", currentLogicalDateStr, "Last Rollover:", state.lastRolloverDate);
        
        const summary = await generateSummary(state);
        
        setState(s => {
          const newTasks = [...s.tasks];
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

    const interval = setInterval(checkRollover, 60000);
    checkRollover();

    return () => clearInterval(interval);
  }, [state.settings.rolloverTime, state.lastRolloverDate]);
}

function getLogicalDateString(date: Date, rolloverTime: string) {
  const [hours, minutes] = rolloverTime.split(":").map(Number);
  const rolloverDateObj = new Date(date);
  rolloverDateObj.setHours(hours, minutes, 0, 0);

  if (date.getTime() < rolloverDateObj.getTime()) {
    return format(subDays(date, 1), "yyyy-MM-dd");
  } else {
    return format(date, "yyyy-MM-dd");
  }
}

async function generateSummary(state: AppState): Promise<string> {
  const tasks = state.tasks.filter(t => t.date === state.lastRolloverDate);
  const apiKey = state.settings.apiKey || "";
  const baseUrl = state.settings.apiBaseUrl;
  const apiModel = state.settings.apiModel || "gemini-2.5-flash";
  
  if (tasks.length === 0) return "今天没有记录任何任务。";

  const text = `
    Yesterday's Tasks for the User:
    ${tasks.map(t => `- [${t.progress}%] ${t.name}`).join("\n")}
    
    Provide a very short positive motivational summary (2 sentences max) in Chinese, in the persona of: ${state.settings.agentStyle}.
  `;

  try {
    const res = await callChatCompletion({
      baseUrl,
      apiKey,
      model: apiModel,
      messages: [{ role: "user", content: text }],
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "生成摘要失败。";
  } catch (e) {
    return "无法生成摘要。请检查 API 配置。";
  }
}
