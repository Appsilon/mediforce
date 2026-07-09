import { z } from 'zod';

export const GetEmailStatusInputSchema = z.object({});
export type GetEmailStatusInput = z.infer<typeof GetEmailStatusInputSchema>;

export const GetEmailStatusOutputSchema = z.object({
  provider: z.enum(['mailgun', 'smtp']).nullable(),
  configured: z.boolean(),
  from: z.string().nullable(),
});
export type GetEmailStatusOutput = z.infer<typeof GetEmailStatusOutputSchema>;
