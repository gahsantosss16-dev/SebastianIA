import type {
  CapabilityHandler,
  CapabilityProvider,
  CapabilityRegistration,
} from '../core/capability/index.js';

export const LOCAL_GREETING_CAPABILITY_ID = 'cap.greeting';
export const LOCAL_GREETING_COMMAND_TYPE = 'greeting';

const greetingHandler: CapabilityHandler = (invocation) => {
  const name = invocation.input.name;
  const normalizedName = typeof name === 'string' ? name.trim() : '';

  return {
    message: normalizedName ? `Hello, ${normalizedName}!` : 'Hello!',
  };
};

const registration: CapabilityRegistration = Object.freeze({
  descriptor: Object.freeze({
    id: LOCAL_GREETING_CAPABILITY_ID,
    name: 'Local Greeting Capability',
    version: '1.0.0',
    handlerId: 'handler.greeting.local',
  }),
  handler: greetingHandler,
});

export const localGreetingCapabilityProvider: CapabilityProvider = Object.freeze({
  providerId: 'provider.greeting.local',
  listRegistrations: (): readonly CapabilityRegistration[] => Object.freeze([registration]),
});
