export const SEBASTIAN_WEB_STYLES = String.raw`
:root {
  color-scheme: dark;
  --bg: #0b0c0f;
  --surface: #0f1014;
  --raised: #15171c;
  --raised-2: #1b1d23;
  --ink: #edebe6;
  --ink-soft: #c8c6c0;
  --muted: #8b8e97;
  --faint: #5e626c;
  --line: rgba(255, 255, 255, 0.065);
  --line-strong: rgba(255, 255, 255, 0.12);
  --accent: #c9a45f;
  --accent-strong: #e0c084;
  --accent-ink: #17130a;
  --accent-soft: rgba(201, 164, 95, 0.1);
  --accent-line: rgba(201, 164, 95, 0.3);
  --danger: #e38692;
  --danger-line: rgba(227, 134, 146, 0.28);
  --online: #62c08c;
  --radius-lg: 20px;
  --radius-md: 12px;
  --radius-sm: 8px;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --font-sans: "Inter", "SF Pro Text", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, serif;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* { box-sizing: border-box; }
html, body { height: 100%; width: 100%; max-width: 100%; overflow-x: hidden; }

body {
  margin: 0;
  min-width: 320px;
  color: var(--ink);
  background: var(--bg);
  font-size: 14px;
  text-rendering: optimizeLegibility;
}

button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
.hidden { display: none !important; }
.icon { display: block; flex-shrink: 0; }
.accent { color: var(--accent); }

::selection { background: rgba(201, 164, 95, 0.28); }
* { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.12) transparent; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
*::-webkit-scrollbar-track { background: transparent; }

kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 5px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.02);
  font-family: var(--font-sans);
  font-size: 10.5px;
  line-height: 1.4;
}

/* ---------- Monogram ---------- */
.mark {
  position: relative;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--accent-line);
  background: radial-gradient(circle at 30% 25%, rgba(224, 192, 132, 0.22), rgba(201, 164, 95, 0.04) 70%);
  color: var(--accent-strong);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}
.mark-lg { width: 56px; height: 56px; font-size: 26px; }

.wordmark { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: 0.005em; color: var(--ink); }
.wordmark .accent { font-family: var(--font-sans); font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; margin-left: 4px; vertical-align: 2px; }

/* ---------- Unlock ---------- */
.unlock {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(ellipse 70% 45% at 50% 0%, rgba(201, 164, 95, 0.07), transparent 65%), var(--bg);
}
.unlock-card {
  width: min(100%, 410px);
  padding: 40px 36px 34px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: linear-gradient(180deg, var(--raised), var(--surface));
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  animation: rise .5s var(--ease) both;
}
.unlock-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 34px; }
.eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 10.5px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
.unlock-card h1 { margin: 0 0 10px; font-family: var(--font-display); font-size: 30px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.15; }
.unlock-copy { margin: 0 0 26px; color: var(--muted); font-size: 13.5px; line-height: 1.65; }
.unlock-form { display: grid; gap: 10px; }
.field-label { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase; }
.unlock input {
  width: 100%;
  height: 48px;
  padding: 0 15px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  outline: 0;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.25);
  transition: border-color .18s, box-shadow .18s;
}
.unlock input::placeholder { color: var(--faint); }
.unlock input:focus-visible { border-color: var(--accent-line); box-shadow: 0 0 0 4px var(--accent-soft); }
.unlock input[type="checkbox"] { width: 16px; height: 16px; padding: 0; accent-color: var(--accent); cursor: pointer; }
.remember-device { display: flex; align-items: center; gap: 9px; margin: 4px 0 6px; color: var(--muted); font-size: 12.5px; user-select: none; cursor: pointer; }
.unlock-submit {
  height: 48px;
  border: 0;
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, var(--accent-strong), var(--accent));
  color: var(--accent-ink);
  font-weight: 650;
  font-size: 14px;
  letter-spacing: 0.01em;
  box-shadow: 0 10px 30px rgba(201, 164, 95, 0.18);
  transition: transform .18s var(--ease), box-shadow .18s, opacity .18s;
}
.unlock-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(201, 164, 95, 0.26); }
.unlock-submit:disabled { opacity: .5; cursor: not-allowed; }
.unlock-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.unlock-error { min-height: 16px; margin: 4px 0 0; color: var(--danger) !important; font-size: 12px; }
.unlock-foot { margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 8px; color: var(--faint); font-size: 11.5px; }
.unlock-foot .icon { width: 13px; height: 13px; color: var(--accent); }

/* ---------- Workspace ---------- */
.workspace { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; display: grid; grid-template-columns: 288px minmax(0, 1fr); }

/* ---------- Sidebar ---------- */
.sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 18px 14px 14px;
  border-right: 1px solid var(--line);
  background: var(--surface);
}
.sidebar-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 6px 20px; }
.sidebar-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }

.new-conversation {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 600;
  transition: background .18s, border-color .18s, transform .18s var(--ease);
}
.new-conversation:hover { background: rgba(201, 164, 95, 0.16); border-color: rgba(201, 164, 95, 0.45); }
.new-conversation:active { transform: scale(.985); }
.new-conversation:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.new-conversation .icon { width: 15px; height: 15px; }
.new-conversation kbd { margin-left: auto; border-color: var(--accent-line); color: var(--accent); background: transparent; }

.search {
  position: relative;
  display: flex;
  align-items: center;
  margin: 12px 0 14px;
}
.search .icon { position: absolute; left: 11px; width: 14px; height: 14px; color: var(--faint); pointer-events: none; }
.search input {
  width: 100%;
  height: 36px;
  padding: 0 52px 0 33px;
  border: 1px solid var(--line);
  border-radius: 10px;
  outline: 0;
  background: rgba(255, 255, 255, 0.025);
  color: var(--ink);
  font-size: 13px;
  transition: border-color .18s, background .18s, box-shadow .18s;
}
.search input::placeholder { color: var(--faint); }
.search input::-webkit-search-cancel-button { display: none; }
.search input:focus-visible { border-color: var(--accent-line); background: rgba(255, 255, 255, 0.04); box-shadow: 0 0 0 3px var(--accent-soft); }
.search kbd { position: absolute; right: 9px; pointer-events: none; }

.conversation-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 -6px;
  padding: 2px 6px 16px;
  overscroll-behavior: contain;
}
/* Every group/item keeps its natural height; only the list scrolls. */
.conversation-list > * { flex: 0 0 auto; }
.conversation-group { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; }
.group-label {
  margin: 0 0 5px;
  padding: 0 10px;
  color: var(--faint);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.conversation-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 8px 10px 8px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  transition: background .15s, color .15s;
}
.conversation-item:hover { background: rgba(255, 255, 255, 0.04); color: var(--ink); }
.conversation-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.conversation-item[aria-current="true"] { background: var(--raised-2); color: var(--ink); font-weight: 550; }
.conversation-item[aria-current="true"]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}
/* Titles get up to two lines before truncating, so long names stay readable. */
.conversation-title {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.conversation-time { flex-shrink: 0; align-self: flex-start; padding-top: 1px; color: var(--faint); font-size: 11px; font-weight: 450; line-height: 18px; font-variant-numeric: tabular-nums; }
.conversation-list-empty { margin: 0; padding: 10px; color: var(--muted); font-size: 12.5px; line-height: 1.5; }

.sidebar-footer {
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 4px 0;
  border-top: 1px solid var(--line);
}
.sidebar-status { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 4px; color: var(--muted); font-size: 12px; }
.status-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--online); box-shadow: 0 0 0 3px rgba(98, 192, 140, 0.14); }
.ghost-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 550;
  transition: background .15s, color .15s, border-color .15s;
}
.ghost-button:hover { background: rgba(255, 255, 255, 0.045); color: var(--ink); }
.ghost-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ghost-button .icon { width: 14px; height: 14px; }

.icon-button {
  width: 36px;
  height: 36px;
  display: none;
  place-items: center;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--ink-soft);
  transition: background .15s, color .15s;
}
.icon-button:hover { background: rgba(255, 255, 255, 0.05); color: var(--ink); }
.icon-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.icon-button .icon { width: 17px; height: 17px; }
.scrim { display: none; }

/* ---------- Stage ---------- */
.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: radial-gradient(ellipse 55% 32% at 50% 0%, rgba(201, 164, 95, 0.045), transparent 70%), var(--bg);
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 60px;
  padding: 10px clamp(18px, 4vw, 40px);
  border-bottom: 1px solid var(--line);
}
.topbar-meta { min-width: 0; flex: 1; display: grid; gap: 2px; }
.topbar-title { margin: 0; overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
#active-project { overflow: hidden; color: var(--muted); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
#active-project:empty { display: none; }

.conversation { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; overflow: hidden; }

.messages { min-height: 0; display: flex; flex-direction: column; overflow-y: auto; padding: 36px clamp(18px, 5vw, 56px) 28px; scroll-behavior: smooth; overscroll-behavior: contain; }

/* ---------- Messages ---------- */
.message { width: 100%; max-width: 760px; margin: 0 auto 26px; display: grid; gap: 6px; }
.message.is-new { animation: rise .32s var(--ease) both; }
.message-header { display: flex; align-items: center; min-width: 0; }
.message-label { color: var(--faint); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; }
.message-actions { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; line-height: 1; min-height: 20px; }
.message-time { font-variant-numeric: tabular-nums; }
.copy-message {
  display: grid; place-items: center; width: 22px; height: 22px; border: 0; padding: 0; border-radius: 5px; background: transparent; color: var(--muted);
  font-size: 15px; line-height: 1; opacity: 1; transition: color .16s, background .16s, opacity .16s;
}
.copy-message:hover, .copy-message:focus-visible { color: var(--accent-strong); background: var(--accent-soft); opacity: 1; outline: 0; }
.copy-message.copied { color: var(--online); opacity: 1; }

.message.user { justify-items: end; }
.message.user .message-header, .message.user .message-actions { justify-content: flex-end; padding-right: 4px; }
.message.user .bubble {
  max-width: min(84%, 600px);
  padding: 11px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 18px 18px 6px 18px;
  background: linear-gradient(180deg, var(--raised-2), var(--raised));
  color: var(--ink);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.message.sebastian { grid-template-columns: 32px minmax(0, 1fr); column-gap: 14px; row-gap: 4px; align-items: start; }
.message.sebastian::before {
  content: "S";
  grid-row: 1 / span 2;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-line);
  border-radius: 50%;
  background: radial-gradient(circle at 30% 25%, rgba(224, 192, 132, 0.2), rgba(201, 164, 95, 0.03) 70%);
  color: var(--accent-strong);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
}
.message.sebastian .message-label { padding-top: 7px; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; font-size: 10.5px; font-weight: 700; }
.message.sebastian .message-header { padding-top: 5px; }
.message.sebastian .message-actions { grid-column: 2; }
.message.sebastian.error::before { border-color: var(--danger-line); background: rgba(227, 134, 146, 0.06); color: var(--danger); }
.message.sebastian.error .message-label { color: var(--danger); }

.bubble { min-width: 0; font-size: 15px; line-height: 1.72; white-space: pre-wrap; overflow-wrap: anywhere; }
.message.sebastian .bubble { color: var(--ink); }
.message.error .bubble { padding: 11px 14px; border: 1px solid var(--danger-line); border-left: 2px solid var(--danger); border-radius: 10px; background: rgba(227, 134, 146, 0.05); color: var(--danger); font-size: 14px; }

.thinking .bubble { display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
.dots { display: inline-flex; gap: 4px; }
.dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); animation: blink 1.2s infinite var(--ease); }
.dots span:nth-child(2) { animation-delay: .15s; }
.dots span:nth-child(3) { animation-delay: .3s; }

/* ---------- Welcome ---------- */
.empty-state {
  flex: 1;
  width: 100%;
  max-width: 640px;
  min-height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  padding: 24px 0 8px;
  animation: rise .5s var(--ease) both;
}
.welcome-date { margin: 22px 0 6px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
.welcome-title { margin: 0; font-family: var(--font-display); font-size: clamp(32px, 4.4vw, 44px); font-weight: 500; letter-spacing: -0.015em; line-height: 1.1; color: var(--ink); }
.welcome-copy { margin: 14px 0 0; max-width: 520px; color: var(--muted); font-size: 15px; line-height: 1.65; }
.welcome-prompts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
.prompt-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--ink-soft);
  font-size: 13px;
  transition: border-color .18s, background .18s, color .18s, transform .18s var(--ease);
}
.prompt-chip::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: .7; }
.prompt-chip:hover { border-color: var(--accent-line); background: var(--accent-soft); color: var(--ink); transform: translateY(-1px); }
.prompt-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---------- Composer ---------- */
.composer-wrap { position: relative; padding: 0 clamp(18px, 5vw, 56px) 18px; }
.composer-wrap::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -32px;
  height: 32px;
  background: linear-gradient(to top, var(--bg), rgba(11, 12, 15, 0));
  pointer-events: none;
}
.composer {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 10px 10px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, var(--raised), var(--surface));
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.035);
  transition: border-color .2s, box-shadow .2s;
}
.composer:focus-within { border-color: var(--accent-line); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35), 0 0 0 4px var(--accent-soft), inset 0 1px 0 rgba(255, 255, 255, 0.035); }
textarea {
  flex: 1;
  min-width: 0;
  width: 100%;
  min-height: 24px;
  max-height: 200px;
  resize: none;
  padding: 9px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  line-height: 1.55;
  font-size: 15px;
}
textarea::placeholder { color: var(--faint); }
textarea:disabled { cursor: not-allowed; }
.send {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(180deg, var(--accent-strong), var(--accent));
  color: var(--accent-ink);
  box-shadow: 0 6px 18px rgba(201, 164, 95, 0.22);
  transition: transform .18s var(--ease), opacity .18s, box-shadow .18s;
}
.send .icon { width: 17px; height: 17px; }
.send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(201, 164, 95, 0.3); }
.send:active:not(:disabled) { transform: scale(.96); }
.send:disabled { cursor: not-allowed; opacity: .35; box-shadow: none; transform: none; }
.send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hint { max-width: 760px; margin: 10px auto 0; display: flex; justify-content: center; gap: 6px; color: var(--faint); font-size: 11.5px; }

/* ---------- Motion ---------- */
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes blink { 0%, 80%, 100% { opacity: .2; transform: scale(.85); } 40% { opacity: 1; transform: none; } }

/* ---------- Tablet ---------- */
@media (max-width: 1080px) {
  .workspace { grid-template-columns: 252px minmax(0, 1fr); }
}

/* ---------- Mobile: sidebar becomes an off-canvas drawer ---------- */
@media (max-width: 760px) {
  .workspace { width: 100%; max-width: 100vw; grid-template-columns: minmax(0, 1fr); }
  .stage { grid-template-rows: auto minmax(0, 1fr); }
  .conversation, .stage, .composer-wrap, .composer, .messages { min-width: 0; max-width: 100%; }
  .sidebar {
    position: fixed;
    z-index: 40;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(86vw, 320px);
    padding-top: max(18px, env(safe-area-inset-top));
    padding-bottom: max(14px, env(safe-area-inset-bottom));
    border-right: 1px solid var(--line-strong);
    box-shadow: 30px 0 80px rgba(0, 0, 0, 0.55);
    transform: translateX(-104%);
    visibility: hidden;
    transition: transform .3s var(--ease), visibility 0s linear .3s;
  }
  /* The list stays hidden while the drawer is closed and appears only inside the open drawer. */
  .conversation-list { display: none; }
  .workspace.drawer-open .conversation-list { display: flex; }
  .workspace.drawer-open .sidebar { transform: none; visibility: visible; transition: transform .3s var(--ease), visibility 0s; }
  .scrim {
    display: block;
    position: fixed;
    z-index: 30;
    inset: 0;
    border: 0;
    background: rgba(5, 6, 8, 0.6);
    opacity: 0;
    pointer-events: none;
    transition: opacity .3s var(--ease);
  }
  .workspace.drawer-open .scrim { opacity: 1; pointer-events: auto; }
  .icon-button { display: grid; }
  .search kbd, .new-conversation kbd { display: none; }
  .topbar { min-height: 56px; padding: 8px 12px; padding-top: max(8px, env(safe-area-inset-top)); gap: 10px; }
  .topbar-meta { text-align: center; }
  .messages { padding: 22px 16px 20px; }
  .message { max-width: 100%; margin-bottom: 22px; }
  .message.user .bubble { max-width: 88%; }
  .message.sebastian { grid-template-columns: 28px minmax(0, 1fr); column-gap: 11px; }
  .message.sebastian::before { width: 28px; height: 28px; font-size: 13px; }
  .message.sebastian .message-label { padding-top: 5px; }
  .message-actions { gap: 5px; }
  .copy-message { width: 26px; height: 26px; }
  .bubble { font-size: 15px; line-height: 1.68; }
  .empty-state { padding: 12px 4px; }
  .welcome-copy { font-size: 14.5px; }
  .composer-wrap { padding: 0 12px max(12px, env(safe-area-inset-bottom)); }
  .composer { padding: 8px 8px 8px 15px; border-radius: 18px; }
  textarea { font-size: 16px; }
  .hint { display: none; }
  .unlock-card { padding: 32px 22px 26px; border-radius: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;

export const SEBASTIAN_WEB_SCRIPT = String.raw`
(() => {
  'use strict';
  const unlock = document.querySelector('#unlock');
  const chat = document.querySelector('#chat');
  const unlockForm = document.querySelector('#unlock-form');
  const tokenInput = document.querySelector('#access-token');
  const rememberDeviceInput = document.querySelector('#remember-device');
  const unlockError = document.querySelector('#unlock-error');
  const form = document.querySelector('#composer-form');
  const input = document.querySelector('#message-input');
  const send = document.querySelector('#send-button');
  const messages = document.querySelector('#messages');
  const conversation = document.querySelector('.conversation');
  const conversationList = document.querySelector('#conversation-list');
  const newConversationButton = document.querySelector('#new-conversation-button');
  const topbarNewButton = document.querySelector('#topbar-new-button');
  const logoutButton = document.querySelector('#logout-button');
  const searchInput = document.querySelector('#conversation-search');
  const topbarTitle = document.querySelector('#topbar-title');
  const drawerToggle = document.querySelector('#drawer-toggle');
  const drawerScrim = document.querySelector('#drawer-scrim');
  let pending = false;
  let activeConversationId = null;
  let switchingConversation = false;
  let knownConversations = [];
  let animateMessages = true;
  let drawerOpen = false;
  const projectLabel = document.querySelector('#active-project');
  const TASK_STATUS_LABEL = {
    analyzing: 'analisando',
    writing: 'executando alteração',
    awaitingHomologation: 'aguardando sua homologação',
    completed: 'concluída',
    failed: 'falhou'
  };
  const showProject = (project, task) => {
    if (!projectLabel) return;
    if (!project) { projectLabel.textContent = ''; return; }
    let text = 'Projeto: ' + project.displayName + (project.policyStatus === 'loaded' ? '' : ' — regras indisponíveis neste ambiente');
    if (task) {
      const label = TASK_STATUS_LABEL[task.status] || task.status;
      text += ' · Tarefa: ' + label + (task.filesChanged && task.filesChanged.length ? ' (' + task.filesChanged.length + ' arquivo(s) alterado(s))' : '');
    }
    projectLabel.textContent = text;
  };

  // ---------- Mobile drawer (purely presentational) ----------
  const setDrawer = (open) => {
    drawerOpen = open;
    if (open) chat.classList.add('drawer-open');
    else chat.classList.remove('drawer-open');
    if (drawerToggle) drawerToggle.setAttribute('aria-expanded', String(open));
  };
  if (drawerToggle) drawerToggle.addEventListener('click', () => setDrawer(!drawerOpen));
  if (drawerScrim) drawerScrim.addEventListener('click', () => setDrawer(false));

  const showChat = () => {
    unlock.classList.add('hidden');
    chat.classList.remove('hidden');
    input.focus();
  };

  const showUnlock = (message = '') => {
    setDrawer(false);
    chat.classList.add('hidden');
    unlock.classList.remove('hidden');
    unlockError.textContent = message;
    tokenInput.value = '';
    tokenInput.focus();
  };

  // ---------- Welcome screen ----------
  const greeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Bom dia.';
    if (hour >= 12 && hour < 18) return 'Boa tarde.';
    return 'Boa noite.';
  };

  const todayLabel = () => {
    try {
      const text = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      return text.charAt(0).toUpperCase() + text.slice(1);
    } catch {
      return '';
    }
  };

  // Shortcuts only pre-fill the composer; the user still reviews and sends.
  const WELCOME_PROMPTS = [
    { label: 'Guardar algo na memória', text: 'Guarde na sua memória que ' },
    { label: 'O que você lembra sobre mim?', text: 'O que você lembra sobre mim?' },
    { label: 'Organizar meu dia', text: 'Me ajude a organizar as prioridades do meu dia.' }
  ];

  const buildEmptyState = () => {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.id = 'empty-state';
    const mark = document.createElement('span');
    mark.className = 'mark mark-lg';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'S';
    const date = document.createElement('p');
    date.className = 'welcome-date';
    date.textContent = todayLabel();
    const heading = document.createElement('h1');
    heading.className = 'welcome-title';
    heading.textContent = greeting();
    const copy = document.createElement('p');
    copy.className = 'welcome-copy';
    copy.textContent = 'Estou online e pronto para conversar. Fale sobre qualquer assunto, peça para eu guardar algo na memória ou retome uma conversa pela lista de conversas.';
    const prompts = document.createElement('div');
    prompts.className = 'welcome-prompts';
    for (const prompt of WELCOME_PROMPTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'prompt-chip';
      chip.textContent = prompt.label;
      chip.addEventListener('click', () => {
        if (input.disabled) return;
        input.value = prompt.text;
        resizeInput();
        input.focus();
      });
      prompts.append(chip);
    }
    wrap.append(mark, date, heading, copy, prompts);
    return wrap;
  };

  const clearEmptyState = () => {
    const existing = document.querySelector('#empty-state');
    if (existing) existing.remove();
  };

  const formatMessageHour = (sentAt) => {
    try {
      return new Date(sentAt || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch { return ''; }
  };

  const copyMessageText = async (text, button) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.append(fallback);
        fallback.select();
        if (!document.execCommand || !document.execCommand('copy')) throw new Error('copy unavailable');
        fallback.remove();
      }
      button.textContent = 'Copiado!';
      button.classList.add('copied');
      setTimeout(() => { button.textContent = '⧉'; button.classList.remove('copied'); }, 1600);
    } catch {
      button.textContent = 'Não copiou';
      setTimeout(() => { button.textContent = '⧉'; }, 1600);
    }
  };

  const appendMessage = (role, text, extraClass = '', sentAt) => {
    clearEmptyState();
    const article = document.createElement('article');
    article.className = ['message', role, extraClass, animateMessages ? 'is-new' : ''].filter(Boolean).join(' ');
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = extraClass === 'error' ? 'Não foi possível concluir' : role === 'user' ? 'Você' : 'Sebastian';
    const header = document.createElement('div');
    header.className = 'message-header';
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = formatMessageHour(sentAt);
    actions.append(time);
    if (extraClass !== 'thinking') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy-message';
      copy.textContent = '⧉';
      copy.setAttribute('aria-label', 'Copiar mensagem completa');
      copy.addEventListener('click', () => { void copyMessageText(text, copy); });
      actions.append(copy);
    }
    header.append(label);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    article.append(header, bubble, actions);
    if (extraClass === 'thinking') {
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
      bubble.append(dots);
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
    // A reopened history renders at once, without per-message entrance motion.
    animateMessages = false;
    try {
      for (const turn of turns) {
        appendMessage(turn.role === 'user' ? 'user' : 'sebastian', turn.content, '', turn.sentAt);
      }
    } finally {
      animateMessages = true;
    }
  };

  // ---------- Sidebar: search + grouping by period ----------
  const PERIOD_LABELS = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 30 dias', 'Anteriores'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  const conversationTimestamp = (item) => {
    const value = Date.parse(item.lastActivityAt || item.createdAt || '');
    return Number.isFinite(value) ? value : null;
  };

  const periodIndex = (timestamp, now) => {
    if (timestamp === null) return PERIOD_LABELS.length - 1;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (timestamp >= startOfToday) return 0;
    if (timestamp >= startOfToday - DAY_MS) return 1;
    if (timestamp >= startOfToday - 6 * DAY_MS) return 2;
    if (timestamp >= startOfToday - 29 * DAY_MS) return 3;
    return 4;
  };

  const timeLabel = (timestamp, period) => {
    if (timestamp === null) return '';
    try {
      const date = new Date(timestamp);
      return period <= 1
        ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    } catch {
      return '';
    }
  };

  const normalizeText = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const updateTopbarTitle = () => {
    if (!topbarTitle) return;
    const current = knownConversations.find((item) => item.id === activeConversationId);
    topbarTitle.textContent = current && current.title ? current.title : 'Nova conversa';
  };

  const renderEmptyList = (text) => {
    const empty = document.createElement('p');
    empty.className = 'conversation-list-empty';
    empty.textContent = text;
    conversationList.append(empty);
  };

  const renderVisibleConversations = () => {
    if (!conversationList) return;
    conversationList.innerHTML = '';
    updateTopbarTitle();
    if (knownConversations.length === 0) {
      renderEmptyList('Nenhuma conversa ainda.');
      return;
    }
    const query = normalizeText(searchInput ? searchInput.value : '').trim();
    const visible = query === '' ? knownConversations : knownConversations.filter((item) => normalizeText(item.title).includes(query));
    if (visible.length === 0) {
      renderEmptyList('Nenhuma conversa encontrada.');
      return;
    }
    const now = new Date();
    const groups = PERIOD_LABELS.map(() => []);
    for (const item of visible) {
      const timestamp = conversationTimestamp(item);
      const period = periodIndex(timestamp, now);
      groups[period].push({ item, timestamp, period });
    }
    groups.forEach((entries, index) => {
      if (entries.length === 0) return;
      const section = document.createElement('section');
      section.className = 'conversation-group';
      const heading = document.createElement('h2');
      heading.className = 'group-label';
      heading.textContent = PERIOD_LABELS[index];
      section.append(heading);
      for (const { item, timestamp, period } of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'conversation-item';
        button.title = item.title;
        const title = document.createElement('span');
        title.className = 'conversation-title';
        title.textContent = item.title;
        const time = document.createElement('span');
        time.className = 'conversation-time';
        time.textContent = timeLabel(timestamp, period);
        button.append(title, time);
        button.dataset.conversationId = item.id;
        button.setAttribute('aria-current', String(item.id === activeConversationId));
        button.addEventListener('click', () => {
          if (pending || item.id === activeConversationId) { setDrawer(false); return; }
          setDrawer(false);
          void openConversation(item.id);
        });
        section.append(button);
      }
      conversationList.append(section);
    });
  };

  const renderConversationList = (conversations) => {
    knownConversations = Array.isArray(conversations) ? conversations : [];
    renderVisibleConversations();
  };

  if (searchInput) {
    searchInput.addEventListener('input', () => renderVisibleConversations());
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchInput.value = '';
        renderVisibleConversations();
        input.focus();
      }
    });
  }

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

  // Which conversation is open is reflected only in the URL (?c=<id>) -
  // never in any browser-side storage API, per this interface's homologated
  // contract that no client-side storage of any kind holds session/app
  // state. The query string survives a same-tab reload but not closing the
  // browser and opening a fresh tab, which is exactly the distinction
  // "reload stays in the same conversation" vs "a new entry starts a new
  // chat" needs.
  const CONVERSATION_QUERY_PARAM = 'c';

  const readConversationIdFromUrl = () => {
    const id = new URLSearchParams(window.location.search).get(CONVERSATION_QUERY_PARAM);
    return id && id.trim() !== '' ? id : null;
  };

  const syncConversationIdToUrl = (id) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set(CONVERSATION_QUERY_PARAM, id);
    } else {
      url.searchParams.delete(CONVERSATION_QUERY_PARAM);
    }
    window.history.replaceState(null, '', url);
  };

  const openConversation = async (id) => {
    if (switchingConversation) return false;
    switchingConversation = true;
    activeConversationId = null;
    input.disabled = true;
    send.disabled = true;
    showProject(null);
    try {
      const response = await fetch('/api/web/conversations/' + encodeURIComponent(id), {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) { appendMessage('sebastian', 'Não foi possível reabrir a conversa. Tente novamente ou crie uma nova.', 'error'); return false; }
      const body = await response.json();
      activeConversationId = id;
      syncConversationIdToUrl(id);
      showConversationMessages(body.messages);
      showProject(body.project, body.task);
      input.value = '';
      input.style.height = 'auto';
      input.focus();
      await refreshConversationList();
      return true;
    } catch {
      appendMessage('sebastian', 'Não foi possível reabrir a conversa. Tente novamente ou crie uma nova.', 'error');
      return false;
    } finally {
      switchingConversation = false;
      input.disabled = !activeConversationId;
      send.disabled = !activeConversationId;
    }
  };

  const createConversation = async () => {
    if (switchingConversation) return;
    switchingConversation = true;
    input.disabled = true;
    send.disabled = true;
    activeConversationId = null;
    syncConversationIdToUrl(null);
    showProject(null);
    try {
      const response = await fetch('/api/web/conversations', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('create failed');
      const body = await response.json();
      activeConversationId = body.conversation.id;
      syncConversationIdToUrl(activeConversationId);
      showConversationMessages([]);
      input.value = '';
      input.style.height = 'auto';
      input.focus();
      await refreshConversationList();
    } catch {
      appendMessage('sebastian', 'Não foi possível criar uma nova conversa. Clique em Nova conversa para tentar novamente. Nenhuma mensagem será enviada à conversa anterior.', 'error');
    } finally {
      switchingConversation = false;
      input.disabled = !activeConversationId;
      send.disabled = !activeConversationId;
    }
  };

  // A fresh entry (login, or opening the app with no conversation in the
  // URL) always starts a new chat; it deliberately never falls back to the
  // most recently active conversation just because one exists.
  const restoreActiveConversation = async () => {
    const requestedId = readConversationIdFromUrl();
    if (requestedId) {
      if (!(await openConversation(requestedId))) { activeConversationId = null; input.disabled = true; send.disabled = true; }
      return;
    }
    await createConversation();
  };

  const startNewConversation = () => {
    if (pending) return;
    setDrawer(false);
    void createConversation();
  };
  if (newConversationButton) newConversationButton.addEventListener('click', startNewConversation);
  if (topbarNewButton) topbarNewButton.addEventListener('click', startNewConversation);

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (pending) return;
      try {
        await fetch('/api/web/session', { method: 'DELETE', credentials: 'same-origin' });
      } finally {
        syncConversationIdToUrl(null);
        showUnlock('Sessão encerrada com segurança.');
      }
    });
  }

  // Keyboard: Ctrl/Cmd+K focuses the search, Escape closes the mobile drawer.
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k' && searchInput && !chat.classList.contains('hidden')) {
        event.preventDefault();
        setDrawer(true);
        searchInput.focus();
        if (typeof searchInput.select === 'function') searchInput.select();
      } else if (event.key === 'Escape' && drawerOpen) {
        setDrawer(false);
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
        await restoreActiveConversation();
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
      const remember = rememberDeviceInput ? rememberDeviceInput.checked : true;
      const response = await fetch('/api/web/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, remember })
      });
      tokenInput.value = '';
      if (!response.ok) {
        unlockError.textContent = await parseError(response, 'Acesso não autorizado.');
        return;
      }
      showChat();
      // A successful login is always a new entry into the system, never a
      // reload - it must open a fresh chat even if the address bar still
      // carries a conversation id from an earlier session in this tab.
      await createConversation();
    } catch {
      tokenInput.value = '';
      unlockError.textContent = 'Não foi possível estabelecer uma sessão segura.';
    } finally {
      button.disabled = false;
    }
  });

  const resizeInput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  };
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || pending || switchingConversation || !activeConversationId) return;
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
          syncConversationIdToUrl(null);
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
      showProject(body.project, body.task);
      void refreshConversationList();
    } catch (error) {
      thinking.remove();
      // The server may have finished and persisted the answer after the browser
      // lost its response. Recover the saved conversation before claiming failure.
      let recovered = false;
      try {
        const history = await fetch('/api/web/conversations/' + encodeURIComponent(activeConversationId), {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (history.ok) {
          const saved = await history.json();
          const turns = Array.isArray(saved.messages) ? saved.messages : [];
          const last = turns[turns.length - 1];
          const previous = turns[turns.length - 2];
          if (previous && previous.role === 'user' && previous.content === message && last && last.role !== 'user' && typeof last.content === 'string') {
            showConversationMessages(turns);
            showProject(saved.project, saved.task);
            recovered = true;
          }
        }
      } catch {
        // History recovery is best-effort; do not send the same message twice.
      }
      if (!recovered) {
        input.value = message;
        resizeInput();
        appendMessage('sebastian', 'Não foi possível confirmar a entrega da resposta. Sua mensagem foi mantida para tentar novamente; confira o histórico antes de reenviar.', 'error');
      }
      console.warn('Conversation response interrupted; history recovery:', recovered ? 'restored' : 'unavailable', error instanceof Error ? error.name : 'unknown');
    } finally {
      pending = false;
      conversation.removeAttribute('aria-busy');
      input.disabled = !activeConversationId;
      send.disabled = !activeConversationId;
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b0c0f">
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
          <span class="wordmark">Sebastian<span class="accent">IA</span></span>
        </div>
        <p class="eyebrow">Acesso privado</p>
        <h1 id="unlock-title">Bem-vindo de volta</h1>
        <p class="unlock-copy">Informe sua chave de acesso para abrir uma sessão segura neste navegador.</p>
        <form class="unlock-form" id="unlock-form">
          <label class="field-label" for="access-token">Chave de acesso</label>
          <input id="access-token" type="password" autocomplete="current-password" required placeholder="Informe sua chave">
          <label class="remember-device" for="remember-device">
            <input id="remember-device" type="checkbox" checked>
            <span>Manter-me conectado neste dispositivo</span>
          </label>
          <button class="unlock-submit" type="submit">Acessar</button>
          <p class="unlock-error" id="unlock-error" role="alert"></p>
        </form>
        <p class="unlock-foot">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 9V7a4 4 0 1 1 8 0v2M5 9h10v8H5z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg>
          <span>Sessão protegida por cookie seguro. Sua chave não fica salva no navegador.</span>
        </p>
      </div>
    </section>

    <div class="workspace hidden" id="chat">
      <aside class="sidebar" id="sidebar" aria-label="Conversas do Sebastian">
        <div class="sidebar-head">
          <div class="sidebar-brand">
            <span class="mark" aria-hidden="true">S</span>
            <span class="wordmark">Sebastian<span class="accent">IA</span></span>
          </div>
        </div>
        <button class="new-conversation" id="new-conversation-button" type="button">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <span>Nova conversa</span>
        </button>
        <label class="search" for="conversation-search">
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M13.2 13.2 17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input id="conversation-search" type="search" autocomplete="off" spellcheck="false" placeholder="Buscar conversas" aria-label="Buscar conversas">
          <kbd>Ctrl K</kbd>
        </label>
        <nav class="conversation-list" id="conversation-list" aria-label="Conversas recentes"></nav>
        <div class="sidebar-footer">
          <div class="sidebar-status">
            <span class="status-dot" aria-hidden="true"></span>
            <span>Online</span>
          </div>
          <button class="ghost-button" id="logout-button" type="button">
            <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5v12h3M12 6l4 4-4 4M16 10H8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Sair</span>
          </button>
        </div>
      </aside>
      <button class="scrim" id="drawer-scrim" type="button" tabindex="-1" aria-label="Fechar lista de conversas"></button>
      <div class="stage">
        <header class="topbar">
          <button class="icon-button" id="drawer-toggle" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Abrir lista de conversas">
            <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M3.5 10h13M3.5 14h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
          <div class="topbar-meta">
            <p class="topbar-title" id="topbar-title">Nova conversa</p>
            <div id="active-project" role="status"></div>
          </div>
          <button class="icon-button" id="topbar-new-button" type="button" aria-label="Nova conversa">
            <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </button>
        </header>
        <main class="conversation" aria-label="Conversa com Sebastian">
          <div class="messages" id="messages" aria-live="polite">
            <div class="empty-state" id="empty-state">
              <span class="mark mark-lg" aria-hidden="true">S</span>
              <h1 class="welcome-title">Olá.</h1>
              <p class="welcome-copy">Estou online e pronto para conversar.</p>
            </div>
          </div>
          <div class="composer-wrap">
            <form class="composer" id="composer-form">
              <textarea id="message-input" maxlength="4000" rows="1" required aria-label="Mensagem para Sebastian" placeholder="Escreva para Sebastian..."></textarea>
              <button class="send" id="send-button" type="submit" aria-label="Enviar mensagem">
                <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
              </button>
            </form>
            <p class="hint"><kbd>Enter</kbd> envia <span aria-hidden="true">·</span> <kbd>Shift</kbd> + <kbd>Enter</kbd> nova linha</p>
          </div>
        </main>
      </div>
    </div>
  </div>
  <script src="/assets/sebastian.js" defer></script>
</body>
</html>`;
