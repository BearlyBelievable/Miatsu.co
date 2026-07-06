"use strict";

const assert = require("node:assert/strict");

const {zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const miatsuco_inline_video = zrequire("miatsuco_inline_video");

function make_content(containers) {
    const $content = $.create("content-stub");
    $content.set_find_results(".message_inline_video", containers);
    return $content;
}

run_test("skips unsupported-format videos", () => {
    const $container = $.create("unsupported-container");
    $container.addClass("video-format-unsupported");

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    assert.equal($container.attr("data-miatsuco-inline-video"), undefined);
    assert.ok(!$container.hasClass("miatsuco-inline-video-playable"));
});

run_test("skips already-enhanced videos", () => {
    const $container = $.create("done-container");
    $container.attr("data-miatsuco-inline-video", "1");
    $container.set_find_results("video", $.create("done-video"));

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    assert.ok(!$container.hasClass("miatsuco-inline-video-playable"));
});

run_test("skips containers with no video element", () => {
    const $container = $.create("empty-container");
    $container.set_find_results("video", []);

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    assert.equal($container.attr("data-miatsuco-inline-video"), undefined);
    assert.ok(!$container.hasClass("miatsuco-inline-video-playable"));
});

run_test("enhances a playable inline video", () => {
    const $container = $.create("video-container");
    const $video = $.create("video-element");
    const $anchor = $.create("anchor-element");
    $container.set_find_results("video", $video);
    $container.set_find_results("a", $anchor);
    // A real video element exposes canPlayType; a playable file reports a
    // non-empty result, so enhancement proceeds.
    $video.attr("src", "https://example.com/uploads/clip.webm");
    $video[0].canPlayType = () => "probably";

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    // Became a real, marked player.
    assert.equal($container.attr("data-miatsuco-inline-video"), "1");
    assert.equal($video.attr("controls"), "true");
    assert.ok($container.hasClass("miatsuco-inline-video-playable"));
    assert.ok(!$video.hasClass("media-image-element"));
    assert.equal($video.attr("draggable"), "false");
    assert.equal($anchor.attr("draggable"), "false");

    // Video click stops propagation (blocks the lightbox). It must not
    // call preventDefault, so the native controls keep working; we assert
    // that by omitting preventDefault from the stub (a call would throw).
    const video_event = {
        stop_propagation_calls: 0,
        stopPropagation() {
            this.stop_propagation_calls += 1;
        },
    };
    $video.get_on_handler("click")(video_event);
    assert.equal(video_event.stop_propagation_calls, 1);

    // Anchor click prevents navigation.
    const anchor_event = {
        prevent_default_calls: 0,
        preventDefault() {
            this.prevent_default_calls += 1;
        },
    };
    $anchor.get_on_handler("click")(anchor_event);
    assert.equal(anchor_event.prevent_default_calls, 1);
});

run_test("falls back when the browser cannot play the container", () => {
    const $container = $.create("video-container");
    const $video = $.create("video-element");
    const $anchor = $.create("anchor-element");
    $container.set_find_results("video", $video);
    $container.set_find_results("a", $anchor);
    $video.attr("src", "https://example.com/uploads/clip.mov");
    // The browser reports a definitive "cannot play" for this container.
    $video[0].canPlayType = () => "";

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    // The preview is marked unsupported (hidden, download link remains) and
    // never turned into a player.
    assert.ok($container.hasClass("video-format-unsupported"));
    assert.equal($container.attr("data-miatsuco-inline-video"), undefined);
    assert.ok(!$container.hasClass("miatsuco-inline-video-playable"));
});

run_test("enhances when the browser might play the container", () => {
    const $container = $.create("video-container");
    const $video = $.create("video-element");
    const $anchor = $.create("anchor-element");
    $container.set_find_results("video", $video);
    $container.set_find_results("a", $anchor);
    $video.attr("src", "https://example.com/uploads/clip.mp4?v=2");
    // "maybe" (and "probably") are not definitive, so we proceed.
    $video[0].canPlayType = () => "maybe";

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    assert.ok(!$container.hasClass("video-format-unsupported"));
    assert.equal($container.attr("data-miatsuco-inline-video"), "1");
    assert.ok($container.hasClass("miatsuco-inline-video-playable"));
});

run_test("enhances when the extension is unrecognized", () => {
    const $container = $.create("video-container");
    const $video = $.create("video-element");
    const $anchor = $.create("anchor-element");
    $container.set_find_results("video", $video);
    $container.set_find_results("a", $anchor);
    // No recognizable extension, so there is no container type to check;
    // canPlayType is left as noop (its presence lets the capability check run,
    // but an unrecognized extension means it is never consulted) and
    // enhancement proceeds, leaving a genuine failure to the error-event
    // fallback.
    $video.attr("src", "https://example.com/uploads/clip");
    $video[0].canPlayType = noop;

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    assert.ok(!$container.hasClass("video-format-unsupported"));
    assert.equal($container.attr("data-miatsuco-inline-video"), "1");
});
