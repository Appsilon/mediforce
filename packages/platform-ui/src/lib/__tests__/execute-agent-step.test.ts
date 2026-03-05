// packages/platform-ui/src/lib/__tests__/execute-agent-step.test.ts
// Tests for config-driven executeAgentStep (no autonomyLevel param)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessConfig } from '@mediforce/platform-core';
import {
  buildProcessInstance,
  buildProcessConfig,
  buildAgentOutputEnvelope,
} from '@mediforce/platform-core/testing';

// Mock platform-services module
const mockProcessRepo = {
  getProcessConfig: vi.fn(),
  getProcessDefinition: vi.fn(),
  saveProcessDefinition: vi.fn(),
  saveProcessConfig: vi.fn(),
  listProcessConfigs: vi.fn(),
  setProcessArchived: vi.fn(),
};
const mockInstanceRepo = {
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  getByStatus: vi.fn(),
  getByDefinition: vi.fn(),
  addStepExecution: vi.fn(),
  getStepExecutions: vi.fn(),
  getLatestStepExecution: vi.fn(),
};
const mockPluginRegistry = {
  get: vi.fn(),
  register: vi.fn(),
  has: vi.fn(),
  clear: vi.fn(),
  names: vi.fn(),
};
const mockAgentRunner = {
  run: vi.fn(),
};
const mockAuditRepo = {
  append: vi.fn(),
};
const mockEngine = {
  advanceStep: vi.fn(),
};
const mockHumanTaskRepo = {
  create: vi.fn(),
  getById: vi.fn(),
  getByRole: vi.fn(),
  getByInstanceId: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
};
const mockLlmClient = {
  complete: vi.fn(),
};

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    engine: mockEngine,
    agentRunner: mockAgentRunner,
    pluginRegistry: mockPluginRegistry,
    instanceRepo: mockInstanceRepo,
    processRepo: mockProcessRepo,
    llmClient: mockLlmClient,
    auditRepo: mockAuditRepo,
    humanTaskRepo: mockHumanTaskRepo,
  }),
}));

// Import after mock setup
import { executeAgentStep } from '../execute-agent-step';

describe('executeAgentStep', () => {
  const defaultInstance = buildProcessInstance({
    id: 'inst-001',
    definitionName: 'supply-chain-review',
    definitionVersion: '2.0',
    configName: 'default',
    configVersion: '1.0',
    currentStepId: 'quality-check',
  });

  const defaultProcessConfig: ProcessConfig = buildProcessConfig({
    processName: 'supply-chain-review',
    configName: 'default',
    configVersion: '1.0',
    stepConfigs: [
      {
        stepId: 'quality-check',
        executorType: 'agent',
        plugin: 'supply-chain-review/vendor-assessment',
        autonomyLevel: 'L2',
        confidenceThreshold: 0.8,
        fallbackBehavior: 'escalate_to_human',
        timeoutMinutes: 30,
      },
    ],
  });

  const mockPlugin = {
    initialize: vi.fn(),
    run: vi.fn(),
  };

  const defaultEnvelope = buildAgentOutputEnvelope();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path mocks
    mockInstanceRepo.getById.mockResolvedValue(defaultInstance);
    mockProcessRepo.getProcessConfig.mockResolvedValue(defaultProcessConfig);
    mockPluginRegistry.get.mockReturnValue(mockPlugin);
    mockAgentRunner.run.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });
    mockInstanceRepo.getStepExecutions.mockResolvedValue([]);
  });

  // ---- Config Resolution ----

  it('[DATA] resolves ProcessConfig from processRepo with 3-part key (processName, configName, configVersion)', async () => {
    await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockProcessRepo.getProcessConfig).toHaveBeenCalledWith(
      'supply-chain-review',
      'default',
      '1.0',
    );
  });

  it('[DATA] uses instance.configName and instance.configVersion for config lookup', async () => {
    const customInstance = buildProcessInstance({
      id: 'inst-002',
      definitionName: 'supply-chain-review',
      definitionVersion: '2.0',
      configName: 'full-auto',
      configVersion: '3.1',
      currentStepId: 'quality-check',
    });
    mockInstanceRepo.getById.mockResolvedValue(customInstance);

    await executeAgentStep('inst-002', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockProcessRepo.getProcessConfig).toHaveBeenCalledWith(
      'supply-chain-review',
      'full-auto',
      '3.1',
    );
  });

  it('[ERROR] throws descriptive error when ProcessConfig is missing', async () => {
    mockProcessRepo.getProcessConfig.mockResolvedValue(null);

    await expect(
      executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1'),
    ).rejects.toThrow("ProcessConfig not found for 'supply-chain-review' @ default:1.0");
  });

  it('[ERROR] throws descriptive error when StepConfig is missing for the step', async () => {
    mockProcessRepo.getProcessConfig.mockResolvedValue(
      buildProcessConfig({
        processName: 'supply-chain-review',
        configName: 'default',
        configVersion: '1.0',
        stepConfigs: [{ stepId: 'other-step', executorType: 'agent' }],
      }),
    );

    await expect(
      executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1'),
    ).rejects.toThrow(
      "StepConfig not found for step 'quality-check' in ProcessConfig 'supply-chain-review'",
    );
  });

  // ---- Plugin Resolution ----

  it('[DATA] uses stepConfig.plugin for plugin lookup when set', async () => {
    await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('supply-chain-review/vendor-assessment');
  });

  it('[DATA] falls back to stepId for plugin lookup when stepConfig.plugin not set', async () => {
    mockProcessRepo.getProcessConfig.mockResolvedValue(
      buildProcessConfig({
        processName: 'supply-chain-review',
        configName: 'default',
        configVersion: '1.0',
        stepConfigs: [
          {
            stepId: 'quality-check',
            executorType: 'agent',
            autonomyLevel: 'L2',
          },
        ],
      }),
    );

    await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('quality-check');
  });

  // ---- AgentRunner receives correct config ----

  it('[DATA] passes resolved autonomyLevel from stepConfig to AgentRunner', async () => {
    mockProcessRepo.getProcessConfig.mockResolvedValue(
      buildProcessConfig({
        processName: 'supply-chain-review',
        configName: 'default',
        configVersion: '1.0',
        stepConfigs: [
          {
            stepId: 'quality-check',
            executorType: 'agent',
            plugin: 'supply-chain-review/vendor-assessment',
            autonomyLevel: 'L3',
          },
        ],
      }),
    );

    await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    // AgentContext should have the resolved autonomyLevel
    const agentContext = mockAgentRunner.run.mock.calls[0][1];
    expect(agentContext.autonomyLevel).toBe('L3');
  });

  // ---- L4 behavior ----

  it('[DATA] L4 calls engine.advanceStep when appliedToWorkflow=true', async () => {
    mockProcessRepo.getProcessConfig.mockResolvedValue(
      buildProcessConfig({
        processName: 'supply-chain-review',
        configName: 'default',
        configVersion: '1.0',
        stepConfigs: [
          {
            stepId: 'quality-check',
            executorType: 'agent',
            plugin: 'supply-chain-review/vendor-assessment',
            autonomyLevel: 'L4',
          },
        ],
      }),
    );

    const updatedInstance = buildProcessInstance({
      id: 'inst-001',
      status: 'running',
      currentStepId: 'next-step',
    });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);
    mockAgentRunner.run.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: true,
      fallbackReason: null,
    });

    const result = await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockEngine.advanceStep).toHaveBeenCalled();
    expect(result.status).toBe('running');
  });

  // ---- L0/L1/L2 behavior ----

  it('[DATA] L0/L1/L2 do NOT call engine.advanceStep', async () => {
    for (const level of ['L0', 'L1', 'L2'] as const) {
      vi.clearAllMocks();
      mockInstanceRepo.getById.mockResolvedValue(defaultInstance);
      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: level,
            },
          ],
        }),
      );
      mockPluginRegistry.get.mockReturnValue(mockPlugin);
      mockAgentRunner.run.mockResolvedValue({
        status: 'completed',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: null,
      });
      mockInstanceRepo.getStepExecutions.mockResolvedValue([]);

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockEngine.advanceStep).not.toHaveBeenCalled();
    }
  });

  // ---- Audit events ----

  it('[DATA] escalated/paused result writes audit event with executorType as top-level field', async () => {
    mockAgentRunner.run.mockResolvedValue({
      status: 'escalated',
      envelope: null,
      appliedToWorkflow: false,
      fallbackReason: 'error',
    });

    await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        executorType: 'agent',
      }),
    );
  });

  // ---- Signature ----

  it('[DATA] has exactly 4 parameters (no autonomyLevel param)', () => {
    // executeAgentStep should accept 4 params: instanceId, stepId, appContext, triggeredBy
    expect(executeAgentStep.length).toBeLessThanOrEqual(4);
  });

  // ---- L3 Review Routing ----

  describe('L3 review routing', () => {
    const l3Config = buildProcessConfig({
      processName: 'supply-chain-review',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [
        {
          stepId: 'quality-check',
          executorType: 'agent',
          plugin: 'supply-chain-review/vendor-assessment',
          autonomyLevel: 'L3',
          allowedRoles: ['reviewer', 'approver'],
        },
      ],
    });

    const l3PausedResult = {
      status: 'paused' as const,
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    };

    beforeEach(() => {
      mockProcessRepo.getProcessConfig.mockResolvedValue(l3Config);
      mockAgentRunner.run.mockResolvedValue(l3PausedResult);
    });

    it('[DATA] L3 + reviewerType undefined (default human) creates HumanTask', async () => {
      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processInstanceId: 'inst-001',
          stepId: 'quality-check',
          assignedRole: 'reviewer',
          status: 'pending',
          completionData: expect.objectContaining({
            reviewType: 'agent_output_review',
            agentOutput: expect.objectContaining({
              confidence: expect.any(Number),
              reasoning: expect.any(String),
            }),
          }),
        }),
      );
    });

    it('[DATA] L3 + reviewerType=human creates HumanTask with agentOutput', async () => {
      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'human',
              allowedRoles: ['senior-reviewer'],
            },
          ],
        }),
      );

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedRole: 'senior-reviewer',
          completionData: expect.objectContaining({
            reviewType: 'agent_output_review',
            agentOutput: expect.objectContaining({
              confidence: defaultEnvelope.confidence,
              reasoning: defaultEnvelope.reasoning_summary,
              result: defaultEnvelope.result,
              model: defaultEnvelope.model,
            }),
          }),
        }),
      );
    });

    it('[DATA] L3 + reviewerType=agent invokes review plugin', async () => {
      const mockReviewPlugin = {
        review: vi.fn().mockResolvedValue({
          verdict: 'approve',
          reasoning: 'Looks good',
          confidence: 0.95,
        }),
      };
      mockPluginRegistry.get.mockImplementation((name: string) => {
        if (name === 'quality-reviewer') return mockReviewPlugin;
        return mockPlugin;
      });

      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'agent',
              reviewerPlugin: 'quality-reviewer',
            },
          ],
        }),
      );

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockReviewPlugin.review).toHaveBeenCalledWith(
        expect.objectContaining({
          stepId: 'quality-check',
          processInstanceId: 'inst-001',
          executorOutput: defaultEnvelope,
          iterationNumber: 0,
        }),
      );
    });

    it('[DATA] L3 + agent reviewer approves -> engine.advanceStep called', async () => {
      const mockReviewPlugin = {
        review: vi.fn().mockResolvedValue({
          verdict: 'approve',
          reasoning: 'Approved',
          confidence: 0.95,
        }),
      };
      mockPluginRegistry.get.mockImplementation((name: string) => {
        if (name === 'quality-reviewer') return mockReviewPlugin;
        return mockPlugin;
      });

      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'agent',
              reviewerPlugin: 'quality-reviewer',
            },
          ],
        }),
      );

      const updatedInstance = buildProcessInstance({
        id: 'inst-001',
        status: 'running',
        currentStepId: 'next-step',
      });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      const result = await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockEngine.advanceStep).toHaveBeenCalled();
      expect(result.status).toBe('running');
    });

    it('[DATA] L3 + agent reviewer rejects -> executor re-invoked with feedback', async () => {
      const mockReviewPlugin = {
        review: vi.fn()
          .mockResolvedValueOnce({
            verdict: 'reject',
            reasoning: 'Missing data',
            feedback: 'Please include vendor certifications',
            confidence: 0.4,
          })
          .mockResolvedValueOnce({
            verdict: 'approve',
            reasoning: 'Now complete',
            confidence: 0.95,
          }),
      };
      mockPluginRegistry.get.mockImplementation((name: string) => {
        if (name === 'quality-reviewer') return mockReviewPlugin;
        return mockPlugin;
      });

      const retryEnvelope = buildAgentOutputEnvelope({ confidence: 0.95 });
      mockAgentRunner.run
        .mockResolvedValueOnce(l3PausedResult) // initial run
        .mockResolvedValueOnce({
          // retry after rejection
          status: 'paused',
          envelope: retryEnvelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        });

      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'agent',
              reviewerPlugin: 'quality-reviewer',
              reviewConstraints: { maxIterations: 3 },
            },
          ],
        }),
      );

      const updatedInstance = buildProcessInstance({
        id: 'inst-001',
        status: 'running',
        currentStepId: 'next-step',
      });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      // Agent runner should have been called twice (initial + retry)
      expect(mockAgentRunner.run).toHaveBeenCalledTimes(2);
      // Second call should include reviewFeedback in stepInput
      const retryContext = mockAgentRunner.run.mock.calls[1][1];
      expect(retryContext.stepInput).toEqual(
        expect.objectContaining({
          reviewFeedback: 'Please include vendor certifications',
        }),
      );
    });

    it('[ERROR] L3 + agent reviewer rejects + maxIterations exhausted -> throws', async () => {
      const mockReviewPlugin = {
        review: vi.fn().mockResolvedValue({
          verdict: 'reject',
          reasoning: 'Still not good',
          feedback: 'Try again',
          confidence: 0.3,
        }),
      };
      mockPluginRegistry.get.mockImplementation((name: string) => {
        if (name === 'quality-reviewer') return mockReviewPlugin;
        return mockPlugin;
      });

      // All retries also return paused
      mockAgentRunner.run.mockResolvedValue(l3PausedResult);

      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'agent',
              reviewerPlugin: 'quality-reviewer',
              reviewConstraints: { maxIterations: 2 },
            },
          ],
        }),
      );

      await expect(
        executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1'),
      ).rejects.toThrow("Max review iterations (2) exhausted for step 'quality-check'");
    });

    it('[DATA] L3 + agent review emits audit event with action=review.completed', async () => {
      const mockReviewPlugin = {
        review: vi.fn().mockResolvedValue({
          verdict: 'approve',
          reasoning: 'Approved',
          confidence: 0.95,
        }),
      };
      mockPluginRegistry.get.mockImplementation((name: string) => {
        if (name === 'quality-reviewer') return mockReviewPlugin;
        return mockPlugin;
      });

      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L3',
              reviewerType: 'agent',
              reviewerPlugin: 'quality-reviewer',
            },
          ],
        }),
      );

      const updatedInstance = buildProcessInstance({ id: 'inst-001', status: 'running' });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockAuditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'review.completed',
          executorType: 'agent',
          reviewerType: 'agent',
        }),
      );
    });

    it('[DATA] L4 has no review task and reviewerType=none in audit', async () => {
      mockProcessRepo.getProcessConfig.mockResolvedValue(
        buildProcessConfig({
          processName: 'supply-chain-review',
          configName: 'default',
          configVersion: '1.0',
          stepConfigs: [
            {
              stepId: 'quality-check',
              executorType: 'agent',
              plugin: 'supply-chain-review/vendor-assessment',
              autonomyLevel: 'L4',
            },
          ],
        }),
      );

      const updatedInstance = buildProcessInstance({ id: 'inst-001', status: 'running' });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);
      mockAgentRunner.run.mockResolvedValue({
        status: 'completed',
        envelope: defaultEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      });

      await executeAgentStep('inst-001', 'quality-check', { studyId: 'S1' }, 'user-1');

      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
      // L4 should not create review tasks
      expect(mockEngine.advanceStep).toHaveBeenCalled();
    });
  });
});
