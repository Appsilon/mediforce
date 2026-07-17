import { describe, it, expect } from 'vitest';
import { buildWorkflowAssistantSystemPrompt } from '../system-prompt';

describe('buildWorkflowAssistantSystemPrompt', () => {
  const prompt = buildWorkflowAssistantSystemPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('mentions every canvas-mutation tool and the routing decision', () => {
    for (const term of ['add_step', 'update_step', 'remove_step', 'list_models', 'clarifying question']) {
      expect(prompt).toContain(term);
    }
  });

  it('does not reference any engine-only concepts from the deprecated full-artifact designer', () => {
    expect(prompt).not.toMatch(/update_artifact/);
    expect(prompt).not.toMatch(/dry.run/i);
    expect(prompt).not.toMatch(/render_workflow_diagram/);
  });

  it('warns against exposing internal schema codes (autonomy levels) to the user', () => {
    expect(prompt).toMatch(/L2/);
    expect(prompt).toMatch(/autonomy/i);
  });

  it('addresses the starter-template placeholder and step-ID grounding', () => {
    expect(prompt).toMatch(/placeholder/i);
    expect(prompt).toMatch(/clientId/);
    expect(prompt).toMatch(/canvas state/i);
  });

  it('pushes back on defaulting to agent for deterministic work, and allows inline scripts', () => {
    expect(prompt).toMatch(/deterministic/i);
    expect(prompt).toMatch(/inlineScript/);
    expect(prompt).toMatch(/no Docker image, repo, or commit needed/);
  });

  it('forbids narrating tool-call self-correction to the user or leaking it into step fields', () => {
    expect(prompt).toMatch(/Never narrate the correction/);
    expect(prompt).toMatch(/leak into a step's fields/);
  });

  it('forbids claiming a change happened in past tense without calling the tool for it in the same turn', () => {
    expect(prompt).toMatch(/past tense/i);
    expect(prompt).toMatch(/only changes when you call/i);
  });

  it('also forbids announcing an about-to-happen action (trailing colon) without a tool call in the same turn', () => {
    expect(prompt).toMatch(/announcing you're about to act/i);
    expect(prompt).toMatch(/trailing off with a colon/i);
  });

  it('requires closing the loop on missing parameters — infer them or ask a specific, understanding-based question, never leave one silently blank', () => {
    expect(prompt).toMatch(/close the loop/i);
    expect(prompt).toMatch(/never leave one silently missing/i);
    expect(prompt).toMatch(/blank "what should/i);
  });

  it('requires the decision type for verdict steps and treats review as deprecated', () => {
    expect(prompt).toMatch(/type.*must be.*decision.*with a `verdicts` map/);
    expect(prompt).toMatch(/review.*is a deprecated type/i);
    expect(prompt).toMatch(/never create a \*new\* step with `type: "review"`/);
  });

  it('teaches the correct ${steps.id} interpolation syntax for action configs and forbids {{...}} there', () => {
    expect(prompt).toMatch(/\$\{steps\.check-etymology\}/);
    expect(prompt).toMatch(/never `\{\{\.\.\.\}\}`/);
    expect(prompt).toMatch(/reserved for agent\/script step `env`\/secrets/);
  });

  it('requires secrets to be referenced with {{SECRET_NAME}} in a step env, not ${secrets.X}', () => {
    expect(prompt).toMatch(/referenced with `\{\{SECRET_NAME\}\}` in a step's `env` map — never `\$\{secrets\.NAME\}`/);
    expect(prompt).toMatch(/"HARVEST_API_KEY": "\{\{HARVEST_API_KEY\}\}"/);
  });

  it('documents that update_step can connect an already-existing step, and that every response is graph-checked before finishing', () => {
    expect(prompt).toMatch(/`update_step` also accepts `insertAfterId`\/`insertBeforeId`/);
    expect(prompt).toMatch(/checked for structural completeness/i);
    expect(prompt).toMatch(/no separate "add a transition" tool/i);
  });

  it('requires every verdict target to be a real step id or a clientId — never an invented value that merely sounds right', () => {
    expect(prompt).toMatch(/Every verdict's `target` must be a real step id/);
    expect(prompt).toMatch(/or in a verdict's `target`, within the same response/);
  });

  it('requires a params field on human input steps and explains how collected input flows downstream', () => {
    expect(prompt).toMatch(/needs a `params` array/);
    expect(prompt).toMatch(/automatically receives the \*immediately preceding\* step's output/);
    expect(prompt).toMatch(/\$\{steps\.share-two-words\.words\}/);
  });

  it('warns that a producer step and a ${steps.x.key} reference must agree on the exact key (blank vs raw-JSON email failures)', () => {
    expect(prompt).toMatch(/producer and the reference MUST agree on the exact key/);
    expect(prompt).toMatch(/renders blank/);
    expect(prompt).toMatch(/dumps raw JSON/);
    expect(prompt).toMatch(/\$\{steps\.analyze\.analysis\}/);
  });

  it('states the physical /output/input.json → /output/result.json file contract for agent and script steps', () => {
    expect(prompt).toMatch(/\/output\/input\.json/);
    expect(prompt).toMatch(/\/output\/result\.json/);
    expect(prompt).toMatch(/step N's `\/output\/result\.json` becomes step N\+1's `\/output\/input\.json`/);
    expect(prompt).toMatch(/don't pretend an empty result is impossible/);
  });
});
