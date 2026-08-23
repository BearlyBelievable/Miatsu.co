"use strict";

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const {set_realm} = zrequire("state_data");
const miatsuco_inline_embed = zrequire("miatsuco_inline_embed");

set_realm(make_realm());

function make_container(name, class_name) {
    const $container = $.create(name);
    $container.addClass(class_name);
    const $anchor = $.create(name + "-anchor");
    $container.set_find_results("a", $anchor);
    return {$container, $anchor};
}

function make_content(containers, name = "content-stub") {
    const $content = $.create(name);
    $content.set_find_results(".youtube-video, .embed-video, .embed-rich", containers);
    return $content;
}

// zjquery caches $("<iframe>") by literal selector text, so re-selecting
// it after enhance_inline_embeds runs is how we inspect the attributes
// load_embed just set on it.
function last_iframe() {
    return $("<iframe>");
}

run_test("skips already-loaded embeds", () => {
    const {$container, $anchor} = make_container("loaded-container", "youtube-video");
    $container.addClass("miatsuco-inline-embed-loaded");
    $anchor.attr("data-id", "dQw4w9WgXcQ");
    $anchor.attr("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal(last_iframe().attr("src"), undefined);
});

run_test("loads a YouTube embed", () => {
    const {$container, $anchor} = make_container("youtube-container", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");
    $anchor.attr("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.ok($container.hasClass("miatsuco-inline-embed-loaded"));

    const $iframe = last_iframe();
    assert.equal(
        $iframe.attr("src"),
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
    );
    assert.equal($iframe.attr("referrerpolicy"), "strict-origin-when-cross-origin");
    assert.notEqual($iframe.attr("referrerpolicy"), "no-referrer");
    assert.equal($iframe.attr("allowfullscreen"), "true");
    assert.equal($iframe.attr("frameborder"), "0");
    assert.ok($iframe.attr("sandbox").includes("allow-scripts"));
});

run_test("loads a YouTube embed with no start time", () => {
    const {$container, $anchor} = make_container("youtube-container-no-start", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");
    $anchor.attr("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal(last_iframe().attr("src"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
});

run_test("a real Vimeo oEmbed response plays via the generic passthrough", () => {
    const {$container, $anchor} = make_container("vimeo-oembed-container", "embed-video");
    $anchor.attr(
        "data-id",
        '<iframe src="https://player.vimeo.com/video/286898202?h=fd61acd044" width="480" height="360" frameborder="0" title="My video" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>',
    );
    $anchor.attr("href", "https://vimeo.com/286898202");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal(
        last_iframe().attr("src"),
        "https://player.vimeo.com/video/286898202?h=fd61acd044",
    );
});

run_test("loads a generic iframe-shaped oEmbed passthrough directly", () => {
    const {$container, $anchor} = make_container("oembed-container", "embed-rich");
    $anchor.attr("data-id", '<iframe src="https://example.com/player"></iframe>');
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal(last_iframe().attr("src"), "https://example.com/player");
});

run_test("sizes a generic rich embed by aspect ratio when width and height are known", () => {
    const {$container, $anchor} = make_container("sized-oembed-container", "embed-rich");
    $anchor.attr("data-id", '<iframe src="https://example.com/player"></iframe>');
    $anchor.attr("href", "https://example.com/watch/1");
    $container.attr("data-width", "800");
    $container.attr("data-height", "450");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal($container[0].style.getPropertyValue("aspect-ratio"), "800 / 450");
    assert.equal($container[0].style.getPropertyValue("height"), "auto");
});

run_test("falls back to a fixed pixel height when only height is known", () => {
    const {$container, $anchor} = make_container("height-only-oembed-container", "embed-rich");
    $anchor.attr("data-id", '<iframe src="https://example.com/player"></iframe>');
    $anchor.attr("href", "https://example.com/watch/1");
    $container.attr("data-height", "450");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal($container[0].style.getPropertyValue("aspect-ratio"), "");
    assert.equal($container[0].style.getPropertyValue("height"), "450px");
});

run_test("rejects a non-http(s) src instead of trusting it as an iframe target", () => {
    const {$container, $anchor} = make_container("malicious-oembed-container", "embed-rich");
    const malicious_html = '<iframe src="javascript:alert(document.domain)"></iframe>';
    $anchor.attr("data-id", malicious_html);
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.ok(src.startsWith("data:text/html,"));
    assert.ok(!src.includes("javascript:")); // eslint-disable-line no-script-url
    const decoded = decodeURIComponent(src.slice("data:text/html,".length));
    assert.ok(decoded.includes(malicious_html));
});

run_test("carries over allow/style and sets a fixed height for Spotify", () => {
    const {$container, $anchor} = make_container("spotify-oembed-container", "embed-rich");
    $anchor.attr(
        "data-id",
        '<iframe style="border-radius: 12px" width="100%" height="152" src="https://open.spotify.com/embed/track/id" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>',
    );
    $anchor.attr("href", "https://open.spotify.com/track/id");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const $iframe = last_iframe();
    assert.equal(
        $iframe.attr("allow"),
        "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    );
    assert.equal($iframe.attr("style"), "border-radius: 12px");
});

run_test("builds a SoundCloud widget URL directly instead of trusting the oEmbed html", () => {
    const {$container, $anchor} = make_container("soundcloud-oembed-container", "embed-rich");
    $anchor.attr(
        "data-id",
        '<iframe width="480" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>',
    );
    $anchor.attr("href", "https://soundcloud.com/forss/flickermood");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const $iframe = last_iframe();
    const src = $iframe.attr("src");
    assert.ok(src.startsWith("https://w.soundcloud.com/player/?"));
    assert.ok(src.includes("visual=false"));
    assert.ok(src.includes("show_artwork=false"));
    assert.ok(
        src.includes("url=" + encodeURIComponent("https://soundcloud.com/forss/flickermood")),
    );
    assert.equal($iframe.attr("allow"), "autoplay; encrypted-media");
});

run_test("falls back to a sandboxed wrapper for non-iframe rich content", () => {
    const {$container, $anchor} = make_container("blockquote-oembed-container", "embed-rich");
    const blockquote_html =
        '<blockquote class="bluesky-embed"><p>Hello</p></blockquote><script async src="https://embed.bsky.app/static/embed.js"></script>';
    $anchor.attr("data-id", blockquote_html);
    $anchor.attr("href", "https://bsky.app/profile/example/post/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.ok(src.startsWith("data:text/html,"));
    const decoded = decodeURIComponent(src.slice("data:text/html,".length));
    assert.ok(decoded.includes(blockquote_html));
    assert.ok(decoded.includes("ResizeObserver"));
});

run_test("does nothing if the anchor has no href", () => {
    const {$container, $anchor} = make_container("no-href-container", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.ok(!$container.hasClass("miatsuco-inline-embed-loaded"));
});

run_test("a second enhance call does not reload an already-loaded embed", () => {
    const {$container, $anchor} = make_container("double-enhance-container", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");
    $anchor.attr("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const reload_sentinel_src = "";
    last_iframe().attr("src", reload_sentinel_src);

    miatsuco_inline_embed.enhance_inline_embeds(
        make_content($container, "content-stub-second-pass"),
    );

    assert.equal(
        last_iframe().attr("src"),
        reload_sentinel_src,
        "load_embed should not have re-run",
    );
});
