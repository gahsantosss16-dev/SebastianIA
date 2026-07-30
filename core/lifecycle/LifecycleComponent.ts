import type { LifecycleComponent as LifecycleComponentContract } from './LifecycleTypes.js';

export class LifecycleComponentAdapter implements LifecycleComponentContract {
  public readonly id: string;
  public readonly order: number | undefined;
  private readonly onStart: () => Promise<void>;
  private readonly onStop: () => Promise<void>;

  public constructor(
    id: string,
    start: () => Promise<void>,
    stop: () => Promise<void>,
    order?: number,
  ) {
    this.id = id;
    this.order = order;
    this.onStart = start;
    this.onStop = stop;
  }

  public async start(): Promise<void> {
    await this.onStart();
  }

  public async stop(): Promise<void> {
    await this.onStop();
  }
}
