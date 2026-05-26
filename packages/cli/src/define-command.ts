/**
 * `defineCommand` — single helper for every CLI subcommand.
 *
 * Owns the boilerplate every subcommand used to duplicate:
 *
 *   1. parseArgs with strict + allowPositionals (any throw → exit 2 + HELP)
 *   2. --help / -h short-circuit (exit 0, HELP to stdout)
 *   3. Positional count check against the declared label list (exit 2 + HELP)
 *   4. resolveConfig + `new Mediforce({...})` (exit 2 on missing API key)
 *   5. try/catch around the user handler; uncaught error → formatCliError + exit 1
 *
 * The handler receives only the per-command logic surface: parsed flags,
 * positionals, json toggle, env, output, stdin, and the constructed client.
 *
 * Commands that need to skip the client (dry-run paths) pass
 * `skipClientWhen: (flags) => boolean`; their handler sees `config | null` and
 * `mediforce | null` and is expected to branch.
 */

import { parseArgs } from 'node:util';
import { Mediforce } from '@mediforce/platform-api/client';
import {
  resolveConfig,
  resolveBaseUrl,
  type ResolvedConfig,
} from './config.js';
import { printError, type OutputSink } from './output.js';
import { formatCliError } from './errors.js';

interface FlagSpec {
  type: 'string' | 'boolean';
  short?: string;
}

export type CommandOptions = Record<string, FlagSpec>;

type FlagValue<S extends FlagSpec> = S extends { type: 'string' }
  ? string | undefined
  : S extends { type: 'boolean' }
    ? boolean | undefined
    : never;

export type Flags<O extends CommandOptions> = { [K in keyof O]: FlagValue<O[K]> };

export interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
  stdin?: () => Promise<string>;
}

export type CommandFn = (input: CommandInput) => Promise<number>;

interface BaseContext<O extends CommandOptions> {
  flags: Flags<O>;
  positionals: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
  stdin?: () => Promise<string>;
  jsonMode: boolean;
}

export interface EagerContext<O extends CommandOptions> extends BaseContext<O> {
  config: ResolvedConfig;
  mediforce: Mediforce;
}

export interface MaybeClientContext<O extends CommandOptions>
  extends BaseContext<O> {
  config: ResolvedConfig | null;
  mediforce: Mediforce | null;
}

interface BaseDefinition<O extends CommandOptions> {
  /** "run get", "workflow register" — used in error prefixes only. */
  name: string;
  /** Help text printed on --help and on errors. */
  help: string;
  options: O;
  /**
   * Positional labels in order. Length is the exact required count.
   * Labels are echoed verbatim in error messages (e.g. `<id> is required`).
   */
  positionals?: readonly string[];
}

export interface EagerDefinition<O extends CommandOptions>
  extends BaseDefinition<O> {
  handler: (ctx: EagerContext<O>) => Promise<number>;
  skipClientWhen?: never;
}

export interface MaybeClientDefinition<O extends CommandOptions>
  extends BaseDefinition<O> {
  handler: (ctx: MaybeClientContext<O>) => Promise<number>;
  /** Return true to skip resolveConfig + Mediforce construction. */
  skipClientWhen: (flags: Flags<O>) => boolean;
}

export function defineCommand<O extends CommandOptions>(
  def: EagerDefinition<O>,
): CommandFn;
export function defineCommand<O extends CommandOptions>(
  def: MaybeClientDefinition<O>,
): CommandFn;
export function defineCommand<O extends CommandOptions>(
  def: EagerDefinition<O> | MaybeClientDefinition<O>,
): CommandFn {
  const labels = def.positionals ?? [];
  const expectedCount = labels.length;

  return async function command(input: CommandInput): Promise<number> {
    let flags: Flags<O>;
    let positionals: string[];
    try {
      const parsed = parseArgs({
        args: input.argv,
        options: def.options,
        strict: true,
        allowPositionals: true,
      });
      flags = parsed.values as unknown as Flags<O>;
      positionals = [...parsed.positionals];
    } catch (err) {
      input.output.stderr(`mediforce ${def.name}: ${String(err)}`);
      input.output.stderr('');
      input.output.stderr(def.help);
      return 2;
    }

    const flagRecord = flags as Record<string, string | boolean | undefined>;
    const jsonMode = flagRecord['json'] === true;

    if (flagRecord['help'] === true) {
      input.output.stdout(def.help);
      return 0;
    }

    if (positionals.length < expectedCount) {
      const missingLabel = labels[positionals.length] ?? '<arg>';
      printError(input.output, { error: `${missingLabel} is required` }, jsonMode);
      input.output.stderr('');
      input.output.stderr(def.help);
      return 2;
    }
    if (positionals.length > expectedCount) {
      const msg =
        expectedCount === 0
          ? `Expected no positionals, got ${String(positionals.length)}`
          : expectedCount === 1
            ? `Expected exactly one ${String(labels[0])}, got ${String(positionals.length)}`
            : `Expected exactly ${String(expectedCount)} positionals (${labels.join(', ')}), got ${String(positionals.length)}`;
      printError(input.output, { error: msg }, jsonMode);
      input.output.stderr('');
      input.output.stderr(def.help);
      return 2;
    }

    const flagBaseUrl =
      typeof flagRecord['base-url'] === 'string'
        ? (flagRecord['base-url'] as string)
        : undefined;

    const shouldSkipClient =
      'skipClientWhen' in def && typeof def.skipClientWhen === 'function'
        ? def.skipClientWhen(flags)
        : false;

    let config: ResolvedConfig | null = null;
    let mediforce: Mediforce | null = null;
    if (!shouldSkipClient) {
      try {
        config = resolveConfig({ flagBaseUrl, env: input.env });
      } catch (err) {
        printError(input.output, { error: String(err) }, jsonMode);
        return 2;
      }
      mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    }

    const baseUrlForErrors =
      config?.baseUrl ?? resolveBaseUrl({ flagBaseUrl, env: input.env });

    try {
      if (shouldSkipClient) {
        return await (def as MaybeClientDefinition<O>).handler({
          flags,
          positionals,
          env: input.env,
          output: input.output,
          stdin: input.stdin,
          jsonMode,
          config,
          mediforce,
        });
      }
      return await (def as EagerDefinition<O>).handler({
        flags,
        positionals,
        env: input.env,
        output: input.output,
        stdin: input.stdin,
        jsonMode,
        config: config as ResolvedConfig,
        mediforce: mediforce as Mediforce,
      });
    } catch (err) {
      printError(
        input.output,
        formatCliError(err, { baseUrl: baseUrlForErrors, jsonMode }),
        jsonMode,
      );
      return 1;
    }
  };
}
