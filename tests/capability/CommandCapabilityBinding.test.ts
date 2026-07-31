import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandCapabilityBindings,
  type CommandCapabilityBinding,
  type CapabilityDescriptor,
} from '../../core/capability/index.js';
import {
  CommandCapabilityBindingConsistencyError,
  CommandCapabilityBindingNotFoundError,
  DuplicateCommandCapabilityBindingError,
  InvalidCommandCapabilityBindingError,
} from '../../core/capability/CommandCapabilityBindingErrors.js';
import { CommandCapabilityBindings as CoreCommandCapabilityBindings } from '../../core/index.js';

const validBindings: readonly CommandCapabilityBinding[] = [
  {
    commandType: 'greeting',
    capabilityId: 'cap.greeting',
  },
  {
    commandType: 'reverse',
    capabilityId: 'cap.reverse',
  },
];

const validCatalog: readonly CapabilityDescriptor[] = [
  {
    id: 'cap.greeting',
    name: 'Greeting Capability',
    version: '1.0.0',
    handlerId: 'handler.greeting',
  },
  {
    id: 'cap.reverse',
    name: 'Reverse Capability',
    version: '1.0.0',
    handlerId: 'handler.reverse',
  },
];

test('CommandCapabilityBindings supports valid bindings', () => {
  const bindings = new CommandCapabilityBindings(validBindings);

  assert.equal(bindings.has('greeting'), true);
  assert.equal(bindings.resolveCapabilityId('greeting'), 'cap.greeting');
});

test('CommandCapabilityBindings rejects invalid commandType', () => {
  assert.throws(
    () =>
      new CommandCapabilityBindings([
        {
          commandType: '   ',
          capabilityId: 'cap.greeting',
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityBindingError);
      return true;
    },
  );
});

test('CommandCapabilityBindings rejects invalid capabilityId', () => {
  assert.throws(
    () =>
      new CommandCapabilityBindings([
        {
          commandType: 'greeting',
          capabilityId: '',
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityBindingError);
      return true;
    },
  );
});

test('CommandCapabilityBindings rejects duplicate commandType', () => {
  assert.throws(
    () =>
      new CommandCapabilityBindings([
        {
          commandType: 'greeting',
          capabilityId: 'cap.greeting',
        },
        {
          commandType: 'greeting',
          capabilityId: 'cap.greeting.v2',
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateCommandCapabilityBindingError);
      return true;
    },
  );
});

test('CommandCapabilityBindings resolves capabilityId for an existing commandType', () => {
  const bindings = new CommandCapabilityBindings(validBindings);

  assert.equal(bindings.resolveCapabilityId('reverse'), 'cap.reverse');
});

test('CommandCapabilityBindings throws typed error for missing commandType', () => {
  const bindings = new CommandCapabilityBindings(validBindings);

  assert.throws(
    () => bindings.resolveCapabilityId('unknown'),
    (error: unknown) => {
      assert.ok(error instanceof CommandCapabilityBindingNotFoundError);
      return true;
    },
  );
});

test('CommandCapabilityBindings validates consistency against a compatible catalog', () => {
  const bindings = new CommandCapabilityBindings(validBindings);

  assert.doesNotThrow(() => bindings.validateAgainstCatalog(validCatalog));
});

test('CommandCapabilityBindings rejects catalog consistency when capability is missing', () => {
  const bindings = new CommandCapabilityBindings(validBindings);

  const missingCatalog: readonly CapabilityDescriptor[] = [
    {
      id: 'cap.greeting',
      name: 'Greeting Capability',
      version: '1.0.0',
      handlerId: 'handler.greeting',
    },
  ];

  assert.throws(
    () => bindings.validateAgainstCatalog(missingCatalog),
    (error: unknown) => {
      assert.ok(error instanceof CommandCapabilityBindingConsistencyError);
      return true;
    },
  );
});

test('CommandCapabilityBindings listBindings returns protected copies', () => {
  const bindings = new CommandCapabilityBindings(validBindings);
  const listed = bindings.listBindings();

  assert.ok(listed.length > 0);

  const mutableListed = listed as unknown as Array<{ commandType: string; capabilityId: string }>;
  const first = mutableListed.at(0);
  if (!first) {
    assert.fail('Expected at least one binding.');
  }

  first.commandType = 'mutated';
  first.capabilityId = 'mutated';

  assert.equal(bindings.resolveCapabilityId('greeting'), 'cap.greeting');
  assert.equal(bindings.has('mutated'), false);
});

test('CommandCapabilityBindings are deterministic for the same input sequence', () => {
  const left = new CommandCapabilityBindings(validBindings).listBindings();
  const right = new CommandCapabilityBindings(validBindings).listBindings();

  assert.deepEqual(left, right);
});

test('core public entrypoint exposes CommandCapabilityBindings', () => {
  assert.equal(typeof CoreCommandCapabilityBindings, 'function');
});