from unittest import mock

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import UserProfile
from zerver.worker.bulk_remediation import BulkFieldRemediationWorker, get_next_batch


class BulkFieldRemediationWorkerTest(ZulipTestCase):
    def create_job(self, **kwargs: object) -> BulkFieldRemediationJob:
        realm = self.example_user("hamlet").realm
        defaults: dict[str, object] = {
            "realm": realm,
            "field_name": "email_address_visibility",
            "from_values": [
                UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE,
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            ],
            "to_value": UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS,
            "total_violating_count": 1,
        }
        defaults.update(kwargs)
        return BulkFieldRemediationJob.objects.create(**defaults)

    def set_visibility(self, user: UserProfile, value: int) -> None:
        user.email_address_visibility = value
        user.save(update_fields=["email_address_visibility"])

    def test_get_next_batch_filters_correctly(self) -> None:
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")
        othello = self.example_user("othello")

        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)
        self.set_visibility(cordelia, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS)
        self.set_visibility(othello, UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS)

        job = self.create_job(realm=realm)
        batch = get_next_batch(job)
        batch_ids = {user.id for user in batch}

        self.assertIn(hamlet.id, batch_ids)
        self.assertIn(othello.id, batch_ids)
        self.assertNotIn(cordelia.id, batch_ids)

    def test_get_next_batch_excludes_bots(self) -> None:
        realm = self.example_user("hamlet").realm
        bot = self.example_user("default_bot")
        self.set_visibility(bot, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        job = self.create_job(realm=realm)
        batch = get_next_batch(job)
        batch_ids = {user.id for user in batch}

        self.assertNotIn(bot.id, batch_ids)

    def test_get_next_batch_respects_cursor(self) -> None:
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        othello = self.example_user("othello")
        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)
        self.set_visibility(othello, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        job = self.create_job(realm=realm, last_processed_user_id=hamlet.id)
        batch = get_next_batch(job)
        batch_ids = {user.id for user in batch}

        self.assertNotIn(hamlet.id, batch_ids)

    def test_consume_missing_job_is_noop(self) -> None:
        worker = BulkFieldRemediationWorker()
        # Should not raise, just silently return.
        worker.consume({"job_id": 999999})

    def test_consume_skips_non_running_job(self) -> None:
        job = self.create_job(status=BulkFieldRemediationJob.STATUS_COMPLETED)
        hamlet = self.example_user("hamlet")
        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        worker = BulkFieldRemediationWorker()
        worker.consume({"job_id": job.id})

        hamlet.refresh_from_db()
        self.assertEqual(
            hamlet.email_address_visibility, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
        )

    def test_consume_processes_batch_and_completes(self) -> None:
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        job = self.create_job(realm=realm)
        worker = BulkFieldRemediationWorker()

        with mock.patch("zerver.worker.bulk_remediation.send_event_on_commit") as mock_send_event:
            worker.consume({"job_id": job.id})

        hamlet.refresh_from_db()
        self.assertEqual(
            hamlet.email_address_visibility, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        )

        job.refresh_from_db()
        self.assertEqual(job.status, BulkFieldRemediationJob.STATUS_COMPLETED)
        self.assertEqual(job.processed_count, 1)
        self.assertIsNotNone(job.finished_at)

        mock_send_event.assert_called_once()
        (realm_arg, event_arg, _user_ids), _kwargs = mock_send_event.call_args
        self.assertEqual(realm_arg, realm)
        self.assertEqual(event_arg["type"], "bulk_field_remediation")
        self.assertEqual(event_arg["op"], "completed")

    def test_consume_reenqueues_when_batch_is_full(self) -> None:
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        othello = self.example_user("othello")
        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)
        self.set_visibility(othello, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        job = self.create_job(realm=realm)
        worker = BulkFieldRemediationWorker()

        with (
            mock.patch("zerver.worker.bulk_remediation.BATCH_SIZE", 2),
            mock.patch("zerver.worker.bulk_remediation.queue_event_on_commit") as mock_requeue,
        ):
            worker.consume({"job_id": job.id})

        job.refresh_from_db()
        self.assertEqual(job.status, BulkFieldRemediationJob.STATUS_RUNNING)
        self.assertEqual(job.processed_count, 2)
        self.assertIsNone(job.finished_at)

        mock_requeue.assert_called_once_with("bulk_remediation", {"job_id": job.id})

    def test_consume_marks_failed_on_exception(self) -> None:
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        self.set_visibility(hamlet, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)

        job = self.create_job(realm=realm)
        worker = BulkFieldRemediationWorker()

        with (
            mock.patch(
                "zerver.worker.bulk_remediation.do_change_user_setting",
                side_effect=ValueError("boom"),
            ),
            mock.patch("zerver.worker.bulk_remediation.send_event_on_commit") as mock_send_event,
            self.assertLogs(level="ERROR") as error_logs,
            self.assertRaises(ValueError),
        ):
            worker.consume({"job_id": job.id})

        self.assert_length(error_logs.output, 1)
        self.assertIn("Failed email_address_visibility remediation for realm", error_logs.output[0])

        job.refresh_from_db()
        self.assertEqual(job.status, BulkFieldRemediationJob.STATUS_FAILED)
        self.assertIsNotNone(job.finished_at)

        mock_send_event.assert_called_once()
        (realm_arg, event_arg, _user_ids), _kwargs = mock_send_event.call_args
        self.assertEqual(realm_arg, realm)
        self.assertEqual(event_arg["type"], "bulk_field_remediation")
        self.assertEqual(event_arg["op"], "failed")
