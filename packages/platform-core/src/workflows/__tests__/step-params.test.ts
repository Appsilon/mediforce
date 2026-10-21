import { describe, it, expect } from 'vitest';
import { resolveParamDefaults } from '../step-params';
import type { StepParam } from '../../schemas/process-definition';

const run = {
  triggerPayload: { studyId: 'ONC-101' },
  variables: {
    'draft-request': { subject: 'Data request', body: 'Dear site,\nplease send the labs.' },
    'review-outcome': { verdict: 'approve', findings: ['Grade 5 AE unreported'] },
  },
};

function param(name: string, defaultValue: unknown): StepParam {
  return { name, type: 'textarea', required: false, default: defaultValue };
}

describe('resolveParamDefaults', () => {
  it('fills a default from a previous step output so the task opens on the actual draft', () => {
    const [body] = resolveParamDefaults([param('body', '${steps.draft-request.body}')], run);

    expect(body.default).toBe('Dear site,\nplease send the labs.');
  });

  it('renders templates that mix text with step output and trigger input', () => {
    const [subject] = resolveParamDefaults(
      [param('subject', '${triggerPayload.studyId}: ${steps.draft-request.subject} (${steps.review-outcome.verdict})')],
      run,
    );

    expect(subject.default).toBe('ONC-101: Data request (approve)');
  });

  it('leaves static defaults and params without a default untouched', () => {
    const params: StepParam[] = [
      param('greeting', 'Dear site'),
      { name: 'urgent', type: 'boolean', required: false, default: true },
      { name: 'notes', type: 'string', required: false },
    ];

    expect(resolveParamDefaults(params, run)).toEqual(params);
  });

  it('drops a default whose step output is missing, so the field opens empty instead of on the raw template', () => {
    const [body] = resolveParamDefaults([param('body', '${steps.never-ran.body}')], run);

    expect(body.default).toBeUndefined();
  });

  it('drops a default whose step output is null, so a required field cannot be submitted as null', () => {
    const [body] = resolveParamDefaults(
      [param('body', '${steps.draft-request.cc}')],
      { variables: { 'draft-request': { cc: null } } },
    );

    expect(body.default).toBeUndefined();
  });

  it('serialises structured output into a text field so the reviewer edits it instead of seeing [object Object]', () => {
    const [findings] = resolveParamDefaults([param('findings', '${steps.review-outcome.findings}')], run);

    expect(findings.default).toBe('[\n  "Grade 5 AE unreported"\n]');
  });

  it('keeps structured output raw for widgets that edit the value itself', () => {
    const [findings] = resolveParamDefaults(
      [{ name: 'findings', type: 'multiselect', required: false, options: ['Grade 5 AE unreported'], default: '${steps.review-outcome.findings}' }],
      run,
    );

    expect(findings.default).toEqual(['Grade 5 AE unreported']);
  });

  it('never resolves secrets into a persisted default', () => {
    const [token] = resolveParamDefaults([param('token', 'key=${secrets.API_KEY}')], run);

    expect(token.default).toBe('key=');
  });
});
