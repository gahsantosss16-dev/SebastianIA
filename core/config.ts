export interface CoreConfig {
  appName: string;
  environment: 'development' | 'production' | 'test';
  debug: boolean;
}

export class CoreConfigService {
  private readonly config: CoreConfig;

  public constructor(config: Partial<CoreConfig> = {}) {
    this.config = this.validate({
      appName: config.appName ?? 'Sebastian IA',
      environment: config.environment ?? 'development',
      debug: config.debug ?? true,
    });
  }

  public get(): CoreConfig {
    return this.config;
  }

  private validate(config: CoreConfig): CoreConfig {
    if (!config.appName.trim()) {
      throw new Error('Core config requires a non-empty appName.');
    }

    if (!['development', 'production', 'test'].includes(config.environment)) {
      throw new Error('Core config has an invalid environment.');
    }

    return config;
  }
}

export function createDefaultCoreConfig(): CoreConfig {
  return new CoreConfigService().get();
}
