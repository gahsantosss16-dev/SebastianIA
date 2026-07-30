export type LifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface LifecycleComponent {
  id: string;
  order: number | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface LifecycleError extends Error {
  cause?: unknown;
}
