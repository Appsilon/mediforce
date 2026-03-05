import type { ProcessDefinition } from '../schemas/process-definition.js';
import type { ProcessConfig } from '../schemas/process-config.js';

export interface ProcessRepository {
  getProcessDefinition(
    name: string,
    version: string,
  ): Promise<ProcessDefinition | null>;
  saveProcessDefinition(definition: ProcessDefinition): Promise<void>;
  getProcessConfig(
    processName: string,
    configName: string,
    configVersion: string,
  ): Promise<ProcessConfig | null>;
  saveProcessConfig(config: ProcessConfig): Promise<void>;
  listProcessConfigs(processName: string): Promise<ProcessConfig[]>;
  setProcessArchived(name: string, archived: boolean): Promise<void>;
}
