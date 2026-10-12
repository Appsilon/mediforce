---
status: living
audience: engineers
last_reviewed: 2026-10-12
---

# Releasing

A release is one workflow run and one merge. Production runs exactly one
released version, and the `vX.Y.Z` tag is the record of which one.

## Cut a release

1. **Actions → Release → Run workflow.** Leave the bump on `auto` unless you
   know better. It opens a PR from `release/vX.Y.Z` that bumps the root
   `package.json` and adds a `## [X.Y.Z]` section to `CHANGELOG.md`, drafted
   from the PRs merged since the last release
   ([`add-changelog-entry`](../../skills/add-changelog-entry/SKILL.md) rules).
2. **Edit the section in that PR.** Read it as someone who uses Mediforce: what
   changed and why it matters to them, in as few words as possible. If the
   draft failed, the section holds a `release-draft` comment listing the PRs.
   Write the notes and delete the comment.
3. **Merge.** [`release.yml`](../../.github/workflows/release.yml) then:
   - tags the merge commit `vX.Y.Z` and publishes the section as the GitHub
     release, word for word (it refuses while the section is empty or still a
     draft);
   - builds the `:X.Y.Z` images
     ([`build-images.yml`](../../.github/workflows/build-images.yml));
   - deploys them to production
     ([`deploy-production.yml`](../../.github/workflows/deploy-production.yml)),
     which records the deploy in the repo's **production** environment;
   - rebuilds the News page.

Wrong version? Close the PR, delete its branch and run the workflow again with
the bump you want.

## Which number

`auto` reads the conventional-commit prefix of every PR title since the last
release:

| Bump | When | Means for users |
|---|---|---|
| major | any `type!:` title | They must act: a migration, a removed feature, a config change |
| minor | any `feat` | They can do something new |
| patch | everything else | Fixes only |

Release often. Small releases are what make the numbers mean something.

## Roll back

**Actions → Deploy to Production → Run workflow** with an earlier version, e.g.
`1.3.1`. Any released version can be deployed this way. A version released
before versioned images existed is built on the server from its tag, which takes
a few minutes longer.

## Hotfix

Fix it on `main` and cut a patch release. Only when `main` holds something that
can't ship yet, do by hand what the merge would have done:

1. Branch from the last tag, cherry-pick the fix, and commit the `package.json`
   bump and changelog section.
2. Tag the commit and publish it: `gh release create vX.Y.Z --target <sha> --notes-file <section>`.
3. **Build & Push Docker Images** from that tag, with the version.
4. **Deploy to Production** with the version.
5. Merge the changelog section back to `main` in a PR.

## Rules

- **Tags are immutable.** Never move or delete a published `vX.Y.Z` tag. A
  mistake is fixed by the next patch release.
- **Feature PRs don't touch `CHANGELOG.md`** (AGENTS.md §10). The release PR is
  the only place a version's section is written.
- **Staging runs `main`.** Every push to `main` builds `:latest` and deploys it
  to staging. Production never runs `:latest`: `scripts/deploy.sh` pins
  `MEDIFORCE_VERSION` in the server's `.env`, and `docker-compose.prod.yml` uses
  it for every Mediforce image.
