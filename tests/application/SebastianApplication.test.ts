import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_GREETING_CAPABILITY_ID,
  LOCAL_GREETING_COMMAND_TYPE,
  localGreetingCapabilityProvider,
} from '../../application/LocalGreetingCapabilityProvider.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { core as defaultApplicationCore } from '../../core/index.js';
import type { Logger } from '../../core/logger.js';

async function withTempDataDir(run: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-application-'));
  try {
    await run(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function rememberInput(text: string): CommandProcessingInput {
  return {
    type: 'remember',
    input: { text },
    generatedAt: '2026-08-11T00:00:00.000Z',
  };
}

function recallInput(): CommandProcessingInput {
  return {
    type: 'recall',
    input: {},
    generatedAt: '2026-08-11T00:00:01.000Z',
  };
}

function converseInput(text: string, generatedAt = '2026-08-11T00:00:00.000Z'): CommandProcessingInput {
  return {
    type: 'converse',
    input: { text },
    generatedAt,
  };
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function greetingInput(name?: unknown): CommandProcessingInput {
  return {
    type: LOCAL_GREETING_COMMAND_TYPE,
    input: name === undefined ? {} : { name },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

test('local provider exposes the concrete greeting registration', () => {
  const registrations = localGreetingCapabilityProvider.listRegistrations();

  assert.equal(localGreetingCapabilityProvider.providerId, 'provider.greeting.local');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.descriptor.id, LOCAL_GREETING_CAPABILITY_ID);
  assert.equal(registrations[0]?.descriptor.handlerId, 'handler.greeting.local');
  assert.equal(typeof registrations[0]?.handler, 'function');
});

test('application composition root returns a fully operational Core', () => {
  const core = createSebastianApplication({ logger });

  assert.equal(core.status, 'ready');
  assert.deepEqual(core.getLifecycleState(), {
    initialized: true,
    started: true,
    shutDown: false,
  });
});

test('application composition root preserves accepted Core configuration', () => {
  const core = createSebastianApplication({
    name: 'Sebastian Local',
    config: {
      appName: 'Sebastian Operational',
      environment: 'test',
      debug: false,
    },
    logger,
  });

  assert.equal(core.name, 'Sebastian Local');
  assert.deepEqual(core.getConfig(), {
    appName: 'Sebastian Operational',
    environment: 'test',
    debug: false,
  });
});

test('local application executes a named greeting through the real pipeline', async () => {
  const core = createSebastianApplication({ logger });

  assert.deepEqual(await core.executeCommand(greetingInput('Gabriel')), {
    status: 'succeeded',
    output: { message: 'Hello, Gabriel!' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});

test('local greeting returns the generic message without a valid name', async () => {
  const core = createSebastianApplication({ logger });

  assert.deepEqual((await core.executeCommand(greetingInput('   '))).output, {
    message: 'Hello!',
  });
  assert.deepEqual((await core.executeCommand(greetingInput(42))).output, {
    message: 'Hello!',
  });
});

test('local greeting is deterministic and does not mutate command input', async () => {
  const core = createSebastianApplication({ logger });
  const command = greetingInput('Gabriel');
  const before = structuredClone(command);

  const left = await core.executeCommand(command);
  const right = await core.executeCommand(command);

  assert.deepEqual(left, right);
  assert.deepEqual(command, before);
});

test('default entrypoint exports an operational Core with the local capability', async () => {
  assert.equal(defaultApplicationCore.status, 'ready');
  assert.deepEqual((await defaultApplicationCore.executeCommand(greetingInput('Sebastian'))).output, {
    message: 'Hello, Sebastian!',
  });
});

test('without a dataDir, memory does not persist across separate Core instances', async () => {
  const first = createSebastianApplication({ logger });
  await first.executeCommand(rememberInput('prefiro reuniões de manhã'));

  const second = createSebastianApplication({ logger });
  assert.deepEqual((await second.executeCommand(recallInput())).output, {
    message: 'Nenhuma memória registrada ainda.',
    facts: [],
  });
});

test('with a dataDir, a fact remembered by one Core instance is recalled by a later instance', async () => {
  await withTempDataDir(async (dataDir) => {
    const writerCore = createSebastianApplication({ logger, dataDir });
    const rememberResult = await writerCore.executeCommand(rememberInput('prefiro reuniões de manhã'));
    assert.deepEqual(rememberResult.output, { fact: 'prefiro reuniões de manhã' });

    const readerCore = createSebastianApplication({ logger, dataDir });
    const recallResult = await readerCore.executeCommand(recallInput());

    assert.equal(recallResult.output.message, '1 memória(s) registrada(s).');
    const facts = recallResult.output.facts as ReadonlyArray<{ readonly content: string }>;
    assert.deepEqual(
      facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );
  });
});

test('recall on a fresh dataDir with no prior facts reports a clear empty-memory message', async () => {
  await withTempDataDir(async (dataDir) => {
    const core = createSebastianApplication({ logger, dataDir });

    assert.deepEqual((await core.executeCommand(recallInput())).output, {
      message: 'Nenhuma memória registrada ainda.',
      facts: [],
    });
  });
});

test('natural language remember, in one Core instance, is recalled by natural language in a later instance', async () => {
  await withTempDataDir(async (dataDir) => {
    const writerCore = createSebastianApplication({ logger, dataDir });
    const rememberResult = await writerCore.executeCommand(
      converseInput('Sebastian, lembra que prefiro reuniões de manhã', '2026-08-11T00:00:00.000Z'),
    );
    assert.deepEqual(rememberResult.output, {
      memoryRecordKind: 'sebastian.memory.fact',
      content: 'prefiro reuniões de manhã',
    });

    const readerCore = createSebastianApplication({ logger, dataDir });
    const respondResult = await readerCore.executeCommand(
      converseInput('Qual horário eu prefiro para reuniões?', '2026-08-11T00:05:00.000Z'),
    );

    assert.deepEqual(respondResult.output, {
      message: 'Sobre isso, você registrou: "prefiro reuniões de manhã".',
    });
  });
});

test('a natural language fact is also visible to the rigid recall command, and vice versa', async () => {
  await withTempDataDir(async (dataDir) => {
    const naturalLanguageCore = createSebastianApplication({ logger, dataDir });
    await naturalLanguageCore.executeCommand(
      converseInput('Sebastian, lembra que prefiro reuniões de manhã', '2026-08-11T00:00:00.000Z'),
    );

    const rigidCore = createSebastianApplication({ logger, dataDir });
    const recallResult = await rigidCore.executeCommand(recallInput());
    const facts = recallResult.output.facts as ReadonlyArray<{ readonly content: string }>;
    assert.deepEqual(
      facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );
  });
});

test('converse resolves natural-language filesystem requests against an explicit allowedFilesystemRoot', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'sebastian-application-fs-'));
  try {
    writeFileSync(join(fixtureRoot, 'nota.txt'), 'prefiro reuniões de manhã');

    const core = createSebastianApplication({ logger, allowedFilesystemRoot: fixtureRoot });

    const listResult = await core.executeCommand(converseInput('Quais arquivos existem?'));
    assert.deepEqual(listResult.output, { message: 'Arquivos em ".": nota.txt.' });

    const readResult = await core.executeCommand(converseInput('Leia o arquivo nota.txt'));
    assert.deepEqual(readResult.output, {
      message: 'Conteúdo de "nota.txt":\nprefiro reuniões de manhã',
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('without an explicit allowedFilesystemRoot, converse filesystem access defaults to process.cwd()', async () => {
  const core = createSebastianApplication({ logger });

  const result = await core.executeCommand(converseInput('Leia o arquivo package.json'));

  const realContent = readFileSync('package.json', 'utf8');
  assert.deepEqual(result.output, { message: `Conteúdo de "package.json":\n${realContent}` });
});

test('converse cannot escape the configured allowedFilesystemRoot through traversal', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'sebastian-application-fs-guard-'));
  try {
    const root = join(parent, 'projeto');
    const outside = join(parent, 'fora');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'segredo.txt'), 'nunca deveria ser lido');

    const core = createSebastianApplication({ logger, allowedFilesystemRoot: root });
    const result = await core.executeCommand(converseInput('Leia o arquivo ../fora/segredo.txt'));

    assert.deepEqual(result.output, {
      message: 'O caminho "../fora/segredo.txt" está fora da área permitida.',
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a task added by one Core instance is listed as pending, then completed and no longer listed by later instances', async () => {
  await withTempDataDir(async (dataDir) => {
    const addCore = createSebastianApplication({ logger, dataDir });
    const addResult = await addCore.executeCommand(
      converseInput('Adiciona uma tarefa: comprar leite', '2026-08-11T00:00:00.000Z'),
    );
    assert.deepEqual(addResult.output, {
      memoryRecordKind: 'sebastian.memory.task.created',
      content: 'comprar leite',
    });

    const listCore = createSebastianApplication({ logger, dataDir });
    const listResult = await listCore.executeCommand(
      converseInput('Quais são minhas tarefas?', '2026-08-11T00:01:00.000Z'),
    );
    assert.deepEqual(listResult.output, { message: 'Suas tarefas pendentes: comprar leite.' });

    const completeCore = createSebastianApplication({ logger, dataDir });
    const completeResult = await completeCore.executeCommand(
      converseInput("Marca 'comprar leite' como feita", '2026-08-11T00:02:00.000Z'),
    );
    assert.deepEqual(completeResult.output, {
      memoryRecordKind: 'sebastian.memory.task.completed',
      taskId: 'converse:2026-08-11T00:00:00.000Z',
    });

    const finalListCore = createSebastianApplication({ logger, dataDir });
    const finalListResult = await finalListCore.executeCommand(
      converseInput('Quais são minhas tarefas?', '2026-08-11T00:03:00.000Z'),
    );
    assert.deepEqual(finalListResult.output, { message: 'Você não tem nenhuma tarefa pendente.' });
  });
});

test('listing tasks with no dataDir and nothing added reports no pending tasks', async () => {
  const core = createSebastianApplication({ logger });

  const result = await core.executeCommand(converseInput('Quais são minhas tarefas?'));

  assert.deepEqual(result.output, { message: 'Você não tem nenhuma tarefa pendente.' });
});

test('tasks and remembered facts coexist without interfering with each other', async () => {
  await withTempDataDir(async (dataDir) => {
    const writerCore = createSebastianApplication({ logger, dataDir });
    await writerCore.executeCommand(rememberInput('prefiro reuniões de manhã'));
    await writerCore.executeCommand(
      converseInput('Adiciona uma tarefa: comprar leite', '2026-08-11T00:00:00.000Z'),
    );

    const readerCore = createSebastianApplication({ logger, dataDir });
    const recallResult = await readerCore.executeCommand(recallInput());
    const facts = recallResult.output.facts as ReadonlyArray<{ readonly content: string }>;
    assert.deepEqual(
      facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );

    const listResult = await readerCore.executeCommand(
      converseInput('Quais são minhas tarefas?', '2026-08-11T00:01:00.000Z'),
    );
    assert.deepEqual(listResult.output, { message: 'Suas tarefas pendentes: comprar leite.' });
  });
});

test('the project workspace vertical slice works end-to-end through SebastianApplication: identity, listing, reading, creating, appending and project context', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'sebastian-application-workspace-'));
  try {
    await withTempDataDir(async (dataDir) => {
      writeFileSync(join(fixtureRoot, 'README.md'), 'projeto de exemplo');

      const writerCore = createSebastianApplication({ logger, allowedFilesystemRoot: fixtureRoot, dataDir });

      const identity = await writerCore.executeCommand(converseInput('Em qual projeto estou?', '2026-08-11T00:00:00.000Z'));
      assert.ok((identity.output as { readonly message: string }).message.includes('1 item na raiz'));

      await writerCore.executeCommand(
        converseInput('Sebastian, lembra que este projeto usa TypeScript', '2026-08-11T00:00:01.000Z'),
      );

      const creating = await writerCore.executeCommand(
        converseInput('Crie uma nota chamada pendencias.md com: revisar autenticação', '2026-08-11T00:00:02.000Z'),
      );
      assert.deepEqual(creating.output, { message: 'Nota "pendencias.md" criada.' });

      const appending = await writerCore.executeCommand(
        converseInput('Acrescente na nota pendencias.md: revisar deploy', '2026-08-11T00:00:03.000Z'),
      );
      assert.deepEqual(appending.output, { message: 'Conteúdo acrescentado a "pendencias.md".' });

      // A later Core instance, sharing dataDir and allowedFilesystemRoot,
      // reads back everything created/appended by the earlier one and still
      // has access to the project context recorded earlier via the
      // pre-existing remember mechanism - reused as-is for "what do you know
      // about this project", with no separate project-context store.
      const readerCore = createSebastianApplication({ logger, allowedFilesystemRoot: fixtureRoot, dataDir });

      const rereading = await readerCore.executeCommand(
        converseInput('Leia o arquivo pendencias.md', '2026-08-11T00:00:04.000Z'),
      );
      assert.deepEqual(rereading.output, {
        message: 'Conteúdo de "pendencias.md":\nrevisar autenticaçãorevisar deploy',
      });

      const whatDoYouKnow = await readerCore.executeCommand(
        converseInput('O que você sabe sobre este projeto?', '2026-08-11T00:00:05.000Z'),
      );
      assert.deepEqual(whatDoYouKnow.output, {
        message: 'Sobre isso, você registrou: "este projeto usa TypeScript".',
      });
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('creating a file over an existing one and appending to a missing one report friendly errors instead of corrupting the workspace', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'sebastian-application-workspace-errors-'));
  try {
    writeFileSync(join(fixtureRoot, 'existente.md'), 'conteúdo original');
    const core = createSebastianApplication({ logger, allowedFilesystemRoot: fixtureRoot });

    const overwrite = await core.executeCommand(
      converseInput('Crie uma nota chamada existente.md com: outra coisa', '2026-08-11T00:00:00.000Z'),
    );
    assert.deepEqual(overwrite.output, {
      message: 'Já existe um arquivo em "existente.md"; não vou sobrescrevê-lo.',
    });
    assert.equal(readFileSync(join(fixtureRoot, 'existente.md'), 'utf8'), 'conteúdo original');

    const appendMissing = await core.executeCommand(
      converseInput('Acrescente no arquivo nao-existe.md: x', '2026-08-11T00:00:01.000Z'),
    );
    assert.deepEqual(appendMissing.output, { message: 'Não encontrei "nao-existe.md".' });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function initGitRepo(dir: string): void {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Sebastian Test'], { cwd: dir });
}

function commitAll(dir: string, message: string): void {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('the development executor vertical slice works end-to-end through SebastianApplication in a real, temporary Git repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-application-devexec-'));
  try {
    initGitRepo(root);
    writeFileSync(join(root, 'exemplo.ts'), 'const x = 1;\n');
    commitAll(root, 'initial commit');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [
        { toolId: 'validation.test', executable: process.execPath, args: ['-e', "console.log('tudo certo')"] },
      ],
    });

    const status = await core.executeCommand(converseInput('Qual é o estado deste repositório?', '2026-08-12T00:00:00.000Z'));
    assert.ok((status.output as { readonly message: string }).message.includes('sem alterações pendentes'));

    const edit = await core.executeCommand(
      converseInput('Altere o arquivo exemplo.ts substituindo const x = 1; por const x = 2;', '2026-08-12T00:00:01.000Z'),
    );
    assert.deepEqual(edit.output, { message: 'Arquivo "exemplo.ts" atualizado.' });
    assert.equal(readFileSync(join(root, 'exemplo.ts'), 'utf8'), 'const x = 2;\n');

    const diff = await core.executeCommand(converseInput('Mostre as alterações atuais', '2026-08-12T00:00:02.000Z'));
    assert.ok((diff.output as { readonly message: string }).message.includes('const x = 2;'));

    const validation = await core.executeCommand(converseInput('Execute os testes do projeto', '2026-08-12T00:00:03.000Z'));
    assert.deepEqual(validation.output, { message: 'Validação "validation.test" concluída com sucesso (exit code 0).' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "the real default authorizedCommands run this very project's own npm scripts without a shell when none are overridden",
  { timeout: 60000 },
  async () => {
    const core = createSebastianApplication({ logger, allowedFilesystemRoot: process.cwd() });

    const result = await core.executeCommand(converseInput('Execute o typecheck', '2026-08-12T00:00:00.000Z'));

    const output = result.output as { readonly message: string };
    assert.ok(output.message.startsWith('Validação "validation.typecheck" concluída'));
  },
);

test('the SPEC-044 developTask vertical slice completes end-to-end: edit, validate, git status and git diff, in one converse invocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-application-developtask-'));
  try {
    initGitRepo(root);
    writeFileSync(join(root, 'exemplo.ts'), 'const x = 1;\n');
    commitAll(root, 'initial commit');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [
        { toolId: 'validation.test', executable: process.execPath, args: ['-e', "console.log('tudo certo')"] },
      ],
    });

    const result = await core.executeCommand(
      converseInput(
        'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.',
        '2026-08-12T01:00:00.000Z',
      ),
    );

    const output = result.output as {
      readonly message: string;
      readonly developmentTask: {
        readonly status: string;
        readonly filesChanged: readonly string[];
        readonly steps: ReadonlyArray<{ readonly toolId: string; readonly outcome: string }>;
      };
    };

    assert.equal(output.developmentTask.status, 'completed');
    assert.deepEqual(output.developmentTask.filesChanged, ['exemplo.ts']);
    assert.deepEqual(
      output.developmentTask.steps.map((step) => step.toolId),
      ['fs.replaceText', 'validation.test', 'git.status', 'git.diff'],
    );
    assert.ok(output.developmentTask.steps.every((step) => step.outcome === 'ok'));
    assert.equal(readFileSync(join(root, 'exemplo.ts'), 'utf8'), 'const x = 2;\n');

    // The bounded finalResult is what gets persisted to Memory too (SPEC-039
    // write-back reuse) - it must never carry a raw diff or raw stdout.
    const serialized = JSON.stringify(output);
    assert.equal(serialized.includes('@@'), false);
    assert.equal(serialized.includes('diff --git'), false);
    assert.equal(serialized.includes('tudo certo'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the SPEC-044 developTask vertical slice reports blocked, without editing or validating, when the target already has uncommitted changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-application-developtask-blocked-'));
  try {
    initGitRepo(root);
    writeFileSync(join(root, 'exemplo.ts'), 'const x = 1;\n');
    commitAll(root, 'initial commit');
    writeFileSync(join(root, 'exemplo.ts'), 'const x = 1; // já alterado manualmente\n');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [
        { toolId: 'validation.test', executable: process.execPath, args: ['-e', "console.log('não deveria rodar')"] },
      ],
    });

    const result = await core.executeCommand(
      converseInput(
        'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.',
        '2026-08-12T01:00:00.000Z',
      ),
    );

    const output = result.output as {
      readonly developmentTask: {
        readonly status: string;
        readonly reason?: string;
        readonly filesChanged: readonly string[];
        readonly steps: ReadonlyArray<{ readonly toolId: string }>;
      };
    };

    assert.equal(output.developmentTask.status, 'blocked');
    assert.equal(output.developmentTask.reason, 'fileAlreadyModified');
    assert.deepEqual(output.developmentTask.filesChanged, []);
    assert.deepEqual(
      output.developmentTask.steps.map((step) => step.toolId),
      ['fs.replaceText'],
    );
    assert.equal(readFileSync(join(root, 'exemplo.ts'), 'utf8'), 'const x = 1; // já alterado manualmente\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the SPEC-044 developTask vertical slice reports failed, preserving the edit and the Git status/diff, when validation does not pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-application-developtask-failed-'));
  try {
    initGitRepo(root);
    writeFileSync(join(root, 'exemplo.ts'), 'const x = 1;\n');
    commitAll(root, 'initial commit');

    const core = createSebastianApplication({
      logger,
      allowedFilesystemRoot: root,
      authorizedCommands: [
        { toolId: 'validation.test', executable: process.execPath, args: ['-e', 'process.exit(1)'] },
      ],
    });

    const result = await core.executeCommand(
      converseInput(
        'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.',
        '2026-08-12T01:00:00.000Z',
      ),
    );

    const output = result.output as {
      readonly developmentTask: {
        readonly status: string;
        readonly reason?: string;
        readonly filesChanged: readonly string[];
        readonly steps: ReadonlyArray<{ readonly toolId: string; readonly outcome: string }>;
      };
    };

    assert.equal(output.developmentTask.status, 'failed');
    assert.equal(output.developmentTask.reason, 'validationFailed');
    assert.deepEqual(output.developmentTask.filesChanged, ['exemplo.ts']);
    // Git status/diff still ran after the failed validation, so the report reflects real, current state.
    assert.deepEqual(
      output.developmentTask.steps.map((step) => step.toolId),
      ['fs.replaceText', 'validation.test', 'git.status', 'git.diff'],
    );
    assert.equal(readFileSync(join(root, 'exemplo.ts'), 'utf8'), 'const x = 2;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('converse on a fresh dataDir with no prior facts still resolves to a coherent response', async () => {
  await withTempDataDir(async (dataDir) => {
    const core = createSebastianApplication({ logger, dataDir });

    const result = await core.executeCommand(converseInput('Qual horário eu prefiro para reuniões?'));

    assert.deepEqual(result.output, {
      message: 'Ainda não tenho nenhuma memória registrada sobre isso.',
    });
  });
});
