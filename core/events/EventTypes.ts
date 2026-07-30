export type EventMap = Record<string, unknown>;

export type EventName<TEventMap extends object> = Extract<keyof TEventMap, string>;

export interface EventEnvelope<TEventMap extends object, TEventName extends string> {
  type: TEventName;
  payload: TEventMap[TEventName & keyof TEventMap];
}

export type EventListener<TEventMap extends object, TEventName extends string> = (
  event: EventEnvelope<TEventMap, TEventName>,
) => void;

export interface CoreEventMap {
  'core.initialized': {
    source: string;
    timestamp: string;
  };
  'core.started': {
    source: string;
    timestamp: string;
  };
  'core.shuttingDown': {
    source: string;
    timestamp: string;
  };
}

export const CoreEventNames = {
  initialized: 'core.initialized',
  started: 'core.started',
  shuttingDown: 'core.shuttingDown',
} as const;
