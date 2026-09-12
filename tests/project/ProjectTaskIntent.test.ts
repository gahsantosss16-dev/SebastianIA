import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectTaskIntent } from '../../core/project/ProjectTaskIntent.js';

test('a capability question containing "fazer" is never classified as write, even in a long natural message', () => {
  for (const text of [
    'o que você consegue fazer por mim?',
    'Sebastian, vamos trabalhar no Neuro Hub Pro.\nQuero que você veja como o projeto está hoje e me diga o que você consegue fazer por mim diretamente nele agora, na prática.\nNão quero explicação de arquitetura, código interno, testes ou como você funciona por trás.\nQuero funcionalidades: coisas que eu posso pedir aqui na conversa e você consegue realmente executar no Neuro para mim.',
    'que funcionalidades você consegue fazer no projeto?',
    'o que você faz aqui?',
  ]) {
    assert.notEqual(classifyProjectTaskIntent(text), 'write', `expected "${text.slice(0, 40)}..." to NOT be write`);
  }
});

test('real imperative orders using "faz"/"fazer" are still classified as write', () => {
  for (const text of ['faz isso', 'pode fazer', 'faz do jeito que você falou', 'pode fazer a correção no botão', 'faça a correção no arquivo']) {
    assert.equal(classifyProjectTaskIntent(text), 'write', `expected "${text}" to be write`);
  }
});
