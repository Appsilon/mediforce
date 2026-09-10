import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseModelJson } from '../parse-model-json';

const Schema = z.object({ reply: z.string(), questions: z.array(z.string()).max(2) });

describe('parseModelJson', () => {
  it('reads a bare object', () => {
    expect(parseModelJson('{"reply":"done","questions":[]}', Schema))
      .toEqual({ reply: 'done', questions: [] });
  });

  it('reads it out of a fenced block, which is what models usually send', () => {
    const content = 'Here you go:\n```json\n{"reply":"done","questions":["which key?"]}\n```';
    expect(parseModelJson(content, Schema)?.questions).toEqual(['which key?']);
  });

  it('reads it out of a sentence either side of the braces', () => {
    expect(parseModelJson('Sure. {"reply":"done","questions":[]} Hope that helps.', Schema)?.reply)
      .toBe('done');
  });

  it('returns null for prose, so the caller can degrade rather than throw', () => {
    expect(parseModelJson('I could not do that.', Schema)).toBeNull();
  });

  it('returns null when the object parses but breaks the schema', () => {
    expect(parseModelJson('{"reply":"done","questions":["a","b","c"]}', Schema)).toBeNull();
  });
});
