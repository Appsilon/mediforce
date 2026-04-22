export interface ClassifiedError {
  status: number;
  body: { error: string; hint?: string };
}

interface FirebaseLikeError {
  code?: string;
  message?: string;
}

function asFirebaseLike(err: unknown): FirebaseLikeError {
  if (err && typeof err === 'object') return err as FirebaseLikeError;
  return {};
}

export function classifyError(err: unknown): ClassifiedError {
  const { code, message } = asFirebaseLike(err);
  const inDev = process.env.NODE_ENV !== 'production';

  if (code === 'app/no-app' || (message && message.includes('Unable to detect a Project Id'))) {
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
