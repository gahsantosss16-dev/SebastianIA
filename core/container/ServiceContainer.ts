import type { ServiceIdentifier } from './ServiceIdentifier.js';

export type ServiceFactory<TService> = () => TService;
export type ServiceRegistration<TService> = {
  factory: ServiceFactory<TService>;
  singleton: boolean;
  instance?: TService;
};

export class ServiceContainer {
  private readonly registrations = new Map<ServiceIdentifier, ServiceRegistration<unknown>>();
  private readonly instances = new Map<ServiceIdentifier, unknown>();

  public register<TService>(identifier: ServiceIdentifier<TService>, factory: ServiceFactory<TService>): void {
    this.registrations.set(identifier, {
      factory: factory as ServiceFactory<unknown>,
      singleton: false,
    });
  }

  public registerSingleton<TService>(identifier: ServiceIdentifier<TService>, factory: ServiceFactory<TService>): void {
    this.registrations.set(identifier, {
      factory: factory as ServiceFactory<unknown>,
      singleton: true,
    });
  }

  public registerInstance<TService>(identifier: ServiceIdentifier<TService>, instance: TService): void {
    this.registrations.set(identifier, {
      factory: () => instance,
      singleton: true,
      instance,
    });
    this.instances.set(identifier, instance);
  }

  public resolve<TService>(identifier: ServiceIdentifier<TService>): TService {
    const registration = this.registrations.get(identifier);

    if (!registration) {
      throw new Error(`Service not registered: ${String(identifier)}`);
    }

    if (registration.singleton && this.instances.has(identifier)) {
      return this.instances.get(identifier) as TService;
    }

    const instance = registration.factory();

    if (registration.singleton) {
      this.instances.set(identifier, instance);
    }

    return instance as TService;
  }

  public has(identifier: ServiceIdentifier): boolean {
    return this.registrations.has(identifier);
  }

  public remove(identifier: ServiceIdentifier): void {
    this.registrations.delete(identifier);
    this.instances.delete(identifier);
  }

  public clear(): void {
    this.registrations.clear();
    this.instances.clear();
  }
}
