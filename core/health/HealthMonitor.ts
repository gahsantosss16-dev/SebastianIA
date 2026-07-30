import type { HealthCheck } from './HealthCheck.js';
import { createHealthReport, type HealthReport } from './HealthReport.js';
import { HealthStatus } from './HealthStatus.js';

export class HealthMonitor {
  private readonly checks = new Map<string, HealthCheck>();

  public register(check: HealthCheck): boolean {
    if (this.checks.has(check.id)) {
      throw new Error(`Health check with id '${check.id}' is already registered`);
    }

    this.checks.set(check.id, check);
    return true;
  }

  public remove(id: string): boolean {
    return this.checks.delete(id);
  }

  public clear(): void {
    this.checks.clear();
  }

  public get(id: string): HealthCheck | undefined {
    return this.checks.get(id);
  }

  public list(): HealthCheck[] {
    return Array.from(this.checks.values());
  }

  public async run(id: string): Promise<HealthReport> {
    const check = this.checks.get(id);
    if (!check) {
      throw new Error(`Health check with id '${id}' was not found`);
    }

    try {
      const result = await check.check();
      return this.normalizeReport(check, result);
    } catch (error) {
      return this.createFailureReport(check, error);
    }
  }

  public async runAll(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];

    for (const check of this.list()) {
      try {
        const result = await check.check();
        reports.push(this.normalizeReport(check, result));
      } catch (error) {
        reports.push(this.createFailureReport(check, error));
      }
    }

    return reports;
  }

  private normalizeReport(check: HealthCheck, result: HealthReport | Promise<HealthReport>): HealthReport {
    if (result instanceof Promise) {
      throw new Error('Health check returned a promise unexpectedly');
    }

    return {
      id: result.id ?? check.id,
      name: result.name ?? check.name,
      status: result.status ?? HealthStatus.UNKNOWN,
      timestamp: result.timestamp ?? new Date().toISOString(),
      ...(result.message !== undefined ? { message: result.message } : {}),
      ...(result.metadata !== undefined ? { metadata: Object.freeze({ ...result.metadata }) } : {}),
    };
  }

  private createFailureReport(check: HealthCheck, error: unknown): HealthReport {
    return createHealthReport(
      check.id,
      check.name,
      HealthStatus.UNHEALTHY,
      'Health check failed',
      { cause: error },
    );
  }
}
