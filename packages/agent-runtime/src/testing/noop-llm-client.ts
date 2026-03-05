import type { LlmClient, LlmMessage, LlmResponse } from '../interfaces/agent-plugin.js';

export class NoopLlmClient implements LlmClient {
  private responses: LlmResponse[] = [];
  private callCount = 0;

  /** Test setup: queue a response to return for the next complete() call */
  queueResponse(response: LlmResponse): void {
    this.responses.push(response);
  }

  async complete(_messages: LlmMessage[], model?: string): Promise<LlmResponse> {
    this.callCount++;
    const response = this.responses.shift();
    if (!response) {
      return {
        content: 'noop response',
        model: model ?? 'noop-model',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }
    return response;
  }

  getCallCount(): number {
    return this.callCount;
  }

  reset(): void {
    this.responses = [];
    this.callCount = 0;
  }
}
