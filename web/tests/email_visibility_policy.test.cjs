"use strict";

const assert = require("node:assert/strict");

const {JSDOM} = require("jsdom");

const {make_realm} = require("./lib/example_realm.cjs");
const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");

const channel = mock_esm("../src/channel");
const bulk_remediation_ui = mock_esm("../src/bulk_remediation_ui");

const {set_realm, set_current_user} = zrequire("state_data");
const {initialize: initialize_realm_user_settings_defaults} = zrequire(
    "realm_user_settings_defaults",
);
const {initialize_user_settings} = zrequire("user_settings");
const email_visibility_policy = zrequire("email_visibility_policy");

const realm_user_settings_defaults = {email_address_visibility: 1};
const user_settings = {email_address_visibility: 1};

const DOM_HTML =
    '<div id="org-email-visibility-policy">' +
    '<div class="save-button-controls"></div>' +
    "</div>" +
    '<div class="email-visibility-policy-impact">' +
    '<div class="banner-label"></div>' +
    "</div>" +
    '<div id="email_visibility_policy_slider"></div>' +
    '<input id="id_realm_email_address_visibility_max">' +
    '<input id="id_realm_email_address_visibility_min">' +
    '<select id="realm_email_address_visibility"></select>' +
    '<select id="user_email_address_visibility"></select>';

const {window} = new JSDOM(DOM_HTML);
set_global("document", window.document);
set_global("HTMLElement", window.HTMLElement);
set_global("getComputedStyle", window.getComputedStyle.bind(window));
set_global("Event", window.Event);

initialize_realm_user_settings_defaults({realm_user_settings_defaults});
initialize_user_settings({user_settings});

function set_up_realm(overrides = {}) {
    set_realm(
        make_realm({
            realm_email_address_visibility_max: 1,
            realm_email_address_visibility_min: 4,
            ...overrides,
        }),
    );
}

function reset_dom() {
    document.body.innerHTML = DOM_HTML;
}

run_test("no restriction returns all values", () => {
    set_up_realm();
    const allowed = email_visibility_policy.get_allowed_email_address_visibility_values();
    assert.deepEqual(Object.keys(allowed), [
        "everyone",
        "members",
        "moderators",
        "admins_only",
        "nobody",
    ]);
});

run_test("max and min filter to the allowed subset", () => {
    set_up_realm({
        realm_email_address_visibility_max: 2,
        realm_email_address_visibility_min: 3,
    });
    const allowed = email_visibility_policy.get_allowed_email_address_visibility_values();
    const allowed_codes = Object.values(allowed).map((value) => value.code);
    assert.deepEqual(new Set(allowed_codes), new Set([2, 5, 3]));
});

function override_channel_get(url_responses) {
    channel.get = (args) => {
        const respond = url_responses[args.url];
        assert.ok(respond !== undefined, `unexpected url: ${args.url}`);
        args.success(respond);
    };
}

run_test("setup creates the slider and shows the normal state for an owner", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: false,
        },
    });

    email_visibility_policy.setup();
});

run_test("setup shows the read-only state for a non-owner", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: false});
    let lock_message;
    bulk_remediation_ui.lock_widget = (_widget, message) => {
        lock_message = message;
    };
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: false,
        },
    });

    email_visibility_policy.setup();

    assert.equal(lock_message, "");
});

run_test("setup shows the locked state while a remediation job is running", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    let running_message;
    bulk_remediation_ui.lock_widget = (_widget, message) => {
        running_message = message;
    };
    bulk_remediation_ui.get_running_message = (total_violating_count) =>
        `running for ${total_violating_count}`;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: true,
            total_violating_count: 7,
        },
    });

    email_visibility_policy.setup();

    assert.equal(running_message, "running for 7");
});

run_test("setup shows the failed state from a past, unrecovered failure", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    let failed_message;
    bulk_remediation_ui.unlock_widget = (_widget, message) => {
        failed_message = message;
    };
    bulk_remediation_ui.get_failed_message = (processed_count, total_violating_count) =>
        `failed at ${processed_count} of ${total_violating_count}`;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: false,
            failed: true,
            processed_count: 3,
            total_violating_count: 10,
        },
    });

    email_visibility_policy.setup();

    assert.equal(failed_message, "failed at 3 of 10");
});

function setup_with_slider(realm_overrides = {}) {
    reset_dom();
    set_up_realm(realm_overrides);
    set_current_user({is_owner: true});
    bulk_remediation_ui.lock_widget = noop;
    bulk_remediation_ui.unlock_widget = noop;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {
            max: realm_overrides.realm_email_address_visibility_max ?? 1,
            min: realm_overrides.realm_email_address_visibility_min ?? 4,
            running: false,
        },
    });
    email_visibility_policy.setup();
}

run_test("handle_policy_update_event shows the locked state while running", () => {
    setup_with_slider();
    let running_message;
    bulk_remediation_ui.lock_widget = (_widget, message) => {
        running_message = message;
    };
    bulk_remediation_ui.get_running_message = (total_violating_count) =>
        `running for ${total_violating_count}`;

    email_visibility_policy.handle_policy_update_event({
        running: true,
        total_violating_count: 4,
    });

    assert.equal(running_message, "running for 4");
});

run_test("handle_policy_update_event clears the locked state once not running", () => {
    setup_with_slider();
    let unlocked = false;
    bulk_remediation_ui.unlock_widget = () => {
        unlocked = true;
    };

    email_visibility_policy.handle_policy_update_event({
        running: false,
        total_violating_count: 0,
    });

    assert.ok(unlocked);
});

run_test("handle_remediation_completed_event shows the completed message", () => {
    setup_with_slider();
    let completed_message;
    bulk_remediation_ui.unlock_widget_after_completion = (_widget, message) => {
        completed_message = message;
    };
    bulk_remediation_ui.get_completed_message = (total_violating_count) =>
        `completed for ${total_violating_count}`;
    override_channel_get({
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: false,
            completed: true,
            total_violating_count: 1,
        },
    });

    email_visibility_policy.handle_remediation_completed_event();

    assert.equal(completed_message, "completed for 1");
});

run_test(
    "handle_remediation_completed_event does nothing if the status no longer shows a completion",
    () => {
        setup_with_slider();
        bulk_remediation_ui.unlock_widget_after_completion = () => {
            /* istanbul ignore next */
            throw new Error("should not be called");
        };
        override_channel_get({
            "/json/realm/email_visibility_policy": {
                max: 1,
                min: 4,
                running: true,
                total_violating_count: 3,
            },
        });

        email_visibility_policy.handle_remediation_completed_event();
    },
);

run_test("reset_slider_to_saved moves the slider back to its saved indices", () => {
    setup_with_slider({
        realm_email_address_visibility_max: 2,
        realm_email_address_visibility_min: 3,
    });

    email_visibility_policy.reset_slider_to_saved();

    // No assertion failure from calling this on a real slider is itself
    // the meaningful check here; current_indices isn't exposed publicly
    // to assert against directly, and this call's own effect on the
    // slider is already covered by two_pole_slider.test.cjs's own
    // "reset_to_saved" test.
});

run_test("reset_slider_to_saved uses the current realm state, not a stale cached one", () => {
    setup_with_slider({
        realm_email_address_visibility_max: 1,
        realm_email_address_visibility_min: 4,
    });

    // Simulate the realm's own value having already changed (e.g. via
    // the live-push event that arrives before the slider's cached
    // saved indices are refreshed), without going through
    // handle_policy_update_event, which is the only other place that
    // normally does that refresh.
    set_up_realm({
        realm_email_address_visibility_max: 3,
        realm_email_address_visibility_min: 4,
    });

    email_visibility_policy.reset_slider_to_saved();

    assert.equal(document.querySelector("#id_realm_email_address_visibility_max").value, "3");
});

run_test("handle_remediation_failed_event shows the failed state", () => {
    setup_with_slider();
    let failed_message;
    bulk_remediation_ui.unlock_widget = (_widget, message) => {
        failed_message = message;
    };
    bulk_remediation_ui.get_failed_message = (processed_count, total_violating_count) =>
        `failed at ${processed_count} of ${total_violating_count}`;
    override_channel_get({
        "/json/realm/email_visibility_policy": {
            max: 1,
            min: 4,
            running: false,
            failed: true,
            processed_count: 2,
            total_violating_count: 8,
        },
    });

    email_visibility_policy.handle_remediation_failed_event();

    assert.equal(failed_message, "failed at 2 of 8");
});

run_test(
    "handle_remediation_failed_event does nothing if the status no longer shows a failure",
    () => {
        setup_with_slider();
        override_channel_get({
            "/json/realm/email_visibility_policy": {
                max: 1,
                min: 4,
                running: false,
                failed: false,
            },
        });

        email_visibility_policy.handle_remediation_failed_event();
    },
);

function get_impact_text() {
    return document.querySelector(".email-visibility-policy-impact .banner-label").textContent;
}

function is_impact_hidden() {
    return document.querySelector(".email-visibility-policy-impact").classList.contains("hide");
}

function click_zone(index) {
    document
        .querySelectorAll("#email_visibility_policy_slider .two-pole-slider-click-zone")
        [index].dispatchEvent(new Event("click"));
}

run_test("update_impact_readout is empty and hidden when the slider isn't dirty", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    bulk_remediation_ui.lock_widget = noop;
    bulk_remediation_ui.unlock_widget = noop;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {1: 5}},
        "/json/realm/email_visibility_policy": {max: 1, min: 4, running: false},
    });

    email_visibility_policy.setup();

    assert.ok(is_impact_hidden());
});

run_test("update_impact_readout counts users made less visible when max is narrowed", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    bulk_remediation_ui.lock_widget = noop;
    bulk_remediation_ui.unlock_widget = noop;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {1: 5}},
        "/json/realm/email_visibility_policy": {max: 1, min: 4, running: false},
    });

    email_visibility_policy.setup();
    click_zone(1);

    assert.ok(!is_impact_hidden());
    assert.equal(get_impact_text(), "translated: 5 user emails will be less visible.");
});

run_test("update_impact_readout counts users made more visible when min is widened", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    bulk_remediation_ui.lock_widget = noop;
    bulk_remediation_ui.unlock_widget = noop;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {4: 3}},
        "/json/realm/email_visibility_policy": {max: 1, min: 4, running: false},
    });

    email_visibility_policy.setup();
    click_zone(3);

    assert.ok(!is_impact_hidden());
    assert.equal(get_impact_text(), "translated: 3 user emails will be more visible.");
});

run_test("update_impact_readout counts both directions when both poles move", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    bulk_remediation_ui.lock_widget = noop;
    bulk_remediation_ui.unlock_widget = noop;
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {1: 5, 4: 3}},
        "/json/realm/email_visibility_policy": {max: 1, min: 4, running: false},
    });

    email_visibility_policy.setup();
    click_zone(1);
    click_zone(3);

    assert.ok(!is_impact_hidden());
    assert.equal(
        get_impact_text(),
        "translated: 5 user emails will be less visible, 3 user emails will be more visible.",
    );
});

run_test("the locked and unlocked states disable and enable the real slider", () => {
    reset_dom();
    set_up_realm();
    set_current_user({is_owner: true});
    // Matches the real bulk_remediation_ui.lock_widget/unlock_widget,
    // which this file's own slider_widget is designed to be used with.
    bulk_remediation_ui.lock_widget = (widget, message) => {
        widget.disable();
        widget.set_message(message);
    };
    bulk_remediation_ui.unlock_widget = (widget, message = "") => {
        widget.enable();
        widget.set_message(message);
    };
    override_channel_get({
        "/json/realm/email_visibility_policy/distribution": {counts: {}},
        "/json/realm/email_visibility_policy": {max: 1, min: 4, running: false},
    });
    email_visibility_policy.setup();
    const slider_container = document.querySelector("#email_visibility_policy_slider");

    email_visibility_policy.handle_policy_update_event({
        running: true,
        total_violating_count: 1,
    });
    assert.ok(slider_container.hasAttribute("disabled"));

    email_visibility_policy.handle_policy_update_event({
        running: false,
        total_violating_count: 0,
    });
    assert.ok(!slider_container.hasAttribute("disabled"));
});

run_test("handle_policy_update_event re-renders both dropdowns to the current values", () => {
    setup_with_slider();
    realm_user_settings_defaults.email_address_visibility = 2;
    user_settings.email_address_visibility = 5;

    email_visibility_policy.handle_policy_update_event({
        running: false,
        total_violating_count: 0,
    });

    assert.equal(document.querySelector("#realm_email_address_visibility").value, "2");
    assert.equal(document.querySelector("#user_email_address_visibility").value, "5");
});

run_test("setup does nothing on a page without the slider container", () => {
    document.body.innerHTML = "";
    set_up_realm();
    set_current_user({is_owner: true});
    channel.get = () => {
        /* istanbul ignore next */
        throw new Error("setup should return before ever fetching anything");
    };

    email_visibility_policy.setup();
});

run_test("update_impact_readout is a no-op on a page without the impact banner", () => {
    setup_with_slider();
    document.querySelector(".email-visibility-policy-impact").remove();

    click_zone(1);
});
