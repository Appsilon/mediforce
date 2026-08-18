# @mediforce/core-actions

Handlers for `executor: 'action'` steps — the deterministic built-ins a workflow
gets without a container, an image, or an LLM.

| Kind | Does |
|---|---|
| `http` | Calls an HTTP endpoint, returns status and parsed body |
| `reshape` | Restructures earlier step output into a new shape |
| `email` | Sends email, with rate limiting |
| `spawn` | Starts another workflow run |
| `wait` | Suspends the run until a deadline or signal |

## Why these are not scripts

An action step needs no Docker image and no build. A workflow that only has to
call an API and reshape the response runs with nothing installed, which keeps
the cheap cases cheap — spinning up a container to make one HTTP request is
overhead a workflow author should not have to pay.

## Interpolation

Action configs interpolate against `${steps.*}`, `${variables.*}`,
`${triggerPayload.*}`, `${triggerContext.*}` and `${secrets.*}` — see
`src/interpolation.ts` and `InterpolationSources` in `platform-core`.

**Secret references are validated before the run starts.**
`validateActionSecrets` walks every action config, extracts each
`${secrets.NAME}`, and reports the ones that are not configured together with
the steps that need them. A workflow missing a credential fails at validation
with a list, rather than halfway through a run with one `undefined`.

## Registering

`ActionRegistry` is populated in
`packages/platform-api/src/services/platform-services.ts`. `email` registers only
when an email sender is configured — an unconfigured action is not offered
rather than failing at run time.
