import type { ScriptStepConfig } from '@mediforce/platform-core';

type ScriptResources = NonNullable<ScriptStepConfig['resources']>;

export interface ResolvedScriptResources {
  memory: string;
  cpus: number;
  /** One line per requested field the deployment's cap lowered, for the step's activity log. */
  clamped: string[];
}

const DEFAULT_MEMORY = '8g';
const DEFAULT_CPUS = 2;
const MEMORY_PATTERN = /^([1-9]\d*)([mg])$/i;

function memoryMegabytes(memory: string): number | null {
  const match = MEMORY_PATTERN.exec(memory);
  if (match === null) return null;
  return Number(match[1]) * (match[2].toLowerCase() === 'g' ? 1024 : 1);
}

function memoryCap(env: Record<string, string | undefined>): string {
  const configured = env.SCRIPT_MAX_MEMORY;
  if (configured === undefined || configured === '') return DEFAULT_MEMORY;
  if (memoryMegabytes(configured) === null) {
    console.warn(`[ScriptContainer] SCRIPT_MAX_MEMORY="${configured}" is not <n>m or <n>g; using ${DEFAULT_MEMORY}`);
    return DEFAULT_MEMORY;
  }
  return configured;
}

function cpusCap(env: Record<string, string | undefined>): number {
  const configured = env.SCRIPT_MAX_CPUS;
  if (configured === undefined || configured === '') return DEFAULT_CPUS;
  const cpus = Number(configured);
  if (Number.isFinite(cpus) === false || cpus <= 0) {
    console.warn(`[ScriptContainer] SCRIPT_MAX_CPUS="${configured}" is not a positive number; using ${DEFAULT_CPUS}`);
    return DEFAULT_CPUS;
  }
  return cpus;
}

/**
 * The `docker run --memory/--cpus` of a script step: what the step asks for
 * (`script.resources`), else 8g / 2 CPUs, never above the deployment's
 * SCRIPT_MAX_MEMORY / SCRIPT_MAX_CPUS. The caps default to 8g / 2, so a
 * deployment that sets neither runs every step exactly as before.
 */
export function resolveScriptResources(
  requested: ScriptResources | undefined,
  env: Record<string, string | undefined>,
): ResolvedScriptResources {
  const maxMemory = memoryCap(env);
  const maxCpus = cpusCap(env);
  const clamped: string[] = [];

  let memory = requested?.memory ?? DEFAULT_MEMORY;
  if ((memoryMegabytes(memory) ?? 0) > (memoryMegabytes(maxMemory) ?? 0)) {
    if (requested?.memory !== undefined) clamped.push(`memory ${memory} > SCRIPT_MAX_MEMORY ${maxMemory}`);
    memory = maxMemory;
  }

  let cpus = requested?.cpus ?? DEFAULT_CPUS;
  if (cpus > maxCpus) {
    if (requested?.cpus !== undefined) clamped.push(`cpus ${cpus} > SCRIPT_MAX_CPUS ${maxCpus}`);
    cpus = maxCpus;
  }

  return { memory, cpus, clamped };
}
