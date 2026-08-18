import { isRequiredEnvSatisfied, type PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type { GetCapabilitiesInput, GetCapabilitiesOutput } from '../../contract/capabilities';

/**
 * Report which platform capabilities this instance can actually run, so the
 * Add Block picker can offer a "Send email" block only where email is wired up
 * — rather than letting the author place a step that dies mid-run.
 *
 * @public-handler  Capabilities are deployment-wide, not workspace-scoped, and
 * the response is derived: a provider name and a plugin name, never env var
 * names, addresses, or credentials. Every authenticated caller sees the same
 * answer, which is what the picker needs before any workflow exists.
 */
export async function getCapabilities(
  _input: GetCapabilitiesInput,
  scope: CallerScope,
): Promise<GetCapabilitiesOutput> {
  const email = scope.system.emailProviderInfo;

  // A plugin that names a foundation model is one that runs an agent; the
  // script and job plugins do not. Its `requiredEnv` says what it needs.
  const modelPlugins = scope.plugins.list().filter((entry) => {
    const metadata = entry.metadata as PluginCapabilityMetadata | undefined;
    return metadata?.foundationModel !== undefined;
  });
  const usableAgent = modelPlugins.find((entry) => {
    const metadata = entry.metadata as PluginCapabilityMetadata | undefined;
    return isRequiredEnvSatisfied(metadata?.requiredEnv, process.env);
  });

  return {
    capabilities: {
      email: email?.configured === true
        ? { available: true, detail: email.provider ?? undefined }
        : {
          available: false,
          reason: 'No email delivery is configured on this instance. An admin can set up SMTP or Mailgun.',
        },
      agents: usableAgent !== undefined
        ? { available: true, detail: usableAgent.name }
        : {
          available: false,
          reason: 'No agent model is configured on this instance. An admin can add an OpenRouter or Anthropic API key.',
        },
    },
  };
}
