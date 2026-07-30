import type {
  CoreEventMap,
  EventEnvelope,
  EventListener,
  EventName,
} from './EventTypes.js';

export class EventBus<TEventMap extends object = CoreEventMap> {
  private readonly listeners = new Map<EventName<TEventMap>, Set<EventListener<TEventMap, EventName<TEventMap>>>>();

  public subscribe<TEventName extends EventName<TEventMap>>(
    eventName: TEventName,
    listener: EventListener<TEventMap, TEventName>,
  ): () => void {
    const listenersForEvent = this.listeners.get(eventName) ?? new Set<EventListener<TEventMap, EventName<TEventMap>>>();

    listenersForEvent.add(listener as EventListener<TEventMap, EventName<TEventMap>>);
    this.listeners.set(eventName, listenersForEvent);

    return () => {
      this.unsubscribe(eventName, listener);
    };
  }

  public unsubscribe<TEventName extends EventName<TEventMap>>(
    eventName: TEventName,
    listener: EventListener<TEventMap, TEventName>,
  ): void {
    const listenersForEvent = this.listeners.get(eventName);

    if (!listenersForEvent) {
      return;
    }

    listenersForEvent.delete(listener as EventListener<TEventMap, EventName<TEventMap>>);

    if (listenersForEvent.size === 0) {
      this.listeners.delete(eventName);
    }
  }

  public emit<TEventName extends EventName<TEventMap>>(
    eventName: TEventName,
    payload: TEventMap[TEventName & keyof TEventMap],
  ): void {
    const listenersForEvent = this.listeners.get(eventName);

    if (!listenersForEvent) {
      return;
    }

    const event: EventEnvelope<TEventMap, TEventName> = {
      type: eventName,
      payload,
    };

    for (const listener of Array.from(listenersForEvent)) {
      listener(event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
