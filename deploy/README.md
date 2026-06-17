# `deploy/` — Kubernetes deployment artifacts

Self-contained Helm chart and Terraform module for deploying Mediforce on
Kubernetes. Versioned in lockstep with the application via the repo's
git tags.

## Layout

```
deploy/
├── charts/mediforce/        Helm chart (UI + worker + bundled Redis)
├── terraform/mediforce/     Terraform wrapper around the chart
│                            (helm_release + EFS PV/PVC for shared workspace)
└── docker/                  Layered Dockerfile.k8s + build/push instructions
```

## Consuming the Helm chart directly

The chart is published from this repo's git history — no OCI registry, no
Helm repo. Reference it by cloning the repo or pulling a specific tag:

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/Appsilon/mediforce.git
helm install mediforce ./mediforce/deploy/charts/mediforce \
  --namespace mediforce \
  --create-namespace \
  --values your-values.yaml
```

See [`charts/mediforce/values.yaml`](charts/mediforce/values.yaml) for the
full list of configurable values (image refs, secrets, database connection,
worker spawn mode, shared-workspace toggle, NetworkPolicy egress, etc.).

## Consuming the Terraform module

The Terraform wrapper bundles the chart with the PV/PVC for the worker's
shared workspace. Pin to a tag and pass values through Terraform:

```hcl
module "mediforce" {
  source = "git::https://github.com/Appsilon/mediforce.git//deploy/terraform/mediforce?ref=v0.1.0"

  namespace    = "mediforce"
  release_name = "mediforce"

  image_registry          = "<your-registry>"
  ui_image_repository     = "mediforce-ui"
  ui_image_tag            = "v0.1.0"
  worker_image_repository = "mediforce-worker"
  worker_image_tag        = "v0.1.0"

  shared_workspace_enabled = false  # leave the EFS PV/PVC out entirely

  external_secrets = [ /* ExternalSecret bindings */ ]
  extra_values     = [ /* additional Helm values YAML strings */ ]
}
```

See [`terraform/mediforce/README.md`](terraform/mediforce/README.md) for the
full variable reference.

## Building the UI image for K8s

The Mediforce UI image used by the chart layers `apps/` over the upstream
`packages/platform-ui/Dockerfile` so the workflow engine can resolve plugin
skills at runtime via `MEDIFORCE_ROOT`. See
[`docker/README.md`](docker/README.md) for the two-stage build and the
reasoning behind it.

## Versioning

The Helm chart, the Terraform module, and the application source are tagged
together. To consume a specific version, pin the git ref (`?ref=v0.1.0`)
when sourcing the Terraform module or check out the tag before
`helm install`.

`deploy/` lives under the same CI as the rest of the repo, but the deploy
workflows (`deploy-staging`, `deploy-production`) ignore changes scoped to
`deploy/**` to avoid auto-deploys on infra-only commits.
