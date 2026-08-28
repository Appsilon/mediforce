import type { CallerScope } from '../../repositories/index';
import type { GetCapabilitiesInput, GetCapabilitiesOutput } from '../../contract/capabilities';

/**
 * Lets the picker offer "Send email" only where email is wired up, instead of
 * letting an author place a step that dies mid-run.
 *
 * Deployment-wide rather than workspace-scoped, so every authenticated caller
 * gets the same answer. The response is derived — a provider name, never env var
 * names, addresses, or credentials.
 *
 * Only capabilities the platform can answer for the whole deployment belong here.
 * Agent availability deliberately does not: the model key reaches the runner
 * through `DOCKER_*`-prefixed host env and through workflow or namespace secrets
 * (see `.env.example` and `opencode-agent-plugin`), so a check against this
 * process's env would grey out agent blocks on a deployment where they work.
 */
export async function getCapabilities(
  _input: GetCapabilitiesInput,
  scope: CallerScope,
): Promise<GetCapabilitiesOutput> {
  const email = scope.system.emailProviderInfo;

  return {
    capabilities: {
      email: email?.configured === true
        ? { available: true, detail: email.provider ?? undefined }
        : {
          available: false,
          reason: 'No email delivery is configured on this instance. An admin can set up SMTP or Mailgun.',
        },
    },
  };
}
