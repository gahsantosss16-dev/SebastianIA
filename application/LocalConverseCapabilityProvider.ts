import type {
  CapabilityHandler,
  CapabilityProvider,
  CapabilityRegistration,
} from '../core/capability/index.js';
import { CONVERSE_COMMAND_TYPE } from '../core/agent/index.js';

export const CONVERSE_CAPABILITY_ID = 'cap.converse';
export const LOCAL_CONVERSE_COMMAND_TYPE = CONVERSE_COMMAND_TYPE;

/**
 * Deliberately unintelligent: this capability only packages the free-form
 * text for the Agent to interpret. No natural-language decision-making
 * happens here - that responsibility belongs to the Agent and its
 * ModelProvider dependency, per SPEC-039.
 */
const converseHandler: CapabilityHandler = (invocation) => {
  const text = invocation.input.text;
  const content = typeof text === 'string' ? text.trim() : '';

  return { text: content };
};

const converseRegistration: CapabilityRegistration = Object.freeze({
  descriptor: Object.freeze({
    id: CONVERSE_CAPABILITY_ID,
    name: 'Local Converse Capability',
    version: '1.0.0',
    handlerId: 'handler.converse.local',
  }),
  handler: converseHandler,
});

export const localConverseCapabilityProvider: CapabilityProvider = Object.freeze({
  providerId: 'provider.converse.local',
  listRegistrations: (): readonly CapabilityRegistration[] => Object.freeze([converseRegistration]),
});
