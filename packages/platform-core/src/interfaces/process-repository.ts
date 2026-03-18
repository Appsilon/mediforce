import type { ZodError } from 'zod';
import type { ProcessDefinition } from '../schemas/process-definition.js';
import type { ProcessConfig } from '../schemas/process-config.js';

export interface InvalidDefinitionEntry {
  data: unknown;
  error: ZodError;
}

export interface DefinitionListResult {
  valid: ProcessDefinition[];
  invalid: InvalidDefinitionEntry[];
}

export interface ProcessRepository {
  getProcessDefinition(
    name: string,
    version: string,
  ): Promise<ProcessDefinition | null>;
  saveProcessDefinition(definition: ProcessDefinition): Promise<void>;
  listProcessDefinitions(): Promise<DefinitionListResult>;
  getProcessConfig(
    processName: string,
    configName: string,
    configVersion: string,
  ): Promise<ProcessConfig | null>;
  saveProcessConfig(config: ProcessConfig): Promise<void>;
  listProcessConfigs(processName: string): Promise<ProcessConfig[]>;
  setProcessArchived(name: string, archived: boolean): Promise<void>;
  setConfigArchived(processName: string, configName: string, configVersion: string, archived: boolean): Promise<void>;
  setDefinitionVersionArchived(name: string, version: string, archived: boolean): Promise<void>;
}
