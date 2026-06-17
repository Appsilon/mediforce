ui:
  image:
    registry: "${image_registry}"
    repository: ${ui_image_repository}
    tag: "${ui_image_tag}"
    pullPolicy: Always

worker:
  image:
    registry: "${image_registry}"
    repository: ${worker_image_repository}
    tag: "${worker_image_tag}"
    pullPolicy: Always
  sharedWorkspace:
    enabled: ${shared_workspace_enabled}
    claimName: mediforce-shared
    mountPath: /var/lib/mediforce

externalSecrets: ${external_secrets_json}
