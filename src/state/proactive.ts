export type TaskReminder = {
  id: string;
  taskId: string;
  taskName: string;
  taskDate: string;
  progress: number;
  lastProgressAt: string;
  createdAt: string;
  message: string;
};

export type ProactiveState = {
  day: string;
  count: number;
  lastRemindedAt?: string;
  snoozedUntil?: string;
  dismissedDate?: string;
  active?: TaskReminder;
};

export type ReminderAction = 'update' | 'snooze' | 'today' | 'help';
