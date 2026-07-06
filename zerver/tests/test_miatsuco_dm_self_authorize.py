from zerver.actions.realm_settings import do_change_realm_permission_group_setting
from zerver.actions.user_groups import check_add_user_group
from zerver.actions.users import do_change_user_role
from zerver.lib.exceptions import DirectMessagePermissionError
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import NamedUserGroup, UserProfile
from zerver.models.groups import SystemGroups
from zerver.models.realms import get_realm


class MiatsucoDMSelfAuthorizeTest(ZulipTestCase):
    """
    Fork feature (miatsuco): direct_message_self_authorize_group lets a
    configured set exchange DMs among themselves without a permission-group
    member, while any participant outside that set still requires one.
    """

    def test_direct_message_self_authorize_group_setting(self) -> None:
        """
        This test encodes the authorization matrix from the design note under
        the stated scenario: permission group = Moderators, initiator =
        Members, peer = group 1.
        """
        realm = get_realm("zulip")

        # group 1 members.
        g1_a = self.example_user("hamlet")
        g1_b = self.example_user("cordelia")
        # not in group 1: an ordinary member, a guest, and a moderator.
        member = self.example_user("othello")
        guest = self.example_user("polonius")
        moderator = self.example_user("shiva")

        do_change_user_role(guest, UserProfile.ROLE_GUEST, acting_user=None, notify=False)
        do_change_user_role(moderator, UserProfile.ROLE_MODERATOR, acting_user=None, notify=False)

        moderators_group = NamedUserGroup.objects.get(
            name=SystemGroups.MODERATORS, realm_for_sharding=realm, is_system_group=True
        )
        members_group = NamedUserGroup.objects.get(
            name=SystemGroups.MEMBERS, realm_for_sharding=realm, is_system_group=True
        )
        group1 = check_add_user_group(realm, "group1", [g1_a, g1_b], acting_user=g1_a)

        # Configure the stated scenario.
        do_change_realm_permission_group_setting(
            realm, "direct_message_permission_group", moderators_group, acting_user=None
        )
        do_change_realm_permission_group_setting(
            realm, "direct_message_initiator_group", members_group, acting_user=None
        )
        do_change_realm_permission_group_setting(
            realm, "direct_message_self_authorize_group", group1, acting_user=None
        )
        for user in (g1_a, g1_b, member, guest, moderator):
            user.refresh_from_db()

        # group1 -> group1: authorized by the peer path, no mod needed.
        self.send_personal_message(g1_a, g1_b)

        # group1 -> member: member is not a peer and no mod is present.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(g1_a, member)

        # group1 -> guest: guest is not a peer and no mod is present.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(g1_a, guest)

        # member -> member: neither is a peer and no mod is present.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(member, g1_a)

        # Any DM including a moderator is authorized (escape hatch), for every
        # sender class, including a guest recipient and a cross-group group DM.
        self.send_personal_message(g1_a, moderator)
        self.send_personal_message(member, moderator)
        self.send_group_direct_message(member, [member, moderator, guest])
        self.send_group_direct_message(g1_a, [g1_a, member, moderator])

        # group1 group DM stays authorized as long as every participant is a peer.
        self.send_group_direct_message(g1_a, [g1_a, g1_b])
        # But one non-peer participant breaks the peer path (no mod present).
        with self.assertRaises(DirectMessagePermissionError):
            self.send_group_direct_message(g1_a, [g1_a, g1_b, member])

        # The peer path also works when the peer setting is an anonymous group
        # combining a group and an individual user.
        anonymous_self_authorize_group = self.create_or_update_anonymous_group_for_setting(
            [member],
            [group1],
        )
        do_change_realm_permission_group_setting(
            realm,
            "direct_message_self_authorize_group",
            anonymous_self_authorize_group,
            acting_user=None,
        )
        member.refresh_from_db()
        # Now member is a peer too, so group1 <-> member is authorized unmodded.
        self.send_personal_message(g1_a, member)
        # Guest is still not a peer, so still needs a mod.
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(g1_a, guest)

        # With the peer group empty (NOBODY), behavior falls back to the
        # permission-group rule alone: group1 -> group1 now needs a mod.
        nobody_group = NamedUserGroup.objects.get(
            name=SystemGroups.NOBODY, realm_for_sharding=realm, is_system_group=True
        )
        do_change_realm_permission_group_setting(
            realm, "direct_message_self_authorize_group", nobody_group, acting_user=None
        )
        for user in (g1_a, g1_b):
            user.refresh_from_db()
        with self.assertRaises(DirectMessagePermissionError):
            self.send_personal_message(g1_a, g1_b)
