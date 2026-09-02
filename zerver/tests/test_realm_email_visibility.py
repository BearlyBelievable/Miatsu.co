from datetime import timedelta
from unittest import mock

import orjson

from bulk_remediation.models import BulkFieldRemediationJob
from zerver.lib.test_classes import ZulipTestCase
from zerver.lib.users import email_address_visibility_violations
from zerver.models import RealmUserDefault, UserProfile


class UpdateEmailVisibilityPolicyTest(ZulipTestCase):
    def test_not_settable_via_generic_realm_update(self) -> None:
        # email_address_visibility_max/min are deliberately absent
        # from Realm.property_types (see zerver/models/realms.py), so
        # the generic PATCH /realm endpoint must silently ignore them,
        # the same as any other unrecognized parameter, rather than
        # applying them without this endpoint's owner check, job
        # lock, and bulk remediation.
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        original_max = realm.email_address_visibility_max
        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        )
        result = self.client_patch("/json/realm", req)
        self.assert_json_success(result, ignored_parameters=["email_address_visibility_max"])

        realm.refresh_from_db()
        self.assertEqual(realm.email_address_visibility_max, original_max)

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

    def test_allows_max_equal_to_min(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        realm.refresh_from_db()
        self.assertEqual(
            realm.email_address_visibility_max, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        )
        self.assertEqual(
            realm.email_address_visibility_min, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        )

    def test_successfully_sets_max_and_min(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        visibility_min = UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        above_max_values, below_min_values = email_address_visibility_violations(
            visibility_max, visibility_min
        )
        expected_count = (
            UserProfile.objects.filter(
                realm=realm, email_address_visibility__in=above_max_values, is_bot=False
            ).count()
            + UserProfile.objects.filter(
                realm=realm, email_address_visibility__in=below_min_values, is_bot=False
            ).count()
        )

        req = dict(
            email_address_visibility_max=orjson.dumps(visibility_max).decode(),
            email_address_visibility_min=orjson.dumps(visibility_min).decode(),
        )
        with mock.patch(
            "zerver.views.realm_email_visibility.send_event_on_commit"
        ) as mock_send_event:
            result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        realm.refresh_from_db()
        self.assertEqual(realm.email_address_visibility_max, visibility_max)
        self.assertEqual(realm.email_address_visibility_min, visibility_min)

        mock_send_event.assert_called_once()
        (realm_arg, event_arg, _user_ids), _kwargs = mock_send_event.call_args
        self.assertEqual(realm_arg, realm)
        self.assertEqual(event_arg["type"], "realm")
        self.assertEqual(event_arg["op"], "update_dict")
        self.assertEqual(event_arg["property"], "email_visibility_policy")
        self.assertEqual(event_arg["data"]["running"], expected_count > 0)
        self.assertEqual(event_arg["data"]["total_violating_count"], expected_count)

    def test_starts_remediation_job_for_violating_users(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        hamlet = self.example_user("hamlet")
        hamlet.email_address_visibility = UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
        hamlet.save(update_fields=["email_address_visibility"])

        visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        above_max_values, _below_min_values = email_address_visibility_violations(
            visibility_max, None
        )
        expected_count = UserProfile.objects.filter(
            realm=realm, email_address_visibility__in=above_max_values, is_bot=False
        ).count()

        req = dict(
            email_address_visibility_max=orjson.dumps(visibility_max).decode(),
        )
        with mock.patch(
            "zerver.views.realm_email_visibility.send_event_on_commit"
        ) as mock_send_event:
            result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        job = BulkFieldRemediationJob.objects.get(
            realm=realm, field_name="email_address_visibility"
        )
        self.assertEqual(job.to_value, visibility_max)
        self.assertGreaterEqual(job.total_violating_count, 1)

        mock_send_event.assert_called_once()
        (realm_arg, event_arg, _user_ids), _kwargs = mock_send_event.call_args
        self.assertEqual(realm_arg, realm)
        self.assertEqual(event_arg["type"], "realm")
        self.assertEqual(event_arg["op"], "update_dict")
        self.assertEqual(event_arg["property"], "email_visibility_policy")
        self.assertTrue(event_arg["data"]["running"])
        self.assertEqual(event_arg["data"]["total_violating_count"], expected_count)

    def test_starts_remediation_job_for_too_closed_violating_users(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        hamlet = self.example_user("hamlet")
        hamlet.email_address_visibility = UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY
        hamlet.save(update_fields=["email_address_visibility"])

        req = dict(
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        job = BulkFieldRemediationJob.objects.get(
            realm=realm, field_name="email_address_visibility"
        )
        self.assertEqual(job.to_value, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS)
        self.assertGreaterEqual(job.total_violating_count, 1)

    def test_clamps_realm_default_when_above_max(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        realm_user_default = RealmUserDefault.objects.get(realm=realm)
        realm_user_default.email_address_visibility = UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
        realm_user_default.save(update_fields=["email_address_visibility"])

        req = dict(
            email_address_visibility_max=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        realm_user_default.refresh_from_db()
        self.assertEqual(
            realm_user_default.email_address_visibility,
            UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
        )

    def test_clamps_realm_default_when_below_min(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        realm_user_default = RealmUserDefault.objects.get(realm=realm)
        realm_user_default.email_address_visibility = UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY
        realm_user_default.save(update_fields=["email_address_visibility"])

        req = dict(
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        realm_user_default.refresh_from_db()
        self.assertEqual(
            realm_user_default.email_address_visibility,
            UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS,
        )

    def test_setting_only_min_reports_no_above_max_violations(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        req = dict(
            email_address_visibility_min=orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
            ).decode(),
        )
        result = self.client_patch("/json/realm/email_visibility_policy", req)
        self.assert_json_success(result)

        self.assertEqual(BulkFieldRemediationJob.objects.filter(realm=realm).count(), 0)

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

    def test_reports_past_completion(self) -> None:
        self.login("hamlet")
        realm = self.example_user("hamlet").realm
        BulkFieldRemediationJob.objects.create(
            realm=realm,
            field_name="email_address_visibility",
            from_values=[UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE],
            to_value=UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            total_violating_count=5,
            processed_count=5,
            status=BulkFieldRemediationJob.STATUS_COMPLETED,
        )

        result = self.client_get("/json/realm/email_visibility_policy")
        response_dict = self.assert_json_success(result)
        self.assertFalse(response_dict["running"])
        self.assertTrue(response_dict["completed"])
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
        self.assertGreaterEqual(response_dict["above_max_visibility_count"], 1)
        self.assertEqual(response_dict["below_min_visibility_count"], 0)
