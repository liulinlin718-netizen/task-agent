export {};

declare global {
  interface Window {
    electronAPI?: {
      updateBall: (enabled: boolean) => void;
      updateTaskCenter: (enabled: boolean) => void;

      ballExpand: () => void;
      ballCollapse: () => void;
      ballCheckSnap: () => 'left' | 'right' | null;

      windowMove: (dx: number, dy: number) => void;
      windowDragStart: () => void;
      windowDragTo: (x: number, y: number) => void;
      windowDragEnd: () => void;
      windowGetPosition: () => [number, number];
      windowGetBounds: () => { x: number; y: number; width: number; height: number };
      windowSetBounds: (b: { x: number; y: number; width: number; height: number }) => void;

      screenGetWorkArea: () => { width: number; height: number };

      taskCenterSnapToEdge: (edge: 'left' | 'right', height?: number) => void;
      taskCenterExpandFromEdge: (edge: 'left' | 'right', width?: number, height?: number) => void;
      taskCenterCheckSnap: () => 'left' | 'right' | null;
      onTaskCenterAutoSnap: (callback: (edge: 'left' | 'right' | null) => void) => void;
    };
  }
}
