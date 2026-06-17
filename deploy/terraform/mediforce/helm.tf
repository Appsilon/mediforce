resource "helm_release" "mediforce" {
  name             = var.release_name
  chart            = "${path.module}/../../charts/mediforce"
  namespace        = var.namespace
  create_namespace = true
  wait             = true
  timeout          = 600

  values = concat(
    [
      templatefile("${path.module}/templates/values.yaml.tpl", {
        image_registry           = var.image_registry
        ui_image_repository      = var.ui_image_repository
        ui_image_tag             = var.ui_image_tag
        worker_image_repository  = var.worker_image_repository
        worker_image_tag         = var.worker_image_tag
        external_secrets_json    = jsonencode(var.external_secrets)
        shared_workspace_enabled = var.shared_workspace_enabled
      }),
    ],
    var.extra_values
  )
}
