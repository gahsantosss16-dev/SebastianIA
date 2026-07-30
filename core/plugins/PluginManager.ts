import {
  InvalidPluginError,
  InvalidPluginStateError,
  PluginActivationError,
  PluginAggregateError,
  PluginAlreadyRegisteredError,
  PluginDeactivationError,
  PluginNotFoundError,
} from './PluginErrors.js';
import type { Plugin, PluginContext, PluginEntry, PluginState } from './PluginTypes.js';

export class PluginManager {
  private readonly plugins = new Map<string, Plugin>();
  private readonly states = new Map<string, PluginState>();

  public register(plugin: Plugin): void {
    this.validatePlugin(plugin);

    if (this.plugins.has(plugin.id)) {
      throw new PluginAlreadyRegisteredError(plugin.id);
    }

    this.plugins.set(plugin.id, plugin);
    this.states.set(plugin.id, 'registered');
  }

  public get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  public isRegistered(id: string): boolean {
    return this.plugins.has(id);
  }

  public getMetadata(id: string): PluginEntry | undefined {
    const plugin = this.plugins.get(id);

    if (!plugin) {
      return undefined;
    }

    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      state: this.states.get(id) ?? 'registered',
    };
  }

  public getState(id: string): PluginState | undefined {
    return this.states.get(id);
  }

  public list(): PluginEntry[] {
    return Array.from(this.plugins.values()).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      state: this.states.get(plugin.id) ?? 'registered',
    }));
  }

  public async activate(id: string, context: PluginContext = {}): Promise<void> {
    const plugin = this.plugins.get(id);

    if (!plugin) {
      throw new PluginNotFoundError(id);
    }

    const state = this.states.get(id) ?? 'registered';

    if (state === 'active') {
      throw new InvalidPluginStateError(id, state);
    }

    if (state === 'activating' || state === 'deactivating') {
      throw new InvalidPluginStateError(id, state);
    }

    this.states.set(id, 'activating');

    try {
      await plugin.activate(context);
      this.states.set(id, 'active');
    } catch (error) {
      this.states.set(id, 'failed');
      throw new PluginActivationError(id, error instanceof Error ? error.message : String(error), error);
    }
  }

  public async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);

    if (!plugin) {
      throw new PluginNotFoundError(id);
    }

    const state = this.states.get(id) ?? 'registered';

    if (state === 'inactive' || state === 'registered') {
      this.states.set(id, 'inactive');
      return;
    }

    if (state === 'deactivating' || state === 'activating') {
      throw new InvalidPluginStateError(id, state);
    }

    this.states.set(id, 'deactivating');

    try {
      await plugin.deactivate();
      this.states.set(id, 'inactive');
    } catch (error) {
      this.states.set(id, 'failed');
      throw new PluginDeactivationError(id, error instanceof Error ? error.message : String(error), error);
    }
  }

  public async activateAll(context: PluginContext = {}): Promise<void> {
    const ordered = Array.from(this.plugins.values());
    const activatedInOperation: Plugin[] = [];

    for (const plugin of ordered) {
      const state = this.states.get(plugin.id) ?? 'registered';

      if (state === 'active') {
        continue;
      }

      try {
        await this.activate(plugin.id, context);
        activatedInOperation.push(plugin);
      } catch (error) {
        for (const activatedPlugin of [...activatedInOperation].reverse()) {
          const currentState = this.states.get(activatedPlugin.id) ?? 'registered';

          if (currentState === 'active') {
            await this.deactivate(activatedPlugin.id);
          }
        }

        throw error;
      }
    }
  }

  public async deactivateAll(): Promise<void> {
    const ordered = Array.from(this.plugins.values()).reverse();
    const errors: Error[] = [];

    for (const plugin of ordered) {
      const state = this.states.get(plugin.id) ?? 'registered';

      if (state !== 'active') {
        continue;
      }

      try {
        await this.deactivate(plugin.id);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) {
      throw new PluginAggregateError(errors);
    }
  }

  public remove(id: string): void {
    const state = this.states.get(id) ?? 'registered';

    if (state === 'activating' || state === 'active' || state === 'deactivating') {
      throw new InvalidPluginStateError(id, state);
    }

    this.plugins.delete(id);
    this.states.delete(id);
  }

  public clear(): void {
    for (const [id, state] of this.states.entries()) {
      if (state === 'activating' || state === 'active' || state === 'deactivating') {
        throw new InvalidPluginStateError(id, state);
      }
    }

    this.plugins.clear();
    this.states.clear();
  }

  private validatePlugin(plugin: Plugin): void {
    if (!plugin || typeof plugin !== 'object') {
      throw new InvalidPluginError('Plugin must be an object');
    }

    if (typeof plugin.id !== 'string' || plugin.id.trim() === '') {
      throw new InvalidPluginError('Plugin id must be a non-empty string');
    }

    if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
      throw new InvalidPluginError('Plugin name must be a non-empty string');
    }

    if (typeof plugin.version !== 'string' || plugin.version.trim() === '') {
      throw new InvalidPluginError('Plugin version must be a non-empty string');
    }

    if (typeof plugin.activate !== 'function' || typeof plugin.deactivate !== 'function') {
      throw new InvalidPluginError('Plugin must expose activate and deactivate methods');
    }
  }
}
