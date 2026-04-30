import type { EmailActionConfig, SendEmailFn } from '@mediforce/platform-core';
import { interpolate } from '../interpolation.js';
import type { EmailActionHandler, InterpolationSources } from '../types.js';

export type { SendEmailFn };

export interface EmailRateLimitConfig {
  perRun: number;
  perMinute: number;
}

const DEFAULT_LIMITS: EmailRateLimitConfig = {
  perRun: 50,
  perMinute: 30,
};

export interface EmailActionOutput {
  messageId: string;
  status: 'sent';
  to: string[];
  subject: string;
  [key: string]: unknown;
}

export function createEmailActionHandler(
  sendEmail: SendEmailFn,
  rateLimitConfig?: Partial<EmailRateLimitConfig>,
): EmailActionHandler {
  const limits: EmailRateLimitConfig = { ...DEFAULT_LIMITS, ...rateLimitConfig };
  const runCounts = new Map<string, number>();
  const minuteTimestamps: number[] = [];

  return async (config, ctx) => {
    enforceRateLimit(ctx.processInstanceId, runCounts, minuteTimestamps, limits);

    const resolved = interpolateConfig(config, ctx.sources);

    const result = await sendEmail({
      to: resolved.to,
      subject: resolved.subject,
      text: resolved.body,
      ...(resolved.from !== undefined ? { from: resolved.from } : {}),
      ...(resolved.cc !== undefined ? { cc: resolved.cc } : {}),
      ...(resolved.bcc !== undefined ? { bcc: resolved.bcc } : {}),
      ...(resolved.replyTo !== undefined ? { replyTo: resolved.replyTo } : {}),
      ...(resolved.html !== undefined ? { html: resolved.html } : {}),
    });

    const output: EmailActionOutput = {
      messageId: result.messageId,
      status: 'sent',
      to: resolved.to,
      subject: resolved.subject,
    };
    return output;
  };
}

function enforceRateLimit(
  processInstanceId: string,
  runCounts: Map<string, number>,
  minuteTimestamps: number[],
  limits: EmailRateLimitConfig,
): void {
  const currentRunCount = runCounts.get(processInstanceId) ?? 0;
  if (currentRunCount >= limits.perRun) {
    throw new Error(
      `Email rate limit exceeded: ${limits.perRun} emails per workflow run (processInstanceId: ${processInstanceId})`,
    );
  }

  const now = Date.now();
  const windowStart = now - 60_000;
  while (minuteTimestamps.length > 0 && minuteTimestamps[0] < windowStart) {
    minuteTimestamps.shift();
  }
  if (minuteTimestamps.length >= limits.perMinute) {
    throw new Error(
      `Email rate limit exceeded: ${limits.perMinute} emails per minute`,
    );
  }

  runCounts.set(processInstanceId, currentRunCount + 1);
  minuteTimestamps.push(now);

  // Evict oldest half to bound memory without wiping active run counters
  if (runCounts.size > 10_000) {
    const entries = [...runCounts.entries()];
    const half = Math.floor(entries.length / 2);
    runCounts.clear();
    for (let i = half; i < entries.length; i++) {
      runCounts.set(entries[i][0], entries[i][1]);
    }
  }
}

interface ResolvedEmailConfig {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  replyTo?: string;
  subject: string;
  body: string;
  html?: string;
}

function interpolateConfig(
  config: EmailActionConfig,
  sources: InterpolationSources,
): ResolvedEmailConfig {
  const interpolatedTo = interpolate(config.to, sources);
  const to: string[] = Array.isArray(interpolatedTo)
    ? interpolatedTo.map(String)
    : [String(interpolatedTo)];

  const subject = String(interpolate(config.subject, sources));
  const body = String(interpolate(config.body, sources));

  const cc = config.cc
    ? (interpolate(config.cc, sources) as string[]).map(String)
    : undefined;
  const bcc = config.bcc
    ? (interpolate(config.bcc, sources) as string[]).map(String)
    : undefined;
  const from = config.from ? String(interpolate(config.from, sources)) : undefined;
  const replyTo = config.replyTo ? String(interpolate(config.replyTo, sources)) : undefined;
  const html = config.html ? String(interpolate(config.html, sources)) : undefined;

  return {
    to, subject, body,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(from ? { from } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(html ? { html } : {}),
  };
}
