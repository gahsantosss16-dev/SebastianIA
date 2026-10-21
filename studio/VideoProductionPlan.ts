/**
 * Sebastian Studio: deterministic production contract. No external API or
 * chargeable operation occurs when a plan is created.
 */
export type StudioAspectRatio = '9:16' | '16:9' | '1:1';
export type StudioVisualStyle = '3d_cartoon' | 'cinematic' | 'anime';
export type StudioStage = 'draft' | 'awaiting_approval' | 'rendering' | 'completed' | 'failed';
export type StudioMediaKind = 'video' | 'image' | 'voice' | 'music' | 'effects';
export interface StudioCharacter {
  readonly id: string;
  readonly name: string;
  readonly visualDescription: string;
  readonly voiceDescription: string;
}
export interface StudioScene {
  readonly id: string;
  readonly order: number;
  readonly durationSeconds: number;
  readonly visualPrompt: string;
  readonly characterIds: readonly string[];
  readonly dialogue: readonly { readonly characterId: string; readonly text: string }[];
}
export interface StudioProductionPlan {
  readonly title: string;
  readonly format: StudioAspectRatio;
  readonly style: StudioVisualStyle;
  readonly language: 'pt-BR';
  readonly durationSeconds: number;
  readonly characters: readonly StudioCharacter[];
  readonly scenes: readonly StudioScene[];
  readonly status: StudioStage;
  readonly estimatedCostUsd: number | null;
  readonly budgetApproved: boolean;
}
export class StudioPlanError extends Error {
  constructor(message: string) { super(message); this.name = 'StudioPlanError'; }
}
/** Fail closed instead of rendering a mismatched story or silently spending credits. */
export function validateStudioPlan(plan: StudioProductionPlan): StudioProductionPlan {
  if (!plan.title.trim()) throw new StudioPlanError('Title is required');
  if (!['9:16','16:9','1:1'].includes(plan.format)) throw new StudioPlanError('Invalid aspect ratio');
  if (!['3d_cartoon','cinematic','anime'].includes(plan.style)) throw new StudioPlanError('Invalid style');
  if (plan.language !== 'pt-BR') throw new StudioPlanError('Language must be pt-BR');
  if (plan.scenes.length === 0 || plan.scenes.length > 20) throw new StudioPlanError('Must have 1-20 scenes');
  if (!Number.isInteger(plan.durationSeconds) || plan.durationSeconds < 5 || plan.durationSeconds > 600) throw new StudioPlanError('Invalid total duration');
  const characterIds = new Set<string>();
  for (const character of plan.characters) {
    if (!character.id.trim() || !character.name.trim() || !character.visualDescription.trim()) throw new StudioPlanError('Incomplete character');
    if (characterIds.has(character.id)) throw new StudioPlanError('Duplicate character ID');
    characterIds.add(character.id);
  }
  const seenScenes = new Set<string>();
  let duration = 0;
  for (const [index, scene] of plan.scenes.entries()) {
    if (!scene.id.trim() || seenScenes.has(scene.id)) throw new StudioPlanError('Invalid or duplicate scene ID');
    seenScenes.add(scene.id);
    if (scene.order !== index + 1) throw new StudioPlanError('Scene order must be contiguous');
    if (!Number.isInteger(scene.durationSeconds) || scene.durationSeconds < 1) throw new StudioPlanError('Invalid scene duration');
    if (!scene.visualPrompt.trim()) throw new StudioPlanError('Scene visual prompt required');
    for (const id of scene.characterIds) if (!characterIds.has(id)) throw new StudioPlanError('Unknown character');
    for (const line of scene.dialogue) {
      if (!characterIds.has(line.characterId) || !scene.characterIds.includes(line.characterId) || !line.text.trim()) throw new StudioPlanError('Invalid dialogue attribution');
    }
    duration += scene.durationSeconds;
  }
  if (duration !== plan.durationSeconds) throw new StudioPlanError('Scene durations must equal total duration');
  if (plan.estimatedCostUsd !== null && (!Number.isFinite(plan.estimatedCostUsd) || plan.estimatedCostUsd < 0)) throw new StudioPlanError('Invalid cost estimate');
  if (plan.status === 'rendering' && (!plan.budgetApproved || plan.estimatedCostUsd === null)) throw new StudioPlanError('Rendering requires approval and cost estimate');
  return plan;
}
/** Rendering is forbidden until the user explicitly approves the estimated charge. */
export function authorizeStudioRendering(plan: StudioProductionPlan, approved: boolean): StudioProductionPlan {
  validateStudioPlan(plan);
  if (!approved) throw new StudioPlanError('Explicit approval required');
  if (plan.estimatedCostUsd === null) throw new StudioPlanError('Cost estimate required');
  if (!['draft','awaiting_approval'].includes(plan.status)) throw new StudioPlanError('Invalid transition');
  return validateStudioPlan({ ...plan, budgetApproved: true, status: 'rendering' });
}
