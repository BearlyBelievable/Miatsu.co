from datetime import timedelta

import time_machine
from django.utils.timezone import now as timezone_now

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.lib.test_classes import ZulipTestCase


class BulkFieldRemediationJobTest(ZulipTestCase):
    def create_job(self, **kwargs: object) -> BulkFieldRemediationJob:
        realm = self.example_user("hamlet").realm
        defaults: dict[str, object] = {
            "realm": realm,
            "field_name": "email_address_visibility",
            "from_values": [1, 2],
            "to_value": 3,
            "total_violating_count": 10,
        }
        defaults.update(kwargs)
        return BulkFieldRemediationJob.objects.create(**defaults)

    def test_defaults(self) -> None:
        job = self.create_job()
        self.assertEqual(job.status, BulkFieldRemediationJob.STATUS_RUNNING)
        self.assertEqual(job.processed_count, 0)
        self.assertEqual(job.last_processed_user_id, 0)
        self.assertIsNone(job.finished_at)

    def test_get_status_display(self) -> None:
        job = self.create_job(status=BulkFieldRemediationJob.STATUS_RUNNING)
        self.assertEqual(job.get_status_display(), "running")
        job.status = BulkFieldRemediationJob.STATUS_COMPLETED
        self.assertEqual(job.get_status_display(), "completed")
        job.status = BulkFieldRemediationJob.STATUS_FAILED
        self.assertEqual(job.get_status_display(), "failed")

    def test_is_stale_false_when_not_running(self) -> None:
        job = self.create_job(
            status=BulkFieldRemediationJob.STATUS_COMPLETED,
            last_batch_at=timezone_now()
            - timedelta(seconds=BulkFieldRemediationJob.STALE_AFTER_SECONDS + 1),
        )
        self.assertFalse(job.is_stale())

    def test_is_stale_false_when_recently_batched(self) -> None:
        job = self.create_job(
            status=BulkFieldRemediationJob.STATUS_RUNNING,
            last_batch_at=timezone_now() - timedelta(seconds=1),
        )
        self.assertFalse(job.is_stale())

    def test_is_stale_true_when_stuck_running(self) -> None:
        job = self.create_job(status=BulkFieldRemediationJob.STATUS_RUNNING)
        with time_machine.travel(
            timezone_now() + timedelta(seconds=BulkFieldRemediationJob.STALE_AFTER_SECONDS + 1),
            tick=False,
        ):
            self.assertTrue(job.is_stale())

    def test_str(self) -> None:
        job = self.create_job()
        self.assertIn("email_address_visibility remediation for", str(job))
        self.assertIn("running", str(job))
