export interface PlatformSettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getByPrefix(prefix: string): Promise<Array<{ key: string; value: string }>>;
}
