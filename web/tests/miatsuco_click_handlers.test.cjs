"use strict";

const assert = require("node:assert/strict");

const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const compose_reply = mock_esm("../src/compose_reply");
const message_lists = mock_esm("../src/message_lists");
const rows = mock_esm("../src/rows");

const click_handlers = zrequire("miatsuco_click_handlers");

run_test("touch-controls click handler clears selection on outside click", () => {
    click_handlers.initialize();
    const handler = $("body").get_on_handler("click");

    const $selected = $(".selected_msg_for_touchscreen");
    $selected.addClass("selected_msg_for_touchscreen");

    const $outside = $(".outside-element");
    $outside.set_closest_results(".message_row", []);

    handler({target: ".outside-element"});

    assert.ok(!$selected.hasClass("selected_msg_for_touchscreen"));
});

run_test("touch-controls click handler leaves selection alone for a message row click", () => {
    click_handlers.initialize();
    const handler = $("body").get_on_handler("click");

    const $selected = $(".selected_msg_for_touchscreen");
    $selected.addClass("selected_msg_for_touchscreen");

    const $inside = $(".inside-element");
    $inside.set_closest_results(".message_row", $(".message_row"));

    handler({target: ".inside-element"});

    assert.ok($selected.hasClass("selected_msg_for_touchscreen"));
});

run_test("quote_message_button click handler quotes the clicked message", () => {
    click_handlers.initialize();
    const handler = $("body").get_on_handler("click", ".quote_message_button");

    const $button = $(".quote_message_button");
    $button.set_closest_results(".message_row", $(".message_row"));
    rows.id = () => 42;
    message_lists.current = {
        get_row: () => $(".message_row"),
    };

    let quote_opts;
    compose_reply.quote_messages = (opts) => {
        quote_opts = opts;
    };

    let stopped = false;
    handler.call(".quote_message_button", {
        stopPropagation() {
            stopped = true;
        },
    });

    assert.deepEqual(quote_opts, {trigger: "message controls", message_id: 42});
    assert.ok(stopped);
});
