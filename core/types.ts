export type CoreStatus = 'idle' | 'initializing' | 'ready' | 'shuttingDown' | 'error';

export interface CoreContext {
  name: string;
  status: CoreStatus;
  createdAt: string;
}

export interface CoreLifecycleState {
  initialized: boolean;
  started: boolean;
  shutDown: boolean;
}
