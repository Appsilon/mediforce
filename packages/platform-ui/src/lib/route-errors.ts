export interface ClassifiedError {
  status: number;
  body: { error: string; hint?: string };
}

function readStringField(err: unknown, key: string): string | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const value = (err as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function classifyError(err: unknown): ClassifiedError {
  const code = readStringField(err, 'code');
  const message = readStringField(err, 'message');
  const inDev = process.env.NODE_ENV !== 'production';

  if (code === 'app/no-app' || (message !== undefined && message.includes('Unable to detect a Project Id'))) {
    const body: ClassifiedError['body'] = {
      error: 'Server misconfigured: Firebase Admin SDK credentials missing',
    };
    if (inDev) body.hint = 'See docs/development.md#firebase-credentials';
    return { status: 500, body };
  }

  if (code === 'auth/id-token-expired') {
    const body: ClassifiedError['body'] = { error: 'Session expired' };
    if (inDev) body.hint = 'Sign in again';
    return { status: 401, body };
  }

  return { status: 500, body: { error: 'Internal error' } };
}
