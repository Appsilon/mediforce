# Firestore index deploy in CI

Tracks the `deploy-firestore-indexes` job that runs ahead of the SSH-based app
deploy on staging and production. The intent is to make "code that needs an
index" and "the index exists in Firestore" land in lockstep, gated by CI — see
#261 for the motivation.

This doc exists because the first attempt at the job (merged in #261) broke
staging deploys for ~2 hours on 2026-04-24. The revert commit removing the job
was `f0066f1`; this PR re-introduces the job and records what was tried so the
next attempt does not repeat the same dead ends.

## What went wrong on 2026-04-24

Marek's PR #261 merged at 10:21 UTC. The first staging run failed immediately
with:

```
::error::FIREBASE project secret for staging is empty
```

None of the three secrets the workflow required existed yet on the repository:

- `FIREBASE_CI_TOKEN`
- `FIREBASE_STAGING_PROJECT`
- `FIREBASE_PROD_PROJECT`

Creating them and iterating produced a sequence of progressively more specific
failures.

### Attempt 1 — `FIREBASE_CI_TOKEN` from `firebase login:ci`

**Worked locally, failed from GitHub runners.** A token minted via
`firebase login:ci` authenticated every Firebase CLI call from a developer
laptop (`firebase firestore:indexes --project mediforce-1c761 --json` returned
the full index list). The byte-identical token, uploaded as a repo secret,
failed the same call from GitHub runners with:

```
HTTP 401, Request had invalid authentication credentials
```

Verified via an in-workflow diagnostic that the secret arrived intact — length
103, sha256 prefix `a419219edf56`, no whitespace or newlines — matching the
local token byte-for-byte. firebase-tools surfaces a deprecation warning on
this flow ("Authenticating with `FIREBASE_TOKEN` is deprecated") and the
failure mode is consistent with Google rejecting `login:ci` refresh tokens
from datacenter IP ranges. This path is a dead end; do not retry it.

### Attempt 2 — Service account key via `GOOGLE_APPLICATION_CREDENTIALS`

**Auth succeeded, API calls 403.** Created a service account
`mediforce-ci-deploy@mediforce-1c761.iam.gserviceaccount.com`, uploaded the
JSON key as `FIREBASE_SA_KEY_STAGING`, wrote it to disk in the workflow, and
exported `GOOGLE_APPLICATION_CREDENTIALS`. firebase-tools picked up the
identity (the `jq -r .client_email` echo matched), but every API call failed:

```
HTTP 403, Permission denied on resource project ***
  (firestore.googleapis.com/v1/.../collectionGroups/.../indexes)
HTTP 400, Project 'projects/***' not found or deleted
  (serviceusage.googleapis.com/v1/projects/.../services/firestore.googleapis.com)
```

Granted roles, in order of desperation:

- `roles/datastore.owner`
- `roles/firebase.developAdmin`
- `roles/serviceusage.serviceUsageConsumer`
- `roles/datastore.indexAdmin`
- `roles/serviceusage.serviceUsageAdmin`
- `roles/firebase.admin`

None cleared the 403/400. The same key read Firestore fine from a developer
machine via `gcloud firestore operations list` and
`gcloud services list --filter=firestore.googleapis.com` — proving the roles
and the Firestore API were correctly provisioned on the project. The failure
appears to be in how firebase-tools consumes ADC for this specific command
set, not in the IAM grants.

The SA was deleted on revert. Both `FIREBASE_CI_TOKEN` and
`FIREBASE_SA_KEY_STAGING` repository secrets were deleted.

`FIREBASE_STAGING_PROJECT` (`mediforce-1c761`) and `FIREBASE_PROD_PROJECT`
(`mediforce-platform`) were kept — they are non-sensitive strings and the
next attempt will need them.

## What to try next

In rough order of preference:

1. **`google-github-actions/auth@v2` (Workload Identity Federation).**
   The official action sets up ADC in a way firebase-tools recognises and
   avoids storing long-lived keys in GitHub. WIF needs a one-time setup in
   GCP (identity pool + provider, plus an IAM binding letting
   `repo:Appsilon/mediforce:ref:refs/heads/main` impersonate
   `mediforce-ci-deploy`). This is the path firebase-tools' own docs
   recommend and likely bypasses whatever ADC-consumption quirk defeated
   attempt 2.

2. **Service account + `google-github-actions/auth@v2` with a static key.**
   Same setup as attempt 2 but routed through the official action instead of
   writing the key file by hand. Worth trying before WIF because the
   machinery is nearly identical to what failed, so a success would narrow
   the root cause to "firebase-tools needs the action's specific ADC shape".

3. **Skip API enablement.** The 400 on `serviceusage.googleapis.com` fires
   because firebase-tools unconditionally probes whether
   `firestore.googleapis.com` is enabled. The API is already on for both
   projects, so this step is pure overhead. If firebase-tools exposes a flag
   to skip it (or we call the Firestore Admin API directly via `gcloud
   firestore indexes ...`), the 400 disappears regardless of auth path.

4. **`firestore.indexes.composites.*` via the Firestore Admin REST API.**
   Bypass firebase-tools entirely. `firebase deploy --only firestore:indexes`
   is thin glue over a handful of REST calls; a 40-line Python script against
   `firestore.googleapis.com/v1/projects/.../databases/(default)/collectionGroups/.../indexes`
   using ADC or an access token from `gcloud auth print-access-token` would
   do the job and avoids every firebase-tools-specific failure mode seen in
   attempts 1 and 2.

Do **not** retry `login:ci` tokens — the 2026-04-24 timeline and
firebase-tools' own deprecation warning both put this one firmly behind us.

## Manual fallback (until CI is fixed)

When a PR adds a new composite index to `firestore.indexes.json`, the index
has to be deployed manually before the app starts querying it:

```bash
# staging
firebase deploy --only firestore:indexes --project mediforce-1c761

# production
firebase deploy --only firestore:indexes --project mediforce-platform
```

This is the workflow that existed before #261 and is what #232's author
had to remember manually — which is exactly the footgun the job is trying to
close.

## Secrets currently on the repo (as of 2026-04-24)

| Secret | Status | Notes |
|---|---|---|
| `FIREBASE_STAGING_PROJECT` | present | `mediforce-1c761` |
| `FIREBASE_PROD_PROJECT` | present | `mediforce-platform` |
| `FIREBASE_CI_TOKEN` | deleted | `login:ci` path abandoned |
| `FIREBASE_SA_KEY_STAGING` | deleted | SA also deleted |
| `FIREBASE_PROJECT` | present | pre-existing, unused, left alone |
