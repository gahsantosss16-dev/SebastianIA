import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeStudioRendering, StudioPlanError, validateStudioPlan, type StudioProductionPlan } from '../../studio/VideoProductionPlan.js';

const plan: StudioProductionPlan = {
  title: 'O Robô que Entendeu Tudo Errado', format: '9:16', style: '3d_cartoon',
  language: 'pt-BR', durationSeconds: 30,
  characters: [
    { id: 'nina', name: 'Nina', visualDescription: 'Menina de jardineira roxa', voiceDescription: 'Infantil feminina' },
    { id: 'bolota', name: 'Bolota', visualDescription: 'Robô azul e branco', voiceDescription: 'Robótica' },
  ],
  scenes: [
    { id: 's1', order: 1, durationSeconds: 10, visualPrompt: 'Quarto bagunçado', characterIds: ['nina','bolota'], dialogue: [{characterId:'nina',text:'Limpe o quarto!'}] },
    { id: 's2', order: 2, durationSeconds: 10, visualPrompt: 'Robô empilha brinquedos', characterIds: ['bolota'], dialogue: [{characterId:'bolota',text:'Entendido!'}] },
    { id: 's3', order: 3, durationSeconds: 10, visualPrompt: 'Brinquedos caem no baú', characterIds: ['nina','bolota'], dialogue: [] },
  ],
  status: 'awaiting_approval', estimatedCostUsd: 2.5, budgetApproved: false,
};
test('valid production plan retains exact sequence and timing', () => {
  assert.equal(validateStudioPlan(plan), plan);
});
test('rejects out-of-order scenes, mismatched timing and missing characters', () => {
  assert.throws(() => validateStudioPlan({...plan, scenes: [...plan.scenes].reverse()}), StudioPlanError);
  assert.throws(() => validateStudioPlan({...plan, durationSeconds: 29}), StudioPlanError);
  assert.throws(() => validateStudioPlan({...plan, characters: []}), StudioPlanError);
});
test('never authorizes paid rendering without explicit approval and an estimate', () => {
  assert.throws(() => authorizeStudioRendering(plan, false), StudioPlanError);
  assert.throws(() => authorizeStudioRendering({...plan,estimatedCostUsd:null}, true), StudioPlanError);
  assert.equal(authorizeStudioRendering(plan, true).status, 'rendering');
  assert.throws(() => validateStudioPlan({...plan,status:'rendering'}), StudioPlanError);
});
