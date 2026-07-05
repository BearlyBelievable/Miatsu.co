"use strict";

const assert = require("node:assert/strict");

const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
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

    miatsuco_inline_video.enhance_inline_videos(make_content($container));

    // Became a real, marked player.
    assert.equal($container.attr("data-miatsuco-inline-video"), "1");
    assert.equal($video.attr("controls"), "true");
    assert.ok($container.hasClass("miatsuco-inline-video-playable"));
    assert.ok(!$video.hasClass("media-image-element"));
    assert.equal($video.attr("draggable"), "false");
    assert.equal($anchor.attr("draggable"), "false");

    // Video click stops propagation (blocks the lightbox) without
    // preventing default (native controls keep working).
    let stopped = false;
    let video_default_prevented = false;
    $video.get_on_handler("click")({
        stopPropagation() {
            stopped = true;
        },
        preventDefault() {
            video_default_prevented = true;
        },
    });
    assert.ok(stopped);
    assert.ok(!video_default_prevented);

    // Anchor click prevents navigation.
    let anchor_default_prevented = false;
    $anchor.get_on_handler("click")({
        preventDefault() {
            anchor_default_prevented = true;
        },
    });
    assert.ok(anchor_default_prevented);
});
