import type { HttpActionConfig } from '@mediforce/platform-core';
import { interpolate } from '../interpolation.js';
import type { HttpActionHandler } from '../types.js';

/** Output shape of the http action.
 *  Mirrors n8n's webhook response item: status, headers, JSON body parsed when
 *  the response is JSON, raw text otherwise. Workflows downstream of this step
 *  can read `body.json.<path>` to navigate the response. */
export interface HttpActionOutput {
  status: number;
  headers: Record<string, string>;
  body: {
    json: unknown;
    text: string;
  };
  url: string;
  method: string;
  [key: string]: unknown;
}

/**
 * HTTP action handler.
 *
 * - Interpolates `${path}` placeholders in `url`, `body`, and each header.
 * - Sends `body` as JSON when it's an object/array (Content-Type set
 *   automatically); as a string when it's a string.
 * - Always returns `{status, headers, body: {json, text}}` — never throws on
 *   non-2xx so the workflow can branch on status. Throws only on transport
 *   errors (DNS, connection refused, abort).
 *
 * No retry, no auth, no streaming — those land in later phases.
 */
export const httpActionHandler: HttpActionHandler = async (config, ctx) => {
  const resolvedConfig = interpolateConfig(config, ctx.sources);

  const init: RequestInit = {
    method: resolvedConfig.method,
    headers: resolvedConfig.headers ?? {},
  };

  if (resolvedConfig.body !== undefined && resolvedConfig.method !== 'GET') {
    if (typeof resolvedConfig.body === 'string') {
      init.body = resolvedConfig.body;
    } else {
      init.body = JSON.stringify(resolvedConfig.body);
      init.headers = {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string>),
      };
    }
  }

  let response: Response;
  try {
    response = await fetch(resolvedConfig.url, init);
  } catch (cause) {
    const rootMessage = cause instanceof Error ? cause.message : String(cause);
    const underlyingDetail =
      cause instanceof Error && cause.cause instanceof Error ? ` (${cause.cause.message})` : '';
    throw new Error(
      `HTTP request failed: ${resolvedConfig.method} ${resolvedConfig.url} — ${rootMessage}${underlyingDetail}`,
    );
  }
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const output: HttpActionOutput = {
    status: response.status,
    headers,
    body: { json, text },
    url: resolvedConfig.url,
    method: resolvedConfig.method,
  };
  return output;
};

interface ResolvedHttpConfig {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function interpolateConfig(
  config: HttpActionConfig,
  sources: import('../types.js').InterpolationSources,
): ResolvedHttpConfig {
  const method = String(interpolate(config.method, sources));
  const url = String(interpolate(config.url, sources));
  const body = config.body !== undefined ? interpolate(config.body, sources) : undefined;
  const headers = config.headers
    ? Object.fromEntries(
        Object.entries(config.headers).map(([k, v]) => [k, String(interpolate(v, sources))]),
      )
    : undefined;

  return {
    method,
    url,
    ...(body !== undefined ? { body } : {}),
    ...(headers ? { headers } : {}),
  };
}
