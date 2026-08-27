import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCognitiveToolMenu,
  describeCognitiveToolMenu,
  findCognitiveToolPolicyEntry,
  validateCognitiveToolArguments,
} from '../../core/cognition/CognitiveToolPolicy.js';
import { FILESYSTEM_READ_FILE_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID } from '../../core/tool/LocalFilesystemInspectionTool.js';

const VALIDATION_TOOL_ID = 'validation.test';

test('the cognitive tool menu is exactly three fixed entries: read, the goal validation tool, and replaceText', () => {
  const menu = buildCognitiveToolMenu(VALIDATION_TOOL_ID);
  assert.equal(menu.length, 3);
  assert.deepEqual(
    menu.map((entry) => entry.toolId).sort(),
    [FILESYSTEM_READ_FILE_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID, VALIDATION_TOOL_ID].sort(),
  );
});

test('only fs.replaceText requires authorization in the menu', () => {
  const menu = buildCognitiveToolMenu(VALIDATION_TOOL_ID);
  const requiring = menu.filter((entry) => entry.requiresAuthorization).map((entry) => entry.toolId);
  assert.deepEqual(requiring, [FILESYSTEM_REPLACE_TEXT_TOOL_ID]);
});

test('describeCognitiveToolMenu strips internal policy fields down to the model-facing descriptor shape', () => {
  const described = describeCognitiveToolMenu(VALIDATION_TOOL_ID);
  for (const descriptor of described) {
    assert.deepEqual(Object.keys(descriptor).sort(), ['description', 'requiresAuthorization', 'toolId'].sort());
  }
});

test('findCognitiveToolPolicyEntry returns undefined for any toolId outside the fixed menu - including a plausible-looking but nonexistent one', () => {
  assert.equal(findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, 'git.push'), undefined);
  assert.equal(findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, 'fs.deleteFile'), undefined);
  assert.equal(findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, 'validation.deploy'), undefined);
});

test('findCognitiveToolPolicyEntry resolves the validation tool by the goal\'s own validationToolId, not a hardcoded one', () => {
  const entry = findCognitiveToolPolicyEntry('validation.build', 'validation.build');
  assert.ok(entry);
  assert.equal(entry?.requiresAuthorization, false);
});

test('validateCognitiveToolArguments accepts a complete, correctly-typed argument set', () => {
  const entry = findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID);
  assert.ok(entry);
  assert.equal(
    validateCognitiveToolArguments(entry!, { path: 'a.js', searchText: 'x', replaceText: 'y' }),
    true,
  );
});

test('validateCognitiveToolArguments rejects a missing required field', () => {
  const entry = findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID);
  assert.ok(entry);
  assert.equal(validateCognitiveToolArguments(entry!, { path: 'a.js' }), false);
});

test('validateCognitiveToolArguments rejects a wrong-typed required field', () => {
  const entry = findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, FILESYSTEM_READ_FILE_TOOL_ID);
  assert.ok(entry);
  assert.equal(validateCognitiveToolArguments(entry!, { path: 42 }), false);
});

test('validateCognitiveToolArguments rejects a non-object toolArguments', () => {
  const entry = findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, FILESYSTEM_READ_FILE_TOOL_ID);
  assert.ok(entry);
  assert.equal(validateCognitiveToolArguments(entry!, ['not', 'an', 'object'] as never), false);
});

test('validateCognitiveToolArguments accepts undefined toolArguments when the tool requires none', () => {
  const entry = findCognitiveToolPolicyEntry(VALIDATION_TOOL_ID, VALIDATION_TOOL_ID);
  assert.ok(entry);
  assert.equal(validateCognitiveToolArguments(entry!, undefined), true);
});
