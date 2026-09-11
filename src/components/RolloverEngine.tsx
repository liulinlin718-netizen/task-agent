import { useEffect } from 'react';
import { useStore } from '../Store';
import { callChatCompletion, getChatConfig } from '../services/AgentService';
import { logicalDate, rolloverState } from '../state/appState';

export function useRolloverEngine() {
  const { getState, setState } = useStore();
  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      const snapshot = getState();
      const date = logicalDate(new Date(), snapshot.settings.rolloverTime);
      if (date <= snapshot.lastRolloverDate) return;
      const previousDate = snapshot.lastRolloverDate;
      try {
        setState(s => rolloverState(s, date));
        const tasks = snapshot.tasks.filter(t => t.date === previousDate);
        const config = getChatConfig(snapshot);
        // The local summary is already saved, so offline use never blocks rollover.
        if (!tasks.length || !config.apiKey) return;
        const response = await callChatCompletion({ ...config, signal: controller.signal,
          messages: [{ role: 'user', content: `用中文两句话鼓励性总结这些任务的进展，语气为${snapshot.settings.agentStyle}：\n${tasks.map(t => `${t.name}：${t.progress}%`).join('\n')}` }],
        });
        const data = await response.json();
        controller.signal.throwIfAborted();
        const summary = data.choices?.[0]?.message?.content;
        if (typeof summary !== 'string' || !summary.trim()) return;
        setState(s => ({ ...s, historySummaries: s.historySummaries.map(h => h.date === previousDate ? { ...h, summary } : h) }));
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('TaskAgent 日报', { body: summary.slice(0, 100) });
        }
      } catch { /* Keep the local summary if the model is unavailable or the app is closing. */ }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [getState, setState]);
}
