import type { LucideIcon } from 'lucide-react';
import { Eye, FileText, CheckSquare, Upload, CircleDot, MessageSquare } from 'lucide-react';
import type { HumanTask, CoworkSession } from '@mediforce/platform-core';
import { formatStepName } from './task-utils';

// ---------------------------------------------------------------------------
// ActionItem — unified wrapper for things that appear in the task queue
// ---------------------------------------------------------------------------

export type ActionItem =
  | { kind: 'task'; data: HumanTask }
  | { kind: 'cowork'; data: CoworkSession };

/** Common accessors so rendering code doesn't need to discriminate everywhere. */
export function getItemId(item: ActionItem): string {
  return item.data.id;
}

export function getItemProcessInstanceId(item: ActionItem): string {
  return item.data.processInstanceId;
}

export function getItemCreatedAt(item: ActionItem): string {
  return item.data.createdAt;
}

export function getItemAssignedUserId(item: ActionItem): string | null {
  return item.data.assignedUserId;
}

export function isItemActive(item: ActionItem): boolean {
  if (item.kind === 'task') return item.data.status === 'pending' || item.data.status === 'claimed';
  return item.data.status === 'active';
}

export function isItemCompleted(item: ActionItem): boolean {
  if (item.kind === 'task') return item.data.status === 'completed' || item.data.status === 'cancelled';
  return item.data.status === 'finalized';
}

export function getItemDeadline(item: ActionItem): string | null {
  if (item.kind === 'task') return item.data.deadline;
  return null;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

const ACTION_TYPES = ['review', 'input', 'choose', 'upload', 'cowork', 'action'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

export interface ActionTypeInfo {
  type: ActionType;
  label: string;
  icon: LucideIcon;
  colorClass: string;
}

const ACTION_TYPE_MAP: Record<ActionType, Omit<ActionTypeInfo, 'type'>> = {
  review: { label: 'Review', icon: Eye, colorClass: 'text-purple-500' },
  input: { label: 'Input needed', icon: FileText, colorClass: 'text-blue-500' },
  choose: { label: 'Choose', icon: CheckSquare, colorClass: 'text-green-500' },
  upload: { label: 'Upload', icon: Upload, colorClass: 'text-orange-500' },
  cowork: { label: 'Co-work', icon: MessageSquare, colorClass: 'text-teal-500' },
  action: { label: 'Action needed', icon: CircleDot, colorClass: 'text-gray-500' },
};

function deriveActionType(item: ActionItem): ActionType {
  if (item.kind === 'cowork') return 'cowork';
  const task = item.data;
  if (task.creationReason === 'agent_review_l3') return 'review';
  if (task.params !== undefined && task.params.length > 0) return 'input';
  if (task.selection !== undefined) return 'choose';
  if (task.ui?.component === 'file-upload') return 'upload';
  return 'action';
}

export function getActionType(item: ActionItem): ActionTypeInfo {
  const type = deriveActionType(item);
  return { type, ...ACTION_TYPE_MAP[type] };
}

export function getItemLabel(item: ActionItem): string {
  const { label } = getActionType(item);
  const context = formatStepName(item.data.stepId);
  return `${label}: ${context}`;
}
