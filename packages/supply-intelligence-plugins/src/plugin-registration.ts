// Plugin registration for supply intelligence agent plugins.
// Called from platform-ui's getPlatformServices() to register both plugins.

import type { PluginRegistry } from '@mediforce/agent-runtime';
import { DriverAgentPlugin } from './driver-agent-plugin.js';
import { RiskDetectionPlugin } from './risk-detection-plugin.js';

export function registerSupplyIntelligencePlugins(
  registry: PluginRegistry,
): void {
  registry.register(
    'supply-intelligence/driver-agent',
    new DriverAgentPlugin(),
  );
  registry.register(
    'supply-intelligence/risk-detection',
    new RiskDetectionPlugin(),
  );
}
