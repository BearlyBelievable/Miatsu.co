"use strict";

const assert = require("node:assert/strict");

const {make_user_group} = require("./lib/example_group.cjs");
const {make_realm} = require("./lib/example_realm.cjs");
const {make_user} = require("./lib/example_user.cjs");
const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const user_group_popover = mock_esm("../src/user_group_popover");

const user_groups = zrequire("user_groups");
const people = zrequire("people");
const {set_realm} = zrequire("state_data");
const miatsuco_dm_authorizer_display = zrequire("miatsuco_dm_authorizer_display");

const realm = make_realm({});
set_realm(realm);

const alice = make_user({email: "alice@example.com", user_id: 11, full_name: "Alice"});
const bob = make_user({email: "bob@example.com", user_id: 12, full_name: "Bob"});
people.add_active_user(alice);
people.add_active_user(bob);

const moderators = make_user_group({
    name: "role:moderators",
    id: 100,
    members: new Set([alice.user_id]),
});
user_groups.initialize({realm_user_groups: [moderators]});

run_test("group value renders a clickable group pill", () => {
    const html = miatsuco_dm_authorizer_display.build_pills_html(moderators.id);
    // A group pill carries data-user-group-id so it opens the popover.
    assert.ok(html.includes(`data-user-group-id="${moderators.id}"`));
    // It should not carry a user-id target.
    assert.ok(!html.includes("data-user-id="));
});

run_test("individual member renders a non-interactive user pill", () => {
    const value = {direct_subgroups: [], direct_members: [alice.user_id]};
    const html = miatsuco_dm_authorizer_display.build_pills_html(value);
    // The name is shown, but with no data-user-group-id and no data-user-id,
    // so the pill is purely informational.
    assert.ok(html.includes("Alice"));
    assert.ok(!html.includes("data-user-group-id="));
    assert.ok(!html.includes("data-user-id="));
});

run_test("anonymous combination renders both group and user pills", () => {
    const value = {direct_subgroups: [moderators.id], direct_members: [bob.user_id]};
    const html = miatsuco_dm_authorizer_display.build_pills_html(value);
    assert.ok(html.includes(`data-user-group-id="${moderators.id}"`));
    assert.ok(html.includes("Bob"));
});

run_test("empty value renders no pills", () => {
    const value = {direct_subgroups: [], direct_members: []};
    const html = miatsuco_dm_authorizer_display.build_pills_html(value);
    assert.equal(html, "");
});

run_test("unknown group id is skipped", () => {
    const html = miatsuco_dm_authorizer_display.build_pills_html(9999);
    assert.equal(html, "");
});

run_test("unknown individual member id is skipped", () => {
    const value = {direct_subgroups: [], direct_members: [999_999]};
    const html = miatsuco_dm_authorizer_display.build_pills_html(value);
    assert.equal(html, "");
});

run_test("render_pills populates the pill container", ({override}) => {
    override(realm, "realm_direct_message_permission_group", moderators.id);
    const $pills = $.create("pills");
    const $container = $.create("render-container");
    $container.set_find_results(".miatsuco-dm-authorizers-pills", $pills);

    miatsuco_dm_authorizer_display.render_pills($container);

    assert.ok($pills.html().includes(`data-user-group-id="${moderators.id}"`));
});

run_test("render_pills shows an empty message when no one can authorize", ({override}) => {
    override(realm, "realm_direct_message_permission_group", {
        direct_subgroups: [],
        direct_members: [],
    });
    const $pills = $.create("empty-pills");
    const $container = $.create("empty-container");
    $container.set_find_results(".miatsuco-dm-authorizers-pills", $pills);

    // Should not throw; the empty-state span is appended.
    miatsuco_dm_authorizer_display.render_pills($container);
});

run_test("render_pills is a no-op without a pill container", () => {
    const $container = $.create("no-pills-container");
    $container.set_find_results(".miatsuco-dm-authorizers-pills", []);
    // Should not throw.
    miatsuco_dm_authorizer_display.render_pills($container);
});

run_test("set_up mounts the pill container and wires the popover handler", ({override}) => {
    override(realm, "realm_direct_message_permission_group", moderators.id);

    const $pills = $.create("setup-pills");
    const $disclosure = $.create("disclosure");
    const $container = $.create("setup-container");
    $container.set_find_results(".miatsuco-dm-authorizers", $disclosure);
    $container.set_find_results(".miatsuco-dm-authorizers-pills", $pills);

    miatsuco_dm_authorizer_display.set_up($container);

    const popover_handler = $disclosure.get_on_handler(
        "click",
        ".miatsuco-dm-authorizers-pills .pill[data-user-group-id]",
    );
    assert.ok(popover_handler !== undefined);

    // Invoke the popover handler to cover the view-only popover call.
    let popover_opened_view_only = false;
    override(user_group_popover, "toggle_user_group_info_popover", (_el, _msg, view_only) => {
        popover_opened_view_only = view_only;
    });
    const $pill = $.create("pill-target");
    const event = {stopPropagation() {}};
    popover_handler.call($pill.get(0) ?? $pill, event);
    assert.ok(popover_opened_view_only);
});

run_test("rerender_if_present updates the settings panel when open", ({override}) => {
    override(realm, "realm_direct_message_permission_group", moderators.id);
    const $pills = $.create("live-pills");
    $.reset_selector("#settings_content");
    const $settings = $.create("#settings_content");
    $settings.set_find_results(".miatsuco-dm-authorizers-pills", $pills);

    miatsuco_dm_authorizer_display.rerender_if_present();

    assert.ok($pills.html().includes(`data-user-group-id="${moderators.id}"`));
    $.clear_all_elements();
});

run_test("rerender_if_present is a no-op when settings are closed", () => {
    $.reset_selector("#settings_content");
    $.set_results("#settings_content", []);
    // Should not throw and should not attempt to find the pill container.
    miatsuco_dm_authorizer_display.rerender_if_present();
    $.clear_all_elements();
});

run_test("set_up is a no-op without a disclosure element", () => {
    const $container = $.create("no-disclosure-container");
    $container.set_find_results(".miatsuco-dm-authorizers", []);
    // Should not throw and should not require a pill container.
    miatsuco_dm_authorizer_display.set_up($container);
});
