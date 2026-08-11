import type {
  CapabilityHandler,
  CapabilityProvider,
  CapabilityRegistration,
} from '../core/capability/index.js';
import { MEMORY_REMEMBER_COMMAND_TYPE, type RememberedFactRecord } from '../core/memory/index.js';

export const MEMORY_REMEMBER_CAPABILITY_ID = 'cap.memory.remember';
export const MEMORY_RECALL_CAPABILITY_ID = 'cap.memory.recall';

export const LOCAL_MEMORY_REMEMBER_COMMAND_TYPE = MEMORY_REMEMBER_COMMAND_TYPE;
export const LOCAL_MEMORY_RECALL_COMMAND_TYPE = 'recall';

const EMPTY_RECALL_MESSAGE = 'Nenhuma memória registrada ainda.';

const rememberHandler: CapabilityHandler = (invocation) => {
  const text = invocation.input.text;
  const content = typeof text === 'string' ? text.trim() : '';

  return { fact: content };
};

const recallHandler: CapabilityHandler = (invocation) => {
  const temporary = invocation.context.temporary as
    | { readonly rememberedFacts?: readonly RememberedFactRecord[] }
    | undefined;
  const facts = temporary?.rememberedFacts ?? [];

  if (facts.length === 0) {
    return { message: EMPTY_RECALL_MESSAGE, facts: [] };
  }

  return { message: `${facts.length} memória(s) registrada(s).`, facts };
};

const rememberRegistration: CapabilityRegistration = Object.freeze({
  descriptor: Object.freeze({
    id: MEMORY_REMEMBER_CAPABILITY_ID,
    name: 'Local Remember Capability',
    version: '1.0.0',
    handlerId: 'handler.memory.remember.local',
  }),
  handler: rememberHandler,
});

const recallRegistration: CapabilityRegistration = Object.freeze({
  descriptor: Object.freeze({
    id: MEMORY_RECALL_CAPABILITY_ID,
    name: 'Local Recall Capability',
    version: '1.0.0',
    handlerId: 'handler.memory.recall.local',
  }),
  handler: recallHandler,
});

export const localMemoryCapabilityProvider: CapabilityProvider = Object.freeze({
  providerId: 'provider.memory.local',
  listRegistrations: (): readonly CapabilityRegistration[] =>
    Object.freeze([rememberRegistration, recallRegistration]),
});
