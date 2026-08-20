# personal-automations

Three small workflows built entirely from built-in actions — no container, no
image, no LLM. Each one is a reference template for a mechanism.

| Workflow | Mechanism |
|---|---|
| `daily-weather.wd.json` | Scheduled run → HTTP fetch → format → fan out to email, Pushover and ntfy.sh |
| `food-log-proxy.wd.json` | Webhook → HTTP proxy → `reshape` — chained actions |
| `execution-summaries-api.wd.json` | Webhook → single HTTP action — the minimal echo template |

## Why they are worth reading

They are the cheapest thing a Mediforce workflow can be. Every step uses
[`@mediforce/core-actions`](../../../packages/core-actions/README.md), so there
is nothing to build and nothing to install — the run needs only the platform.

If you are reaching for a script step to make one HTTP call and rearrange the
response, one of these already shows the version that needs no image.

`daily-weather` additionally shows fan-out: three delivery actions from a single
formatted payload, so a failure of one channel does not take out the others.
