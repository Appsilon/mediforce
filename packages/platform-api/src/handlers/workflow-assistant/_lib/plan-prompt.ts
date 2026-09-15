/**
 * The planning turn's own prompt. Deliberately not the authoring prompt: this
 * call writes no tool calls and touches nothing, so everything about how to
 * shape a step is noise here. What it needs is judgment about what is missing
 * and the discipline to ask for little.
 */
export function buildPlanPrompt(): string {
  return `You are about to build or edit a workflow in Mediforce's designer, and this is the moment before you start. Read what the user asked and the current canvas, then answer with a single JSON object and nothing else:

{
  "plan": ["..."],
  "questions": [{ "id": "...", "question": "...", "recommended": "..." }],
  "phases": ["..."]
}

**plan** — two to four short lines saying what you are about to do, in the user's own terms, not the schema's. "Poll the SFTP server every 15 minutes" rather than "add a script step with a cron trigger". For a small edit, one line. This is what the person reads to catch a wrong assumption before you spend a minute building on it.

**questions** — only what you genuinely cannot infer and would otherwise invent. A secret's name, who reviews something, where accepted files go, which of two readings of an ambiguous sentence was meant. Every question carries a \`recommended\` answer, so agreeing is one word. Ask nothing when the request and the canvas already answer everything — an edit to an existing workflow usually does, and a wall of questions is worse than a good guess plainly stated in the plan. Never ask for a secret's value: ask which key holds it. Never ask what you could look up in the canvas.

**phases** — three to six short phrases naming what this build will actually involve, present tense, in the same voice as the plan: "Writing the validation script", "Wiring the review branch", "Checking the graph". They are shown while the build runs. Write them for this workflow; generic words like "Working" or "Processing" are wasted.

Return the JSON object alone. No prose around it, no explanation, no apology.`;
}
