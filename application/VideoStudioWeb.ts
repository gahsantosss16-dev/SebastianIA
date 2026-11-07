export const VIDEO_STUDIO_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estúdio • SebastianIA</title><link rel="stylesheet" href="/assets/video-studio.css"><main><a href="/">← Assistente pessoal</a><h1>Estúdio de vídeos</h1><p>Comédia original com Beto, Lia e uma planta muito acordada. Cenas ilustradas com movimento, voz sintética em português e legendas. Modelo local fixo; a ideia contextualiza a abertura.</p><p><strong>Custo externo estimado: US$ 0.</strong> Usa CPU e disco locais. Nenhuma assinatura ou API paga.</p><p>Entre pela página do assistente para usar sua sessão existente.</p><form id="form"><label>Ideia <input id="idea" required maxlength="240" value="Um robô aprende a ajudar sem fazer confusão"></label><p><label>Duração <select id="duration"><option>30</option><option>45</option><option>60</option></select> segundos</label></p><button>Criar roteiro gratuito</button></form><p id="error" role="alert"></p><section id="jobs" aria-live="polite"></section></main><script src="/assets/video-studio.js" defer></script></html>`;
export const VIDEO_STUDIO_SCRIPT = `
const jobs = document.querySelector('#jobs'), error = document.querySelector('#error');
async function api(path, body) {
 const r = await fetch('/api/video/jobs'+path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if (!r.ok) { const d = await r.json(); throw new Error(d.error?.message || d.message || 'Sessão inválida. Entre no assistente.'); } return r.json();
}
const statusNames = {awaiting_approval:'Aguardando aprovação',queued:'Na fila',rendering:'Gerando',completed:'Concluído',failed:'Falhou'};
const cards = new Map();
function show(job) {
 let entry = cards.get(job.id);
 if (!entry) { const card = document.createElement('article'), title = document.createElement('h2'), status = document.createElement('p'), script = document.createElement('pre'), actions = document.createElement('div'); title.textContent = job.plan.title; script.textContent = job.plan.scenes.map(s=>s.index+'. '+s.narration).join('\\n\\n'); card.append(title,status,script,actions); jobs.prepend(card); entry={status,actions,last:''}; cards.set(job.id,entry); }
 entry.status.textContent = statusNames[job.status]+' • cena '+job.scene+'/5 • US$ 0'+(job.error?' • '+job.error:'');
 if (entry.last===job.status) return; entry.last=job.status; entry.actions.replaceChildren();
 if(job.status==='awaiting_approval'){const b=document.createElement('button');b.textContent='Aprovar roteiro e gerar MP4 (US$ 0)';b.onclick=async()=>{try{show(await api('/'+job.id+'/render',{approved:true}));}catch(e){error.textContent=e.message;}};entry.actions.append(b);}
 if(job.status==='completed'){const v=document.createElement('video');v.controls=true;v.preload='metadata';v.src=job.previewUrl;const a=document.createElement('a');a.href=job.downloadUrl;a.textContent='Baixar MP4';const s=document.createElement('a');s.href='/api/video/jobs/'+job.id+'/captions.srt';s.textContent=' • Baixar legendas';entry.actions.append(v,a,s);}
}
async function refresh(){try{(await api('')).jobs.forEach(show);error.textContent='';}catch(e){error.textContent=e.message;}}
document.querySelector('#form').onsubmit=async(e)=>{e.preventDefault();try{show(await api('',{idea:document.querySelector('#idea').value,durationSeconds:Number(document.querySelector('#duration').value)}));error.textContent='';}catch(e){error.textContent=e.message;}};
refresh();setInterval(refresh,2500);
`;

export const VIDEO_STUDIO_STYLES = 'body{margin:0;background:#101c30;color:#edf5ff;font:17px system-ui}main{max-width:900px;margin:auto;padding:30px}a{color:#70e0cf}input,select,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #456}input{width:min(90%,600px)}button{background:#70e0cf;color:#102330;cursor:pointer}article{background:#1d304b;padding:24px;margin:24px 0;border-radius:16px}video{display:block;max-width:100%;width:300px;margin:20px 0}p{line-height:1.6}pre{white-space:pre-wrap}#error{color:#ffb6ae}';
