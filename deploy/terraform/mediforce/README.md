# `terraform/mediforce` — Terraform module

Wraps the Mediforce Helm chart with a Terraform `helm_release`, the
optional shared-workspace EFS PV/PVC, and a values-rendering template.

The chart it installs lives at `../../charts/mediforce/` inside this repo;
references resolve correctly when this module is consumed via a TF git
source (`source = "git::...?ref=vX.Y.Z"`) because Terraform extracts the
whole repo into the module cache.

## Example

```hcl
module "mediforce" {
  source = "git::https://github.com/Appsilon/mediforce.git//deploy/terraform/mediforce?ref=v0.1.0"

  namespace    = "mediforce"
  release_name = "mediforce"

  image_registry          = "123456789012.dkr.ecr.eu-west-1.amazonaws.com"
  ui_image_repository     = "mediforce-ui"
  ui_image_tag            = "v0.1.0"
  worker_image_repository = "mediforce-worker"
  worker_image_tag        = "v0.1.0"

  # Skip the shared-workspace PV/PVC entirely (set to true to provision).
  shared_workspace_enabled = false

  external_secrets = [
    {
      name = "mediforce-app-secrets"
      data = [
        { secretKey = "PLATFORM_API_KEY",       remoteRef = { key = "dev/mediforce", property = "PLATFORM_API_KEY" } },
        { secretKey = "SECRETS_ENCRYPTION_KEY", remoteRef = { key = "dev/mediforce", property = "SECRETS_ENCRYPTION_KEY" } },
      ]
    },
    {
      name = "mediforce-db-credentials"
      data = [
        { secretKey = "DATABASE_URL", remoteRef = { key = "dev/mediforce-db", property = "DATABASE_URL" } },
      ]
    },
  ]

  extra_values = [
    yamlencode({
      config = {
        domain     = "mediforce.example.com"
        appBaseUrl = "https://mediforce.example.com"
      }
      database = {
        connectionUrlSecretRef = {
          name = "mediforce-db-credentials"
          key  = "DATABASE_URL"
        }
      }
    }),
  ]
}
```

## Variables

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `namespace` | string | `mediforce` | Kubernetes namespace for the release. |
| `release_name` | string | `mediforce` | Helm release name. |
| `image_registry` | string | `""` | Optional registry prefix (e.g. an ECR account URL). Leave empty to use the repository as-is. |
| `ui_image_repository` | string | `mediforce-ui` | Container image for the Next.js UI. |
| `ui_image_tag` | string | `latest` | Image tag for the UI. |
| `worker_image_repository` | string | `mediforce-worker` | Container image for the BullMQ worker. |
| `worker_image_tag` | string | `latest` | Image tag for the worker. |
| `shared_workspace_enabled` | bool | `true` | Provision the shared EFS PV + PVC and mount it on the worker. Set `false` when the spawn strategy doesn't need a shared scratch volume. |
| `efs_dns_name` | string | `""` | EFS endpoint DNS name (`fs-xxx.efs.<region>.amazonaws.com`). Required only when `shared_workspace_enabled = true`. |
| `shared_storage_size` | string | `100Gi` | PVC `resources.requests.storage` (EFS doesn't enforce; advisory only). |
| `shared_storage_path` | string | `/mediforce/data` | Path within the EFS filesystem to mount. |
| `external_secrets` | list(object) | `[]` | ExternalSecret resources for app credentials. See chart `values.yaml` `externalSecrets` block for shape. |
| `extra_values` | list(string) | `[]` | Additional Helm values YAML strings (last write wins). |

## Outputs

| Name | Description |
|------|-------------|
| `namespace` | The namespace the release lives in. |
| `release_name` | The Helm release name. |

## Providers

| Name | Version |
|------|---------|
| `hashicorp/helm` | `>= 2.0` |
| `hashicorp/kubernetes` | `>= 2.0` |
