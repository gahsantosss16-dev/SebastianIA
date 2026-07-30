import { createCore } from './core.js';

export const core = createCore();

core.initialize();
core.start();

export { createCore } from './core.js';
export * from './config.js';
export * from './logger.js';
export * from './types.js';
export * from './events/EventBus.js';
export * from './events/EventTypes.js';
export * from './container/index.js';
export * from './lifecycle/index.js';
export * from './plugins/index.js';
export * from './errors/index.js';
