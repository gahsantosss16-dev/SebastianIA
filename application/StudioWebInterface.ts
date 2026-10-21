/**
 * Sebastian Studio web interface (/studio): write a story and its cast, pick a
 * 3D style, duration and format, review the production, generate and
 * watch/download the MP4.
 *
 * The page only talks to same-origin endpoints:
 * - GET/POST/DELETE /api/web/session - the existing device-session contract.
 * - POST /api/studio/render { plan } - the render engine, owned by the
 *   renderer work. Accepted answers:
 *     201/200 { downloadUrl, fileName }     synchronous render (current draft)
 *     202 { statusUrl, stage?, progress? }  long-running job (optional)
 * - GET /api/studio/jobs/<id> -> { status: queued|rendering|completed|failed|cancelled,
 *   stage?, progress? (0..1), downloadUrl?, error? } and DELETE to cancel (optional).
 * - GET /api/studio/status -> { available, engine?, message?, estimatedCostUsd? } (optional).
 * Optional endpoints that are missing (404/405) degrade to the synchronous flow
 * and to an "engine state not reported" notice; nothing here assumes rendering
 * is instantaneous or free forever.
 *
 * The plan is built client-side so it conforms to studio/VideoProductionPlan.ts
 * (validated again by the server).
 */

/** Same policy as the main web interface plus media-src so the rendered MP4 can play inline. */
export const STUDIO_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export const STUDIO_DURATION_OPTIONS_SECONDS = [15, 30, 60, 90, 120, 180] as const;
export const STUDIO_MAX_TITLE_LENGTH = 90;
export const STUDIO_MAX_STORY_LENGTH = 4000;
export const STUDIO_MAX_CHARACTERS = 6;
export const STUDIO_MAX_CHARACTER_NAME_LENGTH = 40;
export const STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH = 200;
/** Must match MAX_HTTP_BODY_BYTES in SebastianHttpServer.ts (not imported: that module imports this one). */
export const STUDIO_MAX_REQUEST_BYTES = 16 * 1024;
/** The full text travels in the dialogue; the visual prompt carries a short scene excerpt. */
export const STUDIO_VISUAL_EXCERPT_LENGTH = 160;

/**
 * Pure plan builder shared by the browser script and the tests. Plain
 * JavaScript on purpose: it is shipped verbatim to the browser.
 */
export const STUDIO_PLAN_BUILDER_SOURCE = String.raw`
var STUDIO_STYLES = {
  '3d_cartoon': { label: '3D Cartoon', prompt: 'Animação 3D estilo cartoon', description: 'Personagens 3D coloridos e expressivos, com proporções estilizadas.' },
  cinematic: { label: '3D Cinematográfico', prompt: 'Animação 3D cinematográfica', description: 'Iluminação dramática, profundidade de campo e enquadramentos de cinema.' },
  anime: { label: '3D Anime', prompt: 'Animação 3D estilo anime', description: 'Modelos 3D com sombreamento cel-shading inspirado em anime.' }
};
var STUDIO_FORMATS = { '9:16': 'Vertical', '16:9': 'Horizontal', '1:1': 'Quadrado' };
var STUDIO_LIMITS = {
  title: ${STUDIO_MAX_TITLE_LENGTH}, story: ${STUDIO_MAX_STORY_LENGTH}, characters: ${STUDIO_MAX_CHARACTERS},
  characterName: ${STUDIO_MAX_CHARACTER_NAME_LENGTH}, characterDescription: ${STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH},
  minSceneSeconds: 3, maxScenes: 20, durations: [${STUDIO_DURATION_OPTIONS_SECONDS.join(', ')}],
  visualExcerpt: ${STUDIO_VISUAL_EXCERPT_LENGTH}, requestBytes: ${STUDIO_MAX_REQUEST_BYTES} - 512
};

function buildStudioPlan(input) {
  input = input || {};
  var L = STUDIO_LIMITS;
  function fail(message) { var error = new Error(message); error.name = 'StudioInputError'; throw error; }
  function clean(text) { return String(text).replace(/\s+/g, ' ').trim(); }
  function key(text) { return clean(text).toLocaleLowerCase('pt-BR'); }
  function slug(text) { return key(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function excerpt(text, max) {
    if (text.length <= max) return text;
    var cut = text.slice(0, max - 1);
    var space = cut.lastIndexOf(' ');
    return (space > max / 2 ? cut.slice(0, space) : cut) + '…';
  }
  function utf8Bytes(text) { return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, 'x').length; }
  function isWordChar(ch) { return ch !== '' && /[\p{L}\p{N}]/u.test(ch); }
  function mentions(text, name) {
    var haystack = key(text), needle = key(name), from = 0, at;
    while ((at = haystack.indexOf(needle, from)) !== -1) {
      if (!isWordChar(haystack.charAt(at - 1)) && !isWordChar(haystack.charAt(at + needle.length))) return true;
      from = at + 1;
    }
    return false;
  }

  var title = clean(input.title || '');
  var story = String(input.story || '').replace(/\r\n?/g, '\n').trim();
  var style = input.style;
  var format = input.format;
  var duration = Number(input.durationSeconds);
  if (!title) fail('Informe um título para o vídeo.');
  if (title.length > L.title) fail('O título pode ter no máximo ' + L.title + ' caracteres.');
  if (!story) fail('Escreva a história que será animada.');
  if (story.length > L.story) fail('A história pode ter no máximo ' + L.story + ' caracteres.');
  if (!Object.prototype.hasOwnProperty.call(STUDIO_STYLES, style)) fail('Escolha um estilo de animação válido.');
  if (!Object.prototype.hasOwnProperty.call(STUDIO_FORMATS, format)) fail('Escolha um formato válido.');
  if (L.durations.indexOf(duration) === -1) fail('Escolha uma duração válida.');

  // Cast: one "Nome: aparência" per line. The narrator is a voice and joins only when it speaks.
  var narrator = { id: 'narrador', name: 'Narrador', visualDescription: 'Narrador em off: apenas voz, sem aparição obrigatória em cena', voiceDescription: 'Voz brasileira (pt-BR), clara e expressiva' };
  var cast = [];
  var byName = {};
  var castLines = String(input.characters || '').replace(/\r\n?/g, '\n').split('\n').map(clean).filter(Boolean);
  if (castLines.length > L.characters) fail('Cadastre no máximo ' + L.characters + ' personagens.');
  castLines.forEach(function (line) {
    var match = line.match(/^(.+?)\s*(?:[:—–]|\s-\s)\s*(.*)$/);
    var name = clean(match ? match[1] : line);
    var description = clean(match ? match[2] : '');
    if (name.length > L.characterName) fail('O nome de personagem "' + name.slice(0, 20) + '…" passa de ' + L.characterName + ' caracteres.');
    if (!description) fail('Descreva a aparência de ' + name + ' (ex.: "' + name + ': menina de jardineira roxa").');
    if (description.length > L.characterDescription) fail('A descrição de ' + name + ' passa de ' + L.characterDescription + ' caracteres.');
    var id = slug(name) || 'personagem-' + (cast.length + 1);
    if (byName[key(name)] || cast.some(function (c) { return c.id === id; })) fail('O personagem ' + name + ' foi cadastrado mais de uma vez.');
    if (id === 'narrador') { narrator.visualDescription = description; byName[key(name)] = narrator; return; }
    var character = { id: id, name: name, visualDescription: description, voiceDescription: 'Voz brasileira (pt-BR) de ' + name };
    cast.push(character);
    byName[key(name)] = character;
  });
  byName.narrador = narrator;

  // "Nome: fala" lines belong to that character; everything else is narrated.
  function speakerOf(line) {
    var match = line.match(/^(.{1,${STUDIO_MAX_CHARACTER_NAME_LENGTH}}?)\s*:\s*(.+)$/);
    var who = match && byName[key(match[1])];
    return who ? { characterId: who.id, text: clean(match[2]) } : null;
  }

  // One scene per paragraph; a single paragraph is split by line, then by sentence.
  var blocks = story.split(/\n\s*\n/)
    .map(function (block) { return block.split('\n').map(clean).filter(Boolean); })
    .filter(function (lines) { return lines.length > 0; });
  if (blocks.length === 1 && blocks[0].length > 1) blocks = blocks[0].map(function (line) { return [line]; });
  if (blocks.length === 1 && !speakerOf(blocks[0][0])) {
    var sentences = (blocks[0][0].match(/[^.!?…]+(?:[.!?…]+|$)/g) || []).map(clean).filter(Boolean);
    if (sentences.length > 1) blocks = sentences.map(function (sentence) { return [sentence]; });
  }
  // Never drop text: contiguous blocks are merged when there are more than the duration allows.
  var count = Math.min(blocks.length, L.maxScenes, Math.floor(duration / L.minSceneSeconds));
  var groups = [];
  for (var g = 0; g < count; g++) {
    var start = Math.floor(g * blocks.length / count);
    var end = Math.floor((g + 1) * blocks.length / count);
    groups.push([].concat.apply([], blocks.slice(start, end)));
  }

  // Every scene gets the minimum; the rest follows text length (largest remainder), summing exactly.
  var texts = groups.map(function (lines) { return lines.join(' '); });
  var weights = texts.map(function (text) { return text.length; });
  var totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
  var spare = duration - L.minSceneSeconds * count;
  var seconds = weights.map(function (w) { return L.minSceneSeconds + Math.floor(spare * w / totalWeight); });
  var remaining = duration - seconds.reduce(function (a, b) { return a + b; }, 0);
  var byRemainder = weights.map(function (w, i) { return { i: i, r: (spare * w / totalWeight) % 1 }; })
    .sort(function (a, b) { return b.r - a.r || a.i - b.i; });
  for (var k = 0; k < remaining; k++) seconds[byRemainder[k % count].i] += 1;

  var narratorSpeaks = false;
  var scenes = groups.map(function (lines, i) {
    var dialogue = lines.map(function (line) { return speakerOf(line) || { characterId: 'narrador', text: line }; });
    var speaks = function (id) { return dialogue.some(function (d) { return d.characterId === id; }); };
    var characterIds = [];
    if (speaks('narrador')) { characterIds.push('narrador'); narratorSpeaks = true; }
    cast.forEach(function (c) { if (speaks(c.id) || mentions(texts[i], c.name)) characterIds.push(c.id); });
    // The visual excerpt prefers narration (what happens) over spoken lines.
    var narration = dialogue.filter(function (d) { return d.characterId === 'narrador'; }).map(function (d) { return d.text; }).join(' ');
    return {
      id: 'cena-' + (i + 1),
      order: i + 1,
      durationSeconds: seconds[i],
      visualPrompt: STUDIO_STYLES[style].prompt + ': ' + excerpt(narration || texts[i], L.visualExcerpt),
      characterIds: characterIds,
      dialogue: dialogue
    };
  });

  var plan = {
    title: title,
    format: format,
    style: style,
    language: 'pt-BR',
    durationSeconds: duration,
    characters: (narratorSpeaks ? [narrator] : []).concat(cast),
    scenes: scenes,
    // Local rendering: no charge is expected for this plan. A paid engine must
    // send its own estimate and get explicit approval (see interpretEngineStatus).
    status: 'rendering',
    estimatedCostUsd: 0,
    budgetApproved: true
  };
  // Fail here, with guidance, instead of getting a 413 from the server.
  if (utf8Bytes(JSON.stringify({ plan: plan })) > L.requestBytes) fail('A produção ficou grande demais para enviar de uma vez. Encurte a história ou as descrições dos personagens.');
  return plan;
}
`;

/**
 * Pure interpretation of render-engine answers, shared by the browser script
 * and the tests. Returns plain outcomes the UI renders; never trusts server
 * URLs outside the Studio paths.
 */
export const STUDIO_RENDER_PROTOCOL_SOURCE = String.raw`
var STUDIO_RENDER_PATH = /^\/api\/studio\/renders\/[A-Za-z0-9._-]{1,120}\.mp4$/;
var STUDIO_JOB_PATH = /^\/api\/studio\/jobs\/[A-Za-z0-9_-]{1,80}$/;

function studioErrorOf(body) {
  var error = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
  return {
    code: typeof error.code === 'string' ? error.code : '',
    message: typeof error.message === 'string' ? error.message.slice(0, 300) : ''
  };
}

function studioText(value, max) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }

function describeStudioFailure(status, body) {
  var error = studioErrorOf(body);
  var detail = error.message ? ' Detalhe: ' + error.message : '';
  if (status === 404 || status === 405 || status === 501 || error.code === 'STUDIO_UNAVAILABLE' || error.code === 'ENGINE_UNAVAILABLE') {
    return { reason: 'engine_unavailable', message: 'O motor de renderização 3D não está disponível neste servidor no momento. Sua história continua aqui; tente novamente mais tarde.' + detail };
  }
  if (status === 402 || error.code === 'STUDIO_COST_APPROVAL_REQUIRED') {
    return { reason: 'cost_approval', message: 'Este processamento exige aprovação de custo, que ainda não está disponível nesta interface. Nada foi cobrado.' };
  }
  if (error.code === 'STUDIO_RATE_LIMITED') {
    return { reason: 'rate_limited', message: error.message || 'Limite diário de vídeos atingido. Tente novamente mais tarde.' };
  }
  if (error.code === 'STUDIO_BUSY' || status === 409 || status === 429) {
    return { reason: 'busy', message: 'O Studio já está renderizando outro vídeo. Aguarde a conclusão e tente novamente.' };
  }
  if (status === 413) return { reason: 'too_large', message: 'A produção ficou grande demais para uma única renderização. Reduza a história ou os personagens.' };
  if (status === 400 || status === 415 || status === 422) return { reason: 'invalid_plan', message: 'O servidor recusou o plano do vídeo: ' + (error.message || 'dados inválidos.') };
  if (status === 502 || status === 504) {
    return { reason: 'gateway_timeout', message: 'A conexão foi encerrada antes do fim da renderização (tempo limite do servidor intermediário). O vídeo pode ainda estar sendo produzido; aguarde alguns minutos antes de tentar de novo.' };
  }
  if (status === 503) return { reason: 'temporarily_unavailable', message: 'O servidor está temporariamente indisponível. Tente novamente em instantes.' + detail };
  return { reason: 'unexpected', message: 'Não foi possível gerar o vídeo' + (error.message ? ': ' + error.message : ' (erro ' + status + ').') };
}

function studioPending(body) {
  var progress = body && typeof body.progress === 'number' && isFinite(body.progress) && body.progress >= 0 && body.progress <= 1 ? body.progress : null;
  return { kind: 'pending', queued: !!body && body.status === 'queued', stage: studioText(body && body.stage, 120), progress: progress };
}

function studioCompleted(body) {
  var url = body && body.downloadUrl;
  if (typeof url !== 'string' || !STUDIO_RENDER_PATH.test(url)) {
    return { kind: 'failed', reason: 'invalid_response', message: 'O servidor concluiu, mas não informou um vídeo válido.' };
  }
  var fileName = typeof body.fileName === 'string' && /^[A-Za-z0-9._-]{1,120}\.mp4$/.test(body.fileName) ? body.fileName : url.split('/').pop();
  return { kind: 'completed', downloadUrl: url, fileName: fileName };
}

function interpretRenderResponse(status, body) {
  if (status === 401) return { kind: 'locked' };
  if (status === 200 || status === 201) return studioCompleted(body);
  if (status === 202) {
    var statusUrl = body && body.statusUrl;
    if (typeof statusUrl !== 'string' || !STUDIO_JOB_PATH.test(statusUrl)) {
      return { kind: 'failed', reason: 'invalid_response', message: 'O servidor aceitou a renderização, mas não informou como acompanhá-la.' };
    }
    var pending = studioPending(body);
    pending.statusUrl = statusUrl;
    return pending;
  }
  var failure = describeStudioFailure(status, body);
  return { kind: 'failed', reason: failure.reason, message: failure.message };
}

function interpretJobStatus(status, body) {
  if (status === 401) return { kind: 'locked' };
  if (status === 404) return { kind: 'failed', reason: 'job_lost', message: 'A renderização não foi encontrada no servidor (ele pode ter sido reiniciado). Gere o vídeo novamente.' };
  if (status !== 200) { var failure = describeStudioFailure(status, body); return { kind: 'failed', reason: failure.reason, message: failure.message }; }
  var state = body && body.status;
  if (state === 'queued' || state === 'rendering') return studioPending(body);
  if (state === 'completed') return studioCompleted(body);
  if (state === 'cancelled') return { kind: 'cancelled' };
  if (state === 'failed') {
    var detail = studioErrorOf(body).message;
    return { kind: 'failed', reason: 'render_failed', message: 'A renderização falhou no servidor' + (detail ? ': ' + detail : '.') };
  }
  return { kind: 'failed', reason: 'invalid_response', message: 'O servidor informou um estado de renderização desconhecido.' };
}

function interpretEngineStatus(status, body) {
  if (status === 401) return { state: 'locked', message: '' };
  if (status === 404 || status === 405 || status === 501) {
    return { state: 'unknown', message: 'Este servidor ainda não informa o estado do motor de renderização. A geração será tentada e, se o motor estiver indisponível, você será avisado.' };
  }
  if (status !== 200 || !body || typeof body.available !== 'boolean') {
    return { state: 'unknown', message: 'Não foi possível confirmar o estado do motor de renderização agora.' };
  }
  var detail = studioText(body.message, 200);
  if (!body.available) {
    return { state: 'unavailable', message: 'O motor de renderização 3D está indisponível' + (detail ? ': ' + detail : '.') + ' Você pode preparar a produção; a geração fica bloqueada até ele voltar.' };
  }
  if (body.costPolicy === 'paid' || (typeof body.estimatedCostUsd === 'number' && body.estimatedCostUsd > 0)) {
    return { state: 'paid', message: 'Este servidor informou que o processamento terá custo. A aprovação de custos ainda não existe nesta interface, então a geração foi bloqueada e nada será cobrado.' };
  }
  var engine = studioText(body.engine, 40);
  return { state: 'available', message: 'Motor de renderização disponível' + (engine ? ' (' + engine + ')' : '') + '. Processamento local, sem cobrança prevista para este plano.' };
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
  --danger-soft: rgba(229, 130, 143, 0.06);
  --online: #5fbf88;
  --online-line: rgba(95, 191, 136, 0.3);
  --online-soft: rgba(95, 191, 136, 0.06);
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
.shell { width: min(100%, 1120px); margin: 0 auto; padding: 20px 16px 48px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
.topbar nav { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; text-decoration: none; color: var(--ink); }
.mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--accent); font-weight: 700; }
.link-button { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 6px 4px; text-decoration: none; }
.link-button:hover { color: var(--ink); }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0 0 8px; font-size: clamp(22px, 4vw, 30px); letter-spacing: -0.025em; font-weight: 640; }
.lead { margin: 0 0 20px; color: var(--muted); max-width: 680px; }
.engine { margin: 0 0 20px; padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); color: var(--muted); font-size: 13px; }
.engine::before { content: "●"; margin-right: 8px; }
.engine-available { border-color: var(--online-line); background: var(--online-soft); color: var(--ink); }
.engine-available::before { color: var(--online); }
.engine-unavailable, .engine-paid { border-color: var(--danger-line); background: var(--danger-soft); color: var(--danger); }
.engine-unknown::before, .engine-checking::before { color: var(--accent); }
.layout { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
.side { display: grid; gap: 20px; min-width: 0; }
@media (min-width: 920px) { .layout { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; } }
.card { background: var(--bg-elevated); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 20px; min-width: 0; }
.form { display: grid; gap: 18px; }
.field { display: grid; gap: 7px; min-width: 0; }
.field-label { font-size: 13px; font-weight: 600; }
.optional { color: var(--muted); font-weight: 400; }
.field-hint { color: var(--muted); font-size: 12px; }
.field-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
input[type="text"], input[type="password"], textarea, select {
  width: 100%; padding: 11px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--ink); font: inherit; outline: none;
}
textarea { resize: vertical; min-height: 96px; line-height: 1.55; }
#studio-story { min-height: 180px; }
input:focus-visible, textarea:focus-visible, select:focus-visible { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
input:disabled, textarea:disabled, select:disabled { opacity: .6; }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.choices { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.choices.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.choice { position: relative; display: grid; gap: 2px; padding: 11px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); cursor: pointer; background: var(--bg-input); }
.choices.compact .choice { padding: 9px 10px; }
.choice input { position: absolute; opacity: 0; pointer-events: none; }
.choice-title { font-weight: 600; font-size: 13px; }
.choice-copy { color: var(--muted); font-size: 12px; }
.choice:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.choice:has(input:focus-visible) { box-shadow: 0 0 0 3px var(--accent-soft); }
.grid-2 { display: grid; gap: 14px; align-items: start; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.summary { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-input); border: 1px dashed var(--line-strong); color: var(--muted); font-size: 12.5px; }
.summary.invalid { border-color: var(--danger-line); color: var(--danger); }
.cost { margin: 0; color: var(--muted); font-size: 12px; }
.primary { display: inline-block; text-align: center; text-decoration: none; width: 100%; padding: 13px 16px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: #17130b; font: inherit; font-weight: 650; cursor: pointer; transition: background .15s, transform .15s; }
.primary:hover:not(:disabled) { background: var(--accent-strong); transform: translateY(-1px); }
.primary:disabled { opacity: .5; cursor: not-allowed; }
.primary:focus-visible, .secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.secondary { display: inline-flex; justify-content: center; align-items: center; padding: 11px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: transparent; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.secondary:hover { border-color: var(--accent-line); }
.secondary:disabled { opacity: .5; cursor: not-allowed; }
.actions { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 14px; }
.card-title { margin: 0 0 12px; font-size: 15px; font-weight: 620; }
.placeholder { display: grid; place-items: center; min-height: 160px; padding: 20px; text-align: center; color: var(--muted); border: 1px dashed var(--line-strong); border-radius: var(--radius-md); }
.placeholder p { margin: 0; }
.preview { display: grid; gap: 16px; }
.preview-head h3 { margin: 0 0 6px; font-size: 17px; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.chips li { padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--muted); font-size: 12px; }
.preview-section h4 { margin: 0 0 8px; font-size: 12px; color: var(--accent); letter-spacing: .06em; text-transform: uppercase; }
.preview-section p { margin: 0; color: var(--muted); font-size: 13px; }
.cast, .scenes { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.cast li, .scenes > li { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-input); overflow-wrap: anywhere; }
.cast strong, .scene-head strong { font-size: 13px; }
.cast span { display: block; color: var(--muted); font-size: 12.5px; }
.cast .warn { color: var(--danger); }
.scene-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; margin-bottom: 6px; }
.scene-head span { color: var(--muted); font-size: 12px; }
.lines { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 13px; }
.lines b { color: var(--accent); font-weight: 600; }
.progress { display: grid; gap: 12px; justify-items: center; text-align: center; padding: 24px 8px; }
.spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
progress { width: 100%; height: 8px; accent-color: var(--accent); }
.progress-step { margin: 0; font-weight: 600; }
.progress-meta { margin: 0; color: var(--muted); font-size: 12.5px; }
.slow { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--accent-line); background: var(--accent-soft); font-size: 12.5px; }
.error-box, .notice-box { padding: 14px; border-radius: var(--radius-md); }
.error-box { border: 1px solid var(--danger-line); color: var(--danger); background: var(--danger-soft); }
.notice-box { border: 1px solid var(--accent-line); background: var(--accent-soft); }
.error-box p, .notice-box p { margin: 0; }
.video-frame { display: grid; place-items: center; background: #000; border-radius: var(--radius-md); overflow: hidden; }
.video-frame video { display: block; width: 100%; max-height: 72vh; background: #000; }
.video-frame.ratio-9-16 video { width: auto; max-width: 100%; aspect-ratio: 9 / 16; }
.video-frame.ratio-16-9 video { aspect-ratio: 16 / 9; }
.video-frame.ratio-1-1 video { width: auto; max-width: 100%; aspect-ratio: 1 / 1; }
.video-meta { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
.unlock { display: grid; place-items: center; min-height: 60vh; }
.unlock .card { width: min(100%, 400px); }
.unlock form { display: grid; gap: 12px; }
.check { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.form-error { min-height: 16px; margin: 0; color: var(--danger); font-size: 12.5px; }
@media (max-width: 520px) { .card { padding: 16px; } .topbar { margin-bottom: 20px; } }
`;

export const STUDIO_WEB_SCRIPT = `${STUDIO_PLAN_BUILDER_SOURCE}
${STUDIO_RENDER_PROTOCOL_SOURCE}
` + String.raw`
(() => {
  'use strict';
  const POLL_MS = 3000;
  const MAX_POLL_FAILURES = 5;
  const SLOW_AFTER_S = 90;
  const VERY_SLOW_AFTER_S = 600;
  const $ = (selector) => document.querySelector(selector);
  const unlockView = $('#studio-unlock');
  const studioView = $('#studio-main');
  const unlockForm = $('#studio-unlock-form');
  const unlockError = $('#studio-unlock-error');
  const logoutButton = $('#studio-logout');
  const engineBanner = $('#studio-engine');
  const form = $('#studio-form');
  const submit = $('#studio-submit');
  const summary = $('#studio-summary');
  const storyCounter = $('#studio-story-count');
  const previewEmpty = $('#studio-preview-empty');
  const preview = $('#studio-preview');
  const panels = { idle: $('#studio-idle'), rendering: $('#studio-rendering'), notice: $('#studio-notice'), error: $('#studio-error'), done: $('#studio-done') };
  const stageText = $('#studio-stage');
  const progressBar = $('#studio-progress');
  const elapsedText = $('#studio-elapsed');
  const slowText = $('#studio-slow');
  const cancelButton = $('#studio-cancel');
  const noticeText = $('#studio-notice-message');
  const errorText = $('#studio-error-message');
  const videoFrame = $('#studio-video-frame');
  const video = $('#studio-video');
  const download = $('#studio-download');
  const videoMeta = $('#studio-video-meta');
  let engineState = 'checking';
  let run = null;
  let refreshTimer = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function readInput() {
    const checked = (name) => { const input = form.querySelector('input[name="' + name + '"]:checked'); return input ? input.value : ''; };
    return {
      title: $('#studio-title').value,
      story: $('#studio-story').value,
      characters: $('#studio-characters').value,
      style: checked('style'),
      format: checked('format'),
      durationSeconds: Number($('#studio-duration').value),
    };
  }

  function formatSeconds(total) {
    const m = Math.floor(total / 60), s = total % 60;
    return m > 0 ? m + ' min' + (s ? ' ' + s + ' s' : '') : s + ' s';
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

  function updateSubmit() {
    const blocked = engineState === 'unavailable' || engineState === 'paid';
    submit.disabled = run !== null || blocked;
    submit.textContent = run !== null ? 'Gerando vídeo…' : blocked ? 'Geração indisponível' : 'Gerar vídeo';
  }

  function applyEngine(result) {
    if (result.state === 'locked') { setLocked(true, 'Sua sessão expirou. Entre novamente.'); return; }
    engineState = result.state;
    engineBanner.className = 'engine engine-' + result.state;
    engineBanner.textContent = result.message;
    updateSubmit();
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return null; }
  }

  async function checkEngine() {
    engineState = 'checking';
    engineBanner.className = 'engine engine-checking';
    engineBanner.textContent = 'Verificando o motor de renderização…';
    try {
      const response = await fetch('/api/studio/status', { credentials: 'same-origin' });
      applyEngine(interpretEngineStatus(response.status, await readJson(response)));
    } catch {
      applyEngine({ state: 'unknown', message: 'Não foi possível confirmar o estado do motor de renderização agora.' });
    }
  }

  function renderPreview(plan) {
    preview.replaceChildren();
    const style = STUDIO_STYLES[plan.style];
    const names = {};
    for (const c of plan.characters) names[c.id] = c.name;

    const head = el('div', 'preview-head');
    head.append(el('h3', '', plan.title));
    const chips = el('ul', 'chips');
    for (const text of [style.label, plan.format + ' · ' + STUDIO_FORMATS[plan.format], formatSeconds(plan.durationSeconds), plan.scenes.length + (plan.scenes.length === 1 ? ' cena' : ' cenas'), 'Narração pt-BR · legendas']) chips.append(el('li', '', text));
    head.append(chips);

    const styleSection = el('section', 'preview-section');
    styleSection.append(el('h4', '', 'Estilo visual'), el('p', '', style.label + ' — ' + style.description));

    const castSection = el('section', 'preview-section');
    castSection.append(el('h4', '', 'Personagens'));
    const cast = el('ul', 'cast');
    for (const c of plan.characters) {
      const item = el('li');
      item.append(el('strong', '', c.name), el('span', '', c.visualDescription));
      if (c.id !== 'narrador' && !plan.scenes.some((scene) => scene.characterIds.includes(c.id))) {
        item.append(el('span', 'warn', 'Não aparece na história: cite o nome ou use "' + c.name + ': fala".'));
      }
      cast.append(item);
    }
    castSection.append(cast);

    const scenesSection = el('section', 'preview-section');
    scenesSection.append(el('h4', '', 'Cenas'));
    const scenes = el('ol', 'scenes');
    for (const scene of plan.scenes) {
      const item = el('li');
      const sceneHead = el('div', 'scene-head');
      const who = scene.characterIds.filter((id) => id !== 'narrador').map((id) => names[id]);
      sceneHead.append(el('strong', '', 'Cena ' + scene.order + ' · ' + formatSeconds(scene.durationSeconds)), el('span', '', who.length ? 'Em cena: ' + who.join(', ') : 'Sem personagens em cena'));
      const lines = el('ul', 'lines');
      for (const line of scene.dialogue) {
        const row = el('li');
        row.append(el('b', '', names[line.characterId] + ': '), document.createTextNode(line.text));
        lines.append(row);
      }
      item.append(sceneHead, lines);
      scenes.append(item);
    }
    scenesSection.append(scenes);
    preview.append(head, styleSection, castSection, scenesSection);
  }

  function refresh() {
    const input = readInput();
    storyCounter.textContent = input.story.length + ' / ' + STUDIO_LIMITS.story;
    if (!input.title.trim() && !input.story.trim()) {
      summary.classList.remove('invalid');
      summary.textContent = 'Escreva o título e a história para montar a produção.';
      previewEmpty.classList.remove('hidden');
      preview.classList.add('hidden');
      return null;
    }
    try {
      const plan = buildStudioPlan(input);
      summary.classList.remove('invalid');
      summary.textContent = plan.scenes.length + (plan.scenes.length === 1 ? ' cena' : ' cenas') + ' · ' + formatSeconds(plan.durationSeconds) + ' · ' + STUDIO_STYLES[plan.style].label + ' · ' + plan.format;
      renderPreview(plan);
      previewEmpty.classList.add('hidden');
      preview.classList.remove('hidden');
      return plan;
    } catch (error) {
      summary.classList.add('invalid');
      summary.textContent = error.message;
      return null;
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 150);
  }

  function setFormDisabled(disabled) {
    for (const field of form.querySelectorAll('input, textarea, select')) field.disabled = disabled;
  }

  function setStage(outcome) {
    stageText.textContent = outcome.stage || (outcome.queued ? 'Na fila de renderização…' : 'Renderizando a animação 3D no servidor…');
    if (typeof outcome.progress === 'number') progressBar.value = outcome.progress;
    else progressBar.removeAttribute('value');
  }

  function tick() {
    if (!run) return;
    const seconds = Math.floor((Date.now() - run.startedAt) / 1000);
    elapsedText.textContent = 'Tempo decorrido: ' + formatSeconds(seconds);
    if (seconds >= VERY_SLOW_AFTER_S) {
      slowText.textContent = 'Está demorando mais do que o esperado. Você pode continuar aguardando ou cancelar e tentar uma duração menor.';
    } else if (seconds >= SLOW_AFTER_S) {
      slowText.textContent = 'Animações 3D podem levar vários minutos. Mantenha esta página aberta ou cancele quando quiser.';
    }
    slowText.classList.toggle('hidden', seconds < SLOW_AFTER_S);
  }

  function warnBeforeLeaving(event) { event.preventDefault(); event.returnValue = ''; }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  async function pollJob(current) {
    let failures = 0;
    for (;;) {
      await wait(POLL_MS, current.controller.signal);
      try {
        const response = await fetch(current.statusUrl, { credentials: 'same-origin', signal: current.controller.signal });
        return interpretJobStatus(response.status, await readJson(response));
      } catch (error) {
        if (current.controller.signal.aborted || ++failures >= MAX_POLL_FAILURES) throw error;
      }
    }
  }

  function showVideo(outcome, plan) {
    videoFrame.className = 'video-frame ratio-' + plan.format.replace(':', '-');
    video.src = outcome.downloadUrl;
    download.href = outcome.downloadUrl;
    download.setAttribute('download', outcome.fileName);
    videoMeta.textContent = plan.title + ' · ' + STUDIO_STYLES[plan.style].label + ' · ' + formatSeconds(plan.durationSeconds) + ' · ' + outcome.fileName;
    showPanel('done');
  }

  function finish(outcome, plan) {
    if (outcome.kind === 'completed') {
      if (engineState !== 'available') applyEngine({ state: 'available', message: 'O motor de renderização respondeu e entregou o vídeo.' });
      showVideo(outcome, plan);
    } else if (outcome.kind === 'locked') {
      showPanel('idle');
      setLocked(true, 'Sua sessão expirou. Entre novamente; sua história continua preenchida.');
    } else if (outcome.kind === 'cancelled') {
      noticeText.textContent = 'A renderização foi cancelada no servidor. Nenhum vídeo foi gerado.';
      showPanel('notice');
    } else {
      if (outcome.reason === 'engine_unavailable') applyEngine({ state: 'unavailable', message: outcome.message });
      errorText.textContent = outcome.message;
      showPanel('error');
    }
  }

  // The job being followed survives a page reload (e.g. a phone that slept): only its status URL and summary are stored.
  const ACTIVE_JOB_KEY = 'sebastian-studio-active-job';
  function saveActiveJob(statusUrl, plan) {
    try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ statusUrl, title: plan.title, style: plan.style, format: plan.format, durationSeconds: plan.durationSeconds })); } catch {}
  }
  function clearActiveJob() {
    try { localStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
  }
  function loadActiveJob() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      if (saved && STUDIO_JOB_PATH.test(saved.statusUrl) && STUDIO_STYLES[saved.style] && STUDIO_FORMATS[saved.format] && typeof saved.title === 'string' && Number.isInteger(saved.durationSeconds)) return saved;
    } catch {}
    clearActiveJob();
    return null;
  }
  function resumeActiveJob() {
    const saved = run ? null : loadActiveJob();
    if (saved) void startRender(saved, saved.statusUrl);
  }

  async function startRender(plan, resumeStatusUrl) {
    const current = { controller: new AbortController(), statusUrl: null, cancelled: false, startedAt: Date.now(), clock: null };
    run = current;
    updateSubmit();
    setFormDisabled(true);
    slowText.classList.add('hidden');
    setStage({ stage: resumeStatusUrl ? 'Retomando o acompanhamento da renderização…' : 'Enviando a produção ao servidor…', progress: null });
    showPanel('rendering');
    cancelButton.disabled = false;
    tick();
    current.clock = setInterval(tick, 1000);
    window.addEventListener('beforeunload', warnBeforeLeaving);
    try {
      let outcome;
      if (resumeStatusUrl) {
        outcome = { kind: 'pending', statusUrl: resumeStatusUrl, stage: 'Retomando o acompanhamento da renderização…', progress: null };
      } else {
        const response = await fetch('/api/studio/render', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
          signal: current.controller.signal,
        });
        outcome = interpretRenderResponse(response.status, await readJson(response));
      }
      while (outcome.kind === 'pending') {
        if (outcome.statusUrl && outcome.statusUrl !== current.statusUrl) {
          current.statusUrl = outcome.statusUrl;
          saveActiveJob(current.statusUrl, plan);
        }
        setStage(outcome);
        outcome = await pollJob(current);
      }
      // Session expiry keeps the job so it is resumed after signing in again.
      if (outcome.kind !== 'locked') clearActiveJob();
      if (!current.cancelled) finish(outcome, plan);
    } catch {
      if (!current.cancelled) {
        finish({
          kind: 'failed',
          reason: 'network',
          message: current.statusUrl
            ? 'A conexão caiu enquanto o vídeo era produzido. A renderização pode continuar no servidor; verifique sua internet antes de gerar de novo.'
            : 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
        }, plan);
      }
    } finally {
      clearInterval(current.clock);
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      if (run === current) run = null;
      setFormDisabled(false);
      updateSubmit();
    }
  }

  async function cancelRender() {
    const current = run;
    if (!current || current.cancelled) return;
    current.cancelled = true;
    cancelButton.disabled = true;
    clearActiveJob();
    current.controller.abort();
    let confirmed = false;
    if (current.statusUrl) {
      try {
        const response = await fetch(current.statusUrl, { method: 'DELETE', credentials: 'same-origin' });
        confirmed = response.ok;
      } catch {}
    }
    noticeText.textContent = confirmed
      ? 'A renderização foi cancelada no servidor. Nenhum vídeo foi gerado.'
      : current.statusUrl
        ? 'Você parou de acompanhar, mas o servidor não confirmou o cancelamento. A renderização pode continuar até terminar.'
        : 'Você parou de aguardar. Este servidor ainda não permite cancelar a renderização: ela pode continuar em segundo plano e manter o Studio ocupado até terminar.';
    showPanel('notice');
  }

  form.addEventListener('input', scheduleRefresh);
  form.addEventListener('change', scheduleRefresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (run) return;
    const plan = refresh();
    if (!plan) { summary.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    void startRender(plan);
  });
  cancelButton.addEventListener('click', () => { void cancelRender(); });
  $('#studio-retry').addEventListener('click', () => { showPanel('idle'); if (engineState === 'unavailable') void checkEngine(); submit.focus(); });
  $('#studio-notice-back').addEventListener('click', () => { showPanel('idle'); submit.focus(); });
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
      if (!response.ok) { unlockError.textContent = studioErrorOf(await readJson(response)).message || 'Acesso não autorizado.'; return; }
      $('#studio-token').value = '';
      setLocked(false);
      void checkEngine();
      resumeActiveJob();
      $('#studio-title').focus();
    } catch {
      unlockError.textContent = 'Não foi possível estabelecer uma sessão segura.';
    } finally {
      button.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    if (run) await cancelRender();
    try { await fetch('/api/web/session', { method: 'DELETE', credentials: 'same-origin' }); } catch {}
    setLocked(true);
  });

  (async () => {
    refresh();
    try {
      const response = await fetch('/api/web/session', { credentials: 'same-origin' });
      const body = await readJson(response);
      const authenticated = !!body && body.authenticated === true;
      setLocked(!authenticated);
      if (authenticated) { void checkEngine(); resumeActiveJob(); }
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
      <p class="eyebrow">Animação 3D · processamento local</p>
      <h1>Transforme uma história em animação 3D</h1>
      <p class="lead">Escreva a história e apresente os personagens. O Sebastian monta as cenas, anima em 3D, narra em português, adiciona legendas e entrega o MP4.</p>
      <p class="engine engine-checking" id="studio-engine" role="status">Verificando o motor de renderização…</p>
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
            <textarea id="studio-story" maxlength="${STUDIO_MAX_STORY_LENGTH}" rows="10" required aria-describedby="studio-story-hint" placeholder="Nina pediu ao robô Bolota para arrumar o quarto.&#10;Nina: Bolota, guarde tudo antes do jantar!&#10;&#10;Bolota empilhou todos os brinquedos até o teto.&#10;Bolota: Missão cumprida!&#10;&#10;No fim, os dois riram e guardaram tudo juntos."></textarea>
            <span class="field-hint" id="studio-story-hint">Cada parágrafo vira uma cena. Linhas como "Nina: fala" viram falas do personagem; o restante é narrado.</span>
          </div>
          <div class="field">
            <label class="field-label" for="studio-characters">Personagens <span class="optional">(opcional, até ${STUDIO_MAX_CHARACTERS})</span></label>
            <textarea id="studio-characters" rows="3" aria-describedby="studio-characters-hint" placeholder="Nina: menina de 8 anos, jardineira roxa e tênis amarelos&#10;Bolota: robô redondo azul e branco com olhos de LED"></textarea>
            <span class="field-hint" id="studio-characters-hint">Um por linha, no formato "Nome: aparência". A aparência mantém o personagem consistente em todas as cenas.</span>
          </div>
          <fieldset class="field">
            <legend class="field-label">Estilo da animação</legend>
            <div class="choices">
              <label class="choice"><input type="radio" name="style" value="3d_cartoon" checked><span class="choice-title">3D Cartoon</span><span class="choice-copy">Colorido e expressivo</span></label>
              <label class="choice"><input type="radio" name="style" value="cinematic"><span class="choice-title">3D Cinematográfico</span><span class="choice-copy">Luz e câmera de cinema</span></label>
              <label class="choice"><input type="radio" name="style" value="anime"><span class="choice-title">3D Anime</span><span class="choice-copy">Cel-shading inspirado em anime</span></label>
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
          <p class="cost" id="studio-cost">Custo: esta versão gera o vídeo localmente, no próprio servidor, sem serviços pagos — não há cobrança prevista para este plano. Se no futuro alguma etapa usar processamento pago, o valor será mostrado antes e só será usado com sua aprovação.</p>
          <button class="primary" id="studio-submit" type="submit">Gerar vídeo</button>
        </form>

        <div class="side">
          <section class="card" aria-labelledby="studio-output-title">
            <h2 class="card-title" id="studio-output-title">Resultado</h2>
            <div id="studio-idle" class="placeholder"><p>O vídeo aparecerá aqui, pronto para assistir e baixar.</p></div>
            <div id="studio-rendering" class="progress hidden" role="status" aria-live="polite">
              <div class="spinner" aria-hidden="true"></div>
              <p class="progress-step" id="studio-stage">Enviando a produção ao servidor…</p>
              <progress id="studio-progress" max="1" aria-label="Progresso da renderização"></progress>
              <p class="progress-meta" id="studio-elapsed">Tempo decorrido: 0 s</p>
              <p class="slow hidden" id="studio-slow"></p>
              <p class="progress-meta">A renderização acontece no servidor e pode levar vários minutos.</p>
              <button class="secondary" id="studio-cancel" type="button">Cancelar</button>
            </div>
            <div id="studio-notice" class="hidden" role="status">
              <div class="notice-box"><p id="studio-notice-message"></p></div>
              <div class="actions"><button class="secondary" id="studio-notice-back" type="button">Voltar à produção</button></div>
            </div>
            <div id="studio-error" class="hidden" role="alert">
              <div class="error-box"><p id="studio-error-message"></p></div>
              <div class="actions"><button class="secondary" id="studio-retry" type="button">Voltar e ajustar</button></div>
            </div>
            <div id="studio-done" class="hidden">
              <div class="video-frame" id="studio-video-frame"><video id="studio-video" controls playsinline preload="metadata"></video></div>
              <p class="video-meta" id="studio-video-meta"></p>
              <div class="actions">
                <a class="primary" id="studio-download" href="#" download>Baixar MP4</a>
                <button class="secondary" id="studio-new" type="button">Gerar outro vídeo</button>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="studio-preview-title">
            <h2 class="card-title" id="studio-preview-title">Produção</h2>
            <div id="studio-preview-empty" class="placeholder"><p>Personagens, cenas, falas e estilo visual aparecem aqui enquanto você escreve.</p></div>
            <div id="studio-preview" class="preview hidden"></div>
          </section>
        </div>
      </div>
    </main>
  </div>
</body>
</html>
`;
