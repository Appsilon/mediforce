import type { PlatformSettingsRepository } from '../repositories/platform-settings-repository';

export class InMemoryPlatformSettingsRepository implements PlatformSettingsRepository {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async getByPrefix(prefix: string): Promise<Array<{ key: string; value: string }>> {
    const results: Array<{ key: string; value: string }> = [];
    for (const [key, value] of this.store) {
      if (key.startsWith(prefix)) {
        results.push({ key, value });
      }
    }
    return results;
  }
}
