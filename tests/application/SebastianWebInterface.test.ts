import test from 'node:test';
import assert from 'node:assert/strict';
import { SEBASTIAN_WEB_HTML, SEBASTIAN_WEB_SCRIPT, SEBASTIAN_WEB_STYLES } from '../../application/SebastianWebInterface.js';

test('desktop and narrow chat layouts constrain the conversation to the viewport and scroll only message history', () => {
  assert.match(SEBASTIAN_WEB_STYLES, /\.workspace \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.conversation \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto;[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.messages \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(SEBASTIAN_WEB_STYLES, /@media \(max-width: 760px\)[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /messages\.scrollTop = messages\.scrollHeight/);
});

test('sidebar keeps its footer fixed and reserves an independently scrollable middle region without rendering fake history', () => {
  assert.match(SEBASTIAN_WEB_STYLES, /\.sidebar \{[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.sidebar-spacer \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.sidebar-footer \{[^}]*flex-shrink: 0;/);
  assert.match(SEBASTIAN_WEB_HTML, /<div class="sidebar-spacer"><\/div>[\s\S]*<div class="sidebar-footer">/);
  assert.doesNotMatch(SEBASTIAN_WEB_HTML, /conversation-history|histórico de conversas/i);
});

test('execution and error states are accessible, clear and do not expose internal diagnostics', () => {
  assert.match(SEBASTIAN_WEB_SCRIPT, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /removeAttribute\('aria-busy'\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /setAttribute\('role', 'status'\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /setAttribute\('role', 'alert'\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /A resposta demorou mais que o esperado/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /ainda está concluindo outra resposta/);
  assert.doesNotMatch(SEBASTIAN_WEB_SCRIPT, /stack|exception|requestId|EXECUTION_TIMEOUT|SERVICE_BUSY/);
});
