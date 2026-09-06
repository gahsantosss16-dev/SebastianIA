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

test('a new entry into the system (login, or opening the app fresh) always starts a new chat instead of reopening the most recently active conversation', () => {
  // The old behaviour this replaces picked conversations[0] (the most
  // recently active one) unconditionally; that function and its selection
  // logic must be fully gone, not just bypassed.
  assert.doesNotMatch(SEBASTIAN_WEB_SCRIPT, /ensureActiveConversation/);
  assert.doesNotMatch(SEBASTIAN_WEB_SCRIPT, /conversations\[0\]/);

  // Login always opens a brand new conversation, regardless of any
  // conversation id still sitting in the address bar from an earlier tab session.
  assert.match(
    SEBASTIAN_WEB_SCRIPT,
    /showChat\(\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await createConversation\(\);/,
  );

  // Opening the app fresh restores whatever conversation the URL names, and
  // only falls back to a brand new chat when none is named there.
  assert.match(SEBASTIAN_WEB_SCRIPT, /const restoreActiveConversation = async \(\) => \{/);
  assert.match(
    SEBASTIAN_WEB_SCRIPT,
    /if \(requestedId && \(await openConversation\(requestedId\)\)\) return;\s*await createConversation\(\);/,
  );
  assert.match(SEBASTIAN_WEB_SCRIPT, /showChat\(\);\s*await restoreActiveConversation\(\);/);
});

test('the active conversation is tracked only in the URL query string, never in any browser storage API - a same-tab reload re-requests the same conversation id', () => {
  assert.match(SEBASTIAN_WEB_SCRIPT, /new URLSearchParams\(window\.location\.search\)\.get\(CONVERSATION_QUERY_PARAM\)/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /window\.history\.replaceState\(null, '', url\)/);
  // Every path that lands on a conversation (opening one, creating one) keeps
  // the URL in sync, so a plain reload of that same URL lands back on it.
  assert.match(SEBASTIAN_WEB_SCRIPT, /activeConversationId = id;\s*syncConversationIdToUrl\(id\);/);
  assert.match(SEBASTIAN_WEB_SCRIPT, /activeConversationId = body\.conversation\.id;\s*syncConversationIdToUrl\(activeConversationId\);/);
  // Logging out clears it, so a stale conversation id never lingers in the
  // address bar once the session backing it is gone.
  assert.match(SEBASTIAN_WEB_SCRIPT, /syncConversationIdToUrl\(null\);\s*showUnlock\('Sessão encerrada com segurança\.'\);/);
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
