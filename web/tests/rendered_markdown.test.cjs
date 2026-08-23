"use strict";

const assert = require("node:assert/strict");

const {make_user_group} = require("./lib/example_group.cjs");
const {make_realm} = require("./lib/example_realm.cjs");
const {make_stream} = require("./lib/example_stream.cjs");
const {make_user, Role} = require("./lib/example_user.cjs");
const {$t} = require("./lib/i18n.cjs");
const {mock_cjs, mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const blueslip = require("./lib/zblueslip.cjs");
const $ = require("./lib/zjquery.cjs");

const message_store = zrequire("message_store");

let clipboard_args;
class Clipboard {
    constructor(...args) {
        clipboard_args = args;
    }
    on(_success, show_copied_confirmation) {
        show_copied_confirmation();
    }
}

mock_cjs("clipboard", Clipboard);

const realm_playground = mock_esm("../src/realm_playground");
const copied_tooltip = mock_esm("../src/copied_tooltip");

const alert_words = zrequire("alert_words");
const rm = zrequire("rendered_markdown");
const people = zrequire("people");
const user_groups = zrequire("user_groups");
const stream_data = zrequire("stream_data");
const rows = mock_esm("../src/rows");
mock_esm("../src/settings_data", {
    user_can_access_all_other_users: () => false,
});
const {set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");

const REALM_EMPTY_TOPIC_DISPLAY_NAME = "general chat";
const realm = make_realm({realm_empty_topic_display_name: REALM_EMPTY_TOPIC_DISPLAY_NAME});
set_realm(realm);
const user_settings = {};
initialize_user_settings({user_settings});

const iago = make_user({
    email: "iago@zulip.com",
    user_id: 30,
    full_name: "Iago",
});

const cordelia = make_user({
    email: "cordelia@zulip.com",
    user_id: 31,
    full_name: "Cordelia Lear",
});

const polonius = make_user({
    email: "polonius@zulip.com",
    user_id: 32,
    full_name: "Polonius",
    role: Role.GUEST,
});
const inaccessible_user_id = 33;
const inaccessible_user = people.add_inaccessible_user(inaccessible_user_id);
people.init();
people.add_active_user(iago);
people.add_active_user(cordelia);
people.add_active_user(polonius);
people.initialize_current_user(iago.user_id);

const group_me = make_user_group({
    name: "my user group",
    id: 1,
    members: [iago.user_id, cordelia.user_id],
});
const group_other = make_user_group({
    name: "other user group",
    id: 2,
    members: [cordelia.user_id],
});
const group_me_via_subgroup = make_user_group({
    name: "I am part of this group via a subgroup",
    id: 3,
    members: [],
    direct_subgroup_ids: [group_me.id],
});
user_groups.initialize({
    realm_user_groups: [group_me, group_other, group_me_via_subgroup],
});

const stream = make_stream({
    subscribed: true,
    color: "yellow",
    name: "test",
    stream_id: 3,
    is_muted: true,
    invite_only: false,
});
stream_data.add_sub_for_tests(stream);

function set_message_for_message_content($content, value) {
    // no message row found
    if (value === undefined) {
        $content.set_closest_results(".message_row", []);
        return;
    }
    // message row found
    const $message_row = $.create(".message-row");
    $content.set_closest_results(".message_row", $message_row);
    $message_row.set_closest_results(".overlay-message-row", []);
    const message_id = 100;
    rows.id = ($message_row_) => {
        assert.equal($message_row_[0], $message_row[0]);
        return message_id;
    };
    message_store.update_message_cache({
        message: {
            id: message_id,
            ...value,
        },
    });
}

const get_content_element = () => {
    const $content = $.create("content-stub");
    $content.set_find_results(".user-mention", []);
    $content.set_find_results(".topic-mention", []);
    $content.set_find_results(".user-group-mention", []);
    $content.set_find_results("a.stream", []);
    $content.set_find_results("a.stream-topic, a.message-link", []);
    $content.set_find_results("time", []);
    $content.set_find_results("span.timestamp-error", []);
    $content.set_find_results(".emoji", []);
    $content.set_find_results("div.spoiler-header", []);
    $content.set_find_results("div.codehilite", []);
    $content.set_find_results(".message_inline_video video", []);
    $content.set_find_results(".message_inline_video", []);
    $content.set_find_results(".media-audio-element", []);
    $content.set_find_results("audio", []);
    $content.set_find_results(".youtube-video, .embed-video, .embed-rich", []);

    set_message_for_message_content($content, undefined);

    // Fend off dumb security bugs by forcing devs to be
    // intentional about HTML manipulation.
    /* istanbul ignore next */
    function security_violation() {
        throw new Error(`
            Be super careful about HTML manipulation.

            Make sure your test objects set up their own
            functions to validate that calls to html/prepend/append
            use trusted values.
        `);
    }
    Object.defineProperty($content[0], "innerHTML", {
        get: security_violation,
        set: security_violation,
    });
    return $content;
};

run_test("misc_helpers", ({override}) => {
    const $elem = $.create("user-mention");
    rm.set_name_in_mention_element($elem, "Aaron");
    assert.equal($elem.text(), "@Aaron");
    $elem.addClass("silent");
    rm.set_name_in_mention_element($elem, "Aaron, but silent");
    assert.equal($elem.text(), "Aaron, but silent");

    override(realm, "realm_enable_guest_user_indicator", true);
    rm.set_name_in_mention_element($elem, "Polonius", polonius.user_id);
    assert.equal($elem.text(), "translated: Polonius (guest)");

    override(realm, "realm_enable_guest_user_indicator", false);
    rm.set_name_in_mention_element($elem, "Polonius", polonius.user_id);
    assert.equal($elem.text(), "Polonius");
});

run_test("message_inline_video", () => {
    const $content = get_content_element();
    const $elem = $.create("message_inline_video");

    let load_called = false;
    $elem[0].load = () => {
        load_called = true;
    };

    $content.set_find_results(".message_inline_video video", $elem);

    assert.equal(window.GestureEvent, undefined);
    window.GestureEvent = true;
    rm.update_elements($content);
    assert.equal(load_called, true);
    // Delete so "GestureEvent" in window — and thus is_client_safari() —
    // returns false for other tests.
    delete window.GestureEvent;
});

run_test("message_inline_video_unsupported_format", () => {
    const $content = get_content_element();
    const $video = $.create("video_element");
    const $video_container = $.create("message_inline_video_container");

    $video.set_closest_results(".message_inline_video", $video_container);
    $content.set_find_results(".message_inline_video video", $video);

    rm.update_elements($content);

    // Without a playback error, the preview container is not hidden.
    assert.ok(!$video_container.hasClass("video-format-unsupported"));

    // Simulate video error (browser cannot play the format).
    $video.trigger("error");

    assert.ok($video_container.hasClass("video-format-unsupported"));
});

run_test("message_inline_video_unsupported_format_after_fork_enhance", () => {
    // The fork turns inline video previews into real players (adds controls,
    // the playable marker class). This must not disturb upstream's fallback:
    // if playback then fails, the error handler should still hide the broken
    // player via video-format-unsupported (CSS display:none), leaving the
    // download link. Exercise both on the same element: enhance runs from
    // update_elements, then a media error must still add the fallback class.
    const $content = get_content_element();
    const $video = $.create("video_element");
    const $video_container = $.create("message_inline_video_container");
    const $anchor = $.create("anchor_element");

    // Wire the upstream error handler (matches ".message_inline_video video")
    // and the fork enhancer (matches ".message_inline_video" containers) onto
    // the same elements.
    $video.set_closest_results(".message_inline_video", $video_container);
    $content.set_find_results(".message_inline_video video", $video);
    $content.set_find_results(".message_inline_video", $video_container);
    $video_container.set_find_results("video", $video);
    $video_container.set_find_results("a", $anchor);
    // The container is playable enough to be enhanced (a non-empty
    // canPlayType), so the fork turns it into a player; the error only comes
    // later, at playback time.
    $video.attr("src", "https://example.com/uploads/clip.webm");
    $video[0].canPlayType = () => "probably";

    rm.update_elements($content);

    // The fork enhancement ran: the preview is now a marked player.
    assert.equal($video_container.attr("data-miatsuco-inline-video"), "1");
    assert.equal($video.attr("controls"), "true");
    assert.ok($video_container.hasClass("miatsuco-inline-video-playable"));

    // A later playback failure still triggers the fallback: the container is
    // marked unsupported so the broken player is hidden and the download link
    // remains reachable.
    assert.ok(!$video_container.hasClass("video-format-unsupported"));
    $video.trigger("error");
    assert.ok($video_container.hasClass("video-format-unsupported"));
});

run_test("user-mention", ({override}) => {
    // Setup
    const $content = get_content_element();
    const $iago = $.create("user-mention(iago)");
    $iago.set_find_results(".highlight", []);
    $iago.attr("data-user-id", iago.user_id);
    const $cordelia = $.create("user-mention(cordelia)");
    $cordelia.set_find_results(".highlight", []);
    $cordelia.attr("data-user-id", cordelia.user_id);
    const $polonius = $.create("user-mention(polonius)");
    $polonius.set_find_results(".highlight", []);
    $polonius.attr("data-user-id", polonius.user_id);
    $content.set_find_results(".user-mention", [$iago[0], $cordelia[0], $polonius[0]]);
    override(realm, "realm_enable_guest_user_indicator", true);
    // Initial asserts
    assert.ok(!$iago.hasClass("user-mention-me"));
    assert.equal($iago.text(), "never-been-set");
    assert.equal($cordelia.text(), "never-been-set");
    assert.equal($polonius.text(), "never-been-set");

    rm.update_elements($content);
    assert.ok(!$iago.hasClass("user-mention-me"));
    assert.equal($iago.text(), `@${iago.full_name}`);
    assert.equal($cordelia.text(), `@${cordelia.full_name}`);
    assert.equal($polonius.text(), `translated: @${polonius.full_name} (guest)`);

    const message = {mentioned_me_directly: true};
    set_message_for_message_content($content, message);
    rm.update_elements($content);
    assert.ok($iago.hasClass("user-mention-me"));

    // Silent mentions should also have the `user-mention-me` class.
    $iago.removeClass("user-mention-me");
    message.mentioned_me_directly = false;
    rm.update_elements($content);
    assert.ok($iago.hasClass("user-mention-me"));
});

run_test("user-mention without guest indicator", ({override}) => {
    const $content = get_content_element();
    const $polonius = $.create("user-mention(polonius-again)");
    $polonius.set_find_results(".highlight", []);
    $polonius.attr("data-user-id", polonius.user_id);
    $content.set_find_results(".user-mention", $polonius);

    override(realm, "realm_enable_guest_user_indicator", false);
    rm.update_elements($content);
    assert.equal($polonius.text(), `@${polonius.full_name}`);
});

run_test("user-mention of inaccessible users", () => {
    const $content = get_content_element();
    const $othello = $.create("user-mention(othello)");
    $othello.set_find_results(".highlight", []);
    $othello.attr("data-user-id", inaccessible_user_id);
    $othello.text("@Othello");
    $content.set_find_results(".user-mention", $othello);

    rm.update_elements($content);
    assert.equal($othello.text(), "@Othello");
    assert.notEqual($othello.text(), `@${inaccessible_user.full_name}`);

    // Test inaccessible user id with no user object.
    const $cordelia = $.create("user-mention(cordelia)");
    $cordelia.set_find_results(".highlight", []);
    $cordelia.attr("data-user-id", 40);
    $cordelia.text("@Cordelia");
    $content.set_find_results(".user-mention", $cordelia);

    rm.update_elements($content);
    assert.equal($cordelia.text(), "@Cordelia");
});

run_test("user-mention (stream wildcard)", () => {
    // Setup
    const $content = get_content_element();
    const $mention = $.create("mention");
    $mention.attr("data-user-id", "*");
    $content.set_find_results(".user-mention", $mention);
    const message = {stream_wildcard_mentioned: true};
    set_message_for_message_content($content, message);

    assert.ok(!$mention.hasClass("user-mention-me"));
    rm.update_elements($content);
    assert.ok($mention.hasClass("user-mention-me"));
});

run_test("user-mention (email)", () => {
    // Setup
    const $content = get_content_element();
    const $mention = $.create("mention");
    $mention.attr("data-user-email", cordelia.email);
    $mention.set_find_results(".highlight", []);
    $content.set_find_results(".user-mention", $mention);

    rm.update_elements($content);
    assert.ok(!$mention.hasClass("user-mention-me"));
    assert.equal($mention.text(), "@Cordelia Lear");
});

run_test("user-mention (missing)", () => {
    const $content = get_content_element();
    const $mention = $.create("mention");
    $content.set_find_results(".user-mention", $mention);

    rm.update_elements($content);
    assert.ok(!$mention.hasClass("user-mention-me"));
});

run_test("topic-mention", () => {
    // Setup
    const $content = get_content_element();
    const $mention = $.create("mention");
    $content.set_find_results(".topic-mention", $mention);

    // when no message row found
    assert.ok(!$mention.hasClass("user-mention-me"));
    rm.update_elements($content);
    assert.ok(!$mention.hasClass("user-mention-me"));

    // message row found
    const message = {
        topic_wildcard_mentioned: true,
    };
    set_message_for_message_content($content, message);

    assert.ok(!$mention.hasClass("user-mention-me"));
    rm.update_elements($content);
    assert.ok($mention.hasClass("user-mention-me"));
});

run_test("topic-mention not topic participant", () => {
    // Setup
    const $content = get_content_element();
    const $mention = $.create("mention");
    $content.set_find_results(".topic-mention", $mention);

    const message = {
        topic_wildcard_mentioned: false,
    };
    set_message_for_message_content($content, message);

    assert.ok(!$mention.hasClass("user-mention-me"));
    rm.update_elements($content);
    assert.ok(!$mention.hasClass("user-mention-me"));
});

run_test("user-group-mention", () => {
    // Setup
    const $content = get_content_element();
    const $group_me = $.create("user-group-mention(me)");
    $group_me.set_find_results(".highlight", []);
    $group_me.attr("data-user-group-id", group_me.id);
    const $group_other = $.create("user-group-mention(other)");
    $group_other.set_find_results(".highlight", []);
    $group_other.attr("data-user-group-id", group_other.id);
    $content.set_find_results(".user-group-mention", [$group_me[0], $group_other[0]]);

    // Initial asserts
    assert.ok(!$group_me.hasClass("user-mention-me"));
    assert.equal($group_me.text(), "never-been-set");
    assert.equal($group_other.text(), "never-been-set");

    rm.update_elements($content);

    // Final asserts
    assert.ok($group_me.hasClass("user-mention-me"));
    assert.equal($group_me.text(), `@${group_me.name}`);
    assert.equal($group_other.text(), `@${group_other.name}`);
});

run_test("user-group-mention", () => {
    // Setup
    const $content = get_content_element();
    const $group_me_via_subgroup = $.create("user-group-mention(me_via_subgroup)");
    $group_me_via_subgroup.set_find_results(".highlight", []);
    $group_me_via_subgroup.attr("data-user-group-id", group_me_via_subgroup.id);
    const $group_other = $.create("user-group-mention(other)");
    $group_other.set_find_results(".highlight", []);
    $group_other.attr("data-user-group-id", group_other.id);
    $content.set_find_results(".user-group-mention", [$group_me_via_subgroup[0], $group_other[0]]);

    // Initial asserts
    assert.ok(!$group_me_via_subgroup.hasClass("user-mention-me"));
    assert.equal($group_me_via_subgroup.text(), "never-been-set");
    assert.equal($group_other.text(), "never-been-set");

    rm.update_elements($content);

    // Final asserts
    assert.ok($group_me_via_subgroup.hasClass("user-mention-me"));
    assert.equal($group_me_via_subgroup.text(), `@${group_me_via_subgroup.name}`);
    assert.equal($group_other.text(), `@${group_other.name}`);
});

run_test("user-group-mention (error)", () => {
    const $content = get_content_element();
    const $group = $.create("user-group-mention(bogus)");
    $group.attr("data-user-group-id", "not-even-a-number");
    $content.set_find_results(".user-group-mention", $group);

    rm.update_elements($content);

    assert.ok(!$group.hasClass("user-mention-me"));
});

run_test("stream-links", ({mock_template}) => {
    // Setup
    const $content = get_content_element();
    const $stream = $.create("a.stream");
    $stream.set_find_results(".highlight", []);
    $stream.attr("data-stream-id", stream.stream_id);

    const $stream_topic = $.create("a.stream-topic");
    $stream_topic.set_find_results(".highlight", []);
    $stream_topic.attr(
        "href",
        `/#narrow/channel/${stream.stream_id}-random/topic/topic.20name.20.3E.20still.20the.20topic.20name`,
    );
    $stream_topic[0].replaceWith = noop;
    $stream_topic.addClass("stream-topic");
    $stream_topic.text("#random > topic name > still the topic name");

    $content.set_find_results("a.stream", $stream);
    $content.set_find_results("a.stream-topic, a.message-link", $stream_topic);

    let stream_name_context;
    mock_template("decorated_channel_name.hbs", true, (data, html) => {
        stream_name_context = data;
        return html;
    });

    let topic_link_context;
    let topic_link_rendered_html;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        topic_link_rendered_html = html;
        return html;
    });

    // Initial asserts
    assert.equal($stream.text(), "never-been-set");
    assert.equal($stream_topic.text(), "#random > topic name > still the topic name");

    rm.update_elements($content);

    // Verify decorated_channel_name was called with the correct stream.
    assert.ok(stream_name_context, "decorated_channel_name should be called");
    assert.equal(stream_name_context.stream.stream_id, stream.stream_id);
    assert.equal(stream_name_context.stream.name, stream.name);

    assert.deepEqual(topic_link_context, {
        channel_id: stream.stream_id,
        stream,
        channel_name: stream.name,
        topic_display_name_html: "topic name &gt; still the topic name",
        is_empty_string_topic: false,
        href: `/#narrow/channel/${stream.stream_id}-random/topic/topic.20name.20.3E.20still.20the.20topic.20name`,
    });
    assert.ok(!topic_link_rendered_html.includes("empty-topic-display"));
});

run_test("stream-links alert words", ({mock_template}) => {
    // Setup
    const $content = get_content_element();
    const $stream = $.create("a.stream");
    $stream.set_find_results(".highlight", []);
    $stream.attr("data-stream-id", stream.stream_id);

    const $stream_topic = $.create("a.stream-topic");
    $stream_topic.set_find_results(".highlight", []);
    $stream_topic.attr(
        "href",
        `/#narrow/channel/${stream.stream_id}-test/topic/important.20alert.20topic`,
    );

    $stream_topic[0].replaceWith = noop;
    $stream_topic.addClass("stream-topic");
    $stream_topic.text("#test alert > important alert topic");

    $content.set_find_results("a.stream", $stream);
    $content.set_find_results("a.stream-topic, a.message-link", $stream_topic);

    let stream_name_context;
    mock_template("decorated_channel_name.hbs", true, (data, html) => {
        stream_name_context = data;
        return html;
    });

    let topic_link_context;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        return html;
    });

    const message = {alerted: true};
    set_message_for_message_content($content, message);
    alert_words.set_words(["alert"]);

    rm.update_elements($content);

    // Verify decorated_channel_name was called with the correct stream.
    assert.ok(stream_name_context, "decorated_channel_name should be called");
    assert.equal(stream_name_context.stream.stream_id, stream.stream_id);
    assert.equal(stream_name_context.stream.name, stream.name);

    assert.deepEqual(topic_link_context, {
        channel_id: stream.stream_id,
        stream,
        channel_name: stream.name,
        topic_display_name_html: "important <span class='alert-word'>alert</span> topic",
        is_empty_string_topic: false,
        href: `/#narrow/channel/${stream.stream_id}-test/topic/important.20alert.20topic`,
    });

    alert_words.set_words([]);
});

run_test("message-link alert words", ({mock_template}) => {
    // Setup
    const $content = get_content_element();
    const $message_link = $.create("a.message-link(alert)");
    $message_link.set_find_results(".highlight", []);
    $message_link.attr("href", `/#narrow/channel/${stream.stream_id}-random/topic/alert/near/123`);
    $message_link.addClass("message-link");
    $message_link[0].replaceWith = noop;
    $content.set_find_results("a.stream-topic, a.message-link", $message_link);

    let channel_message_link_context;
    mock_template("channel_message_link.hbs", true, (data, html) => {
        channel_message_link_context = data;
        return html;
    });

    const message = {alerted: true};
    set_message_for_message_content($content, message);
    alert_words.set_words(["alert"]);

    rm.update_elements($content);

    assert.deepEqual(channel_message_link_context, {
        channel_name: stream.name,
        topic_display_name_html: "<span class='alert-word'>alert</span>",
        is_empty_string_topic: false,
        href: `/#narrow/channel/${stream.stream_id}-random/topic/alert/near/123`,
        stream,
    });

    alert_words.set_words([]);
});

run_test("topic-link (empty string topic)", ({mock_template}) => {
    // Setup
    const $content = get_content_element();
    const $channel_topic = $.create("a.stream-topic(empty-string-topic)");
    $channel_topic.set_find_results(".highlight", []);
    $channel_topic.attr("href", `/#narrow/channel/${stream.stream_id}-random/topic/`);
    $channel_topic[0].replaceWith = noop;
    $channel_topic.addClass("stream-topic");
    $channel_topic.html(`#random &gt; <em>${REALM_EMPTY_TOPIC_DISPLAY_NAME}</em>`);
    $content.set_find_results("a.stream-topic, a.message-link", $channel_topic);

    let topic_link_context;
    let topic_link_rendered_html;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        topic_link_rendered_html = html;
        return html;
    });

    // Initial assert
    assert.equal($channel_topic.html(), "#random &gt; <em>general chat</em>");

    rm.update_elements($content);

    // Final assert
    assert.deepEqual(topic_link_context, {
        channel_id: stream.stream_id,
        stream,
        channel_name: stream.name,
        topic_display_name_html: `translated: ${REALM_EMPTY_TOPIC_DISPLAY_NAME}`,
        is_empty_string_topic: true,
        href: `/#narrow/channel/${stream.stream_id}-random/topic/`,
    });
    assert.ok(topic_link_rendered_html.includes("empty-topic-display"));
});

run_test("message-links", ({mock_template}) => {
    // Setup
    const $content = get_content_element();
    const $channel_topic_message = $.create("a.message-link");
    $channel_topic_message.set_find_results(".highlight", []);
    $channel_topic_message.attr(
        "href",
        `/#narrow/channel/${stream.stream_id}-${stream.name}/topic//near/123`,
    );
    $channel_topic_message[0].replaceWith = noop;
    $channel_topic_message.addClass("message-link");
    $channel_topic_message.html(
        `#${stream.name} &gt; <em>${REALM_EMPTY_TOPIC_DISPLAY_NAME}</em> @ 💬`,
    );
    $content.set_find_results("a.stream-topic, a.message-link", $channel_topic_message);

    let channel_message_link_context;
    let channel_message_link_rendered_html;
    mock_template("channel_message_link.hbs", true, (data, html) => {
        channel_message_link_context = data;
        channel_message_link_rendered_html = html;
        return html;
    });

    // Initial assert
    assert.equal($channel_topic_message.html(), "#test &gt; <em>general chat</em> @ 💬");

    rm.update_elements($content);

    // Final asserts
    assert.deepEqual(channel_message_link_context, {
        channel_name: stream.name,
        topic_display_name_html: `translated: ${REALM_EMPTY_TOPIC_DISPLAY_NAME}`,
        is_empty_string_topic: true,
        href: `/#narrow/channel/${stream.stream_id}-test/topic//near/123`,
        stream,
    });
    assert.ok(channel_message_link_rendered_html.includes("empty-topic-display"));
});

run_test("timestamp without time", () => {
    const $content = get_content_element();
    const $timestamp = $.create("timestamp without actual time");
    $content.set_find_results("time", $timestamp);

    rm.update_elements($content);
    assert.equal($timestamp.text(), "never-been-set");
});

run_test("audio", ({mock_template}) => {
    const audio_src = "http://zulip.zulipdev.com/user_uploads/w/ha/tever/inline.mp3";
    const audio_title = "inline.mp3";

    const $content = get_content_element();
    const $audio = $.create("audio");
    $audio[0].replaceWith = noop;
    $audio.attr("src", audio_src);
    $audio.attr("title", audio_title);

    $content.set_find_results("audio", $audio);

    let audio_html;
    mock_template("markdown_audio.hbs", true, (data, html) => {
        assert.deepEqual(data, {audio_src, audio_title});
        audio_html = html;
        return html;
    });

    rm.update_elements($content);

    assert.equal(
        audio_html,
        '<span class="media-audio-wrapper">\n' +
            '    <span class="miatsuco-media-audio-filename">inline.mp3</span>\n' +
            '    <span class="miatsuco-media-audio-controls-row">\n' +
            '        <audio controls="" preload="metadata" src="http://zulip.zulipdev.com/user_uploads/w/ha/tever/inline.mp3" title="inline.mp3" class="media-audio-element"></audio>\n' +
            '        <a class="media-audio-download icon-button icon-button-square icon-button-neutral"\n' +
            '          aria-label="translated: Download" href="http://zulip.zulipdev.com/user_uploads/w/ha/tever/inline.mp3" download>\n' +
            '            <i class="media-download-icon zulip-icon zulip-icon-download"></i>\n' +
            "        </a>\n" +
            "    </span>\n" +
            "</span>",
    );
});

run_test("audio without title derives filename from URL", ({mock_template}) => {
    // Hand-written ![](url) markdown can omit the title; the filename is
    // then derived (and percent-decoded) from the last URL segment.
    const audio_src = "http://zulip.zulipdev.com/user_uploads/w/ha/tever/my%20clip.mp3";

    const $content = get_content_element();
    const $audio = $.create("audio");
    $audio[0].replaceWith = noop;
    $audio.attr("src", audio_src);

    $content.set_find_results("audio", $audio);

    let template_data;
    mock_template("markdown_audio.hbs", true, (data, html) => {
        template_data = data;
        return html;
    });

    rm.update_elements($content);

    assert.deepEqual(template_data, {audio_src, audio_title: "my clip.mp3"});
});

run_test("audio with malformed URL keeps raw filename", ({mock_template}) => {
    // A malformed percent-encoding makes decodeURIComponent throw; the raw
    // last segment is used as-is rather than failing.
    const audio_src = "http://zulip.zulipdev.com/user_uploads/w/ha/tever/bad%E0%A4.mp3";

    const $content = get_content_element();
    const $audio = $.create("audio");
    $audio[0].replaceWith = noop;
    $audio.attr("src", audio_src);

    $content.set_find_results("audio", $audio);

    let template_data;
    mock_template("markdown_audio.hbs", true, (data, html) => {
        template_data = data;
        return html;
    });

    rm.update_elements($content);

    assert.deepEqual(template_data, {audio_src, audio_title: "bad%E0%A4.mp3"});
});

run_test("audio error hides the player", () => {
    const $content = get_content_element();
    const $audio = $.create("audio-element");
    $content.set_find_results(".media-audio-element", $audio);

    rm.update_elements($content);

    // Without an error, the player is not hidden.
    assert.ok(!$audio.hasClass("miatsuco-audio-format-unsupported"));

    // Simulate a decode error (e.g. Safari with an Ogg file).
    const error_handler = $audio.get_on_handler("error");
    error_handler();
    assert.ok($audio.hasClass("miatsuco-audio-format-unsupported"));
});

run_test("audio already enhanced is not replaced again", () => {
    // A second update_elements pass on already-transformed content must not
    // re-replace the audio, which would destroy a playing element and stop
    // playback. Enhanced audio carries the media-audio-element class (raw
    // server audio does not), so it is skipped and the template that would
    // rebuild it is never rendered.
    const $content = get_content_element();
    const $audio = $.create("audio");
    $audio.addClass("media-audio-element");
    // Deliberately do not stub replaceWith: if the guard failed and the code
    // tried to rebuild this element, the mock would throw on the unknown
    // property and fail the test.
    $content.set_find_results("audio", $audio);

    rm.update_elements($content);

    // Still the original element (not replaced), so playback would survive.
    assert.ok($audio.hasClass("media-audio-element"));
});

run_test("timestamp", ({mock_template}) => {
    mock_template("markdown_timestamp.hbs", true, (data, html) => {
        assert.deepEqual(data, {text: "Thu, Jan 1, 1970, 12:00 AM"});
        return html;
    });

    // Setup
    const $content = get_content_element();
    const $timestamp = $.create("timestamp(valid)");
    $timestamp.attr("datetime", "1970-01-01T00:00:01Z");
    const $timestamp_invalid = $.create("timestamp(invalid)");
    $timestamp_invalid.attr("datetime", "invalid");
    $content.set_find_results("time", [$timestamp[0], $timestamp_invalid[0]]);
    blueslip.expect("error", "Could not parse datetime supplied by backend");

    // Initial asserts
    assert.equal($timestamp.text(), "never-been-set");
    assert.equal($timestamp_invalid.text(), "never-been-set");

    rm.update_elements($content);

    // Final asserts
    assert.equal(
        $timestamp.html(),
        '<span class="timestamp-content-wrapper">\n    <i class="zulip-icon zulip-icon-clock markdown-timestamp-icon"></i>Thu, Jan 1, 1970, 12:00 AM</span>',
    );
    assert.equal($timestamp_invalid.text(), "never-been-set");
});

run_test("timestamp-twenty-four-hour-time", ({mock_template, override}) => {
    mock_template("markdown_timestamp.hbs", true, (data, html) => {
        // sanity check incoming data
        assert.ok(data.text.startsWith("Wed, Jul 15, 2020, "));
        return html;
    });

    const $content = get_content_element();
    const $timestamp = $.create("timestamp");
    $timestamp.attr("datetime", "2020-07-15T20:40:00Z");
    $content.set_find_results("time", $timestamp);

    // We will temporarily change the 24h setting for this test.
    override(user_settings, "twenty_four_hour_time", true);
    rm.update_elements($content);
    assert.equal(
        $timestamp.html(),
        '<span class="timestamp-content-wrapper">\n    <i class="zulip-icon zulip-icon-clock markdown-timestamp-icon"></i>Wed, Jul 15, 2020, 20:40</span>',
    );

    override(user_settings, "twenty_four_hour_time", false);
    rm.update_elements($content);
    assert.equal(
        $timestamp.html(),
        '<span class="timestamp-content-wrapper">\n    <i class="zulip-icon zulip-icon-clock markdown-timestamp-icon"></i>Wed, Jul 15, 2020, 8:40 PM</span>',
    );
});

run_test("timestamp-error", () => {
    // Setup
    const $content = get_content_element();
    const $timestamp_error = $.create("timestamp-error");
    $timestamp_error.text("Invalid time format: the-time-format");
    $content.set_find_results("span.timestamp-error", $timestamp_error);

    // Initial assert
    assert.equal($timestamp_error.text(), "Invalid time format: the-time-format");

    rm.update_elements($content);

    // Final assert
    assert.equal($timestamp_error.text(), "translated: Invalid time format: the-time-format");
});

run_test("emoji", ({override}) => {
    // Setup
    const $content = get_content_element();
    const $emoji = $.create("emoji-stub");
    $emoji.attr("title", "tada");
    $emoji.set_contents([]);
    $content.set_find_results(".emoji", $emoji);
    override(user_settings, "emojiset", "text");

    rm.update_elements($content);

    assert.equal($emoji.text(), ":tada:");

    // Set page parameters back so that test run order is independent
    override(user_settings, "emojiset", "apple");
});

run_test("spoiler-header", () => {
    // Setup
    const $content = get_content_element();
    const $header = $.create("div.spoiler-header");
    $content.set_find_results("div.spoiler-header", $header);
    let appended;
    $header[0].append = (element) => {
        appended = element;
    };

    // Test that the show/hide button gets added to a spoiler header.
    const label = "My spoiler header";
    const toggle_button_html =
        '<span class="spoiler-button" aria-expanded="false"><span class="spoiler-arrow"></span></span>';
    $header.html(label);
    $header.set_find_results("p", $.create("p"));
    rm.update_elements($content);
    assert.equal(label, $header.html());
    assert.equal(appended.innerHTML, toggle_button_html);
});

run_test("spoiler-header-empty-fill", () => {
    // Setup
    const $content = get_content_element();
    const $header = $.create("div.spoiler-header");
    $content.set_find_results("div.spoiler-header", $header);
    const appended = [];
    $header[0].append = (element) => {
        appended.push(element);
    };

    // Test that an empty header gets the default text applied (through i18n filter).
    const toggle_button_html =
        '<span class="spoiler-button" aria-expanded="false"><span class="spoiler-arrow"></span></span>';
    $header.empty();
    $header.set_find_results("p", $.create("p"));
    rm.update_elements($content);
    assert.equal(appended[0].innerHTML, "<p>");
    assert.equal(appended[0].textContent, $t({defaultMessage: "Spoiler"}));
    assert.equal(appended[1].innerHTML, toggle_button_html);
});

function assert_clipboard_setup() {
    assert.equal(clipboard_args[0], $("<copy-code-button-stub>")[0]);
    const text = clipboard_args[1].text({
        to_$: () => ({
            parent: () => ({
                siblings(arg) {
                    assert.equal(arg, "code");
                    return {
                        text: () => "text",
                    };
                },
            }),
        }),
    });
    assert.equal(text, "text");
}

function test_code_playground(mock_template, viewing_code) {
    const $content = get_content_element();
    const $hilite = $.create("div.codehilite");
    const $pre = $.create("hilite-pre");
    $content.set_find_results("div.codehilite", $hilite);
    $hilite.set_find_results("pre", $pre);

    $hilite.attr("data-code-language", "javascript");

    const $code_buttons_container = $("<code-buttons-container-stub>");
    const $copy_code_button = $("<copy-code-button-stub>");
    const $view_code_in_playground = $.create("view_code_in_playground");

    $code_buttons_container.set_find_results(".copy_codeblock", $copy_code_button);
    $code_buttons_container.set_find_results(".code_external_link", $view_code_in_playground);

    // The code playground code prepends a button container
    // to the <pre> section of a highlighted piece of code.
    // The args to prepend should be jQuery objects (or in
    // our case "fake" zjquery objects).
    const prepends = [];
    $pre[0].prepend = (arg) => {
        prepends.push(arg);
    };

    if (viewing_code) {
        mock_template("code_buttons_container.hbs", true, (data) => {
            assert.equal(data.show_playground_button, true);
            return "<code-buttons-container-stub>";
        });
    } else {
        mock_template("code_buttons_container.hbs", true, (data) => {
            assert.equal(data.show_playground_button, false);
            return "<code-buttons-container-stub>";
        });
    }

    rm.update_elements($content);

    return {
        prepends,
        $button_container: $code_buttons_container,
        $copy_code: $copy_code_button,
        $view_code: $view_code_in_playground,
    };
}

run_test("code playground none", ({override, mock_template}) => {
    override(realm_playground, "get_playground_info_for_languages", (language) => {
        assert.equal(language, "javascript");
        return undefined;
    });

    override(copied_tooltip, "show_copied_confirmation", noop);

    const {prepends, $button_container, $view_code} = test_code_playground(mock_template, false);
    assert.deepEqual(prepends, [$button_container[0]]);
    assert_clipboard_setup();

    assert.equal($view_code.attr("data-tippy-content"), undefined);
    assert.equal($view_code.attr("aria-label"), undefined);
});

run_test("code playground single", ({override, mock_template}) => {
    override(realm_playground, "get_playground_info_for_languages", (language) => {
        assert.equal(language, "javascript");
        return [{name: "Some Javascript Playground"}];
    });

    override(copied_tooltip, "show_copied_confirmation", noop);

    const {prepends, $button_container, $view_code} = test_code_playground(mock_template, true);
    assert.deepEqual(prepends, [$button_container[0]]);
    assert_clipboard_setup();

    assert.equal(
        $view_code.attr("data-tippy-content"),
        "translated: View in Some Javascript Playground",
    );
    assert.equal($view_code.attr("aria-label"), "translated: View in Some Javascript Playground");
    assert.equal($view_code.attr("aria-haspopup"), undefined);
});

run_test("code playground multiple", ({override, mock_template}) => {
    override(realm_playground, "get_playground_info_for_languages", (language) => {
        assert.equal(language, "javascript");
        return ["whatever", "whatever"];
    });

    override(copied_tooltip, "show_copied_confirmation", noop);

    const {prepends, $button_container, $view_code} = test_code_playground(mock_template, true);
    assert.deepEqual(prepends, [$button_container[0]]);
    assert_clipboard_setup();

    assert.equal($view_code.attr("data-tippy-content"), "translated: View in playground");
    assert.equal($view_code.attr("aria-label"), "translated: View in playground");
    assert.equal($view_code.attr("aria-haspopup"), "true");
});

run_test("stream-private", ({mock_template}) => {
    // Setup
    const private_stream = {
        stream_id: 88,
        name: "secret-stream",
        invite_only: true,
        is_web_public: false,
        is_archived: false,
    };
    stream_data.add_sub_for_tests(private_stream);

    const $content = get_content_element();
    const $stream = $.create("a.stream");
    $stream.attr("data-stream-id", private_stream.stream_id);
    $stream.set_find_results(".highlight", []);

    const $topic = $.create("a.stream-topic");
    $topic.attr("href", `/#narrow/channel/${private_stream.stream_id}-secret-stream/topic/test`);
    $topic.set_find_results(".highlight", []);
    $topic.addClass("stream-topic");
    $topic[0].replaceWith = noop;

    const $message_link = $.create("a.message-link");
    $message_link.attr(
        "href",
        `/#narrow/channel/${private_stream.stream_id}-secret-stream/topic/test/near/123`,
    );
    $message_link.set_find_results(".highlight", []);
    $message_link[0].replaceWith = noop;

    $content.set_find_results("a.stream", $stream);
    $content.set_find_results("a.stream-topic, a.message-link", [...$topic, ...$message_link]);

    let stream_name_context;
    mock_template("decorated_channel_name.hbs", true, (data, html) => {
        stream_name_context = data;
        return html;
    });

    let topic_link_context;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        return html;
    });

    let message_link_context;
    mock_template("channel_message_link.hbs", true, (data, html) => {
        message_link_context = data;
        return html;
    });

    rm.update_elements($content);

    // Verify decorated_channel_name was called with the private stream.
    assert.ok(stream_name_context, "decorated_channel_name should be called");
    assert.ok(stream_name_context.stream.invite_only, "Stream should be private");

    // Verify topic_link was called with the private stream.
    assert.ok(topic_link_context, "topic_link should be called");
    assert.ok(topic_link_context.stream.invite_only, "Topic stream should be private");

    // Verify channel_message_link was called with the private stream.
    assert.ok(message_link_context, "channel_message_link should be called");
    assert.ok(message_link_context.stream.invite_only, "Message link stream should be private");
});

run_test("stream-web-public", ({mock_template}) => {
    // Setup
    const web_public_stream = {
        stream_id: 99,
        name: "web-public-stream",
        invite_only: false,
        is_web_public: true,
        is_archived: false,
    };
    stream_data.add_sub_for_tests(web_public_stream);

    const $content = get_content_element();
    const $stream = $.create("a.stream");
    $stream.attr("data-stream-id", web_public_stream.stream_id);
    $stream.set_find_results(".highlight", []);

    const $topic = $.create("a.stream-topic");
    $topic.attr(
        "href",
        `/#narrow/channel/${web_public_stream.stream_id}-web-public-stream/topic/test`,
    );
    $topic.set_find_results(".highlight", []);
    $topic.addClass("stream-topic");
    $topic[0].replaceWith = noop;

    const $message_link = $.create("a.message-link");
    $message_link.attr(
        "href",
        `/#narrow/channel/${web_public_stream.stream_id}-web-public-stream/topic/test/near/123`,
    );
    $message_link.set_find_results(".highlight", []);
    $message_link[0].replaceWith = noop;

    $content.set_find_results("a.stream", $stream);
    $content.set_find_results("a.stream-topic, a.message-link", [...$topic, ...$message_link]);

    let stream_name_context;
    mock_template("decorated_channel_name.hbs", true, (data, html) => {
        stream_name_context = data;
        return html;
    });

    let topic_link_context;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        return html;
    });

    let message_link_context;
    mock_template("channel_message_link.hbs", true, (data, html) => {
        message_link_context = data;
        return html;
    });

    rm.update_elements($content);

    // Verify decorated_channel_name was called with the web-public stream.
    assert.ok(stream_name_context, "decorated_channel_name should be called");
    assert.ok(stream_name_context.stream.is_web_public, "Stream should be web-public");

    // Verify topic_link was called with the web-public stream.
    assert.ok(topic_link_context, "topic_link should be called");
    assert.ok(topic_link_context.stream.is_web_public, "Topic stream should be web-public");

    // Verify channel_message_link was called with the web-public stream.
    assert.ok(message_link_context, "channel_message_link should be called");
    assert.ok(
        message_link_context.stream.is_web_public,
        "Message link stream should be web-public",
    );
});

run_test("stream-archived", ({mock_template}) => {
    // Setup
    const archived_stream = {
        stream_id: 77,
        name: "old-stream",
        invite_only: false,
        is_web_public: false,
        is_archived: true,
    };
    stream_data.add_sub_for_tests(archived_stream);

    const $content = get_content_element();
    const $stream = $.create("a.stream");
    $stream.attr("data-stream-id", archived_stream.stream_id);
    $stream.set_find_results(".highlight", []);

    const $topic = $.create("a.stream-topic");
    $topic.attr("href", `/#narrow/channel/${archived_stream.stream_id}-old-stream/topic/test`);
    $topic.set_find_results(".highlight", []);
    $topic.addClass("stream-topic");
    $topic[0].replaceWith = noop;

    const $message_link = $.create("a.message-link");
    $message_link.attr(
        "href",
        `/#narrow/channel/${archived_stream.stream_id}-old-stream/topic/test/near/123`,
    );
    $message_link.set_find_results(".highlight", []);
    $message_link[0].replaceWith = noop;

    $content.set_find_results("a.stream", $stream);
    $content.set_find_results("a.stream-topic, a.message-link", [...$topic, ...$message_link]);

    let stream_name_context;
    mock_template("decorated_channel_name.hbs", true, (data, html) => {
        stream_name_context = data;
        return html;
    });

    let topic_link_context;
    mock_template("topic_link.hbs", true, (data, html) => {
        topic_link_context = data;
        return html;
    });

    let message_link_context;
    mock_template("channel_message_link.hbs", true, (data, html) => {
        message_link_context = data;
        return html;
    });

    rm.update_elements($content);

    // Verify decorated_channel_name was called with the archived stream.
    assert.ok(stream_name_context, "decorated_channel_name should be called");
    assert.ok(stream_name_context.stream.is_archived, "Stream should be archived");

    // Verify topic_link was called with the archived stream.
    assert.ok(topic_link_context, "topic_link should be called");
    assert.ok(topic_link_context.stream.is_archived, "Topic stream should be archived");

    // Verify channel_message_link was called with the archived stream.
    assert.ok(message_link_context, "channel_message_link should be called");
    assert.ok(message_link_context.stream.is_archived, "Message link stream should be archived");
});

run_test("rtl", () => {
    const $content = get_content_element();

    $content.text("مرحبا");

    assert.ok(!$content.hasClass("rtl"));
    rm.update_elements($content);
    assert.ok($content.hasClass("rtl"));
});
