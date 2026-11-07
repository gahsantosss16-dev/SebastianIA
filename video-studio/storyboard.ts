export type Scene = { index: number; durationSeconds: number; narration: string; visualPrompt: string };
export type VideoPlan = { title: string; format: "9:16"; durationSeconds: number; scenes: Scene[]; caption: string; status: "storyboard_only" };
export function createVideoPlan(idea: string, durationSeconds = 60): VideoPlan {
  const clean = idea.trim();
  if (!clean) throw new Error("Informe uma ideia para o vídeo.");
  if (!Number.isFinite(durationSeconds) || durationSeconds < 15 || durationSeconds > 180) throw new Error("Duração deve estar entre 15 e 180 segundos.");
  const beats = [
    "Apresente a situação com um gancho visual imediato.",
    "Mostre o primeiro conflito ou mal-entendido.",
    "Aumente a confusão com uma reação inesperada.",
    "Introduza uma reviravolta engraçada.",
    "Entregue a conclusão e um convite natural para acompanhar a série."
  ];
  const count = beats.length;
  const base = Math.floor(durationSeconds / count);
  const scenes = beats.map((beat, i) => ({
    index: i + 1,
    durationSeconds: base + (i < durationSeconds % count ? 1 : 0),
    narration: `${beat} Contexto: ${clean}`,
    visualPrompt: `Vertical 9:16, original Brazilian comedy, consistent recurring characters, expressive cinematic animation, no copyrighted characters, no on-screen text. Scene ${i + 1}/${count}. ${beat} Story: ${clean}`
  }));
  return { title: clean.slice(0, 80), format: "9:16", durationSeconds, scenes, caption: `${clean.slice(0, 120)} #humor #comedia #videosia`, status: "storyboard_only" };
}
