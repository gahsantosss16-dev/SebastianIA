export const SEBASTIAN_WEB_STYLES = String.raw`
:root {
  color-scheme: dark;
  --bg: #0a0b0d;
  --bg-elevated: #111318;
  --ink: #eef0f3;
  --muted: #8b93a3;
  --line: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.16);
  --accent: #c8a463;
  --accent-strong: #ddbb7e;
  --accent-soft: rgba(200, 164, 99, 0.12);
  --accent-line: rgba(200, 164, 99, 0.32);
  --danger: #e5828f;
  --danger-line: rgba(229, 130, 143, 0.3);
  --online: #5fbf88;
  --radius-lg: 16px;
  --radius-md: 12px;
  --radius-sm: 9px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html, body { height: 100%; }

body {
  margin: 0;
  min-width: 320px;
  color: var(--ink);
  background: var(--bg);
  background-image: radial-gradient(ellipse 60% 38% at 50% -8%, rgba(200, 164, 99, 0.07), transparent 60%);
  background-repeat: no-repeat;
}

button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
.hidden { display: none !important; }
.icon { display: block; }

.mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 1px solid var(--accent-line);
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.02em;
}
.accent { color: var(--accent); }

/* ---------- Unlock ---------- */
.unlock { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.unlock-card { width: min(100%, 400px); padding: 36px 32px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-elevated); box-shadow: 0 30px 90px rgba(0, 0, 0, 0.4); }
.unlock-brand { display: flex; align-items: center; gap: 11px; margin-bottom: 30px; }
.unlock-brand-name { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
.unlock-card h1 { margin: 0 0 8px; font-size: 24px; font-weight: 620; letter-spacing: -0.025em; }
.unlock-copy { margin: 0 0 24px; color: var(--muted); font-size: 13.5px; line-height: 1.6; }
.unlock-form { display: grid; gap: 10px; }
.field-label { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
.unlock input {
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  outline: 0;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.03);
  transition: border-color .15s, box-shadow .15s;
}
.unlock input::placeholder { color: var(--muted); opacity: .55; }
.unlock input:focus-visible { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.unlock-submit {
  height: 46px;
  margin-top: 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #16130b;
  font-weight: 660;
  font-size: 14px;
  transition: background .15s, transform .15s, opacity .15s;
}
.unlock-submit:hover:not(:disabled) { background: var(--accent-strong); transform: translateY(-1px); }
.unlock-submit:disabled { opacity: .5; cursor: not-allowed; }
.unlock-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.unlock-error { min-height: 16px; margin: 2px 0 0; color: var(--danger) !important; font-size: 12px; }

/* ---------- Workspace ---------- */
.workspace { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; display: grid; grid-template-columns: 244px 1fr; }

.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 20px 16px;
  border-right: 1px solid var(--line);
  background: var(--bg-elevated);
}
.sidebar-brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px 24px; }
.sidebar-brand-name { font-size: 14px; font-weight: 660; letter-spacing: -0.01em; }

.new-conversation {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: 13px;
  font-weight: 560;
  transition: background .15s, border-color .15s;
}
.new-conversation:hover { background: rgba(255, 255, 255, 0.045); }
.new-conversation:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.new-conversation .icon { width: 14px; height: 14px; color: var(--muted); flex-shrink: 0; }

.conversation-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; margin: 12px 0 0; padding: 0; list-style: none; }
.conversation-item {
  display: block;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .15s, border-color .15s;
}
.conversation-item:hover { background: rgba(255, 255, 255, 0.045); }
.conversation-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.conversation-item[aria-current="true"] { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.conversation-list-empty { padding: 9px 10px; color: var(--muted); font-size: 12px; }
.sidebar-footer { flex-shrink: 0; display: grid; gap: 4px; }
.sidebar-status { display: flex; align-items: center; gap: 8px; padding: 8px 6px; color: var(--muted); font-size: 12px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--online); box-shadow: 0 0 8px rgba(95, 191, 136, 0.65); }

.conversation { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; overflow: hidden; }

.messages { min-height: 0; display: flex; flex-direction: column; overflow-y: auto; padding: 40px 5vw 16px; scroll-behavior: smooth; }
.message { width: 100%; max-width: 700px; margin: 0 auto 28px; display: grid; gap: 6px; }
.message.user { justify-items: end; }

.message-label { color: var(--muted); font-size: 10px; font-weight: 660; letter-spacing: 0.11em; text-transform: uppercase; }

.message.sebastian { position: relative; padding-left: 34px; }
.message.sebastian::before {
  content: "S";
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}
.message.sebastian.error::before { border-color: var(--danger-line); color: var(--danger); }

.bubble { font-size: 14.5px; line-height: 1.68; white-space: pre-wrap; overflow-wrap: anywhere; }
.message.sebastian .bubble { color: var(--ink); }
.message.user .bubble {
  display: inline-block;
  max-width: 100%;
  padding: 11px 15px;
  border: 1px solid var(--line);
  border-radius: 14px 14px 4px 14px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--ink);
}
.message.error .bubble { padding: 11px 13px; border: 1px solid var(--danger-line); border-radius: var(--radius-sm); background: rgba(229, 130, 143, 0.06); color: var(--danger); }
.thinking .bubble { color: var(--muted); }
.thinking .bubble::after {
  content: "";
  display: inline-block;
  width: 3px;
  height: 3px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--muted);
  box-shadow: 7px 0 var(--muted), 14px 0 var(--muted);
  animation: pulse 1.1s infinite ease-in-out;
  vertical-align: middle;
}
@keyframes pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }

.empty-state { flex: 1; min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 16px; }
.empty-mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-line);
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 20px;
  font-weight: 700;
}
.empty-state h1 { margin: 2px 0 0; font-size: 28px; font-weight: 620; letter-spacing: -0.03em; }
.empty-state p { margin: 0; max-width: 380px; color: var(--muted); font-size: 14px; line-height: 1.6; }

.composer-wrap { padding: 12px 5vw 22px; }
.composer {
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  align-items: end;
  gap: 10px;
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 18px;
  background: var(--bg-elevated);
  transition: border-color .15s, box-shadow .15s;
}
.composer:focus-within { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea {
  flex: 1;
  min-height: 24px;
  max-height: 160px;
  resize: none;
  padding: 10px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  line-height: 1.5;
  font-size: 14.5px;
}
textarea::placeholder { color: var(--muted); opacity: .55; }
.send {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 11px;
  background: var(--accent);
  color: #16130b;
  transition: background .15s, transform .15s, opacity .15s;
}
.send .icon { width: 16px; height: 16px; }
.send:hover:not(:disabled) { background: var(--accent-strong); transform: translateY(-1px); }
.send:disabled { cursor: not-allowed; opacity: .4; transform: none; }
.send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hint { max-width: 700px; margin: 9px auto 0; padding: 0 2px; color: var(--muted); font-size: 11px; text-align: center; }

@media (max-width: 760px) {
  .workspace { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .sidebar { flex-direction: row; align-items: center; padding: 12px 14px; border-right: 0; border-bottom: 1px solid var(--line); }
  .sidebar-brand { padding: 0; }
  .sidebar-brand-name { display: none; }
  .new-conversation { width: 38px; height: 38px; padding: 0; justify-content: center; }
  .new-conversation span { display: none; }
  .conversation-list { display: none; }
  .sidebar-footer { display: flex; align-items: center; gap: 10px; }
  .sidebar-status { padding: 0; }
  .messages { padding: 26px 18px 12px; }
  .message { max-width: 100%; }
  .composer-wrap { padding: 10px 16px 16px; }
  .hint { display: none; }
  .unlock-card { padding: 28px 22px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;

export const SEBASTIAN_WEB_SCRIPT = String.raw`
(() => {
  'use strict';
  const unlock = document.querySelector('#unlock');
  const chat = document.querySelector('#chat');
  const unlockForm = document.querySelector('#unlock-form');
  const tokenInput = document.querySelector('#access-token');
  const unlockError = document.querySelector('#unlock-error');
  const form = document.querySelector('#composer-form');
  const input = document.querySelector('#message-input');
  const send = document.querySelector('#send-button');
  const messages = document.querySelector('#messages');
  const conversation = document.querySelector('.conversation');
  const conversationList = document.querySelector('#conversation-list');
  const newConversationButton = document.querySelector('#new-conversation-button');
  const logoutButton = document.querySelector('#logout-button');
  let pending = false;
  let activeConversationId = null;

  const showChat = () => {
    unlock.classList.add('hidden');
    chat.classList.remove('hidden');
    input.focus();
  };

  const showUnlock = (message = '') => {
    chat.classList.add('hidden');
    unlock.classList.remove('hidden');
    unlockError.textContent = message;
    tokenInput.value = '';
    tokenInput.focus();
  };

  const buildEmptyState = () => {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.id = 'empty-state';
    const mark = document.createElement('span');
    mark.className = 'empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'S';
    const heading = document.createElement('h1');
    heading.textContent = 'Sebastian';
    const copy = document.createElement('p');
    copy.textContent = 'Estou online e pronto para conversar. Como posso ajudar?';
    wrap.append(mark, heading, copy);
    return wrap;
  };

  const clearEmptyState = () => {
    const existing = document.querySelector('#empty-state');
    if (existing) existing.remove();
  };

  const appendMessage = (role, text, extraClass = '') => {
    clearEmptyState();
    const article = document.createElement('article');
    article.className = ['message', role, extraClass].filter(Boolean).join(' ');
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = extraClass === 'error' ? 'Não foi possível concluir' : role === 'user' ? 'Você' : 'Sebastian';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    article.append(label, bubble);
    if (extraClass === 'thinking') {
      article.setAttribute('role', 'status');
      article.setAttribute('aria-label', 'Sebastian está preparando a resposta');
    } else if (extraClass === 'error') {
      article.setAttribute('role', 'alert');
    }
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return article;
  };

  const showConversationMessages = (turns) => {
    messages.innerHTML = '';
    if (!turns || turns.length === 0) {
      messages.append(buildEmptyState());
      return;
    }
    for (const turn of turns) {
      appendMessage(turn.role === 'user' ? 'user' : 'sebastian', turn.content);
    }
  };

  const renderConversationList = (conversations) => {
    if (!conversationList) return;
    conversationList.innerHTML = '';
    if (!conversations || conversations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'conversation-list-empty';
      empty.textContent = 'Nenhuma conversa ainda.';
      conversationList.append(empty);
      return;
    }
    for (const item of conversations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-item';
      button.textContent = item.title;
      button.dataset.conversationId = item.id;
      button.setAttribute('aria-current', String(item.id === activeConversationId));
      button.addEventListener('click', () => {
        if (pending || item.id === activeConversationId) return;
        void openConversation(item.id);
      });
      conversationList.append(button);
    }
  };

  const refreshConversationList = async () => {
    try {
      const response = await fetch('/api/web/conversations', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json();
      renderConversationList(Array.isArray(body.conversations) ? body.conversations : []);
    } catch {
      // The sidebar list is a convenience; a transient failure to refresh it
      // must never interrupt an otherwise-working conversation.
    }
  };

  const openConversation = async (id) => {
    try {
      const response = await fetch('/api/web/conversations/' + encodeURIComponent(id), {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const body = await response.json();
      activeConversationId = id;
      showConversationMessages(body.messages);
      input.value = '';
      input.style.height = 'auto';
      input.focus();
      await refreshConversationList();
    } catch {
      // Leave the previously active conversation visible rather than
      // clearing the screen on a transient failure to reopen another one.
    }
  };

  const createConversation = async () => {
    try {
      const response = await fetch('/api/web/conversations', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) return;
      const body = await response.json();
      activeConversationId = body.conversation.id;
      showConversationMessages([]);
      input.value = '';
      input.style.height = 'auto';
      input.focus();
      await refreshConversationList();
    } catch {
      // A failed create leaves the previous conversation active and visible.
    }
  };

  const ensureActiveConversation = async () => {
    try {
      const response = await fetch('/api/web/conversations', { credentials: 'same-origin', cache: 'no-store' });
      const body = response.ok ? await response.json() : { conversations: [] };
      const conversations = Array.isArray(body.conversations) ? body.conversations : [];
      if (conversations.length > 0) {
        await openConversation(conversations[0].id);
        return;
      }
      await createConversation();
    } catch {
      renderConversationList([]);
    }
  };

  if (newConversationButton) {
    newConversationButton.addEventListener('click', () => {
      if (pending) return;
      void createConversation();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (pending) return;
      try {
        await fetch('/api/web/session', { method: 'DELETE', credentials: 'same-origin' });
      } finally {
        showUnlock('Sessão encerrada com segurança.');
      }
    });
  }

  const parseError = async (response, fallback) => {
    try {
      const body = await response.json();
      return body && body.error && typeof body.error.message === 'string' ? body.error.message : fallback;
    } catch {
      return fallback;
    }
  };

  const conversationError = async (response) => {
    if (response.status === 503) return 'O Sebastian ainda está concluindo outra resposta. Aguarde um instante e tente novamente.';
    if (response.status === 504) return 'A resposta demorou mais que o esperado. Tente novamente.';
    return parseError(response, 'Não foi possível concluir a resposta. Tente novamente.');
  };

  const checkSession = async () => {
    try {
      const response = await fetch('/api/web/session', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok && (await response.json()).authenticated === true) {
        showChat();
        await ensureActiveConversation();
      } else {
        showUnlock();
      }
    } catch {
      showUnlock('Não foi possível verificar a conexão. Tente novamente.');
    }
  };

  unlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = tokenInput.value;
    if (!token.trim()) return;
    unlockError.textContent = '';
    const button = unlockForm.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/api/web/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      tokenInput.value = '';
      if (!response.ok) {
        unlockError.textContent = await parseError(response, 'Acesso não autorizado.');
        return;
      }
      showChat();
      await ensureActiveConversation();
    } catch {
      tokenInput.value = '';
      unlockError.textContent = 'Não foi possível estabelecer uma sessão segura.';
    } finally {
      button.disabled = false;
    }
  });

  const resizeInput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  };
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || pending) return;
    pending = true;
    conversation.setAttribute('aria-busy', 'true');
    input.value = '';
    resizeInput();
    input.disabled = true;
    send.disabled = true;
    appendMessage('user', message);
    const thinking = appendMessage('sebastian', 'Preparando resposta', 'thinking');
    try {
      const response = await fetch('/api/web/converse', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          activeConversationId ? { message, conversationId: activeConversationId } : { message }
        )
      });
      thinking.remove();
      if (!response.ok) {
        if (response.status === 401) {
          showUnlock('Sua sessão expirou. Informe o acesso novamente.');
          return;
        }
        if (response.status === 404) {
          appendMessage('sebastian', 'Esta conversa não está mais disponível. Iniciando uma nova.', 'error');
          await createConversation();
          return;
        }
        appendMessage('sebastian', await conversationError(response), 'error');
        return;
      }
      const body = await response.json();
      appendMessage('sebastian', body.message);
      void refreshConversationList();
    } catch {
      thinking.remove();
      appendMessage('sebastian', 'A conexão caiu antes da resposta. Verifique sua conexão e tente novamente.', 'error');
    } finally {
      pending = false;
      conversation.removeAttribute('aria-busy');
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  });

  void checkSession();
})();
`;

export const SEBASTIAN_WEB_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0b0d">
  <meta name="description" content="Interface online privada do SebastianIA.">
  <title>SebastianIA</title>
  <link rel="stylesheet" href="/assets/sebastian.css">
</head>
<body>
  <div class="shell">
    <section class="unlock hidden" id="unlock" aria-labelledby="unlock-title">
      <div class="unlock-card">
        <div class="unlock-brand">
          <span class="mark" aria-hidden="true">S</span>
          <span class="unlock-brand-name">Sebastian<span class="accent">IA</span></span>
        </div>
        <p class="eyebrow">Acesso privado</p>
        <h1 id="unlock-title">Entrar</h1>
        <p class="unlock-copy">Informe sua chave de acesso para abrir uma sessão segura neste navegador.</p>
        <form class="unlock-form" id="unlock-form">
          <label class="field-label" for="access-token">Chave de acesso</label>
          <input id="access-token" type="password" autocomplete="current-password" required placeholder="Informe sua chave">
          <button class="unlock-submit" type="submit">Acessar</button>
          <p class="unlock-error" id="unlock-error" role="alert"></p>
        </form>
      </div>
    </section>

    <div class="workspace hidden" id="chat">
      <aside class="sidebar" aria-label="Sebastian">
        <div class="sidebar-brand">
          <span class="mark" aria-hidden="true">S</span>
          <span class="sidebar-brand-name">Sebastian<span class="accent">IA</span></span>
        </div>
        <button class="new-conversation" id="new-conversation-button" type="button">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span>Nova conversa</span>
        </button>
        <nav class="conversation-list" id="conversation-list" aria-label="Conversas recentes"></nav>
        <div class="sidebar-footer">
          <div class="sidebar-status">
            <span class="status-dot" aria-hidden="true"></span>
            <span>Online</span>
          </div>
          <button class="new-conversation" id="logout-button" type="button">Sair</button>
        </div>
      </aside>
      <main class="conversation" aria-label="Conversa com Sebastian">
        <div class="messages" id="messages" aria-live="polite">
          <div class="empty-state" id="empty-state">
            <span class="empty-mark" aria-hidden="true">S</span>
            <h1>Sebastian</h1>
            <p>Estou online e pronto para conversar. Como posso ajudar?</p>
          </div>
        </div>
        <div class="composer-wrap">
          <form class="composer" id="composer-form">
            <textarea id="message-input" maxlength="4000" rows="1" required aria-label="Mensagem para Sebastian" placeholder="Escreva para Sebastian..."></textarea>
            <button class="send" id="send-button" type="submit" aria-label="Enviar mensagem">
              <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
            </button>
          </form>
          <p class="hint">Enter para enviar · Shift + Enter para nova linha</p>
        </div>
      </main>
    </div>
  </div>
  <script src="/assets/sebastian.js" defer></script>
</body>
</html>`;
