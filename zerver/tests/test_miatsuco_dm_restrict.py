from zerver.actions.realm_settings import do_change_realm_permission_group_setting
from zerver.actions.user_groups import check_add_user_group
from zerver.actions.user_settings import do_change_user_setting
from zerver.actions.users import do_change_user_role
from zerver.lib.exceptions import DirectMessagePermissionError
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import NamedUserGroup, UserProfile
from zerver.models.groups import SystemGroups
from zerver.models.realms import get_realm


class MiatsucoRestrictDMsToAuthorizersTest(ZulipTestCase):
    """
    Fork feature (miatsuco): the personal miatsuco_restrict_dms_to_authorizers
    setting makes a user opt out of any direct message that includes a
    non-authorizer. For an opted-in user, every other human participant must be
    a member of direct_message_permission_group. This is bidirectional (it
    governs the opted-in user's outgoing DMs too) and overrides the realm
    direct_message_self_authorize_group allowance for that user.
    """

    def test_restrict_dms_to_authorizers(self) -> None:
        realm = get_realm("zulip")

        g1_a = self.example_user("hamlet")
        g1_b = self.example_user("cordelia")
        moderator = self.example_user("shiva")
        another_moderator = self.example_user("iago")
        do_change_user_role(moderator, UserProfile.ROLE_MODERATOR, acting_user=None, notify=False)
        do_change_user_role(
            another_moderator, UserProfile.ROLE_MODERATOR, acting_user=None, notify=False
        )

        moderators_group = NamedUserGroup.objects.get(
            name=SystemGroups.MODERATORS, realm_for_sharding=realm, is_system_group=True
        )
        group1 = check_add_user_group(realm, "group1", [g1_a, g1_b], acting_user=g1_a)

        # Authorizers are moderators-and-above; group1 may self-authorize DMs
        # among themselves without an authorizer present.
        do_change_realm_permission_group_setting(
            realm, "direct_message_permission_group", moderators_group, acting_user=None
        )
        do_change_realm_permission_group_setting(
            realm, "direct_message_self_authorize_group", group1, acting_user=None
        )
        for user in (g1_a, g1_b, moderator, another_moderator):
            user.refresh_from_db()

        # Baseline: group1 <-> group1 is allowed via the self-authorize path.
        self.send_personal_message(g1_a, g1_b)

        # g1_b opts into the personal restriction. Wrap the change in
        # captureOnCommitCallbacks so the on_commit user-cache flush runs; the
        # test transaction never commits, and without this a later send would
        # read a stale cached UserProfile and miss the opt-in.
        with self.captureOnCommitCallbacks(execute=True):
            do_change_user_setting(
                g1_b, "miatsuco_restrict_dms_to_authorizers", True, acting_user=None
            )
        g1_b.refresh_from_db()

        # A self-authorized DM from non-authorizer g1_a to g1_b is now blocked:
        # g1_a is not an authorizer. A single opted-in recipient gets the
        # specific "this user" message.
        with self.assertRaises(DirectMessagePermissionError) as blocked_1to1:
            self.send_personal_message(g1_a, g1_b)
        self.assertEqual(
            str(blocked_1to1.exception),
            "This user only accepts direct messages from those who can authorize them.",
        )

        # The restriction is bidirectional: g1_b also cannot start a DM with a
        # non-authorizer. When only the sender has opted in there is no opted-in
        # recipient to name, so the general "some recipients" message is used.
        with self.assertRaises(DirectMessagePermissionError) as blocked_as_sender:
            self.send_personal_message(g1_b, g1_a)
        self.assertEqual(
            str(blocked_as_sender.exception),
            "Some recipients only accept direct messages that include "
            "someone who can authorize them.",
        )

        # A group DM in which any participant is a non-authorizer is blocked,
        # EVEN IF an authorizer is also present: including a moderator does not
        # let a non-authorizer (g1_a) share a DM with the opted-in g1_b.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_group_direct_message(g1_a, [g1_a, g1_b, moderator])

        # A 1:1 DM with an authorizer is allowed: the only other participant is
        # a moderator.
        self.send_personal_message(moderator, g1_b)

        # A group DM is allowed only when every other participant authorizes:
        # g1_b with two moderators and no non-authorizer.
        self.send_group_direct_message(moderator, [moderator, another_moderator, g1_b])

        # With more than one opted-in recipient, the general message is used so
        # that no single recipient is identified.
        with self.captureOnCommitCallbacks(execute=True):
            do_change_user_setting(
                g1_a, "miatsuco_restrict_dms_to_authorizers", True, acting_user=None
            )
        g1_a.refresh_from_db()
        with self.assertRaises(DirectMessagePermissionError) as blocked_group:
            self.send_group_direct_message(moderator, [moderator, g1_a, g1_b])
        self.assertEqual(
            str(blocked_group.exception),
            "Some recipients only accept direct messages that include "
            "someone who can authorize them.",
        )
        with self.captureOnCommitCallbacks(execute=True):
            do_change_user_setting(
                g1_a, "miatsuco_restrict_dms_to_authorizers", False, acting_user=None
            )
        g1_a.refresh_from_db()

        # Self-DMs are always allowed regardless of the setting.
        self.send_personal_message(g1_b, g1_b)

        # Turning the setting back off restores the self-authorize allowance.
        with self.captureOnCommitCallbacks(execute=True):
            do_change_user_setting(
                g1_b, "miatsuco_restrict_dms_to_authorizers", False, acting_user=None
            )
        g1_b.refresh_from_db()
        self.send_personal_message(g1_a, g1_b)

        # When direct_message_permission_group is a named (non-system) group,
        # authorizer membership is resolved by group membership rather than by
        # role. Point the permission group at a named group and re-enable the
        # restriction to exercise that path.
        othello = self.example_user("othello")
        named_authorizers = check_add_user_group(
            realm, "named_authorizers", [othello], acting_user=g1_a
        )
        with self.captureOnCommitCallbacks(execute=True):
            do_change_realm_permission_group_setting(
                realm, "direct_message_permission_group", named_authorizers, acting_user=None
            )
            do_change_user_setting(
                g1_b, "miatsuco_restrict_dms_to_authorizers", True, acting_user=None
            )
        for user in (g1_a, g1_b, othello):
            user.refresh_from_db()

        # othello is a member of the named authorizer group, so a DM to the
        # opted-in g1_b is allowed.
        self.send_personal_message(othello, g1_b)

        # g1_a is not in the named authorizer group, so a DM to g1_b is blocked.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(g1_a, g1_b)
