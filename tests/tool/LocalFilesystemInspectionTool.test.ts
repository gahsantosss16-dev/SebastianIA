import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
  FILESYSTEM_READ_FILE_TOOL_ID,
  LocalFilesystemInspectionTool,
} from '../../core/tool/LocalFilesystemInspectionTool.js';
import { InvalidSpecializedToolInvocationInputError } from '../../core/tool/SpecializedToolInvocationErrors.js';
import type { SpecializedToolInvocationInput } from '../../core/tool/SpecializedToolInvocationContract.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-fs-tool-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invocation(toolId: string, path: string): SpecializedToolInvocationInput {
  return {
    toolId,
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-11T00:00:00.000Z',
    payload: { path },
  };
}

test('lists the entries of an allowed directory, sorted by name', () => {
  withFixtureRoot((root) => {
    mkdirSync(join(root, 'specs'));
    writeFileSync(join(root, 'specs', 'b.md'), 'b');
    writeFileSync(join(root, 'specs', 'a.md'), 'a');
    mkdirSync(join(root, 'specs', 'sub'));

    const tool = new LocalFilesystemInspectionTool(root);
    const result = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, 'specs'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.deepEqual(result.output.entries, [
      { name: 'a.md', type: 'file' },
      { name: 'b.md', type: 'file' },
      { name: 'sub', type: 'directory' },
    ]);
    assert.equal(result.output.message, 'Arquivos em "specs": a.md, b.md, sub.');
  });
});

test('reports an empty directory clearly', () => {
  withFixtureRoot((root) => {
    mkdirSync(join(root, 'vazio'));
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, 'vazio'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.deepEqual(result.output.entries, []);
    assert.equal(result.output.message, 'A pasta "vazio" está vazia.');
  });
});

test('lists the root itself for a "." request', () => {
  withFixtureRoot((root) => {
    writeFileSync(join(root, 'readme.txt'), 'oi');
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, '.'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.deepEqual(result.output.entries, [{ name: 'readme.txt', type: 'file' }]);
  });
});

test('reads the content of an allowed file within the size limit', () => {
  withFixtureRoot((root) => {
    writeFileSync(join(root, 'nota.txt'), 'conteúdo real do arquivo');
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, 'nota.txt'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.content, 'conteúdo real do arquivo');
    assert.equal(result.output.message, 'Conteúdo de "nota.txt":\nconteúdo real do arquivo');
  });
});

test('rejects a missing file with a safe, typed outcome instead of throwing', () => {
  withFixtureRoot((root) => {
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, 'nao-existe.txt'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.deepEqual(result.output, {
      operation: 'readFile',
      outcome: 'rejected',
      path: 'nao-existe.txt',
      reasonCode: 'notFound',
      message: 'Não encontrei "nao-existe.txt".',
    });
  });
});

test('rejects listing a missing directory with a safe, typed outcome', () => {
  withFixtureRoot((root) => {
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, 'nao-existe'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.reasonCode, 'notFound');
  });
});

test('rejects traversal attempts without ever reading outside the root', () => {
  withFixtureRoot((root) => {
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, join('..', '..', 'etc', 'passwd')));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'rejected');
    assert.equal(result.output.reasonCode, 'outsideRoot');
  });
});

test('rejects an absolute path', () => {
  withFixtureRoot((root) => {
    writeFileSync(join(root, 'nota.txt'), 'x');
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, join(root, 'nota.txt')));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.reasonCode, 'absolutePathRejected');
  });
});

test('rejects reading a directory as a file, and listing a file as a directory', () => {
  withFixtureRoot((root) => {
    mkdirSync(join(root, 'pasta'));
    writeFileSync(join(root, 'arquivo.txt'), 'x');
    const tool = new LocalFilesystemInspectionTool(root);

    const readDirAsFile = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, 'pasta'));
    assert.equal(readDirAsFile.status, 'completed');
    if (readDirAsFile.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(readDirAsFile.output.reasonCode, 'notAFile');

    const listFileAsDir = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, 'arquivo.txt'));
    assert.equal(listFileAsDir.status, 'completed');
    if (listFileAsDir.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(listFileAsDir.output.reasonCode, 'notADirectory');
  });
});

test('rejects a file larger than the 256 KiB limit without reading it partially', () => {
  withFixtureRoot((root) => {
    const oversized = Buffer.alloc(256 * 1024 + 1, 'a');
    writeFileSync(join(root, 'grande.txt'), oversized);
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, 'grande.txt'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.reasonCode, 'fileTooLarge');
    assert.equal(result.output.content, undefined);
  });
});

test('rejects a binary file instead of attempting to decode it', () => {
  withFixtureRoot((root) => {
    writeFileSync(join(root, 'binario.dat'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const tool = new LocalFilesystemInspectionTool(root);

    const result = tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, 'binario.dat'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.reasonCode, 'binaryFile');
  });
});

test('rejects a directory listing above the 500 entry limit', () => {
  withFixtureRoot((root) => {
    const big = join(root, 'muitos');
    mkdirSync(big);
    for (let index = 0; index < 501; index += 1) {
      writeFileSync(join(big, `arquivo-${index}.txt`), 'x');
    }

    const tool = new LocalFilesystemInspectionTool(root);
    const result = tool.invoke(invocation(FILESYSTEM_LIST_DIRECTORY_TOOL_ID, 'muitos'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.reasonCode, 'listingLimitExceeded');
    assert.equal(result.output.entries, undefined);
  });
});

test('rejects an unsupported toolId', () => {
  withFixtureRoot((root) => {
    const tool = new LocalFilesystemInspectionTool(root);

    assert.throws(
      () => tool.invoke(invocation('fs.deleteFile', 'x.txt')),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );
  });
});

test('rejects a payload without a string path', () => {
  withFixtureRoot((root) => {
    const tool = new LocalFilesystemInspectionTool(root);

    assert.throws(
      () =>
        tool.invoke({
          toolId: FILESYSTEM_READ_FILE_TOOL_ID,
          executionId: 'x',
          responsibilityId: 'y',
          requestedAt: '2026-08-11T00:00:00.000Z',
          payload: {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );
  });
});

test('rejects a non-empty allowed root argument requirement', () => {
  assert.throws(
    () => new LocalFilesystemInspectionTool('   '),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
      return true;
    },
  );
});
