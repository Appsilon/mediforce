// arm-timer — compute the CI-poll deadline for the next `wait-ci` pause.
//
// The `wait` action reads `config.duration.{minutes}` as raw NUMBERS and does
// NOT interpolate them, so a secret-driven wait length must go through the
// interpolatable `deadline` field instead. This step reads CI_WAIT_MINUTES
// (secret-backed env, changeable without re-registering) and emits an absolute
// ISO deadline that `wait-ci` consumes as `${steps.arm-timer.deadline}`.
//
// It sits in the CI loop and re-arms on every iteration (publish -> here, and
// after each fix / pending re-poll), so each pause gets a fresh future deadline
// — a single up-front computation would go stale on the 2nd lap.
//
// Reads:  env CI_WAIT_MINUTES (default 15)
// Writes: /output/result.json -> { deadline, waitMinutes }

import { writeFileSync } from 'node:fs';

const DEFAULT_MINUTES = 15;

/** Parse the configured wait length, falling back to the default for an unset /
 *  unresolved / non-positive value. Pure. */
export function resolveWaitMinutes(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MINUTES;
}

function main() {
  const waitMinutes = resolveWaitMinutes(process.env.CI_WAIT_MINUTES);
  const deadline = new Date(Date.now() + waitMinutes * 60_000).toISOString();
  writeFileSync('/output/result.json', JSON.stringify({ deadline, waitMinutes }));
  console.log(`arm-timer: next CI check at ${deadline} (in ${waitMinutes} min)`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
