import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function confidenceToTrafficLight(confidence: number): { color: string; label: string } {
  if (confidence >= 0.8) return { color: 'text-green-600 dark:text-green-400', label: 'high' };
  if (confidence >= 0.5) return { color: 'text-amber-600 dark:text-amber-400', label: 'medium' };
  return { color: 'text-red-600 dark:text-red-400', label: 'low' };
}
