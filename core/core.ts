import { CoreConfigService, type CoreConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import type { CoreContext, CoreLifecycleState, CoreStatus } from './types.js';

export class SebastianCore {
  public readonly name: string;
  public readonly createdAt: string;
  public status: CoreStatus;

  private readonly configService: CoreConfigService;
  private readonly logger: Logger;
  private readonly lifecycleState: CoreLifecycleState;

  public constructor(name = 'Sebastian IA', config: Partial<CoreConfig> = {}, logger: Logger = createLogger()) {
    this.name = name;
    this.createdAt = new Date().toISOString();
    this.status = 'idle';
    this.configService = new CoreConfigService(config);
    this.logger = logger;
    this.lifecycleState = {
      initialized: false,
      started: false,
      shutDown: false,
    };
  }

  public initialize(): void {
    this.status = 'initializing';
    this.logger.info('Core initialization started.');
    this.lifecycleState.initialized = true;
    this.status = 'ready';
    this.logger.info('Core initialization completed.');
  }

  public start(): void {
    this.logger.info('Core start requested.');
    this.lifecycleState.started = true;
    this.status = 'ready';
    this.logger.info('Core started.');
  }

  public shutdown(): void {
    this.status = 'shuttingDown';
    this.logger.warn('Core shutdown requested.');
    this.lifecycleState.shutDown = true;
    this.status = 'idle';
    this.logger.info('Core shutdown completed.');
  }

  public getContext(): CoreContext {
    return {
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  public getLifecycleState(): CoreLifecycleState {
    return { ...this.lifecycleState };
  }

  public getConfig(): CoreConfig {
    return this.configService.get();
  }
}

export function createCore(name = 'Sebastian IA', config: Partial<CoreConfig> = {}, logger: Logger = createLogger()): SebastianCore {
  return new SebastianCore(name, config, logger);
}
