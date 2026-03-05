import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { AgentPlugin } from '../interfaces/agent-plugin.js';

export class PluginNotFoundError extends Error {
  override name = 'PluginNotFoundError';

  constructor(pluginName: string) {
    super(`Plugin "${pluginName}" is not registered. Register it at application startup.`);
  }
}

export class PluginRegistry {
  private plugins = new Map<string, AgentPlugin>();

  register(name: string, plugin: AgentPlugin): void {
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered. Duplicate registration is not allowed.`);
    }
    this.plugins.set(name, plugin);
  }

  get(name: string): AgentPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new PluginNotFoundError(name);
    return plugin;
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
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name,
      metadata: plugin.metadata,
    }));
  }
}
