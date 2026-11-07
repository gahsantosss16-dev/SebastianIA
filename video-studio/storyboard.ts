export type Scene = { index: number; durationSeconds: number; narration: string; visualPrompt: string };
export type VideoPlan = { title: string; format: '9:16'; durationSeconds: number; scenes: Scene[]; caption: string; status: 'storyboard_only'; estimatedCostUsd: 0; provider: 'local-ffmpeg-espeak' };
/** A deliberately modest, original robot-comedy template, never a paid model call. */
export function createVideoPlan(idea: unknown, durationSeconds: unknown = 30): VideoPlan {
  if (typeof idea !== 'string' || !idea.trim() || idea.trim().length > 240 || /[\x00-\x1f]/.test(idea)) throw new Error('Informe uma ideia de 1 a 240 caracteres, sem controles.');
  if (typeof durationSeconds !== 'number' || !Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 60) throw new Error('Duração deve ser inteira, entre 15 e 60 segundos.');
  const clean = idea.trim();
  const lines = [
    `Hoje, no laboratório: ${clean}.`,
    'Beto, o pequeno robô, queria resolver tudo apertando um botão.',
    'O botão piscou. A máquina serviu café para um vaso de plantas!',
    'Lia olhou para Beto: primeiro entender, depois apertar!',
    'Beto aprendeu a perguntar. E a planta? Nunca esteve tão acordada!'
  ];
  const visuals = ['Laboratório ao amanhecer', 'Beto diante do botão', 'Café para a planta', 'Lia e Beto conversam', 'Beto e a planta desperta'];
  const base = Math.floor(durationSeconds / lines.length);
  const scenes = lines.map((narration, i) => ({ index: i + 1, durationSeconds: base + (i < durationSeconds % lines.length ? 1 : 0), narration, visualPrompt: visuals[i]! }));
  return { title: clean.slice(0, 80), format: '9:16', durationSeconds, scenes, caption: `${clean} #comedia #SebastianIA`, status: 'storyboard_only', estimatedCostUsd: 0, provider: 'local-ffmpeg-espeak' };
}
