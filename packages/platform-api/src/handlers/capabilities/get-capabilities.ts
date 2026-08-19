import { isRequiredEnvSatisfied, PluginCapabilityMetadataSchema } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type { GetCapabilitiesInput, GetCapabilitiesOutput } from '../../contract/capabilities';

/**
 * Lets the picker offer "Send email" only where email is wired up, instead of
 * letting an author place a step that dies mid-run.
 *
 * Deployment-wide rather than workspace-scoped, so every authenticated caller
 * gets the same answer. The response is derived — a provider name and a plugin
 * name, never env var names, addresses, or credentials.
 */
export async function getCapabilities(
  _input: GetCapabilitiesInput,
  scope: CallerScope,
): Promise<GetCapabilitiesOutput> {
  const email = scope.system.emailProviderInfo;

  // A foundation model marks a plugin as agent-running; script and job plugins
  // have none. Parsed rather than cast, so a bad shape is skipped, not trusted.
  const usableAgent = scope.plugins.list().find((entry) => {
    const parsed = PluginCapabilityMetadataSchema.safeParse(entry.metadata);
    if (!parsed.success || parsed.data.foundationModel === undefined) return false;
    return isRequiredEnvSatisfied(parsed.data.requiredEnv, process.env);
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
