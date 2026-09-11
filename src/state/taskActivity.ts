import type { AppState } from '../Store';

/** Browser preview records the same progress signal as the desktop store. */
export function trackTaskActivity(previous: AppState, next: AppState, now = new Date()): AppState {
  const existing = new Map(previous.tasks.map(task => [task.id, task]));
  const timestamp = now.toISOString();
  return { ...next, tasks: next.tasks.map(task => {
    const prior = existing.get(task.id);
    const lastProgressAt = !prior || prior.progress !== task.progress
      ? timestamp : prior.lastProgressAt || timestamp;
    return task.lastProgressAt === lastProgressAt ? task : { ...task, lastProgressAt };
  }) };
}
