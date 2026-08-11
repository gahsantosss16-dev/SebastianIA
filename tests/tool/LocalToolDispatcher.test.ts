import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalToolDispatcher } from '../../core/tool/LocalToolDispatcher.js';
import { LocalFilesystemInspectionTool, FILESYSTEM_READ_FILE_TOOL_ID } from '../../core/tool/LocalFilesystemInspectionTool.js';
import { InMemorySpecializedTool } from '../../core/tool/InMemorySpecializedTool.js';
import { InvalidSpecializedToolInvocationInputError } from '../../core/tool/SpecializedToolInvocationErrors.js';
import type { SpecializedToolInvocationInput } from '../../core/tool/SpecializedToolInvocationContract.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-tool-dispatcher-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('routes filesystem toolIds to the real filesystem tool', () => {
  withFixtureRoot((root) => {
    writeFileSync(join(root, 'nota.txt'), 'conteúdo real');
    const dispatcher = new LocalToolDispatcher(new InMemorySpecializedTool(), new LocalFilesystemInspectionTool(root));

    const result = dispatcher.invoke({
      toolId: FILESYSTEM_READ_FILE_TOOL_ID,
      executionId: 'x',
      responsibilityId: 'y',
      requestedAt: '2026-08-11T00:00:00.000Z',
      payload: { path: 'nota.txt' },
    });

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.content, 'conteúdo real');
  });
});

test('routes every other toolId to the fallback tool, preserving prior echo behavior', () => {
  withFixtureRoot((root) => {
    const dispatcher = new LocalToolDispatcher(new InMemorySpecializedTool(), new LocalFilesystemInspectionTool(root));

    const input: SpecializedToolInvocationInput = {
      toolId: 'tool.greeting',
      executionId: 'greeting:2026-08-11T00:00:00.000Z',
      responsibilityId: 'capability.execute.greeting',
      requestedAt: '2026-08-11T00:00:01.000Z',
      payload: { commandInput: { type: 'greeting' } },
    };

    const result = dispatcher.invoke(input);

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.toolId, 'tool.greeting');
    assert.deepEqual(result.output.payload, { commandInput: { type: 'greeting' } });
  });
});

test('rejects construction without a valid fallback or filesystem tool', () => {
  withFixtureRoot((root) => {
    assert.throws(
      () => new LocalToolDispatcher({} as never, new LocalFilesystemInspectionTool(root)),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );

    assert.throws(
      () => new LocalToolDispatcher(new InMemorySpecializedTool(), {} as never),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );
  });
});
