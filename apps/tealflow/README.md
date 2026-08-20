# tealflow

Interactively builds a [teal](https://insightsengineering.github.io/teal/) Shiny
clinical-trial app: upload data, state requirements, co-work with an agent to
build it, then deploy to GitHub and Posit Connect.

## Steps

`upload-data` (human) → `define-requirements` (human) → `build-app` (cowork) →
`deploy` (agent) → `demo-review` (human review) → `done`.

## Why `build-app` is a cowork step

Building an analysis app is not a request-response task. The person knows what
they want to see and the agent knows teal; the requirements only become concrete
by trying something and reacting to it. A cowork step keeps both in the loop for
as long as that takes, then hands one finished artefact to `deploy`.

Deployment stays a separate step behind that boundary, so publishing is a
deliberate act rather than a side effect of the conversation — and
`demo-review` puts a human in front of the deployed app before the run
completes.

## Layout

```
container/Dockerfile      R + teal runtime image
container/sample_data/    Demo datasets
plugins/tealflow/         Packaged skills
src/tealflow.wd.json      Workflow definition
```
