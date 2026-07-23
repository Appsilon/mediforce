import {
  createCipheriv,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Firebase Auth password verification (ADR-0002 Gap 2, migrate-on-login).
 *
 * Firebase stores passwords with a modified scrypt scheme that CANNOT be
 * converted to bcrypt offline, but CAN be verified given the plaintext at login
 * time. On the first successful verification the route rehashes the plaintext to
 * bcrypt and clears the legacy columns (see `promoteFirebaseCredentialToBcrypt`),
 * so this path runs at most once per migrated user and is transparent to them.
 *
 * The algorithm (matching Firebase's published scrypt parameters):
 *   1. scrypt-derive a 32-byte key from the password, salted with the user salt
 *      concatenated with the project salt separator (user salt FIRST).
 *   2. AES-256-CTR encrypt the project signer key with that derived key and a
 *      16-byte zero IV.
 *   3. The stored `passwordHash` is the base64 of that ciphertext; a constant
 *      -time compare of the recomputed ciphertext against it is the check.
 *
 * Firebase's `rounds` maps to scrypt's block-size parameter `r` (NOT the
 * iteration count), and `mem_cost` maps to `N = 2 ** mem_cost`; `p` is always 1.
 */

/** Project-level parameters, identical for every user in a Firebase project. */
export interface FirebaseScryptParams {
  /** base64 project signer key (`hash_config.signer_key`). */
  readonly signerKey: string;
  /** base64 project salt separator (`hash_config.salt_separator`). */
  readonly saltSeparator: string;
  /** scrypt block size `r` (`hash_config.rounds`). */
  readonly rounds: number;
  /** scrypt cost exponent: `N = 2 ** memCost` (`hash_config.mem_cost`). */
  readonly memCost: number;
}

const DERIVED_KEY_LENGTH = 32;
const AES_IV = Buffer.alloc(16, 0);
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

/**
 * Firebase emits standard base64, but URL-safe base64 (`-`/`_`) shows up in
 * some exports; normalise before decoding so both forms round-trip.
 */
function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

/**
 * Whether `password` matches the stored Firebase scrypt credential. Pure and
 * native-crypto only; never throws on a wrong password, returns `false`.
 */
export function verifyFirebasePassword(
  password: string,
  storedHash: string,
  salt: string,
  params: FirebaseScryptParams,
): boolean {
  const scryptSalt = Buffer.concat([decodeBase64(salt), decodeBase64(params.saltSeparator)]);
  const derivedKey = scryptSync(Buffer.from(password, 'utf8'), scryptSalt, DERIVED_KEY_LENGTH, {
    N: 2 ** params.memCost,
    r: params.rounds,
    p: 1,
    maxmem: SCRYPT_MAX_MEMORY,
  });

  const cipher = createCipheriv('aes-256-ctr', derivedKey, AES_IV);
  const signerKeyBytes = decodeBase64(params.signerKey);
  const ciphertext = Buffer.concat([cipher.update(signerKeyBytes), cipher.final()]);

  const expected = decodeBase64(storedHash);
  if (ciphertext.length !== expected.length) return false;
  return timingSafeEqual(ciphertext, expected);
}

const SIGNER_KEY_ENV = 'FIREBASE_SCRYPT_SIGNER_KEY';
const SALT_SEPARATOR_ENV = 'FIREBASE_SCRYPT_SALT_SEPARATOR';
const ROUNDS_ENV = 'FIREBASE_SCRYPT_ROUNDS';
const MEM_COST_ENV = 'FIREBASE_SCRYPT_MEM_COST';

function parsePositiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

/**
 * Resolve the project scrypt params from the environment.
 *
 * Returns `null` when NONE of the four variables are set — migrate-on-login is
 * simply switched off (a documented "feature off", not a silent data fallback:
 * a deployment with no Firebase legacy users never sets these).
 *
 * THROWS when SOME but not all are set, or when `rounds`/`memCost` are not
 * positive integers: a half-configured deployment is a misconfiguration and must
 * fail loud rather than silently disable password migration for real users.
 */
export function resolveFirebaseScryptParams(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseScryptParams | null {
  const signerKey = env[SIGNER_KEY_ENV];
  const saltSeparator = env[SALT_SEPARATOR_ENV];
  const rounds = env[ROUNDS_ENV];
  const memCost = env[MEM_COST_ENV];

  const present = [signerKey, saltSeparator, rounds, memCost].filter(
    (value) => value !== undefined && value !== '',
  );
  if (present.length === 0) return null;
  if (present.length < 4) {
    throw new Error(
      `Firebase scrypt migrate-on-login is partially configured: set all of ` +
        `${SIGNER_KEY_ENV}, ${SALT_SEPARATOR_ENV}, ${ROUNDS_ENV}, ${MEM_COST_ENV}, or none.`,
    );
  }

  return {
    signerKey: signerKey as string,
    saltSeparator: saltSeparator as string,
    rounds: parsePositiveInteger(rounds as string, ROUNDS_ENV),
    memCost: parsePositiveInteger(memCost as string, MEM_COST_ENV),
  };
}
