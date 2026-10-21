/**
 * Sebastian Studio web interface (/studio): write a story, pick style, duration
 * and format, generate and watch/download the MP4.
 *
 * The page only talks to same-origin endpoints:
 * - GET/POST /api/web/session - the existing device-session contract (unlock).
 * - POST /api/studio/render { plan } -> 201 { ok, fileName, downloadUrl } -
 *   the render engine endpoint, owned by the renderer work. While it is not
 *   deployed the page reports the engine as unavailable instead of failing.
 *
 * The plan is built client-side so it conforms to studio/VideoProductionPlan.ts
 * (validated again by the server). Rendering is local: estimated cost is US$ 0.
 */

/** Same policy as the main web interface plus media-src so the rendered MP4 can play inline. */
export const STUDIO_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export const STUDIO_DURATION_OPTIONS_SECONDS = [15, 30, 60, 90, 120, 180] as const;
export const STUDIO_MAX_TITLE_LENGTH = 90;
export const STUDIO_MAX_STORY_LENGTH = 4000;

/**
 * Pure plan builder shared by the browser script and the tests. Plain ES5-style
 * JavaScript on purpose: it is shipped verbatim to the browser.
 */
export const STUDIO_PLAN_BUILDER_SOURCE = String.raw`
function buildStudioPlan(input) {
  var STYLES = {
    '3d_cartoon': 'Animação 3D estilo cartoon',
    cinematic: 'Animação 3D cinematográfica',
    anime: 'Animação 3D estilo anime'
  };
  var FORMATS = ['9:16', '16:9', '1:1'];
  var DURATIONS = [${STUDIO_DURATION_OPTIONS_SECONDS.join(', ')}];
  var MIN_SCENE_SECONDS = 3;
  var MAX_SCENES = 20;
  function fail(message) { var error = new Error(message); error.name = 'StudioInputError'; throw error; }
  function clean(text) { return String(text).replace(/\s+/g, ' ').trim(); }

  var title = clean(input && input.title || '');
  var story = String(input && input.story || '').replace(/\r\n?/g, '\n').trim();
  var style = input && input.style;
  var format = input && input.format;
  var duration = Number(input && input.durationSeconds);
  if (!title) fail('Informe um título para o vídeo.');
  if (title.length > ${STUDIO_MAX_TITLE_LENGTH}) fail('O título pode ter no máximo ${STUDIO_MAX_TITLE_LENGTH} caracteres.');
  if (!story) fail('Escreva a história que será animada.');
  if (story.length > ${STUDIO_MAX_STORY_LENGTH}) fail('A história pode ter no máximo ${STUDIO_MAX_STORY_LENGTH} caracteres.');
  if (!Object.prototype.hasOwnProperty.call(STYLES, style)) fail('Escolha um estilo de animação válido.');
  if (FORMATS.indexOf(format) === -1) fail('Escolha um formato válido.');
  if (DURATIONS.indexOf(duration) === -1) fail('Escolha uma duração válida.');

  // One scene per paragraph; a single paragraph is split by sentence.
  var blocks = story.split(/\n\s*\n/).map(clean).filter(Boolean);
  if (blocks.length === 1) {
    var sentences = (blocks[0].match(/[^.!?…]+(?:[.!?…]+|$)/g) || []).map(clean).filter(Boolean);
    if (sentences.length > 1) blocks = sentences;
  }
  // Never drop text: contiguous blocks are merged when there are more than the duration allows.
  var count = Math.min(blocks.length, MAX_SCENES, Math.floor(duration / MIN_SCENE_SECONDS));
  var texts = [];
  for (var g = 0; g < count; g++) {
    var start = Math.floor(g * blocks.length / count);
    var end = Math.floor((g + 1) * blocks.length / count);
    texts.push(blocks.slice(start, end).join(' '));
  }

  // Every scene gets the minimum; the rest follows text length (largest remainder), summing exactly.
  var weights = texts.map(function (text) { return text.length; });
  var totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
  var spare = duration - MIN_SCENE_SECONDS * count;
  var seconds = weights.map(function (w) { return MIN_SCENE_SECONDS + Math.floor(spare * w / totalWeight); });
  var remaining = duration - seconds.reduce(function (a, b) { return a + b; }, 0);
  var byRemainder = weights.map(function (w, i) { return { i: i, r: (spare * w / totalWeight) % 1 }; })
    .sort(function (a, b) { return b.r - a.r || a.i - b.i; });
  for (var k = 0; k < remaining; k++) seconds[byRemainder[k % count].i] += 1;

  return {
    title: title,
    format: format,
    style: style,
    language: 'pt-BR',
    durationSeconds: duration,
    characters: [{
      id: 'narrador',
      name: 'Narrador',
      visualDescription: 'Narrador animado em 3D, com aparência consistente em todas as cenas',
      voiceDescription: 'Voz brasileira (pt-BR), clara e expressiva'
    }],
    scenes: texts.map(function (text, i) {
      return {
        id: 'cena-' + (i + 1),
        order: i + 1,
        durationSeconds: seconds[i],
        visualPrompt: STYLES[style] + ': ' + text,
        characterIds: ['narrador'],
        dialogue: [{ characterId: 'narrador', text: text }]
      };
    }),
    status: 'rendering',
    estimatedCostUsd: 0,
    budgetApproved: true
  };
}
`;

export const STUDIO_WEB_STYLES = `:root {
  color-scheme: dark;
  --bg: #0a0b0d;
  --bg-elevated: #111318;
  --bg-input: #0d0f13;
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
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.hidden { display: none !important; }
.accent { color: var(--accent); }
a { color: var(--accent); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.shell { width: min(100%, 1080px); margin: 0 auto; padding: 20px 16px 48px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; text-decoration: none; color: var(--ink); }
.mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--accent); font-weight: 700; }
.link-button { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 6px 4px; text-decoration: none; }
.link-button:hover { color: var(--ink); }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0 0 8px; font-size: clamp(22px, 4vw, 30px); letter-spacing: -0.025em; font-weight: 640; }
.lead { margin: 0 0 24px; color: var(--muted); max-width: 640px; }
.layout { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .layout { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; } .output { position: sticky; top: 20px; } }
.card { background: var(--bg-elevated); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 20px; }
.form { display: grid; gap: 18px; }
.field { display: grid; gap: 7px; min-width: 0; }
.field-label { font-size: 13px; font-weight: 600; }
.field-hint { color: var(--muted); font-size: 12px; }
.field-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
input[type="text"], input[type="password"], textarea, select {
  width: 100%; padding: 11px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--ink); font: inherit; outline: none;
}
textarea { resize: vertical; min-height: 180px; line-height: 1.55; }
input:focus-visible, textarea:focus-visible, select:focus-visible { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.choices { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.choice { position: relative; display: grid; gap: 2px; padding: 11px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); cursor: pointer; background: var(--bg-input); }
.choice input { position: absolute; opacity: 0; pointer-events: none; }
.choice-title { font-weight: 600; font-size: 13px; }
.choice-copy { color: var(--muted); font-size: 12px; }
.choice:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.choice:has(input:focus-visible) { box-shadow: 0 0 0 3px var(--accent-soft); }
.grid-2 { display: grid; gap: 14px; align-items: start; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.choices.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.choices.compact .choice { padding: 9px 10px; }
.summary { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-input); border: 1px dashed var(--line-strong); color: var(--muted); font-size: 12.5px; }
.summary.invalid { border-color: var(--danger-line); color: var(--danger); }
.primary { display: inline-block; text-align: center; text-decoration: none; width: 100%; padding: 13px 16px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: #17130b; font: inherit; font-weight: 650; cursor: pointer; transition: background .15s, transform .15s; }
.primary:hover:not(:disabled) { background: var(--accent-strong); transform: translateY(-1px); }
.primary:disabled { opacity: .5; cursor: not-allowed; }
.primary:focus-visible, .secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.secondary { display: inline-flex; justify-content: center; align-items: center; padding: 11px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: transparent; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.secondary:hover { border-color: var(--accent-line); }
.actions { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 14px; }
.output-title { margin: 0 0 12px; font-size: 15px; font-weight: 620; }
.placeholder { display: grid; place-items: center; min-height: 220px; padding: 20px; text-align: center; color: var(--muted); border: 1px dashed var(--line-strong); border-radius: var(--radius-md); }
.progress { display: grid; gap: 12px; justify-items: center; text-align: center; padding: 28px 12px; }
.spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
.progress-step { margin: 0; font-weight: 600; }
.progress-meta { margin: 0; color: var(--muted); font-size: 12.5px; }
.error-box { padding: 14px; border: 1px solid var(--danger-line); border-radius: var(--radius-md); color: var(--danger); background: rgba(229, 130, 143, 0.06); }
.error-box p { margin: 0; }
.video-frame { display: grid; place-items: center; background: #000; border-radius: var(--radius-md); overflow: hidden; }
.video-frame video { display: block; width: 100%; max-height: 70vh; background: #000; }
.video-meta { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; word-break: break-all; }
.unlock { display: grid; place-items: center; min-height: 60vh; }
.unlock .card { width: min(100%, 400px); }
.unlock form { display: grid; gap: 12px; }
.check { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.form-error { min-height: 16px; margin: 0; color: var(--danger); font-size: 12.5px; }
@media (max-width: 520px) { .card { padding: 16px; } .topbar { margin-bottom: 20px; } }
`;

export const STUDIO_WEB_SCRIPT = `${STUDIO_PLAN_BUILDER_SOURCE}
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const unlockView = $('#studio-unlock');
  const studioView = $('#studio-main');
  const unlockForm = $('#studio-unlock-form');
  const unlockError = $('#studio-unlock-error');
  const logoutButton = $('#studio-logout');
  const form = $('#studio-form');
  const submit = $('#studio-submit');
  const summary = $('#studio-summary');
  const storyCounter = $('#studio-story-count');
  const panels = { idle: $('#studio-idle'), rendering: $('#studio-rendering'), error: $('#studio-error'), done: $('#studio-done') };
  const elapsedText = $('#studio-elapsed');
  const stepText = $('#studio-step');
  const errorText = $('#studio-error-message');
  const video = $('#studio-video');
  const download = $('#studio-download');
  const videoMeta = $('#studio-video-meta');
  const RENDER_PATH = /^\\/api\\/studio\\/renders\\/[A-Za-z0-9._-]+\\.mp4$/;
  const STEPS = ['Montando as cenas da história…', 'Animando as cenas em 3D…', 'Gerando a narração em português…', 'Sincronizando legendas e trilha…', 'Finalizando o MP4…'];
  let timer = null;
  let rendering = false;

  function readInput() {
    const checked = (name) => { const el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; };
    return {
      title: $('#studio-title').value,
      story: $('#studio-story').value,
      style: checked('style'),
      format: checked('format'),
      durationSeconds: Number($('#studio-duration').value),
    };
  }

  function showPanel(name) {
    for (const key of Object.keys(panels)) panels[key].classList.toggle('hidden', key !== name);
  }

  function setLocked(locked, message) {
    unlockView.classList.toggle('hidden', !locked);
    studioView.classList.toggle('hidden', locked);
    logoutButton.classList.toggle('hidden', locked);
    unlockError.textContent = message || '';
    if (locked) $('#studio-token').focus();
  }

  function formatSeconds(total) {
    const m = Math.floor(total / 60), s = total % 60;
    return m > 0 ? m + ' min' + (s ? ' ' + s + ' s' : '') : s + ' s';
  }

  function refreshSummary() {
    const input = readInput();
    storyCounter.textContent = input.story.length + ' / ${STUDIO_MAX_STORY_LENGTH}';
    if (!input.title.trim() && !input.story.trim()) {
      summary.classList.remove('invalid');
      summary.textContent = 'Escreva a história para ver o plano do vídeo.';
      return;
    }
    try {
      const plan = buildStudioPlan(input);
      summary.classList.remove('invalid');
      summary.textContent = plan.scenes.length + (plan.scenes.length === 1 ? ' cena' : ' cenas') + ' · ' + formatSeconds(plan.durationSeconds) + ' · formato ' + plan.format + ' · custo estimado US$ 0,00 (renderização local)';
    } catch (error) {
      summary.classList.add('invalid');
      summary.textContent = error.message;
    }
  }

  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function startTimer() {
    const startedAt = Date.now();
    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      elapsedText.textContent = 'Tempo decorrido: ' + formatSeconds(seconds);
      stepText.textContent = STEPS[Math.min(STEPS.length - 1, Math.floor(seconds / 8))];
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function setBusy(busy) {
    rendering = busy;
    submit.disabled = busy;
    submit.textContent = busy ? 'Gerando vídeo…' : 'Gerar vídeo';
    for (const el of form.querySelectorAll('input, textarea, select')) el.disabled = busy;
  }

  function showError(message) {
    errorText.textContent = message;
    showPanel('error');
  }

  async function readError(response) {
    try {
      const body = await response.json();
      return { code: body && body.error && body.error.code, message: body && body.error && body.error.message };
    } catch { return {}; }
  }

  function describeFailure(status, error) {
    if (status === 404 || status === 405 || status === 501) return 'O motor de renderização ainda não está disponível neste servidor. Tente novamente após a próxima atualização.';
    if (error.code === 'STUDIO_BUSY') return 'O Studio já está renderizando outro vídeo. Aguarde a conclusão e tente novamente.';
    if (error.code === 'STUDIO_UNAVAILABLE') return 'O motor de renderização está indisponível no momento. ' + (error.message || '');
    if (status === 413) return 'A história ficou grande demais para uma única renderização. Reduza o texto e tente novamente.';
    if (status === 400 || status === 415) return 'O plano do vídeo foi recusado: ' + (error.message || 'dados inválidos.');
    if (status === 504) return 'A renderização demorou mais que o permitido. Tente uma duração menor.';
    return error.message || 'Não foi possível gerar o vídeo (erro ' + status + ').';
  }

  function showVideo(downloadUrl, fileName) {
    video.src = downloadUrl;
    download.href = downloadUrl;
    download.setAttribute('download', fileName);
    videoMeta.textContent = fileName;
    showPanel('done');
  }

  async function render(plan) {
    setBusy(true);
    showPanel('rendering');
    startTimer();
    try {
      const response = await fetch('/api/studio/render', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (response.status === 401) { setLocked(true, 'Sua sessão expirou. Entre novamente para gerar o vídeo.'); showPanel('idle'); return; }
      if (!response.ok) { showError(describeFailure(response.status, await readError(response))); return; }
      const body = await response.json().catch(() => ({}));
      const downloadUrl = body && typeof body.downloadUrl === 'string' ? body.downloadUrl : '';
      if (!RENDER_PATH.test(downloadUrl)) { showError('O servidor concluiu a renderização mas não retornou um vídeo válido.'); return; }
      const fileName = typeof body.fileName === 'string' && body.fileName ? body.fileName : downloadUrl.split('/').pop();
      showVideo(downloadUrl, fileName);
    } catch {
      showError('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
    } finally {
      stopTimer();
      setBusy(false);
    }
  }

  form.addEventListener('input', refreshSummary);
  form.addEventListener('change', refreshSummary);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (rendering) return;
    let plan;
    try { plan = buildStudioPlan(readInput()); } catch (error) { showError(error.message); return; }
    void render(plan);
  });
  $('#studio-retry').addEventListener('click', () => { showPanel('idle'); submit.focus(); });
  $('#studio-new').addEventListener('click', () => {
    video.pause(); video.removeAttribute('src'); video.load();
    showPanel('idle');
    $('#studio-title').focus();
  });
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    videoMeta.textContent = 'Não foi possível reproduzir o vídeo neste navegador. Use o botão de download.';
  });

  unlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = unlockForm.querySelector('button');
    button.disabled = true;
    unlockError.textContent = '';
    try {
      const response = await fetch('/api/web/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: $('#studio-token').value, remember: $('#studio-remember').checked }),
      });
      if (!response.ok) { unlockError.textContent = (await readError(response)).message || 'Acesso não autorizado.'; return; }
      $('#studio-token').value = '';
      setLocked(false);
      $('#studio-title').focus();
    } catch {
      unlockError.textContent = 'Não foi possível estabelecer uma sessão segura.';
    } finally {
      button.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    try { await fetch('/api/web/session', { method: 'DELETE', credentials: 'same-origin' }); } catch {}
    setLocked(true);
  });

  (async () => {
    refreshSummary();
    try {
      const response = await fetch('/api/web/session', { credentials: 'same-origin' });
      const body = await response.json();
      setLocked(!(body && body.authenticated === true));
    } catch {
      setLocked(true, 'Não foi possível verificar a sessão. Verifique sua conexão.');
    }
  })();
})();
`;

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${seconds} segundos`;
  if (rest !== 0) return `${minutes} min e ${rest} s`;
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

const durationOptions = STUDIO_DURATION_OPTIONS_SECONDS
  .map((seconds) => `<option value="${seconds}"${seconds === 30 ? ' selected' : ''}>${durationLabel(seconds)}</option>`)
  .join('');

export const STUDIO_WEB_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Sebastian Studio</title>
  <link rel="stylesheet" href="/assets/studio.css">
  <script src="/assets/studio.js" defer></script>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/"><span class="mark">S</span><span>Sebastian <span class="accent">Studio</span></span></a>
      <nav>
        <a class="link-button" href="/">Voltar ao Sebastian</a>
        <button class="link-button hidden" id="studio-logout" type="button">Sair</button>
      </nav>
    </header>

    <section class="unlock hidden" id="studio-unlock" aria-labelledby="studio-unlock-title">
      <div class="card">
        <h1 id="studio-unlock-title">Entrar no Studio</h1>
        <p class="lead">Informe sua chave de acesso para abrir uma sessão segura neste navegador.</p>
        <form id="studio-unlock-form">
          <label class="field-label" for="studio-token">Chave de acesso</label>
          <input id="studio-token" type="password" autocomplete="current-password" required>
          <label class="check"><input id="studio-remember" type="checkbox" checked> Manter-me conectado neste dispositivo</label>
          <button class="primary" type="submit">Entrar</button>
          <p class="form-error" id="studio-unlock-error" role="alert"></p>
        </form>
      </div>
    </section>

    <main class="hidden" id="studio-main">
      <p class="eyebrow">Produção local · sem créditos</p>
      <h1>Transforme uma história em animação 3D</h1>
      <p class="lead">Escreva a história, escolha o estilo e a duração. O Sebastian monta as cenas, narra em português, adiciona legendas e entrega o MP4.</p>
      <div class="layout">
        <form class="card form" id="studio-form" novalidate>
          <div class="field">
            <label class="field-label" for="studio-title">Título</label>
            <input id="studio-title" type="text" maxlength="${STUDIO_MAX_TITLE_LENGTH}" placeholder="O robô que entendeu tudo errado" required>
          </div>
          <div class="field">
            <div class="field-row">
              <label class="field-label" for="studio-story">História</label>
              <span class="field-hint" id="studio-story-count" aria-live="polite">0 / ${STUDIO_MAX_STORY_LENGTH}</span>
            </div>
            <textarea id="studio-story" maxlength="${STUDIO_MAX_STORY_LENGTH}" rows="10" required aria-describedby="studio-story-hint" placeholder="Nina pediu ao robô Bolota para arrumar o quarto.&#10;&#10;Bolota empilhou todos os brinquedos até o teto.&#10;&#10;No fim, os dois riram e guardaram tudo juntos."></textarea>
            <span class="field-hint" id="studio-story-hint">Cada parágrafo vira uma cena. Um único parágrafo é dividido por frases.</span>
          </div>
          <fieldset class="field">
            <legend class="field-label">Estilo da animação</legend>
            <div class="choices">
              <label class="choice"><input type="radio" name="style" value="3d_cartoon" checked><span class="choice-title">3D Cartoon</span><span class="choice-copy">Colorido e expressivo</span></label>
              <label class="choice"><input type="radio" name="style" value="cinematic"><span class="choice-title">3D Cinematográfico</span><span class="choice-copy">Luz e câmera de cinema</span></label>
              <label class="choice"><input type="radio" name="style" value="anime"><span class="choice-title">3D Anime</span><span class="choice-copy">Traços inspirados em anime</span></label>
            </div>
          </fieldset>
          <div class="grid-2">
            <div class="field">
              <label class="field-label" for="studio-duration">Duração</label>
              <select id="studio-duration">${durationOptions}</select>
            </div>
            <fieldset class="field">
              <legend class="field-label">Formato</legend>
              <div class="choices compact">
                <label class="choice"><input type="radio" name="format" value="9:16" checked><span class="choice-title">9:16</span><span class="choice-copy">Vertical</span></label>
                <label class="choice"><input type="radio" name="format" value="16:9"><span class="choice-title">16:9</span><span class="choice-copy">Horizontal</span></label>
                <label class="choice"><input type="radio" name="format" value="1:1"><span class="choice-title">1:1</span><span class="choice-copy">Quadrado</span></label>
              </div>
            </fieldset>
          </div>
          <p class="summary" id="studio-summary" aria-live="polite"></p>
          <button class="primary" id="studio-submit" type="submit">Gerar vídeo</button>
        </form>

        <section class="card output" aria-labelledby="studio-output-title" aria-live="polite">
          <h2 class="output-title" id="studio-output-title">Resultado</h2>
          <div id="studio-idle" class="placeholder"><p>O vídeo gerado aparecerá aqui, pronto para assistir e baixar.</p></div>
          <div id="studio-rendering" class="progress hidden" role="status">
            <div class="spinner" aria-hidden="true"></div>
            <p class="progress-step" id="studio-step">Montando as cenas da história…</p>
            <p class="progress-meta" id="studio-elapsed">Tempo decorrido: 0 s</p>
            <p class="progress-meta">A renderização acontece no servidor e pode levar alguns minutos. Mantenha esta página aberta.</p>
          </div>
          <div id="studio-error" class="hidden" role="alert">
            <div class="error-box"><p id="studio-error-message"></p></div>
            <div class="actions"><button class="secondary" id="studio-retry" type="button">Voltar e ajustar</button></div>
          </div>
          <div id="studio-done" class="hidden">
            <div class="video-frame"><video id="studio-video" controls playsinline preload="metadata"></video></div>
            <p class="video-meta" id="studio-video-meta"></p>
            <div class="actions">
              <a class="primary" id="studio-download" href="#" download>Baixar MP4</a>
              <button class="secondary" id="studio-new" type="button">Gerar outro vídeo</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</body>
</html>
`;
