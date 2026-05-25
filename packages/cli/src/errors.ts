import { MediforceClientError } from '@mediforce/platform-api/client';
import type { ErrorPayload } from './output.js';

export interface FormatCliErrorInput {
  baseUrl?: string;
  jsonMode?: boolean;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT']);
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function formatCliError(
  err: unknown,
  input: FormatCliErrorInput = {},
): ErrorPayload {
  if (err instanceof MediforceClientError) {
    return formatMediforceClientError(err);
  }

  const systemError = findFetchSystemError(err);
  if (systemError !== null) {
    return formatNetworkError(systemError, input.baseUrl);
  }

  const abortError = findAbortError(err);
  if (abortError !== null) {
    return {
      error: `Cannot reach Mediforce API${input.baseUrl ? ` at ${input.baseUrl}` : ''}`,
      cause: { message: 'server unreachable, took too long' },
      hints: networkHints(input.baseUrl),
    };
  }

  if (err instanceof Error) {
    return { error: err.message };
  }

  return { error: String(err) };
}

function formatMediforceClientError(err: MediforceClientError): ErrorPayload {
  const payload: ErrorPayload = {
    error: err.message,
    status: err.status,
    body: err.body,
  };

  if (err.status === 401) {
    payload.hints = ['Set MEDIFORCE_API_KEY to a valid API key.'];
  } else if (err.status === 403) {
    payload.hints = ['Check that MEDIFORCE_API_KEY is valid for this workspace.'];
  } else if (err.status === 404 && looksLikeNonJson404(err.body)) {
    payload.hints = [
      'The base URL may be wrong. Point MEDIFORCE_BASE_URL at a Mediforce API host.',
    ];
  }

  return payload;
}

function formatNetworkError(systemError: SystemErrorShape, baseUrl?: string): ErrorPayload {
  const code = systemError.code;
  const target = baseUrl ? ` at ${baseUrl}` : '';

  if (code === 'ECONNREFUSED') {
    return {
      error: `Cannot reach Mediforce API${target}`,
      cause: {
        code,
        message: 'connection refused',
        address: systemError.address,
        port: systemError.port,
      },
      hints: networkHints(baseUrl),
    };
  }

  if (DNS_CODES.has(code)) {
    return {
      error: `Cannot resolve Mediforce API host${baseUrl ? ` for ${baseUrl}` : ''}`,
      cause: {
        code,
        message: 'hostname not resolvable',
        hostname: systemError.hostname,
      },
      hints: networkHints(baseUrl),
    };
  }

  if (TIMEOUT_CODES.has(code)) {
    return {
      error: `Cannot reach Mediforce API${target}`,
      cause: { code, message: 'server unreachable, took too long' },
      hints: networkHints(baseUrl),
    };
  }

  if (TLS_CODES.has(code)) {
    return {
      error: `Certificate problem reaching Mediforce API${target}`,
      cause: { code, message: 'certificate problem' },
      hints: networkHints(baseUrl),
    };
  }

  return {
    error: `Cannot reach Mediforce API${target}`,
    cause: { code, message: systemError.message ?? 'network error' },
    hints: networkHints(baseUrl),
  };
}

function networkHints(baseUrl?: string): string[] {
  const hints: string[] = [];

  if (isLocalBaseUrl(baseUrl) === true) {
    hints.push('Is the dev server running? Start with: pnpm dev:local');
  }

  hints.push('To use a different host: export MEDIFORCE_BASE_URL=https://staging.mediforce.ai');
  hints.push('Or pass --base-url https://staging.mediforce.ai to this command.');

  return hints;
}


function findFetchSystemError(err: unknown): SystemErrorShape | null {
  if (!isFetchFailure(err)) {
    return null;
  }

  return findSystemError(err);
}

function isFetchFailure(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);

    if (current['name'] === 'AbortError') {
      return true;
    }

    const message = current['message'];
    if (
      typeof current['name'] === 'string' &&
      current['name'] === 'TypeError' &&
      typeof message === 'string' &&
      message.toLowerCase() === 'fetch failed'
    ) {
      return true;
    }

    const nestedErrors = current['errors'];
    if (Array.isArray(nestedErrors)) {
      for (const nestedError of nestedErrors) {
        if (isFetchFailure(nestedError)) {
          return true;
        }
      }
    }

    current = current['cause'];
  }

  return false;
}

interface SystemErrorShape {
  code: string;
  message?: string;
  address?: string;
  port?: number;
  hostname?: string;
}

function findSystemError(err: unknown): SystemErrorShape | null {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    const code = current['code'];
    if (typeof code === 'string') {
      return {
        code,
        message: typeof current['message'] === 'string' ? current['message'] : undefined,
        address: typeof current['address'] === 'string' ? current['address'] : undefined,
        port: typeof current['port'] === 'number' ? current['port'] : undefined,
        hostname: typeof current['hostname'] === 'string' ? current['hostname'] : undefined,
      };
    }
    const nestedErrors = current['errors'];
    if (Array.isArray(nestedErrors)) {
      for (const nestedError of nestedErrors) {
        const candidate = findSystemError(nestedError);
        if (candidate !== null) {
          return candidate;
        }
      }
    }

    current = current['cause'];
  }

  return null;
}

function findAbortError(err: unknown): unknown | null {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (current['name'] === 'AbortError') {
      return current;
    }
    current = current['cause'];
  }

  return null;
}

function looksLikeNonJson404(body: unknown): boolean {
  // parseJsonOrThrow normalizes non-JSON 404 response bodies to {} in MediforceClientError.body.
  return isRecord(body) && Object.keys(body).length === 0;
}


function isLocalBaseUrl(baseUrl: string | undefined): boolean {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    return true;
  }

  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
