import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractionCheckSource, filePresetCheckSource, filePresetEvaluatorName } from '../preset-check-script';

let pythonAvailable = true;
try {
  execFileSync('python3', ['--version']);
} catch {
  pythonAvailable = false;
}

/** Actually runs a generated check script with python3, in a temp dir standing in for `/output`. */
function runCheck(source: string, input: unknown): { passed: boolean; comment: string | null } {
  const dir = mkdtempSync(join(tmpdir(), 'preset-check-'));
  try {
    writeFileSync(join(dir, 'input.json'), JSON.stringify(input));
    const script = source
      .replace("'/output/input.json'", JSON.stringify(join(dir, 'input.json')))
      .replace("'/output/result.json'", JSON.stringify(join(dir, 'result.json')));
    writeFileSync(join(dir, 'check.py'), script);
    execFileSync('python3', [join(dir, 'check.py')]);
    return JSON.parse(readFileSync(join(dir, 'result.json'), 'utf-8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('extractionCheckSource', () => {
  it('embeds the paths and input part as JSON literals the script reads at runtime', () => {
    const source = extractionCheckSource({
      resultIdsPath: ['events', 'id'],
      inputIdsPart: 'previousStepOutputs',
      inputIdsPath: ['extract-aes', 'records', 'id'],
    });
    expect(source).toContain('RESULT_IDS_PATH = ["events","id"]');
    expect(source).toContain('INPUT_IDS_PART = "previousStepOutputs"');
    expect(source).toContain('INPUT_IDS_PATH = ["extract-aes","records","id"]');
    expect(source).toContain("json.load(open('/output/input.json'))");
    expect(source).toContain("json.dump({'passed': len(invented) == 0, 'comment': comment}, open('/output/result.json', 'w'))");
  });
});

describe('filePresetCheckSource', () => {
  it('embeds the step\'s output path, format and required fields', () => {
    const source = filePresetCheckSource({ fileName: 'summary.csv', format: 'csv', requiredFields: ['subjectId', 'grade'] }, 'grade-adverse-event');
    expect(source).toContain('PATH = "/workspace/.mediforce/output/grade-adverse-event/summary.csv"');
    expect(source).toContain('FORMAT = "csv"');
    expect(source).toContain('REQUIRED_FIELDS = ["subjectId","grade"]');
  });

  it('JSON-escapes a file name so it cannot break out of the embedded string literal', () => {
    const source = filePresetCheckSource({ fileName: `x".py`, format: 'json', requiredFields: ['a'] }, 's1');
    const pathLine = source.split('\n').find((line) => line.startsWith('PATH = '))!;
    const literal = pathLine.slice('PATH = '.length);
    // A well-formed single JSON string literal round-trips to exactly the path we asked for.
    expect(JSON.parse(literal)).toBe('/workspace/.mediforce/output/s1/x".py');
  });
});

describe.skipIf(!pythonAvailable)('extractionCheckSource (run for real)', () => {
  it('fails on an invented id and notes a missing one, flattening through a nested array', () => {
    const source = extractionCheckSource({
      resultIdsPath: ['events', 'id'],
      inputIdsPart: 'previousStepOutputs',
      inputIdsPath: ['extract-aes', 'records', 'id'],
    });
    const outcome = runCheck(source, {
      result: { events: [{ id: 'a' }, { id: 'z' }] },
      stepInput: { previousStepOutputs: { 'extract-aes': { records: [{ id: 'a' }, { id: 'b' }] } } },
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.comment).toContain("invented ids not in the input: ['z']");
    expect(outcome.comment).toContain("1 input id(s) not returned: ['b']");
  });

  it('passes when every returned id exists in the input, even though some input ids were filtered out', () => {
    const source = extractionCheckSource({ resultIdsPath: ['ids'], inputIdsPart: 'triggerPayload', inputIdsPath: ['validIds'] });
    const outcome = runCheck(source, { result: { ids: ['a'] }, stepInput: { triggerPayload: { validIds: ['a', 'b', 'c'] } } });
    expect(outcome.passed).toBe(true);
    expect(outcome.comment).toContain('2 input id(s) not returned');
  });
});

describe.skipIf(!pythonAvailable)('filePresetCheckSource (run for real)', () => {
  function runFileCheck(config: Parameters<typeof filePresetCheckSource>[0], fileContent: string | null): { passed: boolean; comment: string | null } {
    const outputDir = mkdtempSync(join(tmpdir(), 'preset-output-'));
    try {
      const filePath = join(outputDir, config.fileName);
      if (fileContent !== null) writeFileSync(filePath, fileContent);
      const source = filePresetCheckSource(config, 'step').replace(/PATH = ".*"/, `PATH = ${JSON.stringify(filePath)}`);
      return runCheck(source, {});
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }

  it('fails when the file is missing', () => {
    const outcome = runFileCheck({ fileName: 'summary.csv', format: 'csv', requiredFields: ['grade'] }, null);
    expect(outcome).toMatchObject({ passed: false, comment: expect.stringContaining('missing output file') });
  });

  it('checks CSV column headers', () => {
    expect(runFileCheck({ fileName: 'summary.csv', format: 'csv', requiredFields: ['subjectId', 'grade'] }, 'subjectId,grade\n1,5\n'))
      .toEqual({ passed: true, comment: 'has every required field' });
    expect(runFileCheck({ fileName: 'summary.csv', format: 'csv', requiredFields: ['subjectId', 'grade'] }, 'subjectId\n1\n'))
      .toEqual({ passed: false, comment: "missing fields: ['grade']" });
  });

  it('checks JSON keys, on every item when the file is a list', () => {
    expect(runFileCheck({ fileName: 'summary.json', format: 'json', requiredFields: ['grade'] }, '[{"grade":5},{"grade":3}]'))
      .toEqual({ passed: true, comment: 'has every required field' });
    expect(runFileCheck({ fileName: 'summary.json', format: 'json', requiredFields: ['grade'] }, '[{"grade":5},{"other":1}]'))
      .toEqual({ passed: false, comment: "missing fields: ['grade']" });
    expect(runFileCheck({ fileName: 'summary.json', format: 'json', requiredFields: ['grade'] }, 'not json'))
      .toMatchObject({ passed: false, comment: expect.stringContaining('did not parse as json') });
  });
});

describe('filePresetEvaluatorName', () => {
  it('slugifies the file name so it is a valid Evaluator name', () => {
    expect(filePresetEvaluatorName('Summary Report.CSV')).toBe('output-file-summary-report-csv-valid');
  });
});
