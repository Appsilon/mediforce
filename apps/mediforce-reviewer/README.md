# mediforce-reviewer

Picks an open PR on `Appsilon/mediforce` that is not a draft and has no human
comments yet, runs the `code-review` skill against the diff, and posts the
review as a single comment.

The package carries its Skill in [`skills/code-review`](skills/code-review):
importing the workflow creates it in the importing workspace. It is the same
skill this repository's coding agents use; the repo-root `skills/code-review`
is a symlink to it, so there is one copy.

## Steps

`find-pr` (agent) → `review` (agent) → `post-comment` (agent) → `done`, with
`no-pr` as a terminal when nothing qualifies.

## The selection rule

"Not a draft, no human comments yet" is what keeps the bot from talking over
people. A PR someone is already reviewing does not need an automated opinion
layered on top, and a draft is not asking for one. `no-pr` being a first-class
terminal means an empty run is a normal outcome, not a failure to investigate.

One comment per PR, posted once — re-running does not accumulate review noise on
the same diff.
