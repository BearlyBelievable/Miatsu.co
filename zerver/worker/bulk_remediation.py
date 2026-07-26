# Documented in https://zulip.readthedocs.io/en/latest/subsystems/queuing.html
import logging
from collections.abc import Mapping
from typing import Any

from django.utils.timezone import now as timezone_now
from typing_extensions import override

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.actions.user_settings import do_change_user_setting
from zerver.lib.queue import queue_event_on_commit
from zerver.models import UserProfile
from zerver.tornado.django_api import send_event_on_commit
from zerver.worker.base import QueueProcessingWorker, assign_queue

logger = logging.getLogger(__name__)

BATCH_SIZE = 200


def get_next_batch(job: BulkFieldRemediationJob) -> list[UserProfile]:
    # Bot configuration is owner-governed, not a personal preference
    # like a regular user's, so this shouldn't reach into bot accounts.
    return list(
        UserProfile.objects.filter(
            realm=job.realm,
            id__gt=job.last_processed_user_id,
            is_bot=False,
            **{f"{job.field_name}__in": job.from_values},
        ).order_by("id")[:BATCH_SIZE]
    )


@assign_queue("bulk_remediation")
class BulkFieldRemediationWorker(QueueProcessingWorker):
    @override
    def consume(self, event: Mapping[str, Any]) -> None:
        try:
            job = BulkFieldRemediationJob.objects.get(id=event["job_id"])
        except BulkFieldRemediationJob.DoesNotExist:
            return

        if job.status != BulkFieldRemediationJob.STATUS_RUNNING:
            return

        batch = get_next_batch(job)
        if batch:
            try:
                # Looping here rather than calling bulk_change_user_setting(realm,
                # batch, ...) directly, since some fields' post-processing
                # (email_address_visibility among them) assumes exactly one
                # user per call.
                for user in batch:
                    do_change_user_setting(user, job.field_name, job.to_value, acting_user=None)
            except Exception:
                # Marking the job failed here, before re-raising, since
                # nothing else will ever re-enqueue the next batch for a
                # job that errored out partway through. Without this it
                # would look permanently "in progress," indistinguishable
                # from one still genuinely working.
                job.status = BulkFieldRemediationJob.STATUS_FAILED
                job.finished_at = timezone_now()
                job.save()
                logger.exception(
                    "Failed %s remediation for realm %s after %s users processed",
                    job.field_name,
                    job.realm_id,
                    job.processed_count,
                )
                # Generic event, matching notify_realm_export
                # (zerver/actions/realm_export.py). Only reaches whoever's
                # currently connected.
                failure_event = {
                    "type": "bulk_field_remediation",
                    "op": "failed",
                    "field_name": job.field_name,
                }
                send_event_on_commit(
                    job.realm,
                    failure_event,
                    job.realm.get_human_admin_users().values_list("id", flat=True),
                )
                raise

            job.processed_count += len(batch)
            job.last_processed_user_id = batch[-1].id
            job.last_batch_at = timezone_now()

        if len(batch) < BATCH_SIZE:
            job.status = BulkFieldRemediationJob.STATUS_COMPLETED
            job.finished_at = timezone_now()
            job.save()
            logger.info(
                "Completed %s remediation for realm %s: %s users processed",
                job.field_name,
                job.realm_id,
                job.processed_count,
            )
            # Matches the failure event above. Without this, nothing
            # tells an already-connected client the job succeeded, only
            # that it failed.
            completion_event = {
                "type": "bulk_field_remediation",
                "op": "completed",
                "field_name": job.field_name,
            }
            send_event_on_commit(
                job.realm,
                completion_event,
                job.realm.get_human_admin_users().values_list("id", flat=True),
            )
        else:
            job.save()
            # Re-enqueuing rather than looping keeps this rate-limited,
            # letting other queued work interleave between batches.
            queue_event_on_commit("bulk_remediation", {"job_id": job.id})
