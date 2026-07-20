import { z } from 'zod';

/**
 * Platform-settings key holding the deployment's public base URL (e.g.
 * `https://phuse.mediforce.ai`). Read at invite time to build workspace/login
 * links; set via `mediforce config set platform.baseUrl <url>`. Falls back to
 * `NEXT_PUBLIC_PLATFORM_URL` then localhost when unset.
 */
export const PLATFORM_BASE_URL_SETTING_KEY = 'platform.baseUrl';

/**
 * Normalize a configured or caller-supplied base URL before it lands in an
 * email link: trim whitespace, strip trailing slashes so callers can safely
 * append `/login`, and treat blank input as "unset" (`undefined`) so the
 * fallback ladder — never an empty string that would yield `/login` — wins.
 */
export function normalizeBaseUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  return trimmed === '' ? undefined : trimmed;
}

export const GetConfigInputSchema = z.object({ key: z.string().min(1) });
export type GetConfigInput = z.infer<typeof GetConfigInputSchema>;
export const GetConfigOutputSchema = z.object({ key: z.string(), value: z.string().nullable() });
export type GetConfigOutput = z.infer<typeof GetConfigOutputSchema>;

export const GetConfigByPrefixInputSchema = z.object({ prefix: z.string().min(1) });
export type GetConfigByPrefixInput = z.infer<typeof GetConfigByPrefixInputSchema>;
export const GetConfigByPrefixOutputSchema = z.object({
  settings: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type GetConfigByPrefixOutput = z.infer<typeof GetConfigByPrefixOutputSchema>;

export const SetConfigInputSchema = z.object({ key: z.string().min(1), value: z.string() });
export type SetConfigInput = z.infer<typeof SetConfigInputSchema>;
export const SetConfigOutputSchema = z.object({ ok: z.boolean() });
export type SetConfigOutput = z.infer<typeof SetConfigOutputSchema>;

export const TestWebhookOutputSchema = z.object({ ok: z.boolean(), error: z.string().optional() });
export type TestWebhookOutput = z.infer<typeof TestWebhookOutputSchema>;
