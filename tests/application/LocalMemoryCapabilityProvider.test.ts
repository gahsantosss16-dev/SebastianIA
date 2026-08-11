import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_MEMORY_RECALL_COMMAND_TYPE,
  LOCAL_MEMORY_REMEMBER_COMMAND_TYPE,
  MEMORY_RECALL_CAPABILITY_ID,
  MEMORY_REMEMBER_CAPABILITY_ID,
  localMemoryCapabilityProvider,
} from '../../application/LocalMemoryCapabilityProvider.js';
import type { CapabilityInvocation } from '../../core/capability/index.js';

function invocation(overrides: Partial<CapabilityInvocation> = {}): CapabilityInvocation {
  return {
    capabilityId: MEMORY_REMEMBER_CAPABILITY_ID,
    input: {},
    context: {},
    generatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

test('provider exposes remember and recall registrations', () => {
  const registrations = localMemoryCapabilityProvider.listRegistrations();

  assert.equal(localMemoryCapabilityProvider.providerId, 'provider.memory.local');
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0]?.descriptor.id, MEMORY_REMEMBER_CAPABILITY_ID);
  assert.equal(registrations[1]?.descriptor.id, MEMORY_RECALL_CAPABILITY_ID);
  assert.equal(LOCAL_MEMORY_REMEMBER_COMMAND_TYPE, 'remember');
  assert.equal(LOCAL_MEMORY_RECALL_COMMAND_TYPE, 'recall');
});

test('remember handler returns the trimmed fact content', () => {
  const [rememberRegistration] = localMemoryCapabilityProvider.listRegistrations();

  assert.deepEqual(
    rememberRegistration?.handler(invocation({ input: { text: '  prefiro reuniões de manhã  ' } })),
    { fact: 'prefiro reuniões de manhã' },
  );
});

test('remember handler tolerates a missing text field', () => {
  const [rememberRegistration] = localMemoryCapabilityProvider.listRegistrations();

  assert.deepEqual(rememberRegistration?.handler(invocation({ input: {} })), { fact: '' });
});

test('recall handler reports a clear message when memory is empty', () => {
  const [, recallRegistration] = localMemoryCapabilityProvider.listRegistrations();

  assert.deepEqual(recallRegistration?.handler(invocation({ context: {} })), {
    message: 'Nenhuma memória registrada ainda.',
    facts: [],
  });
});

test('recall handler returns the remembered facts hydrated into context', () => {
  const [, recallRegistration] = localMemoryCapabilityProvider.listRegistrations();
  const rememberedFacts = [{ id: 'remember:1', content: 'prefiro reuniões de manhã', recordedAt: '2026-08-11T00:00:00.000Z' }];

  assert.deepEqual(
    recallRegistration?.handler(invocation({ context: { temporary: { rememberedFacts } } })),
    { message: '1 memória(s) registrada(s).', facts: rememberedFacts },
  );
});
