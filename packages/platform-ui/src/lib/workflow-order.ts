import { z } from 'zod';

const WorkflowOrderSchema = z.array(z.string());

/** localStorage key for one user's card order in one workspace. */
export function workflowOrderStorageKey(uid: string, handle: string): string {
  return `mediforce:workflow-order:${uid}:${handle}`;
}

export function parseWorkflowOrder(stored: string | null): string[] {
  if (stored === null) return [];
  try {
    const parsed = WorkflowOrderSchema.safeParse(JSON.parse(stored));
    return parsed.success === true ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Saved names first, in saved order; workflows the user has never placed
 * (e.g. newly created ones) follow with active ones first, then alphabetically.
 * Run activity never moves a placed card.
 */
export function applyWorkflowOrder<T extends { name: string }>(
  items: T[],
  savedOrder: string[],
  isActive: (item: T) => boolean = () => false,
): T[] {
  const position = new Map(savedOrder.map((name, index) => [name, index]));
  return [...items].sort((itemA, itemB) => {
    const positionA = position.get(itemA.name);
    const positionB = position.get(itemB.name);
    if (positionA !== undefined && positionB !== undefined) return positionA - positionB;
    if (positionA !== undefined) return -1;
    if (positionB !== undefined) return 1;
    const activeA = isActive(itemA);
    const activeB = isActive(itemB);
    if (activeA === true && activeB === false) return -1;
    if (activeA === false && activeB === true) return 1;
    return itemA.name.localeCompare(itemB.name);
  });
}

export function readWorkflowOrder(storageKey: string | null): string[] {
  if (storageKey === null) return [];
  try {
    return parseWorkflowOrder(localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

/** Moves `draggedName` into the slot currently held by `targetName`. */
export function moveWorkflow(order: string[], draggedName: string, targetName: string): string[] {
  const fromIndex = order.indexOf(draggedName);
  const toIndex = order.indexOf(targetName);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return order;
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, draggedName);
  return next;
}
