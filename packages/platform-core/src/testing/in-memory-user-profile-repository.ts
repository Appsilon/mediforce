import type { UserProfile, UserProfileRepository } from '../interfaces/user-profile-repository.js';

export class InMemoryUserProfileRepository implements UserProfileRepository {
  private readonly profiles = new Map<string, UserProfile>();

  async getProfile(uid: string): Promise<UserProfile | null> {
    return this.profiles.get(uid) ?? null;
  }

  async setMustChangePassword(uid: string, value: boolean): Promise<void> {
    const current = this.profiles.get(uid);
    this.profiles.set(uid, { ...(current ?? { mustChangePassword: false }), mustChangePassword: value });
  }
}
