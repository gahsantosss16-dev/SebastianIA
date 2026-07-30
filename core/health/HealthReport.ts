import { HealthStatus } from './HealthStatus.js';

export interface HealthReport {
  readonly id: string;
  readonly name: string;
  readonly status: HealthStatus;
  readonly timestamp: string;
  readonly message?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export function createHealthReport(
  id: string,
  name: string,
  status: HealthStatus,
  message?: string,
  metadata?: Record<string, unknown>,
): HealthReport {
  return {
    id,
    name,
    status,
    timestamp: new Date().toISOString(),
    ...(message !== undefined ? { message } : {}),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  };
}
