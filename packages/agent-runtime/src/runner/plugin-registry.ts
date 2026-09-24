import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { StepExecutorPlugin } from '../interfaces/step-executor-plugin';

export class PluginNotFoundError extends Error {
  override name = 'PluginNotFoundError';

  constructor(pluginName: string) {
    super(`Plugin "${pluginName}" is not registered. Register it at application startup.`);
  }
}

/** Plugins keep run state on `this` between `initialize` and `run`, so every
 *  run needs its own instance — a shared one lets concurrent runs overwrite
 *  each other's context. Factories must be cheap and side-effect free:
 *  `register` calls one once to read the plugin's metadata. */
export type PluginFactory = () => StepExecutorPlugin;

interface RegisteredPlugin {
  create: PluginFactory;
  metadata?: PluginCapabilityMetadata;
}

export class PluginRegistry {
  private plugins = new Map<string, RegisteredPlugin>();

  register(name: string, create: PluginFactory): void {
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered. Duplicate registration is not allowed.`);
    }
    this.plugins.set(name, { create, metadata: create().metadata });
  }

  /** Returns a fresh plugin instance for one run. */
  get(name: string): StepExecutorPlugin {
    const registered = this.plugins.get(name);
    if (!registered) throw new PluginNotFoundError(name);
    return registered.create();
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  clear(): void {
    this.plugins.clear();
  }

  names(): string[] {
    return Array.from(this.plugins.keys());
  }

  list(): Array<{ name: string; metadata?: PluginCapabilityMetadata }> {
    return Array.from(this.plugins.entries()).map(([name, registered]) => ({
      name,
      metadata: registered.metadata,
    }));
  }
}
