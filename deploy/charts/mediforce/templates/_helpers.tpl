{{/*
Expand the name of the chart.
*/}}
{{- define "mediforce.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mediforce.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart label.
*/}}
{{- define "mediforce.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels applied to every resource.
*/}}
{{- define "mediforce.labels" -}}
helm.sh/chart: {{ include "mediforce.chart" . }}
{{ include "mediforce.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: mediforce
{{- end -}}

{{/*
Selector labels (no version, used by Services to select Pods).
*/}}
{{- define "mediforce.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mediforce.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component selector labels.
Usage: {{ include "mediforce.componentSelectorLabels" (dict "context" . "component" "ui") }}
*/}}
{{- define "mediforce.componentSelectorLabels" -}}
app.kubernetes.io/name: {{ include "mediforce.name" .context }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Per-component labels (full set).
Usage: {{ include "mediforce.componentLabels" (dict "context" . "component" "ui") }}
*/}}
{{- define "mediforce.componentLabels" -}}
helm.sh/chart: {{ include "mediforce.chart" .context }}
{{ include "mediforce.componentSelectorLabels" . }}
app.kubernetes.io/managed-by: {{ .context.Release.Service }}
app.kubernetes.io/part-of: mediforce
{{- end -}}

{{/*
Image reference (combines optional registry + repository + tag).
Usage: {{ include "mediforce.image" .Values.ui.image }}
*/}}
{{- define "mediforce.image" -}}
{{- if .registry -}}
{{ .registry }}/{{ .repository }}:{{ .tag }}
{{- else -}}
{{ .repository }}:{{ .tag }}
{{- end -}}
{{- end -}}

{{/*
Worker ServiceAccount name (used by both the ServiceAccount template and the Deployment).
*/}}
{{- define "mediforce.workerServiceAccountName" -}}
{{- default (printf "%s-worker" (include "mediforce.fullname" .)) .Values.rbac.serviceAccountName -}}
{{- end -}}

{{/*
UI ServiceAccount name. Returns the explicit override when set, otherwise
"<fullname>-ui". Used by the UI Deployment, ServiceAccount, Role, and
RoleBinding templates so the four resources cannot drift apart.
*/}}
{{- define "mediforce.uiServiceAccountName" -}}
{{- default (printf "%s-ui" (include "mediforce.fullname" .)) .Values.ui.serviceAccount.name -}}
{{- end -}}

{{/*
Image reference for the migration initContainer. Each field of
`.Values.migrations.image` falls back to the matching field on the UI
image — so the default case is "reuse the UI image at the same tag";
operators can pin any subset by setting non-empty values explicitly.
*/}}
{{- define "mediforce.migrate.image" -}}
{{- $reg := default .Values.ui.image.registry .Values.migrations.image.registry -}}
{{- $repo := default .Values.ui.image.repository .Values.migrations.image.repository -}}
{{- $tag := default .Values.ui.image.tag .Values.migrations.image.tag -}}
{{- if $reg -}}
{{ $reg }}/{{ $repo }}:{{ $tag }}
{{- else -}}
{{ $repo }}:{{ $tag }}
{{- end -}}
{{- end -}}

{{/*
imagePullPolicy for the migration initContainer. Falls back to the UI
image's pullPolicy.
*/}}
{{- define "mediforce.migrate.pullPolicy" -}}
{{- default .Values.ui.image.pullPolicy .Values.migrations.image.pullPolicy -}}
{{- end -}}
