output "namespace" {
  value       = var.namespace
  description = "Kubernetes namespace the release was deployed into."
}

output "release_name" {
  value       = helm_release.mediforce.name
  description = "Helm release name."
}

output "ui_service_url" {
  value       = "http://${var.release_name}-ui.${var.namespace}.svc.cluster.local:3000"
  description = "In-cluster URL for the UI service."
}

output "worker_service_url" {
  value       = "http://${var.release_name}-worker.${var.namespace}.svc.cluster.local:3001"
  description = "In-cluster URL for the worker service (health endpoint only)."
}

output "redis_service_url" {
  value       = "redis://${var.release_name}-redis.${var.namespace}.svc.cluster.local:6379"
  description = "In-cluster Redis URL used by the UI and worker."
}

output "shared_pvc_name" {
  value       = one(kubernetes_persistent_volume_claim_v1.mediforce_shared[*].metadata[0].name)
  description = "Name of the shared EFS PVC mounted at /var/lib/mediforce. null when shared_workspace_enabled = false."
}
