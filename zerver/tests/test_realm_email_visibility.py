from datetime import timedelta

import orjson

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import UserProfile


class UpdateEmailVisibilityPolicyTest(ZulipTestCase):
    def test_requires_owner(self) -> None:
        self.login("iago")
        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_error(result, "Must be an organization owner")

    def test_rejects_max_more_open_than_min(self) -> None:
        self.login("desdemona")
        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY
            ).decode(),
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_error(
            result, "The maximum visibility cannot be more restrictive than the minimum."
        )

    def test_successfully_sets_max_and_min(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode(),
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        realm.refresh_from_db()
        self.assertEqual(
            realm.email_address_visibility_max, UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        )
        self.assertEqual(
            realm.email_address_visibility_min, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        )

    def test_blocks_update_while_job_running(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        BulkFieldRemediationJob.objects.create(
            realm=realm,
            field_name="email_address_visibility",
            from_values=[UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE],
            to_value=UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            total_violating_count=1,
            status=BulkFieldRemediationJob.STATUS_RUNNING,
        )

        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_error(
            result, "A previous email visibility policy change is still being applied."
        )

    def test_stale_job_does_not_block_update(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        stale_job = BulkFieldRemediationJob.objects.create(
            realm=realm,
            field_name="email_address_visibility",
            from_values=[UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE],
            to_value=UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            total_violating_count=1,
            status=BulkFieldRemediationJob.STATUS_RUNNING,
        )
        stale_job.last_batch_at -= timedelta(
            seconds=BulkFieldRemediationJob.STALE_AFTER_SECONDS + 1
        )
        stale_job.save(update_fields=["last_batch_at"])

        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        )
        with self.assertLogs(level="WARNING") as warn_logs:
            result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)
        self.assert_length(warn_logs.output, 1)
        self.assertIn("Marking stale email_address_visibility remediation job", warn_logs.output[0])

        stale_job.refresh_from_db()
        self.assertEqual(stale_job.status, BulkFieldRemediationJob.STATUS_FAILED)


class GetEmailVisibilityPolicyStatusTest(ZulipTestCase):
    def test_reports_current_max_and_min(self) -> None:
        self.login("hamlet")
        realm = self.example_user("hamlet").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        result = self.client_get("/json/realm/email_visibility_policy")
        response_dict = self.assert_json_success(result)
        self.assertEqual(response_dict["max"], UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS)
        self.assertFalse(response_dict["running"])

    def test_reports_running_job(self) -> None:
        self.login("hamlet")
        realm = self.example_user("hamlet").realm
        BulkFieldRemediationJob.objects.create(
            realm=realm,
            field_name="email_address_visibility",
            from_values=[UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE],
            to_value=UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            total_violating_count=5,
            status=BulkFieldRemediationJob.STATUS_RUNNING,
        )

        result = self.client_get("/json/realm/email_visibility_policy")
        response_dict = self.assert_json_success(result)
        self.assertTrue(response_dict["running"])
        self.assertEqual(response_dict["total_violating_count"], 5)

    def test_reports_past_failure(self) -> None:
        self.login("hamlet")
        realm = self.example_user("hamlet").realm
        BulkFieldRemediationJob.objects.create(
            realm=realm,
            field_name="email_address_visibility",
            from_values=[UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE],
            to_value=UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            total_violating_count=5,
            processed_count=2,
            status=BulkFieldRemediationJob.STATUS_FAILED,
        )

        result = self.client_get("/json/realm/email_visibility_policy")
        response_dict = self.assert_json_success(result)
        self.assertFalse(response_dict["running"])
        self.assertTrue(response_dict["failed"])
        self.assertEqual(response_dict["processed_count"], 2)
        self.assertEqual(response_dict["total_violating_count"], 5)


class EmailVisibilityDistributionTest(ZulipTestCase):
    def test_returns_counts_for_all_values(self) -> None:
        self.login("hamlet")
        result = self.client_get("/json/realm/email_visibility_policy/distribution")
        response_dict = self.assert_json_success(result)
        for value in UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES:
            self.assertIn(str(value), response_dict["counts"])


class PreviewEmailVisibilityPolicyImpactTest(ZulipTestCase):
    def test_reports_violating_counts(self) -> None:
        self.login("hamlet")
        hamlet = self.example_user("hamlet")
        hamlet.email_address_visibility = UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
        hamlet.save(update_fields=["email_address_visibility"])

        req = dict(
            visibility_max=orjson.dumps(UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS).decode(),
        )
        result = self.client_get("/json/realm/email_visibility_policy/preview", req)
        response_dict = self.assert_json_success(result)
        self.assertGreaterEqual(response_dict["too_open_count"], 1)
        self.assertEqual(response_dict["too_closed_count"], 0)
