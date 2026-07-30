export type ConfigPrimitive = string | number | boolean | null;

export interface ConfigObject {
  readonly [key: string]: ConfigValue;
}

export type ConfigValue = ConfigPrimitive | readonly ConfigValue[] | ConfigObject;

export enum ConfigurationSource {
  DEFAULT = 'DEFAULT',
  FILE = 'FILE',
  ENVIRONMENT = 'ENVIRONMENT',
  RUNTIME = 'RUNTIME',
}

export interface ConfigurationEntry {
  readonly key: string;
  readonly value: ConfigValue;
  readonly source: ConfigurationSource;
  readonly registeredAt: string;
}
