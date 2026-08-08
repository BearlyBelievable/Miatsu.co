import logging
from typing import Annotated, Any

from django.db.models import Count
from django.http import HttpRequest, HttpResponse
from django.utils.timezone import now as timezone_now
from django.utils.translation import gettext as _
from pydantic import Json

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.actions.realm_settings import (
    do_change_email_visibility_policy_bound,
    do_set_realm_user_default_setting,
)
from zerver.decorator import require_realm_owner
from zerver.lib.exceptions import JsonableError
from zerver.lib.queue import queue_event_on_commit
from zerver.lib.response import json_success
from zerver.lib.typed_endpoint import typed_endpoint, typed_endpoint_without_parameters
from zerver.lib.typed_endpoint_validators import check_int_in_validator
from zerver.lib.users import email_address_visibility_violations
from zerver.models import Realm, RealmUserDefault, UserProfile
from zerver.models.users import active_user_ids
from zerver.tornado.django_api import send_event_on_commit

logger = logging.getLogger(__name__)

FIELD_NAME = "email_address_visibility"

# Kept in their own file rather than growing zerver/views/realm.py,
# since this feature's endpoints, locking, and job-creation logic
# form one coherent unit.


def _job_currently_running(realm: Realm) -> bool:
    running_jobs = BulkFieldRemediationJob.objects.filter(
        realm=realm, field_name=FIELD_NAME, status=BulkFieldRemediationJob.STATUS_RUNNING
    )
    still_running = False
    for job in running_jobs:
        if job.is_stale():
            job.status = BulkFieldRemediationJob.STATUS_FAILED
            job.finished_at = timezone_now()
            job.save()
            logger.warning(
                "Marking stale %s remediation job %s (realm %s) as failed",
                job.field_name,
                job.id,
                job.realm_id,
            )
        else:
            still_running = True
    return still_running


def _violating_counts(
    realm: Realm, visibility_max: int | None, visibility_min: int | None
) -> dict[str, int]:
    above_max_visibility_values, below_min_visibility_values = email_address_visibility_violations(
        visibility_max, visibility_min
    )

    if above_max_visibility_values:
        above_max_visibility_count = UserProfile.objects.filter(
            realm=realm, email_address_visibility__in=above_max_visibility_values, is_bot=False
        ).count()
    else:
        above_max_visibility_count = 0

    if below_min_visibility_values:
        below_min_visibility_count = UserProfile.objects.filter(
            realm=realm, email_address_visibility__in=below_min_visibility_values, is_bot=False
        ).count()
    else:
        below_min_visibility_count = 0

    return {
        "above_max_visibility_count": above_max_visibility_count,
        "below_min_visibility_count": below_min_visibility_count,
    }


def _create_and_enqueue_job(
    realm: Realm, from_values: list[int], to_value: int, total_count: int
) -> None:
    job = BulkFieldRemediationJob.objects.create(
        realm=realm,
        field_name=FIELD_NAME,
        from_values=from_values,
        to_value=to_value,
        total_violating_count=total_count,
    )
    queue_event_on_commit("bulk_remediation", {"job_id": job.id})


def _clamp_realm_default_if_needed(
    realm: Realm,
    above_max_visibility_values: list[int],
    below_min_visibility_values: list[int],
    visibility_max: int | None,
    visibility_min: int | None,
    acting_user: UserProfile,
) -> None:
    # The per-user job above never covers RealmUserDefault (a separate
    # model from UserProfile), so a non-compliant default would
    # otherwise stay that way, and every new user would inherit a value
    # that already violates the policy.
    realm_user_default = RealmUserDefault.objects.get(realm=realm)
    current_value = realm_user_default.email_address_visibility
    if current_value in above_max_visibility_values and visibility_max:
        do_set_realm_user_default_setting(
            realm_user_default, "email_address_visibility", visibility_max, acting_user=acting_user
        )
    elif current_value in below_min_visibility_values and visibility_min:
        do_set_realm_user_default_setting(
            realm_user_default, "email_address_visibility", visibility_min, acting_user=acting_user
        )


@typed_endpoint_without_parameters
def get_email_visibility_distribution(
    request: HttpRequest, user_profile: UserProfile
) -> HttpResponse:
    # Fetched once when the settings page loads. Every slider pole
    # movement after that is computed client-side from this
    # distribution. Only the final Apply click needs fresh counts (see
    # preview_email_visibility_policy_impact).
    counts = dict(
        UserProfile.objects.filter(realm=user_profile.realm, is_bot=False)
        .values_list("email_address_visibility")
        .annotate(count=Count("id"))
    )
    return json_success(
        request,
        data={
            "counts": {
                str(value): counts.get(value, 0)
                for value in UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES
            }
        },
    )


@typed_endpoint
def preview_email_visibility_policy_impact(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    visibility_max: Json[int | None] = None,
    visibility_min: Json[int | None] = None,
) -> HttpResponse:
    return json_success(
        request, data=_violating_counts(user_profile.realm, visibility_max, visibility_min)
    )


@typed_endpoint_without_parameters
def get_email_visibility_policy_status(
    request: HttpRequest, user_profile: UserProfile
) -> HttpResponse:
    realm = user_profile.realm
    # Called for its side effect only (flips a stale job to
    # STATUS_FAILED). The return value isn't needed here.
    _job_currently_running(realm)
    running_job = (
        BulkFieldRemediationJob.objects.filter(
            realm=realm,
            field_name=FIELD_NAME,
            status=BulkFieldRemediationJob.STATUS_RUNNING,
        )
        .order_by("-started_at")
        .first()
    )
    data: dict[str, Any] = {
        "max": realm.email_address_visibility_max,
        "min": realm.email_address_visibility_min,
        "running": running_job is not None,
    }
    if running_job:
        data["total_violating_count"] = running_job.total_violating_count
    else:
        # The live-push event only reaches whoever's currently
        # connected, so this surfaces a failure that can appear on a
        # later page load. This can be superseded by a more recent
        # success message.
        last_job = (
            BulkFieldRemediationJob.objects.filter(realm=realm, field_name=FIELD_NAME)
            .order_by("-started_at")
            .first()
        )
        if last_job and last_job.status == BulkFieldRemediationJob.STATUS_FAILED:
            data["failed"] = True
            data["processed_count"] = last_job.processed_count
            data["total_violating_count"] = last_job.total_violating_count
        elif last_job and last_job.status == BulkFieldRemediationJob.STATUS_COMPLETED:
            data["completed"] = True
            data["total_violating_count"] = last_job.total_violating_count
    return json_success(request, data=data)


@require_realm_owner
@typed_endpoint
def update_email_visibility_policy(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    email_address_visibility_max: Annotated[
        Json[int], check_int_in_validator(UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES)
    ]
    | None = None,
    email_address_visibility_min: Annotated[
        Json[int], check_int_in_validator(UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES)
    ]
    | None = None,
) -> HttpResponse:
    visibility_max = email_address_visibility_max
    visibility_min = email_address_visibility_min
    # The policy applies uniformly, including to the owner who set it.
    # Only changing it is owner-restricted, matching precedent
    # (message_retention_days, web-public channel creation).
    realm = user_profile.realm

    if _job_currently_running(realm):
        raise JsonableError(_("A previous email visibility policy change is still being applied."))

    if visibility_max and visibility_min:
        max_index = UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES.index(visibility_max)
        min_index = UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES.index(visibility_min)
        if max_index > min_index:
            raise JsonableError(
                _("The maximum visibility cannot be more restrictive than the minimum.")
            )

    counts = _violating_counts(realm, visibility_max, visibility_min)

    # A raw realm.save() wouldn't send a live-update event, leaving
    # already-connected clients' realm state stale.
    if visibility_max and visibility_max != realm.email_address_visibility_max:
        do_change_email_visibility_policy_bound(
            realm, "email_address_visibility_max", visibility_max, acting_user=user_profile
        )
    if visibility_min and visibility_min != realm.email_address_visibility_min:
        do_change_email_visibility_policy_bound(
            realm, "email_address_visibility_min", visibility_min, acting_user=user_profile
        )

    above_max_visibility_values, below_min_visibility_values = email_address_visibility_violations(
        visibility_max, visibility_min
    )

    _clamp_realm_default_if_needed(
        realm,
        above_max_visibility_values,
        below_min_visibility_values,
        visibility_max,
        visibility_min,
        user_profile,
    )
    if visibility_max and counts["above_max_visibility_count"]:
        _create_and_enqueue_job(
            realm, above_max_visibility_values, visibility_max, counts["above_max_visibility_count"]
        )
    if visibility_min and counts["below_min_visibility_count"]:
        _create_and_enqueue_job(
            realm, below_min_visibility_values, visibility_min, counts["below_min_visibility_count"]
        )

    job_started = (
        counts["above_max_visibility_count"] > 0 or counts["below_min_visibility_count"] > 0
    )
    event: dict[str, Any] = {
        "type": "realm",
        "op": "update_dict",
        "property": "email_visibility_policy",
        "data": {
            "running": job_started,
            "total_violating_count": counts["above_max_visibility_count"]
            + counts["below_min_visibility_count"],
        },
    }
    send_event_on_commit(realm, event, active_user_ids(realm.id))

    return json_success(request)
