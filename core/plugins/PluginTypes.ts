export type PluginState = 'registered' | 'activating' | 'active' | 'deactivating' | 'inactive' | 'failed';

export interface PluginMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
}

export interface PluginContext {
  readonly metadata?: Record<string, unknown>;
  readonly eventBus?: unknown;
  readonly serviceContainer?: unknown;
}

export interface Plugin extends PluginMetadata {
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
}

export interface PluginEntry extends PluginMetadata {
  readonly state: PluginState;
}
