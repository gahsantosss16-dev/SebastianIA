export class InvalidPluginError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidPluginError';
  }
}

export class PluginAlreadyRegisteredError extends Error {
  public constructor(id: string) {
    super(`Plugin already registered: ${id}`);
    this.name = 'PluginAlreadyRegisteredError';
  }
}

export class PluginNotFoundError extends Error {
  public constructor(id: string) {
    super(`Plugin not found: ${id}`);
    this.name = 'PluginNotFoundError';
  }
}

export class InvalidPluginStateError extends Error {
  public constructor(id: string, state: string) {
    super(`Invalid plugin state for ${id}: ${state}`);
    this.name = 'InvalidPluginStateError';
  }
}

export class PluginActivationError extends Error {
  public declare cause?: unknown;

  public constructor(id: string, message: string, cause?: unknown) {
    super(`Plugin activation failed for ${id}: ${message}`);
    this.name = 'PluginActivationError';
    this.cause = cause;
  }
}

export class PluginDeactivationError extends Error {
  public declare cause?: unknown;

  public constructor(id: string, message: string, cause?: unknown) {
    super(`Plugin deactivation failed for ${id}: ${message}`);
    this.name = 'PluginDeactivationError';
    this.cause = cause;
  }
}

export class PluginAggregateError extends Error {
  public readonly errors: Error[];

  public constructor(errors: Error[]) {
    super(errors.map((error) => error.message).join('; '));
    this.name = 'PluginAggregateError';
    this.errors = errors;
  }
}
