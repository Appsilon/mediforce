import { z } from 'zod';

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
