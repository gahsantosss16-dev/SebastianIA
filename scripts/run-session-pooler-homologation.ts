/** Linux/container runner: credential material exists only in the mounted file and child environment. */
import { spawnSync } from 'node:child_process';
import { HomologationPreparationError, prepareSessionPoolerEnvironment } from './SessionPoolerHomologationEnvironment.js';

const write = (report: Record<string, unknown>): void => { console.log(JSON.stringify(report)); };
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--prepare-only', '--verify-persistence'].includes(arg)) || args.length > 1) {
    throw new HomologationPreparationError('INVALID_RUNNER_ARGUMENTS');
  }
  const env = prepareSessionPoolerEnvironment(process.env);
  if (args[0] === '--prepare-only') {
    write({ status: 'prepared', endpointConfirmed: true, secretLoaded: true, tlsRequired: true, connectionAttempted: false });
  } else {
    const child = spawnSync('npm', ['run', 'check:postgres:homologation', ...(args[0] === '--verify-persistence' ? ['--', '--verify-persistence'] : [])], {
      env, shell: false, encoding: 'utf8', timeout: 180_000, maxBuffer: 128 * 1_024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Only relay the diagnostic's fixed-schema JSON. Never relay raw npm/stderr output.
    const reports: Record<string, unknown>[] = [];
    for (const line of (child.stdout ?? '').split('\n')) {
      try {
        const report = JSON.parse(line) as Record<string, unknown>;
        if (['passed', 'failed', 'blocked'].includes(String(report.status))) reports.push(report);
      } catch { /* npm banners are not diagnostic results */ }
    }
    const last = reports.at(-1);
    if (child.error || !last) {
      write({ status: 'failed', code: child.error && 'code' in child.error && child.error.code === 'ETIMEDOUT' ? 'CHECK_TIMEOUT' : 'CHECK_PROCESS_FAILED' });
      process.exitCode = 1;
    } else if (child.status === 0 && last.status === 'passed' && last.identityVerified === true && last.tlsVerified === true && last.schemaReady === true &&
        (args[0] !== '--verify-persistence' || (last.writeVerified === true && last.readVerified === true && last.updateVerified === true && last.reconnectVerified === true && last.isolationVerified === true))) {
      write({ status: 'passed', mode: 'session-pooler', identityVerified: true, tlsVerified: true, schemaReady: true,
        tlsProtocol: last.tlsProtocol === 'TLSv1.2' || last.tlsProtocol === 'TLSv1.3' ? last.tlsProtocol : null,
        backendTls: last.backendTls === true, writesPerformed: last.writesPerformed === true,
        ...(args[0] === '--verify-persistence' ? { writeVerified: true, readVerified: true, updateVerified: true,
          reconnectVerified: true, isolationVerified: true,
          validationNamespace: typeof last.validationNamespace === 'string' && /^validation-github:[a-zA-Z0-9:-]+$/.test(last.validationNamespace) ? last.validationNamespace : undefined } : {}),
      });
    } else {
      // Preserve only known-safe code shapes and configuration variable names.
      const code = typeof last.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(last.code) ? last.code : 'CHECK_FAILED';
      write({ status: last.status === 'blocked' ? 'blocked' : 'failed', code,
        ...(typeof last.stage === 'string' && /^[a-z-]{1,64}$/.test(last.stage) ? { stage: last.stage } : {}) });
      process.exitCode = child.status === 2 ? 2 : 1;
    }
  }
} catch (error) {
  write({ status: 'blocked', code: error instanceof HomologationPreparationError ? error.code : 'PREPARATION_FAILED' });
  process.exitCode = 2;
}
