import { eq, like, sql } from 'drizzle-orm';
import type { PlatformSettingsRepository } from '@mediforce/platform-core';
import type { Database } from '../client';
import { platformSettings } from '../schema/platform-settings';

export class PostgresPlatformSettingsRepository implements PlatformSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(platformSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value,
          updatedAt: sql`NOW()`,
        },
      });
  }

  async getByPrefix(prefix: string): Promise<Array<{ key: string; value: string }>> {
    const escaped = prefix.replace(/[%_]/g, '\\$&');
    return this.db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings)
      .where(like(platformSettings.key, `${escaped}%`));
  }
}
