# MiAtSu.Co fork conventions

This is MiAtSu.Co's fork of Zulip. We track upstream release tags and
rebase our own features on top of each new release, rather than merging.
Read this page before contributing, on top of [Contributing to
Zulip](contributing.md). It only covers what differs about working in this
fork. Zulip's own contribution standards (commit format, PR structure, code
style, review process) apply as-is.

## Why this page exists

Every `git rebase` onto a new Zulip release replays our commits on top of
upstream's latest code. That only stays low-friction if our additions are
structurally invisible to upstream. Reusing a field name, migration
number, or CSS class upstream also uses turns a mechanical rebase into a
debugging session, so everything below exists to make that kind of
collision impossible.

## Contributing a feature

1. Get the latest `main` and branch off it by running `git fetch origin &&
git checkout main && git checkout -b my-feature`.
2. Build the feature on that branch, following the upstream-file, naming,
   and migration conventions below. Keep it to one feature per branch so it
   can be reviewed and rebased on its own.
3. Add tests for it, in a feature-named module (see Passing CI), and run the
   backend and frontend suites plus `./tools/lint -m` locally.
4. Push the branch and open a PR against `main`. CI must be green. See
   Pull Requests and Passing CI for what reviewers look for.

The sections below cover those conventions in detail.

## Maintaining Upstream Files

We try to keep fork content out of files upstream might also edit. Where
practical, fork-specific docs and tests get their own dedicated files
instead of being added to a file upstream maintains.

- **User-facing docs.** Fork-specific settings are documented in
  `starlight_help/src/content/docs/miatsuco-custom-features.mdx`, linking
  to the relevant upstream page rather than editing it in place.
- **Contributor-facing docs.** Pages like this one live in
  `docs/contributing/`, alongside (not merged into) Zulip's own pages,
  linked from `docs/contributing/index.md`'s toctree.
- **API documentation.** A genuinely new endpoint is tagged
  `intentionally_undocumented` in `zproject/urls.py`, with its OpenAPI
  content drafted in
  [`miatsuco-upstream-api-drafts.md`](miatsuco-upstream-api-drafts.md)
  instead of `zerver/openapi/zulip.yaml`, until it's been through
  upstream's own [API change process](../processes/api-design.md) and
  `tools/merge-api-changelogs` assigns a real `API_FEATURE_LEVEL`. A new
  field on an already-documented endpoint is documented normally, using
  `**Changes**: New in Miatsuco X.Y-dev.` in place of a real feature
  level.
- **Tests.** Each fork feature gets its own module,
  `zerver/tests/test_miatsuco_<feature>.py`, since features are developed
  and PR'd independently and a shared test file would conflict across
  branches. Shared helpers live in `zerver/lib/test_miatsuco.py`'s
  `MiatsucoMarkdownTestMixin`, following upstream's own convention of
  keeping test base classes out of the test modules the backend runner
  discovers.

This isn't a hard rule with no exceptions. A bug fix to existing upstream
behavior inherently requires editing the file that behavior lives in, and
that's fine. The goal is eliminating unnecessary shared-file surface
area, not editing zero upstream files at any cost.

When fork code does land inline in an upstream file, mark it so a
reviewer or a future rebase doesn't mistake it for upstream code.

- Start with a marker line reading exactly `# MiAtSu.Co edit:` (or
  `// MiAtSu.Co edit:` in TypeScript), with the explanation on the same
  line or after it. It makes fork-added code obvious without needing to
  diff against the upstream merge-base.
- Either name the hook point the edit reaches into a fork-specific file or
  setting (`gated by miatsuco_web_show_upload_thumbnails`, `hooks out to
miatsuco_message_card_embed.ts`), or, when nothing fork-specific exists
  to point at, give one short clause on what the line does or how it
  behaves (`lazy-loads previews for bandwidth savings`). This isn't a
  justification for why the change was made at all.
- This doesn't apply to a second implementation being prepared for an
  actual upstream PR (see Upstreaming a Fork Feature below), which reads
  as an upstream comment would, with no fork reference at all.

## Documenting Fork Features

A fork feature's rationale and full behavior belong in one of the
fork-maintained doc files described above (user-facing behavior in
`miatsuco-custom-features.mdx`, contributor-facing design notes in
`docs/contributing/`), not in comments scattered across every call site
that touches it. Write it up there once. Code should point at the
feature, not re-explain it.

## Naming Schemes

New files unique to this fork are prefixed `miatsuco_` (e.g.,
`miatsuco_collapsed_media.ts`, `zerver/tests/test_miatsuco_dm_restrict.py`),
which makes `grep -r miatsuco` a reliable inventory of every fork-specific
file.

Identifiers inside those files don't need their own prefix, since the
filename already marks them as fork-owned. The same goes for fork CSS,
which lives entirely in `web/styles/miatsuco.css`, so individual class
names skip the `miatsuco-` prefix too.

Prefix the identifier itself, instead, when it's added onto a model,
setting, or framework dict upstream also owns and extends over time
(e.g., the `Realm` field `miatsuco_inline_upload_preview`, or a
`property_types` key). There, the identifier is the shared surface
upstream might collide with, not a file the fork controls outright.

**Don't** prefix classes, fields, or functions we merely read from or
extend, since those aren't ours to rename.

## Applying Migrations

Fork migrations live in `zerver/migrations/`, named
`zerver/migrations/miatsuco_NNNN_description.py` and never renamed once
written. A fork feature that needs a wholly new table can use its own
separate Django app instead, which never touches `zerver`'s migration
graph at all. We prefer that when it's an option.

For a field added to an existing upstream model, the migration's `zerver`
dependency has to be re-pointed at the actual current tip on every rebase
onto a new upstream tag. Django's migration graph is built purely from
what's on disk, with no concept of git history, so a `miatsuco_*`
migration left depending on a stale `zerver` migration produces a
"multiple heads" state once upstream ships migrations of its own that
don't know about it. Run `./manage.py check_miatsuco_migrations` as part
of the rebase checklist. It verifies this automatically and fails with
the specific fix needed.

Re-pointing a dependency is safe, and a no-op for Django's
applied-migration bookkeeping, since that keys off filename, not content.
Renaming the file is not safe. Django's bookkeeping still expects the old
filename as applied, so it would try to re-run the new name's operations
against a column that already exists.

## Signaling Fork Features

Zulip's own `zulip_feature_level` is owned and incremented by upstream, so
the fork can't reuse it to signal fork-specific features to a client
without risking a future collision. Instead, `zerver/lib/miatsuco.py`
defines `MIATSUCO_VERSION` (a fork-owned release number) and
`MIATSUCO_CAPABILITIES` (a list of named flags for features a client might
need to detect), both advertised in `POST /register` and
`GET /server_settings` as `miatsuco_version` and `miatsuco_capabilities`.

No fork client currently consumes capabilities, so `MIATSUCO_CAPABILITIES`
stays empty and features ship without a flag for now. Once a consuming
client exists, these rules apply.

- Add a capability flag in the same commit that makes the feature usable
  end to end, never before it actually works.
- Capability names are stable, lower-case `snake_case` strings, treated as
  public API once shipped. Don't rename or remove one without a
  deprecation path.
- A client checks for the specific capability it needs, not
  `miatsuco_version` alone, which would force it to maintain its own
  version-to-feature mapping.

## Passing CI

Most of what CI enforces is upstream Zulip's own tooling, already
documented well elsewhere. Read those pages and run the same commands,
particularly [Linters](../testing/linters.md) (`./tools/lint -m`,
`--fix`, `--verbose`), [Testing with Django](../testing/testing-with-django.md)
(the 100% line-coverage requirement, `test-backend --coverage`,
`# nocoverage`), and
[Continuous integration](../testing/continuous-integration.md).

One surprise is that a bare `./tools/lint` also runs `gitlint` against
your commit messages. CI skips it (`--skip=gitlint`, since it's flaky),
so it never fails your PR, but it can fail a local full lint run for what
looks like an unrelated reason. Follow [commit
discipline](commit-discipline.md) regardless, since it's good practice
either way.

Fork test files are discovered automatically. The backend runner collects
every `zerver/tests/test_*.py` and the frontend runner every
`web/tests/*.test.cjs`, so a feature's test module runs as part of the
normal suite with no registration step.

Two failure modes are specific to this fork and easy to trip, since
upstream's own files don't hit them.

- **A shared helper module with no tests of its own needs
  `# nocoverage`.** `zerver/lib/test_miatsuco.py` is a helper mixin,
  uncovered until a feature's tests actually exercise it. The exclusion
  requires `# nocoverage` as the exact first line of the file, dropped
  again once every helper is covered through a real caller.
- **`check_miatsuco_migrations` is fork-only, but wired into CI** via
  `tools/test-migrations`, so a `miatsuco_*` migration pointing at a
  stale `zerver` tip fails CI rather than slipping through.

A green `git apply` or `git rebase` only means the text merged, not that
lint, coverage, the docs build, or the tests still pass, so run the
checks above locally.

`./tools/setup-git-repo` installs a fork `pre-push` hook (frontend lint,
backend lint, node tests with coverage) that blocks the push if any fail.
The backend suite is opt-in with `RUN_BACKEND=1 git push`, since it needs
a provisioned database, and `git push --no-verify` overrides the hook
when you mean to. It can't verify rendering, media, or browser quirks, so
it reminds you to browser-test when a push touches those paths.

## Pull Requests

In addition to Zulip's own [review guide](review-process.md), follow this
checklist.

1. Confirm your branch applies cleanly against the current base release
   tag on its own.
2. If your change should be independent of other in-flight fork features,
   verify it applies correctly in either order relative to them, with an
   identical resulting tree. If it has a genuine, intentional dependency,
   confirm it fails clearly and immediately without that dependency
   present.
3. Run `./manage.py check_miatsuco_migrations` if you've touched a
   migration.
4. Run the actual test suite. A clean `git apply` or `git rebase` only
   means the text merged, not that the feature still behaves correctly.

## Releases

`MIATSUCO_VERSION` (in `zerver/lib/miatsuco.py`) is this fork's own
release number, independent of `ZULIP_VERSION`. A release is a known-good
snapshot, a tag where `main` sat at a specific upstream base plus a
specific feature set, with CI green and the result actually deployed and
verified, not merely merged.

Cut a release when a meaningful change has landed and been confirmed
working, not on every merge to `main`. Bundling several features into one
release is fine. Doc-only changes and small commits between deployments
don't need a version bump.

`MAJOR.MINOR.PATCH` carries fork-specific meaning.

- **Major.** A stable-substrate milestone or a break to a promised
  `MIATSUCO_CAPABILITIES` flag.
- **Minor.** A new fork feature shipped and deployed, or a new capability
  flag. The common bump.
- **Patch.** Bug fixes to existing features, with no new feature or
  capability.

Between releases, `main` carries a `-dev` suffix (e.g., `0.2-dev`), bumped
right after cutting a release.

The version is for humans, not load-bearing for feature detection.
Clients detect features through `MIATSUCO_CAPABILITIES` instead (see
Signaling Fork Features above), so the release cadence can follow
whatever's meaningful to maintainers.

## Upstreaming a Fork Feature

Some fork features are improvements Zulip itself should have. These
follow a separate process when ready to send upstream.

1. Once a feature is proven stable and worth sending upstream, build a
   second, independent implementation targeting current upstream `main`
   directly. It branches from a real upstream commit (since our `main`
   always carries fork-only commits), uses no `miatsuco_` prefix, follows
   upstream conventions throughout, and stays rebased against upstream's
   tip while the PR is open. Our fork keeps running its own version
   regardless of that PR's status.
2. Once accepted, reconciliation happens only during the periodic rebase
   onto a new upstream stable release, when we drop the custom
   implementation and adopt the version that arrives with it.

## Questions

If something here is unclear, or you've hit a case this page doesn't
cover, then that's a documentation bug. Please raise it rather than
guessing, as this page is expected to evolve. If a convention here turns
out to be wrong, we want to fix the convention and this page together, in
the same commit.
