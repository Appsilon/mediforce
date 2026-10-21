/** The fixed name and rule of a step's extraction-ids Evaluator (epic #1516 F2). */
export const EXTRACTION_EVALUATOR_NAME = 'extraction-ids-valid';
export const EXTRACTION_EVALUATOR_RULE = 'Every id the output returns exists in the step\'s input; ids present in the input but missing from the output are noted, not failed.';

/** The name of a file-producing Evaluator for one Output File (one check per file, so a step can have several). */
export function filePresetEvaluatorName(fileName: string): string {
  return `output-file-${fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)}-valid`;
}

export function filePresetEvaluatorRule(fileName: string): string {
  return `The output file '${fileName}' exists, parses, and has its required fields.`;
}

/**
 * A `code` check: every id the output returns (`resultIdsPath`, walked
 * through `result`) exists among the ids the input offered (`inputIdsPath`,
 * walked through `stepInput[inputIdsPart]`). Where a path crosses an array it
 * reads the rest of the path from every element, flattening the results —
 * the same `collect` walk is embedded in the generated script so it runs the
 * identical way for every check. An invented id fails the check; an id the
 * input had but the output dropped is only noted in the comment, since
 * filtering can be legitimate (epic #1516 F2 decision B) — a person reviews
 * that before approving the source.
 */
export function extractionCheckSource(config: {
  resultIdsPath: readonly string[];
  inputIdsPart: 'triggerPayload' | 'previousStepOutputs';
  inputIdsPath: readonly string[];
}): string {
  return [
    'import json',
    '',
    `RESULT_IDS_PATH = ${JSON.stringify(config.resultIdsPath)}`,
    `INPUT_IDS_PART = ${JSON.stringify(config.inputIdsPart)}`,
    `INPUT_IDS_PATH = ${JSON.stringify(config.inputIdsPath)}`,
    '',
    'def collect(value, path):',
    '    if isinstance(value, list):',
    '        out = []',
    '        for item in value:',
    '            out.extend(collect(item, path))',
    '        return out',
    '    if not path:',
    '        return [value]',
    '    key, rest = path[0], path[1:]',
    '    if isinstance(value, dict) and key in value:',
    '        return collect(value[key], rest)',
    '    return []',
    '',
    "d = json.load(open('/output/input.json'))",
    "result_ids = set(collect(d['result'], RESULT_IDS_PATH))",
    "step_input = d['stepInput'] or {}",
    'input_ids = set(collect(step_input.get(INPUT_IDS_PART, {}), INPUT_IDS_PATH))',
    'invented = sorted(str(x) for x in result_ids - input_ids)',
    'missing = sorted(str(x) for x in input_ids - result_ids)',
    "comment = 'every returned id exists in the input' if not invented else f'invented ids not in the input: {invented}'",
    'if missing:',
    "    comment += f'; {len(missing)} input id(s) not returned: {missing[:20]}'",
    "json.dump({'passed': len(invented) == 0, 'comment': comment}, open('/output/result.json', 'w'))",
  ].join('\n');
}

/**
 * A `code` check: the step's Output File `fileName` exists under
 * `/workspace/.mediforce/output/<stepId>/`, parses as `format`, and has every
 * one of `requiredFields` (top-level keys for `json` — checked on every item
 * when the file is a JSON array; column headers for `csv`).
 */
export function filePresetCheckSource(config: {
  fileName: string;
  format: 'json' | 'csv';
  requiredFields: readonly string[];
}, stepId: string): string {
  const path = `/workspace/.mediforce/output/${stepId}/${config.fileName}`;
  return [
    'import json, csv, os',
    `PATH = ${JSON.stringify(path)}`,
    `FORMAT = ${JSON.stringify(config.format)}`,
    `REQUIRED_FIELDS = ${JSON.stringify(config.requiredFields)}`,
    '',
    'if not os.path.exists(PATH):',
    "    passed, comment = False, f'missing output file: {PATH}'",
    'else:',
    '    try:',
    "        if FORMAT == 'json':",
    '            with open(PATH) as f:',
    '                data = json.load(f)',
    '            items = data if isinstance(data, list) else [data]',
    '            missing = sorted({field for item in items for field in REQUIRED_FIELDS if not isinstance(item, dict) or field not in item})',
    '        else:',
    "            with open(PATH, newline='') as f:",
    '                header = next(csv.reader(f), [])',
    '            missing = [field for field in REQUIRED_FIELDS if field not in header]',
    "        passed, comment = len(missing) == 0, ('has every required field' if len(missing) == 0 else f'missing fields: {missing}')",
    '    except Exception as err:',
    "        passed, comment = False, f'{PATH} did not parse as {FORMAT}: {err}'",
    "json.dump({'passed': passed, 'comment': comment}, open('/output/result.json', 'w'))",
  ].join('\n');
}
