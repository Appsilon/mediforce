export interface MailgunConfig {
  apiKey: string;
  domain: string;
  defaultFrom: string;
  defaultSenderName: string;
}

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

export function createMailgunSender(
  config: MailgunConfig,
): (params: SendEmailParams) => Promise<SendEmailResult> {
  return async (params) => {
    const from = params.from ?? `${config.defaultSenderName} <${config.defaultFrom}>`;
    const formData = new URLSearchParams();
    formData.append('from', from);
    for (const recipient of params.to) {
      formData.append('to', recipient);
    }
    if (params.cc) {
      for (const addr of params.cc) {
        formData.append('cc', addr);
      }
    }
    if (params.bcc) {
      for (const addr of params.bcc) {
        formData.append('bcc', addr);
      }
    }
    if (params.replyTo) {
      formData.append('h:Reply-To', params.replyTo);
    }
    formData.append('subject', params.subject);
    formData.append('text', params.text);
    if (params.html) {
      formData.append('html', params.html);
    }

    const credentials = Buffer.from(`api:${config.apiKey}`).toString('base64');
    const response = await fetch(
      `https://api.mailgun.net/v3/${config.domain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Mailgun error ${response.status}: ${body}`);
    }

    const result = await response.json() as Record<string, unknown>;
    return { messageId: (result.id as string) ?? '' };
  };
}
