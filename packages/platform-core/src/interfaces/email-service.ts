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
  // `file` is a dev/E2E sink that writes emails to a file instead of sending
  // them (MEDIFORCE_EMAIL_TO_FILE) — never configured in production.
  provider: 'mailgun' | 'smtp' | 'file' | null;
  configured: boolean;
  from: string | null;
}
