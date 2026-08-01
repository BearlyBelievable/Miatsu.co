from zerver.lib.test_classes import ZulipTestCase
from zerver.lib.users import (
    email_address_visibility_allowed,
    email_address_visibility_options,
    email_address_visibility_violations,
)
from zerver.models import UserProfile


class EmailAddressVisibilityPolicyTest(ZulipTestCase):
    def test_allowed_no_restriction(self) -> None:
        realm = self.example_user("hamlet").realm
        for value in UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES:
            self.assertTrue(email_address_visibility_allowed(realm, value))

    def test_allowed_max_rejects_too_open(self) -> None:
        realm = self.example_user("hamlet").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        realm.save(update_fields=["email_address_visibility_max"])

        self.assertFalse(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)
        )
        self.assertTrue(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS)
        )
        self.assertTrue(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY)
        )

    def test_allowed_min_rejects_too_closed(self) -> None:
        realm = self.example_user("hamlet").realm
        realm.email_address_visibility_min = UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        realm.save(update_fields=["email_address_visibility_min"])

        self.assertFalse(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY)
        )
        self.assertTrue(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS)
        )
        self.assertTrue(
            email_address_visibility_allowed(realm, UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE)
        )

    def test_options(self) -> None:
        realm = self.example_user("hamlet").realm
        realm.email_address_visibility_max = UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS
        realm.email_address_visibility_min = UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS
        realm.save(
            update_fields=[
                "email_address_visibility_max",
                "email_address_visibility_min",
            ]
        )

        options = email_address_visibility_options(realm)
        self.assertNotIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE, options)
        self.assertIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS, options)
        self.assertIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS, options)
        self.assertNotIn(UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY, options)

    def test_violations_no_bounds(self) -> None:
        too_open, too_closed = email_address_visibility_violations(None, None)
        self.assertEqual(too_open, [])
        self.assertEqual(too_closed, [])

    def test_violations_with_max_and_min(self) -> None:
        too_open, too_closed = email_address_visibility_violations(
            UserProfile.EMAIL_ADDRESS_VISIBILITY_MEMBERS,
            UserProfile.EMAIL_ADDRESS_VISIBILITY_ADMINS,
        )
        self.assertEqual(too_open, [UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE])
        self.assertEqual(
            too_closed,
            [UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY],
        )
