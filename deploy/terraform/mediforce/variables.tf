# =============================================================================
# Identity
# =============================================================================

variable "namespace" {
  type        = string
  default     = "mediforce"
  description = "Kubernetes namespace for the mediforce release."
}

variable "release_name" {
  type        = string
  default     = "mediforce"
  description = "Helm release name."
}

# =============================================================================
# Images
# =============================================================================

variable "image_registry" {
  type        = string
  default     = ""
  description = "Optional registry prefix (e.g. an ECR account URL). Leave empty to use the repository as-is."
}

variable "ui_image_repository" {
  type        = string
  default     = "bioverse/mediforce-ui"
  description = "Container image for the Next.js UI."
}

variable "ui_image_tag" {
  type        = string
  default     = "latest"
  description = "Image tag for the UI."
}

variable "worker_image_repository" {
  type        = string
  default     = "bioverse/mediforce-worker"
  description = "Container image for the BullMQ worker."
}

variable "worker_image_tag" {
  type        = string
  default     = "latest"
  description = "Image tag for the worker."
}

# =============================================================================
# Storage
# =============================================================================

variable "shared_workspace_enabled" {
  type        = bool
  default     = true
  description = "Whether to provision the shared EFS workspace (PV + PVC) and mount it on the worker. Set false when the spawn strategy doesn't need a shared scratch volume (e.g. when the worker runs single-step jobs locally)."
}

variable "efs_dns_name" {
  type        = string
  default     = ""
  description = "EFS endpoint DNS name (e.g. fs-xxx.efs.eu-west-1.amazonaws.com). Required only when shared_workspace_enabled = true."
}

variable "shared_storage_size" {
  type        = string
  default     = "100Gi"
  description = "Capacity claimed for /var/lib/mediforce (EFS does not enforce; advisory only)."
}

variable "shared_storage_path" {
  type        = string
  default     = "/mediforce/data"
  description = "Path within the EFS filesystem to mount as the shared workspace."
}

# =============================================================================
# Secrets — ExternalSecret mappings (axon-style loop)
# =============================================================================

variable "external_secrets" {
  type = list(object({
    name               = string
    refreshInterval    = optional(string, "1h")
    clusterSecretStore = optional(string, "aws-secrets-manager")
    data = list(object({
      secretKey = string
      remoteRef = object({
        key      = string
        property = optional(string)
      })
    }))
  }))
  default     = []
  description = "ExternalSecret resources for app credentials (Firebase Admin SA JSON, LLM keys, Mailgun, PLATFORM_API_KEY, SECRETS_ENCRYPTION_KEY, etc.)."
}

# =============================================================================
# Pass-through values overrides
# =============================================================================

variable "extra_values" {
  type        = list(string)
  default     = []
  description = "Additional Helm values YAML strings (last write wins)."
}
