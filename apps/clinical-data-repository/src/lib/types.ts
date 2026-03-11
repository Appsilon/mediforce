import { z } from 'zod';

export const RequirementFileTypeSchema = z.enum([
  'Protocol',
  'DTS',
  'Standards',
  'CRF',
  'SAP',
]);
export type RequirementFileType = z.infer<typeof RequirementFileTypeSchema>;

export const StudyDomainSchema = z.enum([
  'DM',
  'AE',
  'LB',
  'VS',
  'EX',
  'CM',
]);
export type StudyDomain = z.infer<typeof StudyDomainSchema>;

export const ValidationSeveritySchema = z.enum(['Error', 'Warning', 'Info']);
export type ValidationSeverity = z.infer<typeof ValidationSeveritySchema>;

export const RuleTypeSchema = z.enum([
  'required',
  'format',
  'range',
  'completeness',
  'uniqueness',
  'terminology',
]);
export type RuleType = z.infer<typeof RuleTypeSchema>;

export const FileContentTypeSchema = z.enum(['csv', 'xlsx', 'xpt', 'pdf', 'txt', 'xml']);
export type FileContentType = z.infer<typeof FileContentTypeSchema>;

export const RequirementFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: RequirementFileTypeSchema,
  sizeBytes: z.number(),
  uploadedAt: z.string(),
  aiSummary: z.string(),
  contentType: FileContentTypeSchema,
});
export type RequirementFile = z.infer<typeof RequirementFileSchema>;

export const StudyFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: StudyDomainSchema,
  sizeBytes: z.number(),
  uploadedAt: z.string(),
  hasIssues: z.boolean(),
  issueCount: z.number(),
  contentType: FileContentTypeSchema,
  rows: z.array(z.record(z.string())).optional(),
});
export type StudyFile = z.infer<typeof StudyFileSchema>;

export const ValidationIssueSchema = z.object({
  id: z.string(),
  severity: ValidationSeveritySchema,
  fileId: z.string(),
  fileName: z.string(),
  domain: z.string(),
  variable: z.string(),
  row: z.number(),
  description: z.string(),
  ruleId: z.string(),
  cellValue: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  domain: z.string(),
  type: RuleTypeSchema,
  enabled: z.boolean(),
});
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

export const QueryItemSchema = z.object({
  id: z.string(),
  column: z.string(),
  row: z.number(),
  commentText: z.string(),
  targetType: z.enum(['ValidationAgent', 'CRO']),
  createdAt: z.string(),
});
export type QueryItem = z.infer<typeof QueryItemSchema>;

export const SentQuerySchema = z.object({
  id: z.string(),
  message: z.string(),
  sentAt: z.string(),
  fileId: z.string(),
});
export type SentQuery = z.infer<typeof SentQuerySchema>;
