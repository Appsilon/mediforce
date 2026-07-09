/**
 * Citty bridge — adapts citty's `defineCommand` to our test contract
 * `({ argv, env, output }) => Promise<number>` while keeping shared
 * `resolveConfig` + `Mediforce` client + `OutputSink` plumbing in one place.
 *
 * What this wrapper takes over from citty:
 *   - `--help` short-circuit (citty's `runCommand` doesn't render usage).
 *   - Exit-code mapping (parse error → 2, ApiError → 1, success → 0).
 *   - Stdout/stderr split via `OutputSink` (citty doesn't print anything; we
 *     route `renderUsage` output ourselves).
 *   - `--json` translation into `printJson` / `printError` envelope.
 *   - Eager `resolveConfig` + `Mediforce` client injection into the run ctx.
 *
 * Citty's native error phrasing (`Missing required positional argument:
 * WIDGETID`, `USAGE mediforce widget poke [OPTIONS] <WIDGETID>`) is passed
 * through unchanged — no translation layer.
 */

import {
  defineCommand as cittyDefineCommand,
  parseArgs,
  renderUsage,
  type ArgsDef,
  type CommandDef,
  type ParsedArgs,
} from 'citty';
import { Mediforce } from '@mediforce/platform-api/client';
import { resolveConfig, type ResolvedConfig } from './config';
import { printError, type OutputSink } from './output';
import { formatCliError } from './errors';

export interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
  stdin?: NodeJS.ReadableStream | (() => Promise<string>);
}

interface RunContextBase<TArgs extends ArgsDef> {
  args: ParsedArgs<TArgs>;
  output: OutputSink;
  env: Record<string, string | undefined>;
  stdin?: NodeJS.ReadableStream | (() => Promise<string>);
  jsonMode: boolean;
}

/** Run context for commands that always resolve a Mediforce client. */
export interface RunContext<TArgs extends ArgsDef> extends RunContextBase<TArgs> {
  config: ResolvedConfig;
  mediforce: Mediforce;
}

/** Run context for commands that opt out of client resolution on some paths. */
export interface MaybeClientRunContext<TArgs extends ArgsDef> extends RunContextBase<TArgs> {
  config?: ResolvedConfig;
  mediforce?: Mediforce;
}

interface DefineCommandBaseOptions<TArgs extends ArgsDef> {
  /** e.g. "mediforce run get" — appears in the USAGE line. */
  name: string;
  description: string;
  args: TArgs;
}

export interface DefineCommandOptions<TArgs extends ArgsDef>
  extends DefineCommandBaseOptions<TArgs> {
  run: (ctx: RunContext<TArgs>) => Promise<number | void>;
}

export interface DefineMaybeClientCommandOptions<TArgs extends ArgsDef>
  extends DefineCommandBaseOptions<TArgs> {
  /** Skip resolveConfig + Mediforce client for dry-run paths. */
  skipClientWhen: (args: ParsedArgs<TArgs>) => boolean;
  run: (ctx: MaybeClientRunContext<TArgs>) => Promise<number | void>;
}

/** The shape returned by `defineCommand` — used by `cli.ts` for the leaf map. */
export type CommandFn = (input: CommandInput) => Promise<number>;

/** Always-on flags layered onto every wrapped command. */
const COMMON_ARGS = {
  'base-url': { type: 'string', description: 'API base URL (default: http://localhost:9003)' },
  json: { type: 'boolean', description: 'Emit JSON instead of human-readable output' },
  help: { type: 'boolean', alias: 'h', description: 'Show this help text' },
} as const;

type WithCommonArgs<T extends ArgsDef> = T & typeof COMMON_ARGS;

export function defineCommand<TArgs extends ArgsDef>(
  options: DefineMaybeClientCommandOptions<TArgs>,
): CommandFn;
export function defineCommand<TArgs extends ArgsDef>(
  options: DefineCommandOptions<TArgs>,
): CommandFn;
export function defineCommand<TArgs extends ArgsDef>(
  options: DefineCommandOptions<TArgs> | DefineMaybeClientCommandOptions<TArgs>,
): CommandFn {
  const mergedArgs = { ...options.args, ...COMMON_ARGS } as WithCommonArgs<TArgs>;
  const positionalCount = Object.values(options.args).filter(
    (def) => def !== null && typeof def === 'object' && 'type' in def && def.type === 'positional',
  ).length;
  const skipClientWhen =
    'skipClientWhen' in options ? options.skipClientWhen : undefined;

  const cmd: CommandDef<WithCommonArgs<TArgs>> = cittyDefineCommand({
    meta: { name: options.name, description: options.description },
    args: mergedArgs,
  });

  // Single cast point: citty's `renderUsage` is generic in `ArgsDef`, but the
  // wrapper holds a `CommandDef<WithCommonArgs<TArgs>>` which TS won't widen
  // without help.
  const renderUsageFor = (): Promise<string> => renderUsage(cmd as CommandDef);

  return async function runMediforceCommand(input: CommandInput): Promise<number> {
    if (input.argv.includes('--help') || input.argv.includes('-h')) {
      input.output.stdout(await renderUsageFor());
      return 0;
    }

    let parsedArgs: ParsedArgs<WithCommonArgs<TArgs>>;
    try {
      parsedArgs = parseArgs<WithCommonArgs<TArgs>>(input.argv, mergedArgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const jsonMode = input.argv.includes('--json');
      printError(input.output, { error: msg }, jsonMode);
      input.output.stderr('');
      input.output.stderr(await renderUsageFor());
      return 2;
    }

    const jsonMode = parsedArgs['json'] === true;

    const extras = parsedArgs._.slice(positionalCount);
    if (extras.length > 0) {
      printError(
        input.output,
        { error: `Unexpected positional arguments: ${extras.join(' ')}` },
        jsonMode,
      );
      input.output.stderr('');
      input.output.stderr(await renderUsageFor());
      return 2;
    }

    // Strips the WithCommonArgs extension after we've consumed json/help/base-url ourselves.
    const userArgs = parsedArgs as unknown as ParsedArgs<TArgs>;
    const skipClient = skipClientWhen?.(userArgs) === true;
    let config: ResolvedConfig | undefined;
    let mediforce: Mediforce | undefined;
    if (!skipClient) {
      try {
        config = resolveConfig({
          flagBaseUrl:
            typeof parsedArgs['base-url'] === 'string' ? parsedArgs['base-url'] : undefined,
          env: input.env,
        });
      } catch (err) {
        printError(input.output, { error: String(err) }, jsonMode);
        return 2;
      }
      mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    }

    try {
      const ctx: MaybeClientRunContext<TArgs> = {
        args: userArgs,
        output: input.output,
        env: input.env,
        stdin: input.stdin,
        jsonMode,
        config,
        mediforce,
      };
      // Both overloads accept this shape; the non-skip overload's `RunContext`
      // is just the same record with non-optional `config` + `mediforce`,
      // which we've populated above when `skipClient` is false.
      const result = await (options.run as (ctx: MaybeClientRunContext<TArgs>) => Promise<number | void>)(ctx);
      return typeof result === 'number' ? result : 0;
    } catch (err) {
      printError(
        input.output,
        formatCliError(err, { baseUrl: config?.baseUrl, jsonMode }),
        jsonMode,
      );
      return 1;
    }
  };
}

/**
 * Typed citty `enum` arg helper. Narrows citty's `EnumArgDef.options: string[]`
 * to a literal union via `<const T>` so `args.foo` is the union, not `string`.
 *
 * Usage: `status: enumArg(['created', 'running', 'failed'] as const, { description: '...' })`
 */
export function enumArg<const TValues extends readonly string[]>(
  options: TValues,
  extras?: { description?: string; required?: boolean },
): {
  type: 'enum';
  options: TValues[number][];
  description?: string;
  required?: boolean;
} {
  return {
    type: 'enum',
    options: [...options] as TValues[number][],
    ...extras,
  };
}

export { renderUsage };
export type { ArgsDef, ParsedArgs };
