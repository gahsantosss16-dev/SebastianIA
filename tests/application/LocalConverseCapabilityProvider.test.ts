import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSE_CAPABILITY_ID,
  LOCAL_CONVERSE_COMMAND_TYPE,
  localConverseCapabilityProvider,
} from '../../application/LocalConverseCapabilityProvider.js';
import type { CapabilityInvocation } from '../../core/capability/index.js';

function invocation(overrides: Partial<CapabilityInvocation> = {}): CapabilityInvocation {
  return {
    capabilityId: CONVERSE_CAPABILITY_ID,
    input: {},
    context: {},
    generatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

test('provider exposes the converse registration', () => {
  const registrations = localConverseCapabilityProvider.listRegistrations();

  assert.equal(localConverseCapabilityProvider.providerId, 'provider.converse.local');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.descriptor.id, CONVERSE_CAPABILITY_ID);
  assert.equal(registrations[0]?.descriptor.handlerId, 'handler.converse.local');
  assert.equal(LOCAL_CONVERSE_COMMAND_TYPE, 'converse');
});

test('handler passes the trimmed free text through without interpreting it', () => {
  const [registration] = localConverseCapabilityProvider.listRegistrations();

  assert.deepEqual(
    registration?.handler(invocation({ input: { text: '  Sebastian, lembra que prefiro reuniões de manhã  ' } })),
    { text: 'Sebastian, lembra que prefiro reuniões de manhã' },
  );
});

test('handler tolerates a missing or invalid text field', () => {
  const [registration] = localConverseCapabilityProvider.listRegistrations();

  assert.deepEqual(registration?.handler(invocation({ input: {} })), { text: '' });
  assert.deepEqual(registration?.handler(invocation({ input: { text: 42 } })), { text: '' });
});
