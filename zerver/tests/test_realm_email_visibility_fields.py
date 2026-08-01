from zerver.lib.test_classes import ZulipTestCase
from zerver.models import UserProfile


class RealmEmailVisibilityFieldsTest(ZulipTestCase):
    def test_defaults_on_existing_realm(self) -> None:
        realm = self.example_user("hamlet").realm
        self.assertEqual(
            realm.email_address_visibility_max,
            UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE,
        )
        self.assertEqual(
            realm.email_address_visibility_min, UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY
        )
