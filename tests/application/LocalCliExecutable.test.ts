import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEBASTIAN_DATA_DIRECTORY_ENV_VAR } from '../../core/memory/index.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageJsonPath = resolve(projectRoot, 'package.json');
const packageLockPath = resolve(projectRoot, 'package-lock.json');
const cliPath = resolve(projectRoot, 'application/cli.ts');
const USAGE_SUMMARY = 'greeting [name] | remember <text> | recall | "<free text>"';

interface PackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, { readonly bin?: Readonly<Record<string, string>> }>>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Filesystem inspection tests run with `cwd` set to an isolated fixture
 * directory (the allowed root seam), which sits outside this project's
 * `node_modules` - so the tsx-loader entrypoint used elsewhere in this file
 * cannot resolve. The compiled entrypoint has no such dependency and is
 * used instead for those tests.
 */
const compiledCliPath = resolve(projectRoot, readJson<PackageManifest>(packageJsonPath).bin?.sebastiania ?? '');

function withIsolatedDataDir(run: (dataDir: string) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-cli-executable-'));
  try {
    run(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function isolatedEnv(dataDir: string): NodeJS.ProcessEnv {
  return { ...process.env, [SEBASTIAN_DATA_DIRECTORY_ENV_VAR]: dataDir };
}

function withIsolatedFixtureRoot(run: (fixtureRoot: string) => void): void {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'sebastian-cli-fs-fixture-'));
  try {
    run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('package exposes the sebastiania executable at the compiled CLI entrypoint', () => {
  const manifest = readJson<PackageManifest>(packageJsonPath);

  assert.deepEqual(manifest.bin, {
    sebastiania: './dist/application/cli.js',
  });
});

test('package lock preserves the executable contract', () => {
  const lock = readJson<PackageLock>(packageLockPath);

  assert.deepEqual(lock.packages?.['']?.bin, {
    sebastiania: 'dist/application/cli.js',
  });
});

test('package preparation and start lifecycle delegate to the existing build', () => {
  const manifest = readJson<PackageManifest>(packageJsonPath);

  assert.equal(manifest.scripts?.prepare, 'npm run build');
  assert.equal(manifest.scripts?.prestart, 'npm run build');
  assert.equal(manifest.scripts?.start, 'node ./dist/application/cli.js');
});

test('CLI source declares the Node shebang', () => {
  const firstLine = readFileSync(cliPath, 'utf8').split(/\r?\n/, 1)[0];

  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('compiled executable exists at the bin target and preserves the shebang', () => {
  const manifest = readJson<PackageManifest>(packageJsonPath);
  const binTarget = manifest.bin?.sebastiania;
  assert.equal(typeof binTarget, 'string');

  const compiledCliPath = resolve(projectRoot, binTarget ?? '');
  assert.equal(existsSync(compiledCliPath), true);
  const firstLine = readFileSync(compiledCliPath, 'utf8').split(/\r?\n/, 1)[0];
  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('compiled executable runs the nominal greeting contract', () => {
  withIsolatedDataDir((dataDir) => {
    const manifest = readJson<PackageManifest>(packageJsonPath);
    const compiledCliPath = resolve(projectRoot, manifest.bin?.sebastiania ?? '');
    const execution = spawnSync(process.execPath, [compiledCliPath, 'greeting', 'Gabriel'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: isolatedEnv(dataDir),
    });

    assert.equal(execution.error, undefined);
    assert.equal(execution.status, 0);
    assert.equal(execution.stderr, '');
    assert.deepEqual(JSON.parse(execution.stdout.trim()).output, {
      message: 'Hello, Gabriel!',
    });
  });
});

test('real CLI process executes a named greeting successfully', () => {
  withIsolatedDataDir((dataDir) => {
    const execution = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'greeting', 'Gabriel'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: isolatedEnv(dataDir),
      },
    );

    assert.equal(execution.error, undefined);
    assert.equal(execution.status, 0);
    assert.equal(execution.stderr, '');

    const result = JSON.parse(execution.stdout.trim()) as {
      readonly status: string;
      readonly output: Readonly<Record<string, unknown>>;
      readonly generatedAt: string;
    };
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.output, { message: 'Hello, Gabriel!' });
    assert.equal(Number.isNaN(Date.parse(result.generatedAt)), false);
  });
});

test('real CLI process rejects missing arguments through stderr', () => {
  withIsolatedDataDir((dataDir) => {
    const execution = spawnSync(process.execPath, ['--import', 'tsx', cliPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: isolatedEnv(dataDir),
    });

    assert.equal(execution.error, undefined);
    assert.equal(execution.status, 1);
    assert.equal(execution.stdout, '');
    assert.deepEqual(JSON.parse(execution.stderr.trim()), {
      name: 'InvalidLocalCommandArgumentsError',
      message: `Command type is required. Usage: ${USAGE_SUMMARY}.`,
      code: 'INVALID_ARGUMENT',
    });
  });
});

test('a fact remembered in one real CLI process is recalled by a later, separate real CLI process', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    const rememberProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'remember', 'prefiro', 'reuniões', 'de', 'manhã'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );

    assert.equal(rememberProcess.error, undefined);
    assert.equal(rememberProcess.status, 0);
    assert.equal(rememberProcess.stderr, '');
    const rememberResult = JSON.parse(rememberProcess.stdout.trim()) as { output: { fact: string } };
    assert.equal(rememberResult.output.fact, 'prefiro reuniões de manhã');

    const recallProcess = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'recall'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });

    assert.equal(recallProcess.error, undefined);
    assert.equal(recallProcess.status, 0);
    assert.equal(recallProcess.stderr, '');
    const recallResult = JSON.parse(recallProcess.stdout.trim()) as {
      output: { message: string; facts: ReadonlyArray<{ content: string }> };
    };
    assert.equal(recallResult.output.message, '1 memória(s) registrada(s).');
    assert.deepEqual(
      recallResult.output.facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );
  });
});

test('recall from a real CLI process against a data directory that never received a remember reports empty memory clearly', () => {
  withIsolatedDataDir((dataDir) => {
    const recallProcess = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'recall'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: isolatedEnv(dataDir),
    });

    assert.equal(recallProcess.error, undefined);
    assert.equal(recallProcess.status, 0);
    const recallResult = JSON.parse(recallProcess.stdout.trim()) as {
      output: { message: string; facts: readonly unknown[] };
    };
    assert.deepEqual(recallResult.output, { message: 'Nenhuma memória registrada ainda.', facts: [] });
  });
});

test('a fact remembered via natural language in one real process is used to answer a natural language question in a later, separate real process', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    const rememberProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Sebastian, lembra que prefiro reuniões de manhã'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );

    assert.equal(rememberProcess.error, undefined);
    assert.equal(rememberProcess.status, 0);
    assert.equal(rememberProcess.stderr, '');
    const rememberResult = JSON.parse(rememberProcess.stdout.trim()) as {
      output: { memoryRecordKind: string; content: string };
    };
    assert.deepEqual(rememberResult.output, {
      memoryRecordKind: 'sebastian.memory.fact',
      content: 'prefiro reuniões de manhã',
    });

    const respondProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Qual', 'horário', 'eu', 'prefiro', 'para', 'reuniões?'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );

    assert.equal(respondProcess.error, undefined);
    assert.equal(respondProcess.status, 0);
    assert.equal(respondProcess.stderr, '');
    const respondResult = JSON.parse(respondProcess.stdout.trim()) as { output: { message: string } };
    assert.deepEqual(respondResult.output, {
      message: 'Sobre isso, você registrou: "prefiro reuniões de manhã".',
    });

    // Two independent spawnSync invocations are always distinct OS processes with
    // their own PIDs - asserting both are defined and different is the concrete,
    // checkable proof that this is not the same process reusing in-memory state.
    assert.equal(typeof rememberProcess.pid, 'number');
    assert.equal(typeof respondProcess.pid, 'number');
    assert.notEqual(rememberProcess.pid, respondProcess.pid);
  });
});

test('natural language conversation neither breaks nor is affected by the rigid remember/recall commands sharing the same memory file', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    const naturalRemember = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Sebastian, lembra que prefiro reuniões de manhã'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(naturalRemember.status, 0);

    const rigidRecall = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'recall'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(rigidRecall.status, 0);
    const rigidRecallResult = JSON.parse(rigidRecall.stdout.trim()) as {
      output: { facts: ReadonlyArray<{ content: string }> };
    };
    assert.deepEqual(
      rigidRecallResult.output.facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );

    const rigidRemember = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'remember', 'gosto', 'de', 'café'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(rigidRemember.status, 0);

    const naturalRespond = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'O', 'que', 'você', 'sabe', 'sobre', 'mim?'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(naturalRespond.status, 0);
    const naturalRespondResult = JSON.parse(naturalRespond.stdout.trim()) as { output: { message: string } };
    assert.equal(typeof naturalRespondResult.output.message, 'string');
  });
});

test('a real CLI process lists the real contents of its own working directory via natural language', () => {
  withIsolatedDataDir((dataDir) => {
    withIsolatedFixtureRoot((fixtureRoot) => {
      writeFileSync(join(fixtureRoot, 'nota.txt'), 'conteúdo real de teste');
      mkdirSync(join(fixtureRoot, 'sub'));

      const execution = spawnSync(process.execPath, [compiledCliPath, 'Quais arquivos existem?'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: isolatedEnv(dataDir),
      });

      assert.equal(execution.error, undefined);
      assert.equal(execution.status, 0);
      assert.equal(execution.stderr, '');
      const result = JSON.parse(execution.stdout.trim()) as { output: { message: string } };
      assert.equal(result.output.message, 'Arquivos em ".": nota.txt, sub.');
    });
  });
});

test('a real CLI process reads the real content of a file via natural language', () => {
  withIsolatedDataDir((dataDir) => {
    withIsolatedFixtureRoot((fixtureRoot) => {
      writeFileSync(join(fixtureRoot, 'nota.txt'), 'prefiro reuniões de manhã');

      const execution = spawnSync(process.execPath, [compiledCliPath, 'Leia o arquivo nota.txt'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: isolatedEnv(dataDir),
      });

      assert.equal(execution.error, undefined);
      assert.equal(execution.status, 0);
      assert.equal(execution.stderr, '');
      const result = JSON.parse(execution.stdout.trim()) as { output: { message: string } };
      assert.equal(result.output.message, 'Conteúdo de "nota.txt":\nprefiro reuniões de manhã');
    });
  });
});

test('a real CLI process refuses to read outside its working directory and reports it safely, without crashing', () => {
  withIsolatedDataDir((dataDir) => {
    const parent = mkdtempSync(join(tmpdir(), 'sebastian-cli-fs-guard-'));
    try {
      const root = join(parent, 'projeto');
      const outside = join(parent, 'fora');
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, 'segredo.txt'), 'nunca deveria ser lido');

      const execution = spawnSync(process.execPath, [compiledCliPath, 'Leia o arquivo ../fora/segredo.txt'], {
        cwd: root,
        encoding: 'utf8',
        env: isolatedEnv(dataDir),
      });

      assert.equal(execution.error, undefined);
      assert.equal(execution.status, 0);
      assert.equal(execution.stderr, '');
      const result = JSON.parse(execution.stdout.trim()) as { output: { message: string } };
      assert.equal(result.output.message, 'O caminho "../fora/segredo.txt" está fora da área permitida.');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test('filesystem inspection through the real CLI neither breaks nor is affected by greeting, remember and recall', () => {
  withIsolatedDataDir((dataDir) => {
    withIsolatedFixtureRoot((fixtureRoot) => {
      const env = isolatedEnv(dataDir);
      writeFileSync(join(fixtureRoot, 'nota.txt'), 'x');

      const greeting = spawnSync(process.execPath, [compiledCliPath, 'greeting', 'Gabriel'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env,
      });
      assert.equal(greeting.status, 0);
      assert.deepEqual(JSON.parse(greeting.stdout.trim()).output, { message: 'Hello, Gabriel!' });

      const remember = spawnSync(process.execPath, [compiledCliPath, 'remember', 'prefiro', 'café'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env,
      });
      assert.equal(remember.status, 0);

      const listing = spawnSync(process.execPath, [compiledCliPath, 'Quais arquivos existem?'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env,
      });
      assert.equal(listing.status, 0);
      assert.deepEqual(JSON.parse(listing.stdout.trim()).output, { message: 'Arquivos em ".": nota.txt.' });

      const recall = spawnSync(process.execPath, [compiledCliPath, 'recall'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env,
      });
      assert.equal(recall.status, 0);
      const recallResult = JSON.parse(recall.stdout.trim()) as { output: { facts: ReadonlyArray<{ content: string }> } };
      assert.deepEqual(
        recallResult.output.facts.map((fact) => fact.content),
        ['prefiro café'],
      );
    });
  });
});

test('a task added in one real CLI process is listed, completed, and no longer listed in later, separate real processes', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    const addProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Adiciona uma tarefa: comprar leite'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(addProcess.error, undefined);
    assert.equal(addProcess.status, 0);
    assert.equal(addProcess.stderr, '');
    const addResult = JSON.parse(addProcess.stdout.trim()) as { output: { memoryRecordKind: string; content: string } };
    assert.deepEqual(addResult.output, { memoryRecordKind: 'sebastian.memory.task.created', content: 'comprar leite' });

    const firstListProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Quais', 'são', 'minhas', 'tarefas?'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(firstListProcess.status, 0);
    const firstListResult = JSON.parse(firstListProcess.stdout.trim()) as { output: { message: string } };
    assert.equal(firstListResult.output.message, 'Suas tarefas pendentes: comprar leite.');

    const completeProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, "Marca 'comprar leite' como feita"],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(completeProcess.status, 0);
    const completeResult = JSON.parse(completeProcess.stdout.trim()) as { output: { memoryRecordKind: string; taskId: string } };
    assert.equal(completeResult.output.memoryRecordKind, 'sebastian.memory.task.completed');
    assert.equal(typeof completeResult.output.taskId, 'string');

    const secondListProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'Quais', 'são', 'minhas', 'tarefas?'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(secondListProcess.status, 0);
    const secondListResult = JSON.parse(secondListProcess.stdout.trim()) as { output: { message: string } };
    assert.equal(secondListResult.output.message, 'Você não tem nenhuma tarefa pendente.');

    // Distinct real OS processes, same concrete proof pattern already used for remember/recall.
    assert.notEqual(addProcess.pid, secondListProcess.pid);
  });
});

test('completing an unmatched task through the real CLI reports it clearly instead of crashing or completing the wrong task', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'Adiciona uma tarefa: comprar leite'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });

    const completeProcess = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, "Marca 'lavar o carro' como feita"],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(completeProcess.error, undefined);
    assert.equal(completeProcess.status, 0);
    assert.equal(completeProcess.stderr, '');
    const completeResult = JSON.parse(completeProcess.stdout.trim()) as { output: { message: string } };
    assert.equal(completeResult.output.message, 'Não encontrei nenhuma tarefa pendente correspondente a "lavar o carro".');

    const listProcess = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'Quais', 'são', 'minhas', 'tarefas?'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(listProcess.status, 0);
    const listResult = JSON.parse(listProcess.stdout.trim()) as { output: { message: string } };
    assert.equal(listResult.output.message, 'Suas tarefas pendentes: comprar leite.');
  });
});

test('greeting, remember and recall remain fully functional through the real CLI after the converse evolution', () => {
  withIsolatedDataDir((dataDir) => {
    const env = isolatedEnv(dataDir);

    const greeting = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'greeting', 'Gabriel'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(greeting.status, 0);
    assert.deepEqual(JSON.parse(greeting.stdout.trim()).output, { message: 'Hello, Gabriel!' });

    const remember = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'remember', 'prefiro', 'café'],
      { cwd: projectRoot, encoding: 'utf8', env },
    );
    assert.equal(remember.status, 0);
    assert.deepEqual(JSON.parse(remember.stdout.trim()).output, { fact: 'prefiro café' });

    const recall = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'recall'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(recall.status, 0);
    const recallResult = JSON.parse(recall.stdout.trim()) as { output: { facts: ReadonlyArray<{ content: string }> } };
    assert.deepEqual(
      recallResult.output.facts.map((fact) => fact.content),
      ['prefiro café'],
    );
  });
});
