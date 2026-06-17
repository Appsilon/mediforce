# Namespace + Helm release are owned by helm_release (`create_namespace = true`).
# ExternalSecret entries are passed into the chart via the `externalSecrets`
# value, rendered by the chart's loop template (axon pattern). No separate
# kubernetes_manifest blocks here.
