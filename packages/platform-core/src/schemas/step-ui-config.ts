import { z } from 'zod';

/**
 * Typed shapes for `steps[].ui.config`.
 *
 * `StepUiSchema` types `config` as `z.record(z.string(), z.unknown())`, so every
 * reader cast it and picked keys ad hoc: the two table views, the file-upload
 * view, the completion validator in the engine, and the step editor each knew
 * their own subset. Nothing could enumerate what a component accepts, which is
 * why the editor offered `table-editor` in its dropdown but no way to give it
 * columns — a step authored in the UI shipped with `columns: []` and rendered an
 * empty table.
 *
 * The registry at the bottom is what makes a component's config authorable
 * rather than hand-written: one entry per `ui.component`, so a form can be
 * driven off the schema instead of a hardcoded field list.
 *
 * Defaults here reproduce what the views already applied when a key was absent.
 * Readers should `safeParse` and fall back, never `parse`: a deployment may hold
 * a config shape from before this file existed, and refusing to render a live
 * task would be worse than the loose casting this replaces.
 */

export const SelectOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  kind: z.enum(['human', 'agent']).optional(),
  badge: z.string().optional(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

/** A table column: `static` is read-only display, the rest are cell editors
 *  whose values land in the output keyed by column id. */
export const ColumnSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('static'),
    id: z.string().min(1),
    label: z.string(),
    field: z.string().min(1),
    link: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('single-select'),
    id: z.string().min(1),
    label: z.string(),
    options: z.array(SelectOptionSchema),
    default: z.string().optional(),
    allowEmpty: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('multi-select'),
    id: z.string().min(1),
    label: z.string(),
    options: z.array(SelectOptionSchema),
    default: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('text'),
    id: z.string().min(1),
    label: z.string(),
    placeholder: z.string().optional(),
  }),
  z.object({
    kind: z.literal('avatar'),
    id: z.string().min(1),
    label: z.string(),
    field: z.string().min(1),
    size: z.number().int().positive().optional(),
    fallbackField: z.string().optional(),
  }),
]);
export type ColumnSpec = z.infer<typeof ColumnSpecSchema>;

/** The variants by name, for the renderers that switch on one kind. */
export type StaticColumn = Extract<ColumnSpec, { kind: 'static' }>;
export type SingleSelectColumn = Extract<ColumnSpec, { kind: 'single-select' }>;
export type MultiSelectColumn = Extract<ColumnSpec, { kind: 'multi-select' }>;
export type TextColumn = Extract<ColumnSpec, { kind: 'text' }>;
export type AvatarColumn = Extract<ColumnSpec, { kind: 'avatar' }>;

export const COLUMN_KINDS = ['static', 'single-select', 'multi-select', 'text', 'avatar'] as const;

/** `minFiles`/`maxFiles` are enforced server-side by `validateUploadPayload`. */
export const FileUploadUiConfigSchema = z.object({
  acceptedTypes: z.array(z.string().min(1)).optional(),
  minFiles: z.number().int().nonnegative().optional(),
  maxFiles: z.number().int().positive().optional(),
});
export type FileUploadUiConfig = z.infer<typeof FileUploadUiConfigSchema>;

export const TableEditorUiConfigSchema = z.object({
  columns: z.array(ColumnSpecSchema).default([]),
  submitLabel: z.string().min(1).optional(),
  emptyMessage: z.string().min(1).optional(),
});
export type TableEditorUiConfig = z.infer<typeof TableEditorUiConfigSchema>;

export const AssignmentTableUiConfigSchema = z.object({
  assignees: z.array(
    SelectOptionSchema.extend({
      kind: z.enum(['human', 'agent']),
      role: z.string().optional(),
    }),
  ).default([]),
  priorities: z.array(z.string().min(1)).optional(),
  defaultPriority: z.string().min(1).optional(),
  allowSkip: z.boolean().optional(),
  submitLabel: z.string().min(1).optional(),
  itemColumnLabel: z.string().min(1).optional(),
  noteField: z.boolean().optional(),
});
export type AssignmentTableUiConfig = z.infer<typeof AssignmentTableUiConfigSchema>;

/**
 * The components a human step can render, each with the config it accepts.
 * The step editor's dropdown and its config fields both come from here, so a
 * component cannot be offered without a way to configure it.
 */
export const STEP_UI_CONFIG_SCHEMAS = {
  'file-upload': FileUploadUiConfigSchema,
  'table-editor': TableEditorUiConfigSchema,
  'assignment-table': AssignmentTableUiConfigSchema,
} as const;

export type StepUiComponent = keyof typeof STEP_UI_CONFIG_SCHEMAS;

export const STEP_UI_COMPONENTS = Object.keys(STEP_UI_CONFIG_SCHEMAS) as [StepUiComponent, ...StepUiComponent[]];

/** True when the component name has a config schema — a `ui.component` may name
 *  a custom body this platform build does not know about. */
export function isKnownStepUiComponent(component: string | undefined): component is StepUiComponent {
  return component !== undefined && component in STEP_UI_CONFIG_SCHEMAS;
}
