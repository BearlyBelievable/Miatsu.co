"use strict";

const assert = require("node:assert/strict");

const {JSDOM} = require("jsdom");

const message_card_embed_test_cases = require("../../zerver/tests/fixtures/miatsuco_message_card_embed_test_cases.json");

const {$t} = require("./lib/i18n.cjs");
const {clock, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const {initialize_user_settings} = zrequire("user_settings");

const user_settings = {};
initialize_user_settings({user_settings});

const miatsuco_message_card_embed = zrequire("miatsuco_message_card_embed");

let unique_id = 0;
function format_timestamp(datetime) {
    unique_id += 1;
    const $content = $.create(`content-stub-${unique_id}`);
    const $time = $.create(`time-element-${unique_id}`);
    if (datetime !== undefined) {
        $time.attr("datetime", datetime);
    }
    $content.set_find_results(".message-card-embed-timestamp", $time);
    miatsuco_message_card_embed.enhance_message_card_embed_timestamps($content);
    return $time.text();
}

run_test("formats recent timestamps relative to now", () => {
    const base_date = new Date(2016, 2, 1, 0, 30);
    clock.setSystemTime(base_date.getTime());

    assert.equal(format_timestamp(base_date.toISOString()), $t({defaultMessage: "Now"}));
    assert.equal(
        format_timestamp(new Date(base_date.getTime() - 30 * 60 * 1000).toISOString()),
        $t({defaultMessage: "{minutes}m"}, {minutes: 30}),
    );
    assert.equal(
        format_timestamp(new Date(base_date.getTime() - 60 * 60 * 1000).toISOString()),
        $t({defaultMessage: "{hours}h"}, {hours: 1}),
    );
    assert.equal(
        format_timestamp(new Date(base_date.getTime() - 23 * 60 * 60 * 1000).toISOString()),
        $t({defaultMessage: "{hours}h"}, {hours: 23}),
    );

    clock.reset();
});

run_test("switches to an absolute date after 24 hours", () => {
    const base_date = new Date(2016, 2, 1, 0, 30);
    clock.setSystemTime(base_date.getTime());

    assert.equal(
        format_timestamp(new Date(base_date.getTime() - 24 * 60 * 60 * 1000).toISOString()),
        "Feb 29",
    );
    assert.equal(format_timestamp("2015-03-01T00:30:00.000Z"), "Mar 1, 2015");

    clock.reset();
});

run_test("leaves elements with no usable datetime untouched", () => {
    assert.equal(format_timestamp(undefined), "never-been-set");
    assert.equal(format_timestamp("not a date"), "never-been-set");
});

run_test("enhances every payload shape in the shared contract fixture", () => {
    const {window} = new JSDOM("");
    for (const test_case of message_card_embed_test_cases) {
        const message_embed = window.document.createElement("div");
        miatsuco_message_card_embed.enhance_message_card_embed(
            window.document,
            message_embed,
            JSON.stringify(test_case.expected_payload),
        );
        assert.ok(
            message_embed.classList.contains("message-card-embed"),
            `${test_case.name} should enhance successfully`,
        );
    }
});
