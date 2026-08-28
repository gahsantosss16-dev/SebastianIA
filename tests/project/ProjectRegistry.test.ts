import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import {
  InvalidProjectRegistrationError,
  ProjectAlreadyRegisteredError,
  ProjectRegistryError,
} from '../../core/project/ProjectRegistryErrors.js';
import type { ProjectDescriptor } from '../../core/project/ProjectTypes.js';

function neuroHub(overrides: Partial<ProjectDescriptor> = {}): ProjectDescriptor {
  return {
    id: 'neuro-hub-pro',
    displayName: 'Neuro Hub Pro',
    aliases: ['Neuro Hub', 'NeuroHub'],
    resourceKind: 'github-repository',
    remoteRepository: { owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    permissions: { access: 'read-only' },
    ...overrides,
  };
}

test('resolves a registered project by its exact id', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  const resolved = registry.resolve('neuro-hub-pro');

  assert.equal(resolved?.id, 'neuro-hub-pro');
  assert.equal(resolved?.remoteRepository.owner, 'sebastian-org');
});

test('resolves a registered project by displayName and by any registered alias, normalized', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  assert.equal(registry.resolve('Neuro Hub Pro')?.id, 'neuro-hub-pro');
  assert.equal(registry.resolve('Neuro Hub')?.id, 'neuro-hub-pro');
  assert.equal(registry.resolve('  neuro   hub  ')?.id, 'neuro-hub-pro');
  assert.equal(registry.resolve('NEURO HUB')?.id, 'neuro-hub-pro');
  assert.equal(registry.resolve('néuro hub')?.id, 'neuro-hub-pro');
});

test('an unregistered, invented reference never resolves to any project', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  assert.equal(registry.resolve('Neuro Hub Enterprise'), undefined);
  assert.equal(registry.resolve('some-other-repo'), undefined);
  assert.equal(registry.resolve(''), undefined);
  assert.equal(registry.resolve('   '), undefined);
});

test('resolution never falls back to a closest fuzzy match', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  // Close, but not an exact normalized match to any registered id/displayName/alias.
  assert.equal(registry.resolve('Neuro Hubb'), undefined);
  assert.equal(registry.resolve('Neuro'), undefined);
});

test('rejects a duplicate project id', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  assert.throws(
    () => registry.register(neuroHub({ displayName: 'Different Name', aliases: [] })),
    (error: unknown) => {
      assert.ok(error instanceof ProjectAlreadyRegisteredError);
      return true;
    },
  );
});

test('rejects an alias that collides with a previously registered project reference', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  assert.throws(
    () =>
      registry.register(
        neuroHub({ id: 'another-project', displayName: 'Another Project', aliases: ['Neuro Hub'] }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProjectAlreadyRegisteredError);
      return true;
    },
  );
});

test('rejects an invalid descriptor: missing fields, wrong resourceKind, or non-read-only access', () => {
  const registry = new ProjectRegistry();

  assert.throws(
    () => registry.register(neuroHub({ id: '' })),
    (error: unknown) => {
      assert.ok(error instanceof InvalidProjectRegistrationError);
      return true;
    },
  );
  assert.throws(
    () => registry.register(neuroHub({ resourceKind: 'local-agent' as never })),
    (error: unknown) => {
      assert.ok(error instanceof InvalidProjectRegistrationError);
      return true;
    },
  );
  assert.throws(
    () => registry.register(neuroHub({ permissions: { access: 'read-write' as never } })),
    (error: unknown) => {
      assert.ok(error instanceof InvalidProjectRegistrationError);
      return true;
    },
  );
  assert.throws(
    () => registry.register(neuroHub({ remoteRepository: { owner: '', repository: 'neuro-hub', defaultBranch: 'main' } })),
    (error: unknown) => {
      assert.ok(error instanceof InvalidProjectRegistrationError);
      return true;
    },
  );
});

test('a read-only registry rejects further registration after initialization', () => {
  const registry = new ProjectRegistry({ readOnly: true, entries: [neuroHub()] });

  assert.equal(registry.resolve('Neuro Hub')?.id, 'neuro-hub-pro');
  assert.throws(
    () => registry.register(neuroHub({ id: 'second-project', displayName: 'Second Project', aliases: [] })),
    (error: unknown) => {
      assert.ok(error instanceof ProjectRegistryError);
      return true;
    },
  );
});

test('resolve and listDescriptors return defensive copies, never the internal descriptor', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub()] });

  const resolved = registry.resolve('neuro-hub-pro') as unknown as { displayName: string };
  resolved.displayName = 'Tampered';

  assert.equal(registry.resolve('neuro-hub-pro')?.displayName, 'Neuro Hub Pro');
  assert.equal(registry.listDescriptors()[0]?.displayName, 'Neuro Hub Pro');
});

test('an optional localAgentPath is accepted when a non-empty string, reserved and unused', () => {
  const registry = new ProjectRegistry({ entries: [neuroHub({ localAgentPath: 'C:/future/local/path' })] });

  assert.equal(registry.resolve('neuro-hub-pro')?.localAgentPath, 'C:/future/local/path');

  assert.throws(
    () => new ProjectRegistry({ entries: [neuroHub({ id: 'x', displayName: 'X', aliases: [], localAgentPath: '   ' })] }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidProjectRegistrationError);
      return true;
    },
  );
});
