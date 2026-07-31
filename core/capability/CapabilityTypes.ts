export interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly handlerId: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

export interface CapabilityInvocation {
  readonly capabilityId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}

export interface CapabilityResult {
  readonly status: 'succeeded';
  readonly output: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}

export type CapabilityHandler = (invocation: CapabilityInvocation) => Record<string, unknown>;

export interface CapabilityRegistration {
  readonly descriptor: CapabilityDescriptor;
  readonly handler: CapabilityHandler;
}
