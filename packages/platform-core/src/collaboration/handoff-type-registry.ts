import type { z } from 'zod';

export interface HandoffTypeRegistration {
  type: string;
  payloadSchema: z.ZodTypeAny;
  resolutionSchema: z.ZodTypeAny;
}

class HandoffTypeRegistry {
  private readonly registry = new Map<string, HandoffTypeRegistration>();

  /**
   * Register an app-defined handoff type at startup.
   * Must be called before the first createHandoff() for this type.
   * Throws if the type is already registered (prevents silent overwrites).
   */
  register(registration: HandoffTypeRegistration): void {
    if (this.registry.has(registration.type)) {
      throw new Error(`Handoff type '${registration.type}' is already registered`);
    }
    this.registry.set(registration.type, registration);
  }

  getPayloadSchema(type: string): z.ZodTypeAny {
    const reg = this.registry.get(type);
    if (!reg) throw new Error(`Unknown handoff type: '${type}'. Call registerHandoffType() at app startup.`);
    return reg.payloadSchema;
  }

  getResolutionSchema(type: string): z.ZodTypeAny {
    const reg = this.registry.get(type);
    if (!reg) throw new Error(`Unknown handoff type: '${type}'. Call registerHandoffType() at app startup.`);
    return reg.resolutionSchema;
  }

  isRegistered(type: string): boolean {
    return this.registry.has(type);
  }

  /**
   * Reset registry state. ONLY for use in tests (afterEach cleanup).
   * Call handoffTypeRegistry.reset() in afterEach to prevent state leakage between tests.
   */
  reset(): void {
    this.registry.clear();
  }
}

/** Singleton exported for app startup registration and platform use. */
export const handoffTypeRegistry = new HandoffTypeRegistry();
