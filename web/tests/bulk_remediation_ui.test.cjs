"use strict";

const assert = require("node:assert/strict");

const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const {lock_widget, unlock_widget, get_running_message, get_failed_message} =
    zrequire("bulk_remediation_ui");

function make_fake_widget() {
    const calls = {disable: 0, enable: 0, messages: []};
    const widget = {
        disable() {
            calls.disable += 1;
        },
        enable() {
            calls.enable += 1;
        },
        set_message(text) {
            calls.messages.push(text);
        },
    };
    return {widget, calls};
}

run_test("lock_widget", () => {
    const {widget, calls} = make_fake_widget();
    lock_widget(widget, "translated: Applying changes: updating 5 users.");
    assert.equal(calls.disable, 1);
    assert.equal(calls.enable, 0);
    assert.deepEqual(calls.messages, ["translated: Applying changes: updating 5 users."]);
});

run_test("unlock_widget", () => {
    const {widget, calls} = make_fake_widget();
    unlock_widget(widget, "translated: Something failed.");
    assert.equal(calls.enable, 1);
    assert.equal(calls.disable, 0);
    assert.deepEqual(calls.messages, ["translated: Something failed."]);
});

run_test("unlock_widget default message", () => {
    const {widget, calls} = make_fake_widget();
    unlock_widget(widget);
    assert.deepEqual(calls.messages, [""]);
});

run_test("get_running_message", () => {
    assert.equal(get_running_message(5), "translated: Applying changes: updating 5 users.");
    assert.equal(get_running_message(0), "translated: Applying changes: updating 0 users.");
});

run_test("get_failed_message", () => {
    assert.equal(
        get_failed_message(3, 10),
        "translated: The last change encountered an error after updating 3 of 10 users. Applying a new change will retry the remaining users.",
    );
});
