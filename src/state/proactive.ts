export type TaskReminder = {
  id: string;
  taskId: string;
  taskName: string;
  taskDate: string;
  progress: number;
  lastProgressAt: string;
  createdAt: string;
  message: string;
  snoozeMinutes?: 30 | 60 | 120;
};

export type TaskReminderState = {
  snoozedUntil?: string;
  snoozeCount?: number;
  dismissedDate?: string;
  lastProgressAt?: string;
};

export type ProactiveState = {
  day: string;
  count: number;
  lastRemindedAt?: string;
  snoozedUntil?: string;
  dismissedDate?: string;
  active?: TaskReminder;
  taskStates?: Record<string, TaskReminderState>;
};

export type ReminderAction = 'update' | 'complete' | 'advance' | 'unchanged' | 'snooze' | 'dismiss-task' | 'today' | 'help';
