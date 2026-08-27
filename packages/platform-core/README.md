# @mediforce/platform-core

The vocabulary every other package speaks. Zod schemas, repository and service
interfaces, and in-memory test doubles — no implementations, no I/O.

This package sits at the bottom of the dependency graph and has **zero
`@mediforce/*` dependencies**. Everything else depends on it, which is what
makes it the place a shared type belongs and a bad place for anything else.

## What lives here

| Directory | Holds |
|---|---|
| `src/schemas/` | Domain schemas — `WorkflowDefinition`, `ProcessInstance`, `StepExecution`, `HumanTask`, `AgentRun`, triggers, actions, MCP bindings |
| `src/interfaces/` | Repository and service contracts the infra layer implements |
| `src/repositories/` | Repository-side shared types |
| `src/parser/` | YAML process-definition parsing |
| `src/mcp/` | MCP server resolution and tool-catalog validation |
| `src/validation/` | Cross-field workflow validation, graph and reference checks |
| `src/collaboration/` | Handoff registry |
| `src/testing/` | In-memory repositories and `build*` factories |

Three entry points: `.` for the domain surface, `./testing` for the doubles and
factories, `./workflow-examples` for the bundled tutorial definitions.

## Rules

**Nothing in here reaches the network or a database.** A schema, an interface,
and a pure function are the only shapes that belong. The moment this package
imports a driver, every consumer inherits it — including the CLI and the tests
that exist specifically to avoid one.

**`WorkflowDefinition` is the schema authority.** It is a discriminated union
over step variants (agent, review, cowork, script, action, terminal). Adding a
step kind means changing it here first; there is no second definition to keep
in sync.

**Schemas are the type source.** Infer with `z.infer`, never hand-write a
parallel `interface`, and never widen to `any` to make a consumer compile.

## Testing

`@mediforce/platform-core/testing` exports in-memory repositories and entity
factories so a test can build a realistic `ProcessInstance` or `HumanTask`
without a database. Prefer these over ad-hoc object literals — they track schema
changes, hand-written fixtures do not.
