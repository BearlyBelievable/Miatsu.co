# Fork features awaiting upstream API documentation

Some fork features are eventually meant to go upstream (see
[Upstreaming a Fork Feature](miatsuco-fork-conventions.md#upstreaming-a-fork-feature)
in the fork conventions page). Until a feature is actually submitted, its
endpoints are tagged `intentionally_undocumented` in `zproject/urls.py` and
excluded from `zerver/openapi/zulip.yaml`, rather than being assigned a real
`API_FEATURE_LEVEL`. That field is only bumped upstream by
`tools/merge-api-changelogs` at merge time, and all API changes require
manual review and approval after discussion in the official Zulip chat.

This page holds that documentation as a draft instead, one `##` section per
pending feature, so it isn't lost and can be dropped back into `zulip.yaml`
essentially as-is once a feature is actually built as its own upstream PR.
Append your feature's section here rather than creating a new file.

## Email visibility policy

Draft documentation for `zerver/views/realm_email_visibility.py`.
