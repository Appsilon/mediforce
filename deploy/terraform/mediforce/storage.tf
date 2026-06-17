# =============================================================================
# Shared workspace — EFS RWX for /var/lib/mediforce
# Mounted by the worker Deployment and by every spawned Job's pod template.
# =============================================================================

locals {
  nfs_mount_options = ["nfsvers=4.1", "rsize=1048576", "wsize=1048576", "hard", "timeo=600", "retrans=2"]
}

resource "kubernetes_persistent_volume_v1" "mediforce_shared" {
  count = var.shared_workspace_enabled ? 1 : 0

  metadata {
    name = "${var.namespace}-shared-pv"
  }

  spec {
    capacity                         = { storage = var.shared_storage_size }
    access_modes                     = ["ReadWriteMany"]
    persistent_volume_reclaim_policy = "Retain"
    storage_class_name               = ""

    persistent_volume_source {
      nfs {
        server = var.efs_dns_name
        path   = var.shared_storage_path
      }
    }

    mount_options = local.nfs_mount_options
  }
}

resource "kubernetes_persistent_volume_claim_v1" "mediforce_shared" {
  count = var.shared_workspace_enabled ? 1 : 0

  metadata {
    name      = "mediforce-shared"
    namespace = var.namespace
  }

  spec {
    access_modes       = ["ReadWriteMany"]
    storage_class_name = ""
    volume_name        = kubernetes_persistent_volume_v1.mediforce_shared[0].metadata[0].name
    resources { requests = { storage = var.shared_storage_size } }
  }
}
