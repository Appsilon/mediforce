import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { isLocalExecutionAllowed } from './base-container-agent-plugin';
import { getDockerSpawnStrategy } from './docker-spawn-strategy';
import { localSandboxEnv, sandboxedDockerArgs, stderrDetail, uniqueContainerName } from './sandbox-container';

const execFileAsync = promisify(execFile);

/** Python with the `gepa` package; built by `scripts/rebuild-docker-images.sh`. */
export const GEPA_JOB_IMAGE = 'mediforce-gepa:latest';

/**
 * The job: GEPA's reflective proposal step (`InstructionProposalSignature`)
 * once per candidate, each over its own minibatch of the records, as GEPA
 * samples them. The reflection model is reached through OpenRouter's chat
 * completions API. `result.json` is rewritten after every call, so a job that
 * dies part-way still says what it spent.
 */
export const GEPA_JOB_SCRIPT = String.raw`import json
import os
import sys
import urllib.error
import urllib.request

try:
    from gepa.strategies.instruction_proposal import InstructionProposalSignature
except ImportError:
    sys.stderr.write('the gepa package is not installed: pip install gepa\n')
    sys.exit(2)


def main(output_dir):
    with open(os.path.join(output_dir, 'input.json'), encoding='utf-8') as handle:
        job = json.load(handle)
    base_url = os.environ.get('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1').rstrip('/')
    api_key = os.environ['OPENROUTER_API_KEY']
    result = {'candidates': [], 'usage': [], 'error': None}
    result_path = os.path.join(output_dir, 'result.json')

    def save():
        with open(result_path, 'w', encoding='utf-8') as handle:
            json.dump(result, handle)

    def reflection_lm(prompt):
        messages = prompt if isinstance(prompt, list) else [{'role': 'user', 'content': prompt}]
        body = json.dumps({
            'model': job['reflectionModel'],
            'messages': messages,
            'temperature': 1.0,
            'max_tokens': job['maxOutputTokens'],
        }).encode('utf-8')
        request = urllib.request.Request(
            base_url + '/chat/completions',
            data=body,
            headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                reply = json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', 'replace')[:500]
            raise RuntimeError('the reflection model answered HTTP %d: %s' % (error.code, detail))
        usage = reply.get('usage') or {}
        result['usage'].append({
            'promptTokens': int(usage.get('prompt_tokens') or 0),
            'completionTokens': int(usage.get('completion_tokens') or 0),
        })
        save()
        return reply['choices'][0]['message'].get('content') or ''

    records = job['records']
    size = min(job['minibatchSize'], len(records))
    try:
        for index in range(job['candidates']):
            batch = [records[(index * size + offset) % len(records)] for offset in range(size)]
            proposal = InstructionProposalSignature.run(reflection_lm, {
                'current_instruction_doc': job['currentPrompt'],
                'dataset_with_feedback': batch,
                'prompt_template': None,
            })
            result['candidates'].append({'prompt': proposal['new_instruction'], 'reflectedOn': len(batch)})
            save()
    except Exception as error:
        result['error'] = str(error)
        save()
        sys.exit(1)
    save()


main(sys.argv[1])
`;

/** Records per reflection call, as GEPA samples its minibatches. */
export const GEPA_REFLECTION_MINIBATCH_SIZE = 3;

/** One example GEPA reflects on: what the step was given, what it produced, and the feedback on it. */
export type GepaReflectiveRecord = Record<string, unknown>;

export interface GepaJobInput {
  readonly reflectionModel: string;
  /** The instruction the candidates rewrite. */
  readonly currentPrompt: string;
  readonly candidates: number;
  readonly maxOutputTokens: number;
  readonly minibatchSize: number;
  readonly records: readonly GepaReflectiveRecord[];
}

export interface GepaJobRequest {
  readonly input: GepaJobInput;
  /** The workspace's OpenRouter key; the job's reflection calls are billed to it. */
  readonly apiKey: string;
  readonly timeoutMs: number;
  /** Names the container, for `docker ps` and logs. */
  readonly label: string;
}

const GepaJobResultSchema = z.object({
  candidates: z.array(z.object({ prompt: z.string(), reflectedOn: z.number().int().nonnegative() })),
  usage: z.array(z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative() })),
  error: z.string().nullable(),
});

export type GepaJobOutcome = z.infer<typeof GepaJobResultSchema>;

/**
 * Runs the GEPA job (ADR-0023 D15) in its own container — network on, for
 * the reflection model, and nothing mounted but its `/output` — or as a local
 * `python3` process under `ALLOW_LOCAL_AGENTS`. A job that fails after it
 * started still returns what it proposed and spent, with `error` set; one that
 * leaves no readable result throws.
 */
export async function runGepaJob(request: GepaJobRequest): Promise<GepaJobOutcome> {
  const outputDir = await realpath(await mkdtemp(join(tmpdir(), 'mediforce-gepa-job-')));
  try {
    await writeFile(join(outputDir, 'input.json'), JSON.stringify(request.input), 'utf-8');
    await writeFile(join(outputDir, 'gepa_job.py'), GEPA_JOB_SCRIPT, 'utf-8');
    const env: Record<string, string> = {
      OPENROUTER_API_KEY: request.apiKey,
      ...(process.env.OPENROUTER_BASE_URL === undefined ? {} : { OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL }),
    };
    const failure = isLocalExecutionAllowed()
      ? await runLocally(request, outputDir, env)
      : await runInContainer(request, outputDir, env);

    let raw: string;
    try {
      raw = await readFile(join(outputDir, 'result.json'), 'utf-8');
    } catch {
      throw new Error(failure ?? 'the GEPA job wrote no result');
    }
    const outcome = GepaJobResultSchema.parse(JSON.parse(raw));
    return outcome.error === null && failure !== null ? { ...outcome, error: failure } : outcome;
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Dev only (ALLOW_LOCAL_AGENTS): the host's `python3`, which must have `gepa`. Returns why it failed, or null. */
async function runLocally(request: GepaJobRequest, outputDir: string, env: Record<string, string>): Promise<string | null> {
  try {
    await execFileAsync('python3', [join(outputDir, 'gepa_job.py'), outputDir], {
      cwd: outputDir,
      timeout: request.timeoutMs,
      env: {
        ...localSandboxEnv(),
        ...(process.env.PYTHONPATH === undefined ? {} : { PYTHONPATH: process.env.PYTHONPATH }),
        ...env,
      },
    });
    return null;
  } catch (err) {
    return `GEPA job failed${stderrDetail((err as { stderr?: unknown }).stderr)}`;
  }
}

async function runInContainer(request: GepaJobRequest, outputDir: string, env: Record<string, string>): Promise<string | null> {
  const containerName = uniqueContainerName('mediforce-gepa', request.label);
  const result = await getDockerSpawnStrategy().spawn({
    dockerArgs: [
      'run', '--rm',
      '--name', containerName,
      ...sandboxedDockerArgs({ memory: '1g' }),
      '-v', `${outputDir}:/output`,
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      GEPA_JOB_IMAGE,
      'python3', '/output/gepa_job.py', '/output',
    ],
    stdinPayload: null,
    timeoutMs: request.timeoutMs,
    containerName,
    processInstanceId: request.label,
    stepId: 'gepa-job',
    outputDir,
    logFile: null,
  });
  if (result.exitCode === 0) return null;
  return `GEPA job exited with code ${String(result.exitCode)}${stderrDetail(result.stderr)}`;
}
