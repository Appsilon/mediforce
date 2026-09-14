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

/** Derived, so the editor's kind dropdown cannot drift from the union. */
export const COLUMN_KINDS = ColumnSpecSchema.options.map(
  (option) => option.shape.kind.value,
) as [ColumnSpec['kind'], ...ColumnSpec['kind'][]];

/**
 * Each field carries its own `.catch(undefined)`, so a malformed value drops
 * that key alone. A whole-object parse with a whole-object fallback is not safe
 * here: these configs come from definitions authored before the shape was typed,
 * and `validateUploadPayload` reading `{}` means *no* limits — one bad key would
 * silently disable the file-count and MIME checks the author asked for.
 *
 * `looseObject`, so a key this build does not know about survives a round-trip
 * through the editor rather than being stripped on save.
 */
export const FileUploadUiConfigSchema = z.looseObject({
  acceptedTypes: z.array(z.string().min(1)).optional().catch(undefined),
  minFiles: z.number().int().nonnegative().optional().catch(undefined),
  maxFiles: z.number().int().positive().optional().catch(undefined),
});
export type FileUploadUiConfig = z.infer<typeof FileUploadUiConfigSchema>;

export const TableEditorUiConfigSchema = z.looseObject({
  // Per element: one malformed column must not blank the whole table.
  columns: z.array(z.unknown())
    .transform((cols) => cols.flatMap((c) => {
      const parsed = ColumnSpecSchema.safeParse(c);
      return parsed.success ? [parsed.data] : [];
    }))
    .optional()
    .catch(undefined)
    .transform((cols) => cols ?? []),
  submitLabel: z.string().min(1).optional().catch(undefined),
  emptyMessage: z.string().min(1).optional().catch(undefined),
});
export type TableEditorUiConfig = z.infer<typeof TableEditorUiConfigSchema>;

export const AssigneeOptionSchema = SelectOptionSchema.extend({
  kind: z.enum(['human', 'agent']),
  role: z.string().optional(),
});
export type AssigneeOption = z.infer<typeof AssigneeOptionSchema>;

export const AssignmentTableUiConfigSchema = z.looseObject({
  // Per element, for the same reason as `columns`: dropping every assignee
  // because one lacks a `kind` would also revert `allowSkip` and `noteField`
  // to their defaults, handing back a skip button the author turned off.
  assignees: z.array(z.unknown())
    .transform((list) => list.flatMap((a) => {
      const parsed = AssigneeOptionSchema.safeParse(a);
      return parsed.success ? [parsed.data] : [];
    }))
    .optional()
    .catch(undefined)
    .transform((list) => list ?? []),
  priorities: z.array(z.string().min(1)).optional().catch(undefined),
  defaultPriority: z.string().min(1).optional().catch(undefined),
  allowSkip: z.boolean().optional().catch(undefined),
  submitLabel: z.string().min(1).optional().catch(undefined),
  itemColumnLabel: z.string().min(1).optional().catch(undefined),
  noteField: z.boolean().optional().catch(undefined),
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
