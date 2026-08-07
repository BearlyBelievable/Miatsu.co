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

```yaml
/realm/email_visibility_policy:
  get:
    operationId: get-email-visibility-policy-status
    summary: Get the email visibility policy's status
    tags: ["server_and_organizations"]
    description: |
      Get the organization's current `email_address_visibility` max/min
      range, and whether a bulk remediation job is still applying a
      previous change to that range. Specific to the MiAtSu.Co fork.

      A client that missed the live-push event for a job's completion
      or failure can use this endpoint on page load to learn the
      outcome instead.
    responses:
      "200":
        description: Success.
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/JsonSuccessBase"
                - additionalProperties: false
                  properties:
                    result: {}
                    msg: {}
                    ignored_parameters_unsupported: {}
                    max:
                      type: integer
                      description: |
                        The most open `email_address_visibility` value
                        organization members are permitted to choose.
                    min:
                      type: integer
                      description: |
                        The most restrictive `email_address_visibility`
                        value organization members are permitted to
                        choose.
                    running:
                      type: boolean
                      description: |
                        Whether a bulk remediation job for this policy is
                        still in progress.
                    total_violating_count:
                      type: integer
                      description: |
                        Present if `running` is `true`, or if the most
                        recent job failed. The number of users the
                        in-progress or most recently failed job covers.
                    failed:
                      type: boolean
                      description: |
                        Present if the most recent remediation job for
                        this policy failed, and no job is currently
                        running.
                    processed_count:
                      type: integer
                      description: |
                        Present under the same condition as `failed`. The
                        number of users the failed job had already
                        processed before failing.
                  example:
                    {
                      "result": "success",
                      "msg": "",
                      "max": 1,
                      "min": 4,
                      "running": false,
                    }
  patch:
    operationId: update-email-visibility-policy
    summary: Update the email visibility policy
    tags: ["server_and_organizations"]
    x-requires-owner: true
    description: |
      Change the organization's `email_address_visibility` max/min
      range. Specific to the MiAtSu.Co fork.

      Rejects a `email_address_visibility_max` more open than
      `email_address_visibility_min`. Blocks a new change while a
      previous one is still being applied to existing users; see
      [`GET /realm/email_visibility_policy`](/api/get-email-visibility-policy-status).
    requestBody:
      required: false
      content:
        application/x-www-form-urlencoded:
          schema:
            type: object
            properties:
              email_address_visibility_max:
                type: integer
                description: |
                  The new most-open `email_address_visibility` value
                  organization members will be permitted to choose. Must
                  be one of the values accepted by
                  [`PATCH /settings`](/api/update-settings)'s own
                  `email_address_visibility` parameter.
                example: 1
              email_address_visibility_min:
                type: integer
                description: |
                  The new most-restrictive `email_address_visibility`
                  value organization members will be permitted to
                  choose. Must be one of the values accepted by
                  [`PATCH /settings`](/api/update-settings)'s own
                  `email_address_visibility` parameter.
                example: 4
          examples:
            email_address_visibility_max:
              value:
                email_address_visibility_max: 1
    responses:
      "200":
        $ref: "#/components/responses/SimpleSuccess"
/realm/email_visibility_policy/preview:
  get:
    operationId: preview-email-visibility-policy-impact
    summary: Preview the email visibility policy's impact
    tags: ["server_and_organizations"]
    description: |
      Given a prospective `email_address_visibility` max/min range,
      return how many existing users would be affected by it, without
      applying the change. Specific to the MiAtSu.Co fork.
    parameters:
      - name: visibility_max
        in: query
        schema:
          type: integer
        example: 1
        description: |
          The prospective most-open `email_address_visibility` value
          to preview.
      - name: visibility_min
        in: query
        schema:
          type: integer
        example: 4
        description: |
          The prospective most-restrictive `email_address_visibility`
          value to preview.
    responses:
      "200":
        description: Success.
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/JsonSuccessBase"
                - additionalProperties: false
                  properties:
                    result: {}
                    msg: {}
                    ignored_parameters_unsupported: {}
                    above_max_visibility_count:
                      type: integer
                      description: |
                        The number of existing users whose current
                        `email_address_visibility` is more open than the
                        prospective `visibility_max`.
                    below_min_visibility_count:
                      type: integer
                      description: |
                        The number of existing users whose current
                        `email_address_visibility` is more restrictive
                        than the prospective `visibility_min`.
                  example:
                    {
                      "result": "success",
                      "msg": "",
                      "above_max_visibility_count": 5,
                      "below_min_visibility_count": 3,
                    }
/realm/email_visibility_policy/distribution:
  get:
    operationId: get-email-visibility-distribution
    summary: Get the email visibility distribution
    tags: ["server_and_organizations"]
    description: |
      Get a count of existing users at each possible
      `email_address_visibility` value. Specific to the MiAtSu.Co fork.

      Fetched once when the settings page loads; the impact of any
      prospective range change is then computed client-side from this
      distribution, without a further request.
    responses:
      "200":
        description: Success.
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/JsonSuccessBase"
                - additionalProperties: false
                  properties:
                    result: {}
                    msg: {}
                    ignored_parameters_unsupported: {}
                    counts:
                      type: object
                      description: |
                        An object mapping each possible
                        `email_address_visibility` value, as a string,
                        to the count of existing users currently set to
                        it.
                      additionalProperties:
                        type: integer
                        description: |
                          The count of existing users currently set to
                          this `email_address_visibility` value.
                  example:
                    {
                      "result": "success",
                      "msg": "",
                      "counts": {"1": 8, "2": 3, "3": 1, "4": 0, "5": 0},
                    }
```

Restore alongside `api_docs/include/rest-endpoints.md`'s sidebar entries and
`zerver/openapi/curl_param_value_generators.py`'s owner-auth example
generator for the `PATCH` endpoint.
