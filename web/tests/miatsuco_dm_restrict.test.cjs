"use strict";

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {make_user} = require("./lib/example_user.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const people = zrequire("people");
const {set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");

// Fork feature (miatsuco): the personal miatsuco_restrict_dms_to_authorizers
// setting. This exercises the client-side half of the bidirectional check in
// people.user_can_direct_message: only our own opted-in status is ever known
// client-side, so this covers the current user's own restriction blocking
// their own outgoing DMs, mirroring part of the backend's
// check_can_send_direct_message.

const realm = make_realm({});
set_realm(realm);

const user_settings = {miatsuco_restrict_dms_to_authorizers: false};
initialize_user_settings({user_settings});

const me = make_user({email: "me@example.com", user_id: 1, full_name: "Me"});
const authorizer = make_user({email: "auth@example.com", user_id: 2, full_name: "Auth"});
const non_authorizer = make_user({email: "other@example.com", user_id: 3, full_name: "Other"});
const bot = make_user({email: "bot@example.com", user_id: 4, full_name: "Bot", is_bot: true});

people.init();
for (const user of [me, authorizer, non_authorizer, bot]) {
    people.add_active_user(user);
}
people.initialize_current_user(me.user_id);

function set_groups() {
    // The current user is a permission-group member, which would normally
    // authorize any DM on its own; the restriction setting overrides that.
    realm.realm_direct_message_permission_group = {
        direct_members: [me.user_id, authorizer.user_id],
        direct_subgroups: [],
    };
    realm.realm_direct_message_self_authorize_group = {direct_members: [], direct_subgroups: []};
}

run_test("restriction overrides being a permission-group member ourselves", () => {
    set_groups();
    user_settings.miatsuco_restrict_dms_to_authorizers = true;

    assert.ok(people.user_can_direct_message(authorizer.user_id.toString()));
    assert.ok(!people.user_can_direct_message(non_authorizer.user_id.toString()));

    user_settings.miatsuco_restrict_dms_to_authorizers = false;
});

run_test("restriction ignores bots and self", () => {
    set_groups();
    user_settings.miatsuco_restrict_dms_to_authorizers = true;

    assert.ok(people.user_can_direct_message(`${authorizer.user_id},${bot.user_id},${me.user_id}`));

    user_settings.miatsuco_restrict_dms_to_authorizers = false;
});

run_test("without the restriction, being a permission-group member allows anyone", () => {
    set_groups();

    assert.ok(people.user_can_direct_message(non_authorizer.user_id.toString()));
});

run_test("restriction blocks a group DM with a mix of authorizers and non-authorizers", () => {
    set_groups();
    user_settings.miatsuco_restrict_dms_to_authorizers = true;

    assert.ok(
        !people.user_can_direct_message(
            `${authorizer.user_id},${non_authorizer.user_id},${bot.user_id}`,
        ),
    );

    user_settings.miatsuco_restrict_dms_to_authorizers = false;
});
