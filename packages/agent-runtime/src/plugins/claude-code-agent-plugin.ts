import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentPlugin, AgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';

export class ClaudeCodeAgentPlugin implements AgentPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Claude Code Agent',
    description:
      'General-purpose AI agent powered by Claude Code CLI. ' +
      'Executes configurable skills — from document extraction to code generation — ' +
      'driven by SKILL.md prompts and structured input data.',
    inputDescription:
      'Any structured JSON context: file paths, previous step outputs, domain data. ' +
      'Adapts to the configured skill.',
    outputDescription:
      'Skill-dependent structured JSON with confidence scoring. ' +
      'Examples: extracted metadata, generated code, analysis reports.',
    roles: ['executor'],
  };

  private context!: AgentContext;
  private agentConfig!: AgentConfig;

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;

    const stepConfig = context.config.stepConfigs.find(
      (sc: StepConfig) => sc.stepId === context.stepId,
    );

    if (!stepConfig) {
      throw new Error(`Step config not found for stepId '${context.stepId}'`);
    }

    const agentConfig = stepConfig.agentConfig ?? {};
    if (!agentConfig.skill && !agentConfig.prompt) {
      throw new Error(
        `Neither skill nor prompt configured in agentConfig for step '${context.stepId}'. ` +
        'ClaudeCodeAgentPlugin requires at least one of agentConfig.skill or agentConfig.prompt.',
      );
    }

    this.agentConfig = agentConfig;
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();
    const skillName = this.agentConfig.skill ?? 'custom-prompt';

    await emit({
      type: 'status',
      payload: `spawning Claude Code CLI with skill '${skillName}'`,
      timestamp: new Date().toISOString(),
    });

    try {
      const prompt = await this.buildPrompt();
      const options = this.agentConfig.model ? { model: this.agentConfig.model } : undefined;
      const cliOutput = await this.spawnClaudeCli(prompt, options);
      const duration_ms = Date.now() - startTime;

      let parsedResult: Record<string, unknown>;
      try {
        parsedResult = JSON.parse(cliOutput) as Record<string, unknown>;
      } catch {
        parsedResult = { raw: cliOutput };
      }

      const confidence = typeof parsedResult.confidence === 'number'
        ? parsedResult.confidence
        : 0.7;

      await emit({
        type: 'result',
        payload: {
          confidence,
          reasoning_summary: `Claude Code skill '${skillName}' completed successfully`,
          reasoning_chain: [
            `Invoked skill: ${skillName}`,
            `Input keys: ${Object.keys(this.context.stepInput).join(', ')}`,
            'CLI execution completed',
          ],
          annotations: [],
          model: this.agentConfig.model ?? 'claude-code-cli',
          duration_ms,
          result: parsedResult,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await emit({
        type: 'result',
        payload: {
          confidence: 0,
          reasoning_summary: `Claude Code skill '${skillName}' failed with error: ${errorMessage}`,
          reasoning_chain: [
            `Invoked skill: ${skillName}`,
            `Error: ${errorMessage}`,
          ],
          annotations: [],
          model: this.agentConfig.model ?? 'claude-code-cli',
          duration_ms,
          result: null,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async buildPrompt(): Promise<string> {
    const parts: string[] = [];

    // 1. Skill prompt from SKILL.md
    if (this.agentConfig.skill && this.agentConfig.skillsDir) {
      const skillContent = await this.readSkillFile(
        this.agentConfig.skillsDir,
        this.agentConfig.skill,
      );
      parts.push(skillContent);
    }

    // 2. Custom prompt
    if (this.agentConfig.prompt) {
      parts.push(this.agentConfig.prompt);
    }

    // 3. Input context
    const previousOutputs = await this.context.getPreviousStepOutputs();
    const hasPreivousOutputs = Object.keys(previousOutputs).length > 0;

    parts.push('## Input Data');
    parts.push(JSON.stringify(this.context.stepInput, null, 2));

    if (hasPreivousOutputs) {
      parts.push('## Previous Step Outputs');
      parts.push(JSON.stringify(previousOutputs, null, 2));
    }

    return parts.join('\n\n');
  }

  protected async readSkillFile(skillsDir: string, skill: string): Promise<string> {
    const skillPath = join(skillsDir, skill, 'SKILL.md');
    return readFile(skillPath, 'utf-8');
  }

  protected async spawnClaudeCli(prompt: string, options?: { model?: string }): Promise<string> {
    const args = ['-p', prompt, '--output-format', 'json'];

    if (options?.model) {
      args.push('--model', options.model);
    }

    return new Promise((resolve, reject) => {
      execFile(
        'claude',
        args,
        { timeout: 10 * 60_000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`CLI process failed: ${stderr || error.message}`));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }
}
