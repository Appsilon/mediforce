import { describe, it, expect } from 'vitest';
import { messagesForModel, type AssistantMessage } from '../assistant-conversation';

describe('messagesForModel', () => {
  it('drops the plan the pane wrote, so the model does not read it as its own turn', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', content: 'Build a CDISC validation workflow.' },
      { role: 'assistant', content: 'Poll SFTP, validate, then report.', narration: true },
    ];
    expect(messagesForModel(messages)).toEqual([
      { role: 'user', content: 'Build a CDISC validation workflow.' },
    ]);
  });

  it('keeps what the model actually said, without the canvas summary', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', content: 'Add a review step.' },
      { role: 'assistant', content: 'Added a review step before the report.', changes: 'Added review' },
    ];
    expect(messagesForModel(messages)).toEqual([
      { role: 'user', content: 'Add a review step.' },
      { role: 'assistant', content: 'Added a review step before the report.' },
    ]);
  });

  it('drops an empty reply, which the request schema refuses', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', content: 'Add a review step.' },
      { role: 'assistant', content: '', changes: 'Added review' },
    ];
    expect(messagesForModel(messages)).toHaveLength(1);
  });
});
