"use strict";

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {make_user} = require("./lib/example_user.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const people = zrequire("people");
const {set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");
const message_util = zrequire("message_util");

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
    // The current user is in both the initiator and permission groups, so
    // without the restriction setting every candidate would normally be
    // allowed (make_check_message_permission_for_dm_candidate returns null).
    realm.realm_direct_message_initiator_group = {
        direct_members: [me.user_id],
        direct_subgroups: [],
    };
    realm.realm_direct_message_permission_group = {
        direct_members: [me.user_id, authorizer.user_id],
        direct_subgroups: [],
    };
    realm.realm_direct_message_self_authorize_group = {direct_members: [], direct_subgroups: []};
}

run_test("restrict_dms_to_authorizers overrides being an initiator and authorizer", () => {
    set_groups();
    user_settings.miatsuco_restrict_dms_to_authorizers = true;

    const check = message_util.make_check_message_permission_for_dm_candidate([]);
    assert.ok(check !== null);
    assert.ok(check(authorizer.user_id));
    assert.ok(check(bot.user_id));
    assert.ok(!check(non_authorizer.user_id));

    user_settings.miatsuco_restrict_dms_to_authorizers = false;
});

run_test("without the restriction, being an initiator and authorizer allows anyone", () => {
    set_groups();

    const check = message_util.make_check_message_permission_for_dm_candidate([]);
    assert.equal(check, null);
});
