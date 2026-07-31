import { InvalidMemoryKeyError, InvalidMemoryNamespaceError } from './MemoryErrors.js';

export class MemoryManager {
  private readonly store = new Map<string, Map<string, unknown>>();

  public async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.assertValidNamespace(namespace);
    this.assertValidKey(key);

    const namespaceEntries = this.getOrCreateNamespace(namespace);
    namespaceEntries.set(key, this.cloneValue(value));
  }

  public async get<T>(namespace: string, key: string): Promise<T | undefined> {
    this.assertValidNamespace(namespace);
    this.assertValidKey(key);

    const namespaceEntries = this.store.get(namespace);
    if (!namespaceEntries) {
      return undefined;
    }

    const value = namespaceEntries.get(key);
    return value === undefined ? undefined : this.cloneValue(value as T);
  }

  public async has(namespace: string, key: string): Promise<boolean> {
    this.assertValidNamespace(namespace);
    this.assertValidKey(key);

    const namespaceEntries = this.store.get(namespace);
    return namespaceEntries?.has(key) ?? false;
  }

  public async remove(namespace: string, key: string): Promise<boolean> {
    this.assertValidNamespace(namespace);
    this.assertValidKey(key);

    const namespaceEntries = this.store.get(namespace);
    if (!namespaceEntries) {
      return false;
    }

    const deleted = namespaceEntries.delete(key);
    if (namespaceEntries.size === 0) {
      this.store.delete(namespace);
    }

    return deleted;
  }

  public async clearNamespace(namespace: string): Promise<void> {
    this.assertValidNamespace(namespace);
    this.store.delete(namespace);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  public async size(): Promise<number> {
    let total = 0;

    for (const namespaceEntries of this.store.values()) {
      total += namespaceEntries.size;
    }

    return total;
  }

  private getOrCreateNamespace(namespace: string): Map<string, unknown> {
    let namespaceEntries = this.store.get(namespace);
    if (!namespaceEntries) {
      namespaceEntries = new Map<string, unknown>();
      this.store.set(namespace, namespaceEntries);
    }

    return namespaceEntries;
  }

  private assertValidNamespace(namespace: string): void {
    if (typeof namespace !== 'string' || namespace.trim() === '') {
      throw new InvalidMemoryNamespaceError('Memory namespace must be a non-empty string');
    }
  }

  private assertValidKey(key: string): void {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new InvalidMemoryKeyError('Memory key must be a non-empty string');
    }
  }

  private cloneValue<T>(value: T): T {
    return structuredClone(value) as T;
  }
}
