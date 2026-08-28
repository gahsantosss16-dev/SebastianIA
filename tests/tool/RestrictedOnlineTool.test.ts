import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONLINE_TOOL_RESTRICTION_MESSAGE,
  RestrictedOnlineTool,
} from '../../core/tool/RestrictedOnlineTool.js';

const sensitiveToolIds = [
  'fs.createTextFile',
  'fs.appendTextFile',
  'fs.replaceText',
  'fs.readFile',
  'fs.listDirectory',
  'git.status',
  'git.diff',
  'validation.test',
  'validation.build',
  'validation.typecheck',
];

test('SPEC-049: the online Tool boundary rejects every sensitive Tool without delegating it', () => {
  const tool = new RestrictedOnlineTool();

  for (const toolId of sensitiveToolIds) {
    const result = tool.invoke({
      toolId,
      executionId: `execution:${toolId}`,
      responsibilityId: 'online.converse',
      requestedAt: '2026-08-27T00:00:00.000Z',
      payload: { path: 'protected.txt', content: 'changed' },
    });

    assert.equal(result.status, 'completed');
    if (result.status === 'completed') {
      assert.deepEqual(result.output, {
        outcome: 'rejected',
        reasonCode: 'onlineProfileRestricted',
        message: ONLINE_TOOL_RESTRICTION_MESSAGE,
      });
    }
  }
});
