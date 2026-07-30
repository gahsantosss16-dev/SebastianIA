export type ServiceIdentifier<TService = unknown> =
  | (new (...args: never[]) => TService)
  | (abstract new (...args: never[]) => TService)
  | string;
