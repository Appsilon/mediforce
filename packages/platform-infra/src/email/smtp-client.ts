import type { SendEmailParams, SendEmailResult } from '@mediforce/platform-core';
import { createTransport } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  defaultFrom: string;
  defaultSenderName: string;
}

export function createSmtpSender(
  config: SmtpConfig,
): (params: SendEmailParams) => Promise<SendEmailResult> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });

  return async (params) => {
    const from = params.from ?? `${config.defaultSenderName} <${config.defaultFrom}>`;
    const info = await transport.sendMail({
      from,
      to: params.to.join(', '),
      cc: params.cc?.join(', '),
      bcc: params.bcc?.join(', '),
      replyTo: params.replyTo,
      subject: params.subject,
      text: params.text,
      html: params.html ?? undefined,
    });
    return { messageId: info.messageId ?? '' };
  };
}
