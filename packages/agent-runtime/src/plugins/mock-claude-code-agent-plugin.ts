// Mock plugin for UAT — returns fixture data instantly instead of spawning Claude CLI.
// Activate with MOCK_AGENT=true env var. The mock is handled by getMockDockerArgs()
// in the base class's spawnDockerContainer flow (MOCK_AGENT env var check).
//
// This class is kept for backward compatibility with plugin registration in platform-services.
// It inherits all behavior from ClaudeCodeAgentPlugin — the actual mock mechanism is
// the MOCK_AGENT=true env var check in BaseContainerAgentPlugin.spawnDockerContainer().

import { ClaudeCodeAgentPlugin } from './claude-code-agent-plugin.js';

export class MockClaudeCodeAgentPlugin extends ClaudeCodeAgentPlugin {}
