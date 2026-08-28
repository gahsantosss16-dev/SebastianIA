export const SEBASTIAN_WEB_STYLES = String.raw`
:root {
  color-scheme: dark;
  --ink: #f2f4f8;
  --muted: #9098a8;
  --line: rgba(255, 255, 255, 0.09);
  --panel: rgba(14, 17, 24, 0.86);
  --accent: #6ee7c4;
  --accent-strong: #39cfa7;
  --danger: #ff8f9c;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  color: var(--ink);
  background:
    radial-gradient(circle at 10% 0%, rgba(57, 207, 167, 0.12), transparent 34rem),
    radial-gradient(circle at 92% 100%, rgba(82, 102, 151, 0.14), transparent 38rem),
    #080a0f;
}

button, textarea, input { font: inherit; }

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 0 28px;
}

.topbar {
  height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
}

.brand { display: flex; align-items: center; gap: 13px; }
.mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(110, 231, 196, 0.32);
  border-radius: 10px;
  background: rgba(110, 231, 196, 0.08);
  color: var(--accent);
  font-weight: 700;
  letter-spacing: -0.04em;
}
.brand-copy strong { display: block; font-size: 15px; letter-spacing: 0.01em; }
.brand-copy span { color: var(--muted); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
.status { display: flex; align-items: center; gap: 8px; color: #b8c0ce; font-size: 12px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 14px rgba(110, 231, 196, 0.7); }

.workspace {
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 34px 0;
}

.panel {
  width: 100%;
  height: min(760px, calc(100vh - 150px));
  min-height: 540px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--panel);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.panel-head { padding: 22px 26px 18px; border-bottom: 1px solid var(--line); }
.eyebrow { margin: 0 0 5px; color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.17em; text-transform: uppercase; }
.panel-head h1 { margin: 0; font-size: clamp(20px, 3vw, 27px); font-weight: 580; letter-spacing: -0.035em; }
.panel-head p { margin: 7px 0 0; color: var(--muted); font-size: 13px; }

.messages { overflow-y: auto; padding: 26px; scroll-behavior: smooth; }
.message { display: grid; gap: 7px; max-width: 76%; margin-bottom: 22px; }
.message.user { margin-left: auto; justify-items: end; }
.message-label { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.bubble { padding: 14px 16px; border: 1px solid var(--line); border-radius: 5px 17px 17px; background: rgba(255, 255, 255, 0.045); line-height: 1.58; white-space: pre-wrap; overflow-wrap: anywhere; }
.user .bubble { border-color: rgba(110, 231, 196, 0.18); border-radius: 17px 5px 17px 17px; background: rgba(110, 231, 196, 0.09); }
.message.error .bubble { border-color: rgba(255, 143, 156, 0.25); color: #ffd9de; background: rgba(255, 143, 156, 0.07); }
.thinking .bubble { color: var(--muted); }
.thinking .bubble::after { content: ""; display: inline-block; width: 3px; height: 3px; margin-left: 5px; border-radius: 50%; background: var(--accent); box-shadow: 7px 0 var(--accent), 14px 0 var(--accent); animation: pulse 1.1s infinite ease-in-out; }
@keyframes pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }

.composer-wrap { padding: 18px 20px 20px; border-top: 1px solid var(--line); background: rgba(8, 10, 15, 0.58); }
.composer { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 12px; padding: 9px 9px 9px 15px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 17px; background: rgba(255, 255, 255, 0.035); transition: border-color .2s, box-shadow .2s; }
.composer:focus-within { border-color: rgba(110, 231, 196, 0.42); box-shadow: 0 0 0 3px rgba(110, 231, 196, 0.07); }
textarea { width: 100%; min-height: 44px; max-height: 150px; resize: none; padding: 11px 0 8px; border: 0; outline: 0; color: var(--ink); background: transparent; line-height: 1.45; }
textarea::placeholder, input::placeholder { color: #697181; }
.send { height: 44px; min-width: 92px; padding: 0 18px; border: 0; border-radius: 12px; color: #07120f; background: var(--accent); font-weight: 720; cursor: pointer; transition: transform .15s, background .15s, opacity .15s; }
.send:hover:not(:disabled) { transform: translateY(-1px); background: #8bf0d3; }
.send:disabled { cursor: not-allowed; opacity: .42; }
.hint { margin: 9px 4px 0; color: #727b8b; font-size: 11px; }

.unlock { width: min(100%, 460px); padding: 34px; border: 1px solid var(--line); border-radius: 22px; background: var(--panel); box-shadow: 0 24px 80px rgba(0,0,0,.34); }
.unlock h1 { margin: 13px 0 8px; font-size: 29px; letter-spacing: -0.04em; }
.unlock p { margin: 0 0 22px; color: var(--muted); line-height: 1.55; }
.unlock-form { display: grid; gap: 12px; }
.unlock input { width: 100%; height: 50px; padding: 0 15px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; outline: 0; color: var(--ink); background: rgba(255,255,255,.035); }
.unlock input:focus { border-color: rgba(110, 231, 196, .45); }
.unlock-error { min-height: 20px; margin: 0; color: var(--danger) !important; font-size: 12px; }
.hidden { display: none !important; }

@media (max-width: 680px) {
  .shell { padding: 0 12px; }
  .topbar { height: 66px; }
  .workspace { padding: 12px 0; }
  .panel { height: calc(100vh - 90px); min-height: 500px; border-radius: 18px; }
  .panel-head { padding: 18px 18px 15px; }
  .panel-head p { display: none; }
  .messages { padding: 20px 16px; }
  .message { max-width: 90%; }
  .composer-wrap { padding: 12px; }
  .composer { grid-template-columns: 1fr; gap: 7px; }
  .send { width: 100%; }
  .hint { display: none; }
  .unlock { padding: 26px 22px; }
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
  let pending = false;

  const showChat = () => {
    unlock.classList.add('hidden');
    chat.classList.remove('hidden');
    input.focus();
  };

  const appendMessage = (role, text, extraClass = '') => {
    const article = document.createElement('article');
    article.className = ['message', role, extraClass].filter(Boolean).join(' ');
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'Você' : 'Sebastian';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    article.append(label, bubble);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return article;
  };

  const parseError = async (response, fallback) => {
    try {
      const body = await response.json();
      return body && body.error && typeof body.error.message === 'string' ? body.error.message : fallback;
    } catch {
      return fallback;
    }
  };

  const checkSession = async () => {
    try {
      const response = await fetch('/api/web/session', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok && (await response.json()).authenticated === true) showChat();
    } catch {
      unlockError.textContent = 'Não foi possível verificar a conexão. Tente novamente.';
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
    } catch {
      tokenInput.value = '';
      unlockError.textContent = 'Não foi possível estabelecer uma sessão segura.';
    } finally {
      button.disabled = false;
    }
  });

  const resizeInput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
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
    input.value = '';
    resizeInput();
    input.disabled = true;
    send.disabled = true;
    appendMessage('user', message);
    const thinking = appendMessage('sebastian', 'Processando', 'thinking');
    try {
      const response = await fetch('/api/web/converse', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      thinking.remove();
      if (!response.ok) {
        if (response.status === 401) {
          chat.classList.add('hidden');
          unlock.classList.remove('hidden');
          unlockError.textContent = 'Sua sessão expirou. Informe o acesso novamente.';
          tokenInput.focus();
          return;
        }
        appendMessage('sebastian', await parseError(response, 'Não consegui concluir esta resposta. Tente novamente.'), 'error');
        return;
      }
      const body = await response.json();
      appendMessage('sebastian', body.message);
    } catch {
      thinking.remove();
      appendMessage('sebastian', 'A conexão foi interrompida. Tente novamente em instantes.', 'error');
    } finally {
      pending = false;
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
  <meta name="theme-color" content="#080a0f">
  <meta name="description" content="Interface online privada do SebastianIA.">
  <title>SebastianIA</title>
  <link rel="stylesheet" href="/assets/sebastian.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><div class="mark" aria-hidden="true">S</div><div class="brand-copy"><strong>SebastianIA</strong><span>Inteligência privada</span></div></div>
      <div class="status"><span class="status-dot" aria-hidden="true"></span><span>Online</span></div>
    </header>
    <section class="workspace">
      <section class="unlock" id="unlock" aria-labelledby="unlock-title">
        <p class="eyebrow">Acesso privado</p>
        <h1 id="unlock-title">Entre no SebastianIA</h1>
        <p>Use sua chave de acesso para criar uma sessão segura neste navegador.</p>
        <form class="unlock-form" id="unlock-form">
          <label class="message-label" for="access-token">Chave de acesso</label>
          <input id="access-token" type="password" autocomplete="current-password" required placeholder="Informe sua chave">
          <button class="send" type="submit">Acessar</button>
          <p class="unlock-error" id="unlock-error" role="alert"></p>
        </form>
      </section>
      <section class="panel hidden" id="chat" aria-labelledby="chat-title">
        <header class="panel-head"><p class="eyebrow">Conversa ativa</p><h1 id="chat-title">Fale com Sebastian</h1><p>Uma interface direta para raciocínio e conversa.</p></header>
        <div class="messages" id="messages" aria-live="polite">
          <article class="message sebastian"><div class="message-label">Sebastian</div><div class="bubble">Estou online e pronto para conversar. Como posso ajudar?</div></article>
        </div>
        <div class="composer-wrap">
          <form class="composer" id="composer-form">
            <textarea id="message-input" maxlength="4000" rows="1" required aria-label="Mensagem para Sebastian" placeholder="Escreva sua mensagem..."></textarea>
            <button class="send" id="send-button" type="submit">Enviar</button>
          </form>
          <p class="hint">Enter para enviar · Shift + Enter para nova linha</p>
        </div>
      </section>
    </section>
  </main>
  <script src="/assets/sebastian.js" defer></script>
</body>
</html>`;
