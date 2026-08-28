import test from 'node:test';
import assert from 'node:assert/strict';
import { SEBASTIAN_WEB_SCRIPT, SEBASTIAN_WEB_STYLES } from '../../application/SebastianWebInterface.js';

test('desktop and narrow chat layouts constrain the conversation to the viewport and scroll only message history', () => {
  assert.match(SEBASTIAN_WEB_STYLES, /\.workspace \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.conversation \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto;[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.messages \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(SEBASTIAN_WEB_STYLES, /@media \(max-width: 760px\)[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /messages\.scrollTop = messages\.scrollHeight/);
});
