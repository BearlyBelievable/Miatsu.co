---
orphan: true
---

# Miatsu.co changelog

The Miatsu.co release history — what shipped in each release and the **upgrade
notes** for deploying it. This is the operator-facing log, the fork's analogue of
Zulip's [Version history](../overview/changelog.md); the client-facing **API
changelog** is `api_docs/miatsu-changelog.md` (served at `/api/miatsu-changelog`).

It complements:

- `api_docs/miatsu-changelog.md` — the client-facing API changelog (what changed
  in the API and observable behavior; for client and integration authors).
- [`release-lifecycle.md`](release-lifecycle.md) — the general deploy, rollback,
  and migration process (read once).

Each release records the upstream Zulip base it is built on (see
[What a release is](release-lifecycle.md#what-a-release-is)).

## Miatsu.co 0.1-dev

_Unreleased._ Based on the upstream Zulip 12.x maintenance branch (feature level 499).

### Highlights

- Establishes the fork's versioning, capability-flag, and changelog conventions.
