export interface SendEmailParams {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  messageId: string;
}

export type SendEmailFn = (params: SendEmailParams) => Promise<SendEmailResult>;

export interface EmailProviderInfo {
  provider: 'mailgun' | 'smtp' | null;
  configured: boolean;
  from: string | null;
}
