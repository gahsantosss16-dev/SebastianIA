import type { LifecycleComponent, LifecycleError, LifecycleState } from './LifecycleTypes.js';

export class LifecycleManager {
  private state: LifecycleState = 'idle';
  private readonly components = new Map<string, LifecycleComponent>();
  private readonly startedComponents: LifecycleComponent[] = [];

  public getState(): LifecycleState {
    return this.state;
  }

  public isRegistered(id: string): boolean {
    return this.components.has(id);
  }

  public register(component: LifecycleComponent): void {
    if (this.isRegistered(component.id)) {
      throw new Error(`Lifecycle component already registered: ${component.id}`);
    }

    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'failed') {
      throw new Error(`Cannot register component while lifecycle is in state: ${this.state}`);
    }

    this.components.set(component.id, component);
  }

  public remove(id: string): void {
    if (this.state === 'starting' || this.state === 'running' || this.state === 'stopping') {
      throw new Error(`Cannot remove component while lifecycle is in state: ${this.state}`);
    }

    this.components.delete(id);
    this.startedComponents.splice(0, this.startedComponents.length);
  }

  public list(): LifecycleComponent[] {
    return Array.from(this.components.values()).sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder === rightOrder) {
        return 0;
      }

      return leftOrder - rightOrder;
    });
  }

  public async start(): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') {
      throw new Error(`Lifecycle already starting or running. Current state: ${this.state}`);
    }

    if (this.state === 'stopping') {
      throw new Error(`Cannot start while lifecycle is stopping. Current state: ${this.state}`);
    }

    this.state = 'starting';
    const ordered = this.list();
    const started: LifecycleComponent[] = [];
    const errors: string[] = [];

    for (const component of ordered) {
      try {
        await component.start();
        started.push(component);
        this.startedComponents.push(component);
      } catch (error) {
        errors.push(this.formatError(component.id, error));
        this.state = 'failed';
        await this.stopStartedComponents(started);
        const lifecycleError = this.createError(errors, error);
        throw lifecycleError;
      }
    }

    this.state = 'running';
  }

  public async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.state = 'stopped';
      return;
    }

    if (this.state === 'stopping') {
      throw new Error(`Lifecycle already stopping. Current state: ${this.state}`);
    }

    this.state = 'stopping';
    const errors: string[] = [];

    for (const component of [...this.startedComponents].reverse()) {
      try {
        await component.stop();
      } catch (error) {
        errors.push(this.formatError(component.id, error));
      }
    }

    this.startedComponents.length = 0;
    this.state = errors.length > 0 ? 'failed' : 'stopped';

    if (errors.length > 0) {
      throw this.createError(errors);
    }
  }

  private async stopStartedComponents(components: LifecycleComponent[]): Promise<void> {
    for (const component of [...components].reverse()) {
      try {
        await component.stop();
      } catch {
        // Preserve original start failure while stopping already started components.
      }
    }
  }

  private formatError(id: string, error: unknown): string {
    return `${id}: ${error instanceof Error ? error.message : String(error)}`;
  }

  private createError(errors: string[], cause?: unknown): LifecycleError {
    const error = new Error(errors.join('; ')) as LifecycleError;
    error.cause = cause;
    return error;
  }
}
