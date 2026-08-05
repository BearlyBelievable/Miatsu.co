from typing import cast

import orjson
from django import forms

from zerver.forms import RegistrationForm
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import RealmUserDefault, UserProfile


class EnforceEmailVisibilityPolicyTest(ZulipTestCase):
    def test_realm_user_settings_defaults_requires_owner(self) -> None:
        self.login("iago")
        realm = self.example_user("iago").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        data = {
            "email_address_visibility": orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        }
        result = self.client_patch("/json/realm/user_settings_defaults", data)
        self.assert_json_error(result, "Must be an organization owner")

    def test_realm_user_settings_defaults_rejects_out_of_policy(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        data = {
            "email_address_visibility": orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
            ).decode()
        }
        result = self.client_patch("/json/realm/user_settings_defaults", data)
        self.assert_json_error(
            result, "That email address visibility is not allowed in this organization."
        )

    def test_realm_user_settings_defaults_accepts_within_policy(self) -> None:
        self.login("desdemona")
        realm = self.example_user("desdemona").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        data = {
            "email_address_visibility": orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        }
        result = self.client_patch("/json/realm/user_settings_defaults", data)
        self.assert_json_success(result)

        realm_user_default = RealmUserDefault.objects.get(realm=realm)
        self.assertEqual(
            realm_user_default.email_address_visibility,
            UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
        )

    def test_json_change_settings_rejects_out_of_policy(self) -> None:
        self.login("hamlet")
        hamlet = self.example_user("hamlet")
        realm = hamlet.realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        data = {
            "email_address_visibility": orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
            ).decode()
        }
        result = self.client_patch("/json/settings", data)
        self.assert_json_error(
            result, "That email address visibility is not allowed in this organization."
        )

    def test_json_change_settings_accepts_within_policy(self) -> None:
        self.login("hamlet")
        hamlet = self.example_user("hamlet")
        realm = hamlet.realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        data = {
            "email_address_visibility": orjson.dumps(
                UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
            ).decode()
        }
        result = self.client_patch("/json/settings", data)
        self.assert_json_success(result)

        hamlet.refresh_from_db()
        self.assertEqual(
            hamlet.email_address_visibility, UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        )


class RegistrationFormEmailVisibilityFilterTest(ZulipTestCase):
    def test_registration_form_filters_choices_to_policy(self) -> None:
        realm = self.example_user("hamlet").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.save(update_fields=["email_address_visibility_max"])

        form = RegistrationForm(realm_creation=False, realm=realm)
        email_visibility_field = cast(
            forms.TypedChoiceField, form.fields["email_address_visibility"]
        )
        choices = cast(list[tuple[int, str]], email_visibility_field.choices)
        choice_values = [choice[0] for choice in choices]

        self.assertNotIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE, choice_values)
        self.assertIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS, choice_values)
