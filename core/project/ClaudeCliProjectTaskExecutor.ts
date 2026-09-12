import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ProjectTaskExecutionRequest,
  ProjectTaskExecutionResult,
  ProjectTaskExecutor,
} from './ProjectTaskExecutor.js';

const MAX_CAPTURED_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_READ_ONLY_MAX_BUDGET_USD = 0.5;
const DEFAULT_WRITE_MAX_BUDGET_USD = 2;

export interface ClaudeCliProjectTaskExecutorOptions {
  readonly executablePath?: string;
  readonly timeoutMs?: number;
  readonly readOnlyMaxBudgetUsd?: number;
  readonly writeMaxBudgetUsd?: number;
}

interface ClaudeCliJsonResult {
  readonly type?: string;
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly result?: string;
}

export class ClaudeCliProjectTaskExecutor implements ProjectTaskExecutor {
  private readonly options: ClaudeCliProjectTaskExecutorOptions;
  private resolvedExecutablePath: string | undefined;

  public constructor(options: ClaudeCliProjectTaskExecutorOptions = {}) {
    this.options = options;
  }

  public async execute(request: ProjectTaskExecutionRequest): Promise<ProjectTaskExecutionResult> {
    const executablePath = this.resolveExecutablePath();
    const args = this.buildArgs(request);

    return new Promise<ProjectTaskExecutionResult>((resolve) => {
      const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      let cancelled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onExternalAbort = (): void => {
        cancelled = true;
        controller.abort();
      };
      request.signal?.addEventListener('abort', onExternalAbort, { once: true });

      let stdout = '';
      let stderr = '';

      let child;
      try {
        child = spawn(executablePath, args, {
          cwd: request.workspaceRoot,
          shell: false,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
        resolve(this.executorUnavailableResult(error));
        return;
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = this.appendCapped(stdout, chunk.toString('utf8'));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = this.appendCapped(stderr, chunk.toString('utf8'));
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
        resolve(this.executorUnavailableResult(error));
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);

        if (cancelled) {
          resolve({ outcome: 'cancelled', summary: 'Tarefa cancelada antes da conclusão.', rawLog: stderr || stdout });
          return;
        }
        if (timedOut) {
          resolve({
            outcome: 'timedOut',
            summary: `O executor excedeu o tempo limite de ${timeoutMs}ms e foi encerrado.`,
            rawLog: stderr || stdout,
          });
          return;
        }

        resolve(this.parseResult(exitCode, stdout, stderr));
      });
    });
  }

  private buildArgs(request: ProjectTaskExecutionRequest): readonly string[] {
    const isWrite = request.authorization === 'writeAuthorized';
    const tools = isWrite ? 'Read,Grep,Glob,Edit,Write' : 'Read,Grep,Glob';
    const permissionMode = isWrite ? 'acceptEdits' : 'dontAsk';
    const maxBudgetUsd = isWrite
      ? this.options.writeMaxBudgetUsd ?? DEFAULT_WRITE_MAX_BUDGET_USD
      : this.options.readOnlyMaxBudgetUsd ?? DEFAULT_READ_ONLY_MAX_BUDGET_USD;

    return [
      '-p',
      request.instructions,
      '--restricted',
      '--tools',
      tools,
      '--permission-mode',
      permissionMode,
      '--output-format',
      'json',
      '--no-session-persistence',
      '--max-budget-usd',
      String(maxBudgetUsd),
      '--strict-mcp-config',
    ];
  }

  private parseResult(exitCode: number | null, stdout: string, stderr: string): ProjectTaskExecutionResult {
    let parsed: ClaudeCliJsonResult | undefined;
    try {
      parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
    } catch {
      parsed = undefined;
    }

    if (parsed && typeof parsed.result === 'string') {
      if (parsed.is_error) {
        return { outcome: 'failed', summary: parsed.result, rawLog: stdout };
      }
      return { outcome: 'completed', summary: parsed.result, rawLog: stdout };
    }

    if (exitCode === 0) {
      return { outcome: 'completed', summary: stdout.trim() || 'Executor concluiu sem retornar um resumo.', rawLog: stdout };
    }

    return {
      outcome: 'failed',
      summary: `O executor terminou com codigo ${exitCode ?? 'desconhecido'} e nao retornou um resultado utilizavel.`,
      rawLog: stderr || stdout,
    };
  }

  private executorUnavailableResult(error: unknown): ProjectTaskExecutionResult {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'failed',
      summary: `Executor indisponivel: nao foi possivel iniciar o Claude Code CLI (${detail}).`,
    };
  }

  private appendCapped(current: string, addition: string): string {
    if (Buffer.byteLength(current, 'utf8') >= MAX_CAPTURED_OUTPUT_BYTES) {
      return current;
    }
    return current + addition;
  }

  private resolveExecutablePath(): string {
    if (this.resolvedExecutablePath) {
      return this.resolvedExecutablePath;
    }
    if (this.options.executablePath) {
      this.resolvedExecutablePath = this.options.executablePath;
      return this.resolvedExecutablePath;
    }
    if (process.env.CLAUDE_CLI_PATH) {
      this.resolvedExecutablePath = process.env.CLAUDE_CLI_PATH;
      return this.resolvedExecutablePath;
    }
    const bundled = this.findBundledExtensionBinary();
    this.resolvedExecutablePath = bundled ?? 'claude';
    return this.resolvedExecutablePath;
  }

  private findBundledExtensionBinary(): string | undefined {
    const extensionsDir = join(homedir(), '.vscode', 'extensions');
    let entries: readonly string[];
    try {
      entries = readdirSync(extensionsDir);
    } catch {
      return undefined;
    }

    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const candidates = entries
      .map((name) => {
        const match = /^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)-/.exec(name);
        if (!match) return undefined;
        const version: readonly [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
        const binaryPath = join(extensionsDir, name, 'resources', 'native-binary', binaryName);
        return existsSync(binaryPath) ? { version, binaryPath } : undefined;
      })
      .filter((candidate): candidate is { version: readonly [number, number, number]; binaryPath: string } => candidate !== undefined)
      .sort((a, b) => a.version[0] - b.version[0] || a.version[1] - b.version[1] || a.version[2] - b.version[2]);

    return candidates.at(-1)?.binaryPath;
  }
}
