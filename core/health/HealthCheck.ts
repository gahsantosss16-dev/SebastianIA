import type { HealthReport } from './HealthReport.js';

export interface HealthCheck {
  readonly id: string;
  readonly name: string;
  check(): Promise<HealthReport> | HealthReport;
}
