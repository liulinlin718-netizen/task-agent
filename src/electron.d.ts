export {};

declare global {
  interface Window {
    electronAPI?: {
      updateBall: (enabled: boolean) => void;
      updateTaskCenter: (enabled: boolean) => void;

      ballExpand: () => void;
      ballCollapse: () => void;
      ballCheckSnap: () => 'left' | 'right' | null;
      reminderAction: (id: string, action: import('./state/proactive').ReminderAction, progress?: number) => { ok: boolean; error?: string };
      ballReady: () => void;
      onReminderHelp: (callback: (detail: { taskId: string; taskName: string; prompt: string }) => void) => () => void;

      windowMove: (dx: number, dy: number) => void;
      windowDragStart: () => void;
      windowDragTo: (x: number, y: number) => void;
      windowDragEnd: () => void;
      windowGetPosition: () => [number, number];
      windowGetBounds: () => { x: number; y: number; width: number; height: number };
      windowSetBounds: (b: { x: number; y: number; width: number; height: number }) => void;

      screenGetWorkArea: () => { x: number; y: number; width: number; height: number };

      taskCenterSnapToEdge: (edge: 'left' | 'right', height?: number) => void;
      taskCenterExpandFromEdge: (edge: 'left' | 'right', width?: number, height?: number) => void;
      taskCenterCheckSnap: () => 'left' | 'right' | null;
      onTaskCenterAutoSnap: (callback: (edge: 'left' | 'right' | null) => void) => () => void;

      storeGet: () => string | null;
      storeSet: (data: string) => boolean;
      storeCommit: (data: string, base: string, guard?: { sessionId: string; messageId: string }) => string | null;
      onStoreChanged: (callback: (data: string) => void) => () => void;
      dataExport: (password: string) => Promise<boolean | null>;
      dataImport: (password: string) => Promise<string | null>;
    };
  }
}
