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

test('sidebar keeps its footer fixed and reserves an independently scrollable middle region', () => {
  assert.match(SEBASTIAN_WEB_STYLES, /\.sidebar \{[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.conversation-list \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(SEBASTIAN_WEB_STYLES, /\.sidebar-footer \{[^}]*flex-shrink: 0;/);
  assert.match(SEBASTIAN_WEB_HTML, /<nav class="conversation-list" id="conversation-list"[^>]*><\/nav>[\s\S]*<div class="sidebar-footer">/);
  // The narrow layout never redesigns the compact header - the full list is
  // simply hidden there, exactly like the brand name and the composer hint.
  assert.match(SEBASTIAN_WEB_STYLES, /@media \(max-width: 760px\)[\s\S]*\.conversation-list \{ display: none; \}/);
});

test('sidebar renders real, persisted conversations - listing, opening and creating them through the actual API, with the active one visually marked', () => {
  assert.match(SEBASTIAN_WEB_SCRIPT, /fetch\('\/api\/web\/conversations', \{ credentials: 'same-origin', cache: 'no-store' \}\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /fetch\('\/api\/web\/conversations', \{ method: 'POST', credentials: 'same-origin' \}\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /fetch\('\/api\/web\/conversations\/' \+ encodeURIComponent\(id\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /setAttribute\('aria-current', String\(item\.id === activeConversationId\)\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /conversationId: activeConversationId/);
  // A brand new conversation always clears the pane instead of resuming the previous one's messages.
  assert.match(SEBASTIAN_WEB_SCRIPT, /showConversationMessages\(\[\]\)/);
});

test('"Manter-me conectado neste dispositivo" is checked by default, sent with the unlock request, and never persists the password itself', () => {
  assert.match(SEBASTIAN_WEB_HTML, /<input id="remember-device" type="checkbox" checked>/);
  assert.match(SEBASTIAN_WEB_HTML, /Manter-me conectado neste dispositivo/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /rememberDeviceInput \? rememberDeviceInput\.checked : true/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /JSON\.stringify\(\{ token, remember \}\)/);
  // No client-side storage of any kind - the session lives only in the
  // HttpOnly cookie the server issues; the password itself is never retained.
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB']) {
    assert.equal(SEBASTIAN_WEB_SCRIPT.includes(forbidden), false);
  }
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
