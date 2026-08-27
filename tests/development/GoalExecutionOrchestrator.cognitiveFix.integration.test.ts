import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import type { Logger } from '../../core/logger.js';
import type {
  CognitiveDecision,
  CognitiveDecisionRequest,
  CognitiveDecisionResult,
  CognitiveModelProvider,
} from '../../core/cognition/index.js';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function converseInput(text: string, generatedAt = '2026-08-12T00:00:00.000Z'): CommandProcessingInput {
  return { type: 'converse', input: { text }, generatedAt };
}

function initGitRepo(dir: string): void {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Sebastian Test'], { cwd: dir });
}

function commitAll(dir: string, message: string): void {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

/**
 * A structural bug SPEC-047's heuristic is deliberately unable to fix:
 * `isEven` uses an inverted comparison operator (`!==` instead of `===`),
 * so the real Node assertion failure's `actual`/`expected` are the booleans
 * `false`/`true` - both are in `FailureEvidenceParser`'s own
 * `UNUSABLE_LITERALS` set (see `core/development/FailureEvidenceParser.ts`),
 * so `actualLiteral`/`expectedLiteral` are always `undefined` for this
 * failure. SPEC-047's `pursueAutonomousFix` therefore never even forms a
 * hypothesis (its while-loop condition requires both to be defined) and
 * falls straight through to a diagnosis-only `completed` result with zero
 * files changed - proven directly by the companion "heuristic alone" test
 * below. Fixing this instead requires reading and understanding the
 * comparison operator itself, not swapping a literal.
 */
function writeStructuralBugFixture(root: string): void {
  writeFileSync(
    join(root, 'isEven.js'),
    ['function isEven(n) {', '  return n % 2 !== 0;', '}', '', 'module.exports = { isEven };', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'isEven.test.js'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { isEven } = require('./isEven.js');",
      '',
      "test('isEven identifies even numbers correctly', () => {",
      '  assert.strictEqual(isEven(4), true);',
      '});',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'unrelated.js'),
    ['function isOdd(n) {', '  return n % 2 !== 0;', '}', '', 'module.exports = { isOdd };', ''].join('\n'),
  );
  // Same real-Node wrapper SPEC-047's own integration tests use: this suite
  // itself runs under `node --test`, so a nested `node --test` would
  // silently no-op unless these two inherited env vars are cleared first.
  // Real, unmodified `node --test` output is what Sebastian ends up parsing.
  writeFileSync(
    join(root, 'run-node-test.js'),
    [
      'delete process.env.NODE_TEST_CONTEXT;',
      'delete process.env.NODE_TEST_WORKER_ID;',
      "const { spawnSync } = require('node:child_process');",
      "const result = spawnSync(process.execPath, ['--test', 'isEven.test.js'], { stdio: 'inherit', cwd: __dirname });",
      'process.exit(result.status === null ? 1 : result.status);',
      '',
    ].join('\n'),
  );
}

function nodeTestAuthorizedCommand(): { toolId: string; executable: string; args: readonly string[] } {
  return { toolId: 'validation.test', executable: process.execPath, args: ['run-node-test.js'] };
}

function decided(decision: CognitiveDecision): CognitiveDecisionResult {
  return { outcome: 'decided', decision };
}

/**
 * A scripted stand-in for a real local model - not live inference (see the
 * final report's "limitations" section for why: this environment has
 * Ollama installed but zero local models downloaded, and downloading one
 * was explicitly out of scope for this pass). It reacts to the *actual*
 * observations it receives each turn rather than replaying a fixed
 * call-index script, which is what proves the DECIDE↔OBSERVE wiring itself
 * works, not just that a canned sequence replays.
 */
function structuralFixCognitiveProvider(sourceFileName: string, validationToolId: string): CognitiveModelProvider {
  let editProposed = false;
  return {
    async decide(request: CognitiveDecisionRequest): Promise<CognitiveDecisionResult> {
      const readEntry = request.filesRead.find((file) => file.path === sourceFileName);

      if (!readEntry) {
        return decided({
          intent: 'investigate',
          goal: request.objective,
          reasoningSummary: `Lendo "${sourceFileName}" para entender a causa da falha.`,
          nextAction: 'invokeTool',
          toolId: 'fs.readFile',
          toolArguments: { path: sourceFileName },
          requiresAuthorization: false,
          expectedEvidence: 'O conteúdo do arquivo fonte revelará a lógica com defeito.',
          completionState: 'inProgress',
          confidence: 0.85,
        });
      }

      if (!editProposed && readEntry.content.includes('n % 2 !== 0')) {
        editProposed = true;
        return decided({
          intent: 'proposeFix',
          goal: request.objective,
          reasoningSummary: 'O operador de comparação está invertido; corrigindo de !== para ===.',
          nextAction: 'invokeTool',
          toolId: 'fs.replaceText',
          toolArguments: { path: sourceFileName, searchText: 'n % 2 !== 0', replaceText: 'n % 2 === 0' },
          requiresAuthorization: true,
          expectedEvidence: 'A validação deve passar após a correção.',
          completionState: 'inProgress',
          confidence: 0.8,
        });
      }

      return decided({
        intent: 'verify',
        goal: request.objective,
        reasoningSummary: 'Reexecutando a validação para confirmar a correção.',
        nextAction: 'invokeTool',
        toolId: validationToolId,
        toolArguments: {},
        requiresAuthorization: false,
        expectedEvidence: 'A validação deve reportar sucesso.',
        completionState: 'inProgress',
        confidence: 0.85,
      });
    },
  };
}

test('SPEC-047 heuristic alone cannot fix the structural bug - it correctly diagnoses but never edits anything', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-cognitive-heuristic-baseline-'));
  try {
    initGitRepo(root);
    writeStructuralBugFixture(root);
    commitAll(root, 'initial commit');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [nodeTestAuthorizedCommand()],
      // Deliberately no cognitiveModelProvider - proves the deterministic
      // SPEC-047 path alone is genuinely incapable of this fix, establishing
      // the baseline the cognitive-engine test below is measured against.
    });

    const result = await core.executeCommand(
      converseInput('Sebastian, descubra por que esse teste está falhando e corrija.'),
    );

    const output = result.output as {
      readonly goalExecution: { readonly status: string; readonly filesChanged: readonly string[] };
    };
    assert.equal(output.goalExecution.status, 'completed');
    assert.deepEqual(output.goalExecution.filesChanged, []);
    assert.equal(readFileSync(join(root, 'isEven.js'), 'utf8').includes('!== 0'), true, 'the bug must still be present - nothing was fixed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the cognitive engine fixes the same structural bug SPEC-047 alone could not, verifies it for real, and never touches the unrelated file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-cognitive-fix-'));
  try {
    initGitRepo(root);
    writeStructuralBugFixture(root);
    commitAll(root, 'initial commit');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [nodeTestAuthorizedCommand()],
      cognitiveModelProvider: structuralFixCognitiveProvider('isEven.js', 'validation.test'),
    });

    const result = await core.executeCommand(
      converseInput('Sebastian, descubra por que esse teste está falhando e corrija.'),
    );

    const output = result.output as {
      readonly message: string;
      readonly goalExecution: { readonly status: string; readonly authorization: string; readonly filesChanged: readonly string[] };
    };

    assert.equal(output.goalExecution.status, 'completed');
    assert.equal(output.goalExecution.authorization, 'writeAuthorized');
    assert.deepEqual(output.goalExecution.filesChanged, ['isEven.js']);

    const fixedSource = readFileSync(join(root, 'isEven.js'), 'utf8');
    assert.equal(fixedSource.includes('n % 2 === 0'), true);
    assert.equal(fixedSource.includes('!=='), false);

    const unrelatedSource = readFileSync(join(root, 'unrelated.js'), 'utf8');
    assert.equal(unrelatedSource.includes('n % 2 !== 0'), true, 'the unrelated file sharing the same "wrong" text must never be touched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
