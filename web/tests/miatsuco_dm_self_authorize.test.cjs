"use strict";

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {make_user} = require("./lib/example_user.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const people = zrequire("people");
const {set_realm} = zrequire("state_data");

// Fork feature (miatsuco): direct_message_self_authorize_group lets a
// configured set exchange DMs among themselves without a permission-group
// member present. This exercises the client-side branch in
// people.user_can_direct_message that mirrors the backend allowance.

const realm = make_realm({});
set_realm(realm);

const me = make_user({email: "me@example.com", user_id: 1, full_name: "Me"});
const peer = make_user({email: "peer@example.com", user_id: 2, full_name: "Peer"});
const outsider = make_user({email: "outsider@example.com", user_id: 3, full_name: "Outsider"});
const bot = make_user({email: "bot@example.com", user_id: 4, full_name: "Bot", is_bot: true});

people.init();
for (const user of [me, peer, outsider, bot]) {
    people.add_active_user(user);
}
people.initialize_current_user(me.user_id);

// A DM never uses the permission-group escape hatch in these cases: the
// current user is not in it, so the self-authorize branch is what decides.
function set_groups({self_authorize_members}) {
    // Anonymous-group form: an object with explicit direct_members. Nobody is
    // in the permission group, forcing evaluation of the self-authorize path.
    realm.realm_direct_message_permission_group = {direct_members: [], direct_subgroups: []};
    realm.realm_direct_message_self_authorize_group = {
        direct_members: self_authorize_members,
        direct_subgroups: [],
    };
}

run_test("self_authorize allows DMs among members", () => {
    // Me and the peer are both in the self-authorize group; a DM between us is
    // authorized without a permission-group member present.
    set_groups({self_authorize_members: [me.user_id, peer.user_id]});
    assert.ok(people.user_can_direct_message(peer.user_id.toString()));

    // Bots and the sender are skipped, so a DM to the peer plus a bot is still
    // authorized as long as every other human is a self-authorizer.
    assert.ok(people.user_can_direct_message(`${peer.user_id},${bot.user_id},${me.user_id}`));
});

run_test("self_authorize blocks when any recipient is outside the group", () => {
    // Me and the peer self-authorize, but the outsider does not. A DM that
    // includes the outsider is not authorized by the self-authorize path.
    set_groups({self_authorize_members: [me.user_id, peer.user_id]});
    assert.ok(!people.user_can_direct_message(`${peer.user_id},${outsider.user_id}`));
});

run_test("self_authorize path is skipped when sender is not a member", () => {
    // If the current user is not in the self-authorize group, the branch does
    // not apply and cannot authorize the DM on its own.
    set_groups({self_authorize_members: [peer.user_id]});
    assert.ok(!people.user_can_direct_message(peer.user_id.toString()));
});
