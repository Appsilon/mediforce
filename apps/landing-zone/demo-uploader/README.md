# mediforce-landing-zone-demo-uploader

Mediforce workflow that drives the Landing Zone demo. One human-review step
with 8 N-way verdicts → one seed step that `curl`s the demo-console's
`/seed` endpoint. No scripts, no image build — the demo-console (deployed
separately on the SFTP host) does the actual file moves.

```sh
pnpm exec mediforce workflow register \
  --file apps/landing-zone/demo-uploader/src/demo-uploader.wd.json \
  --namespace appsilon

pnpm exec mediforce secret set --workflow landing-zone-demo-uploader \
  --namespace appsilon --key DEMO_CONSOLE_URL      --value http://<sftp-host>:8080
pnpm exec mediforce secret set --workflow landing-zone-demo-uploader \
  --namespace appsilon --key DEMO_CONSOLE_API_KEY  # matches DEMO_CONSOLE_API_KEY on the host
```

Image: `mediforce-landing-zone:latest` (already has `curl` + `jq` from
`mediforce-golden-image`). To be extracted to standalone repo
`Appsilon/mediforce-landing-zone-demo-uploader` later.
