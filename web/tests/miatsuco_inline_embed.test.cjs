"use strict";

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const {set_realm} = zrequire("state_data");
const miatsuco_inline_embed = zrequire("miatsuco_inline_embed");

const realm = make_realm();
set_realm(realm);

run_test("css_color_to_hex converts an rgb string to a hex triplet", () => {
    assert.equal(miatsuco_inline_embed.css_color_to_hex("rgb(29, 161, 242)"), "1da1f2");
});

run_test("css_color_to_hex ignores an alpha channel", () => {
    assert.equal(miatsuco_inline_embed.css_color_to_hex("rgba(29, 161, 242, 0.5)"), "1da1f2");
});

run_test("css_color_to_hex zero-pads a component under 16", () => {
    assert.equal(miatsuco_inline_embed.css_color_to_hex("rgb(0, 5, 15)"), "00050f");
});

run_test("css_color_to_hex falls back to 000000 for an unparseable value", () => {
    assert.equal(miatsuco_inline_embed.css_color_to_hex("transparent"), "000000");
});

function make_container(name, class_name) {
    const $container = $.create(name);
    $container.addClass(class_name);
    const $anchor = $.create(name + "-anchor");
    $container.set_find_results("a", $anchor);
    return {$container, $anchor};
}

// Matches the shape add_oembed_data's rich branch actually builds now:
// a plain message_embed card carrying the iframe html and any known
// width/height in one JSON data attribute, not a data-id on a single anchor.
function make_rich_embed_container(name, payload) {
    const $container = $.create(name);
    $container.addClass("message_embed");
    $container.attr("data-inline-rich-embed", JSON.stringify(payload));
    const $anchor = $.create(name + "-anchor");
    $container.set_find_results(".message_embed_title a, .message_embed_image", $anchor);
    return {$container, $anchor};
}

function make_content(containers, name = "content-stub") {
    const $content = $.create(name);
    $content.set_find_results(
        ".youtube-video, .embed-video, .message_embed[data-inline-rich-embed]",
        containers,
    );
    return $content;
}

// zjquery caches $("<iframe>") by literal selector text, so re-selecting
// it after enhance_inline_embeds runs is how we inspect the attributes
// load_embed just set on it.
function last_iframe() {
    return $("<iframe>");
}

// DOMParser isn't in this test env's eslint globals, so this reaches it
// via globalThis. It gives resolve_css_color_var a real document to
// create and query elements against.
function make_inert_document() {
    return new globalThis.DOMParser().parseFromString("", "text/html");
}

run_test("skips already-loaded embeds", () => {
    const {$container, $anchor} = make_container("loaded-container", "youtube-video");
    $container.addClass("inline-embed-loaded");
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

    assert.ok($container.hasClass("inline-embed-loaded"));

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
    const {$container, $anchor} = make_rich_embed_container("oembed-container", {
        html: '<iframe src="https://example.com/player"></iframe>',
    });
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal(last_iframe().attr("src"), "https://example.com/player");
});

run_test("sizes a generic rich embed by aspect ratio when width and height are known", () => {
    const {$container, $anchor} = make_rich_embed_container("sized-oembed-container", {
        html: '<iframe src="https://example.com/player"></iframe>',
        width: 800,
        height: 450,
    });
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal($container[0].style.getPropertyValue("aspect-ratio"), "800 / 450");
    assert.equal($container[0].style.getPropertyValue("height"), "auto");
});

run_test("falls back to a fixed pixel height when only height is known", () => {
    const {$container, $anchor} = make_rich_embed_container("height-only-oembed-container", {
        html: '<iframe src="https://example.com/player"></iframe>',
        height: 450,
    });
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.equal($container[0].style.getPropertyValue("aspect-ratio"), "");
    assert.equal($container[0].style.getPropertyValue("height"), "450px");
});

run_test("rejects a non-http(s) src instead of trusting it as an iframe target", () => {
    const malicious_html = '<iframe src="javascript:alert(document.domain)"></iframe>';
    const {$container, $anchor} = make_rich_embed_container("malicious-oembed-container", {
        html: malicious_html,
    });
    $anchor.attr("href", "https://example.com/watch/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.ok(src.startsWith("data:text/html,"));
    assert.ok(!src.includes("javascript:")); // eslint-disable-line no-script-url
    const decoded = decodeURIComponent(src.slice("data:text/html,".length));
    assert.ok(decoded.includes(malicious_html));
});

run_test("carries over allow/style and sets a fixed height for Spotify", () => {
    const {$container, $anchor} = make_rich_embed_container("spotify-oembed-container", {
        html: '<iframe style="border-radius: 12px" width="100%" height="152" src="https://open.spotify.com/embed/track/id" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>',
        width: 456,
        height: 152,
    });
    $anchor.attr("href", "https://open.spotify.com/track/id");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const $iframe = last_iframe();
    assert.equal(
        $iframe.attr("allow"),
        "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    );
    assert.equal($iframe.attr("style"), "border-radius: 12px");
    assert.ok($container.hasClass("embed-rich"));
});

run_test("builds a SoundCloud widget URL directly instead of trusting the oEmbed html", () => {
    const {$container, $anchor} = make_rich_embed_container("soundcloud-oembed-container", {
        html: '<iframe width="640" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>',
        width: 640,
        height: 400,
    });
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
    assert.ok(!src.includes("color="));
    assert.equal($iframe.attr("allow"), "autoplay; encrypted-media");
});

run_test(
    "SoundCloud widget hides artwork at the same preview size Spotify treats as compact",
    ({override}) => {
        override(realm, "realm_media_preview_size", 150);

        const {$container, $anchor} = make_rich_embed_container("soundcloud-boundary-container", {
            html: '<iframe width="640" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>',
            width: 640,
            height: 400,
        });
        $anchor.attr("href", "https://soundcloud.com/forss/flickermood");

        miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

        assert.ok(last_iframe().attr("src").includes("show_artwork=false"));
    },
);

// jsdom doesn't resolve var(...) in getComputedStyle, so this stubs it
// to mimic what resolve_css_color_var reads off the probe element it creates.
function fake_get_computed_style(var_values) {
    return (element) => ({
        getPropertyValue(prop) {
            for (const [var_name, value] of Object.entries(var_values)) {
                if (element.style.getPropertyValue(prop) === `var(${var_name})`) {
                    return value;
                }
            }
            return "";
        },
    });
}

run_test(
    "SoundCloud widget URL carries the resolved accent color as a hex triplet",
    ({override}) => {
        override(global, "document", make_inert_document());
        override(
            global,
            "getComputedStyle",
            fake_get_computed_style({
                "--color-background-brand-solid-action-button": "rgb(29, 161, 242)",
            }),
        );

        const {$container, $anchor} = make_rich_embed_container("soundcloud-accent-container", {
            html: '<iframe width="640" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>',
            width: 640,
            height: 400,
        });
        $anchor.attr("href", "https://soundcloud.com/forss/flickermood");

        miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

        const src = last_iframe().attr("src");
        assert.ok(src.includes("color=1da1f2"));
    },
);

run_test(
    "SoundCloud widget URL falls back to 000000 when the accent color is unresolved",
    ({override}) => {
        override(global, "document", make_inert_document());
        override(
            global,
            "getComputedStyle",
            fake_get_computed_style({
                "--color-background-brand-solid-action-button": "transparent",
            }),
        );

        const {$container, $anchor} = make_rich_embed_container(
            "soundcloud-unresolved-accent-container",
            {
                html: '<iframe width="640" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>',
                width: 640,
                height: 400,
            },
        );
        $anchor.attr("href", "https://soundcloud.com/forss/flickermood");

        miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

        const src = last_iframe().attr("src");
        assert.ok(src.includes("color=000000"));
    },
);

run_test("Vimeo widget URL carries resolved theme colors", ({override}) => {
    override(global, "document", make_inert_document());
    override(
        global,
        "getComputedStyle",
        fake_get_computed_style({
            "--color-background": "rgb(255, 255, 255)",
            "--color-background-brand-solid-action-button": "rgb(29, 161, 242)",
            "--color-text-default": "rgb(0, 0, 0)",
        }),
    );

    const {$container, $anchor} = make_container("vimeo-accent-container", "embed-video");
    $anchor.attr(
        "data-id",
        '<iframe src="https://player.vimeo.com/video/286898202?h=fd61acd044" width="480" height="360" frameborder="0" title="My video" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>',
    );
    $anchor.attr("href", "https://vimeo.com/286898202");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.ok(src.startsWith("https://player.vimeo.com/video/286898202?h=fd61acd044"));
    assert.ok(src.includes("colors=ffffff%2C1da1f2%2C000000%2C000000"));
});

run_test("Vimeo widget URL when one theme color fails to resolve", ({override}) => {
    override(global, "document", make_inert_document());
    override(
        global,
        "getComputedStyle",
        fake_get_computed_style({
            "--color-background": "rgb(255, 255, 255)",
            "--color-text-default": "rgb(0, 0, 0)",
        }),
    );

    const {$container, $anchor} = make_container("vimeo-partial-accent-container", "embed-video");
    $anchor.attr(
        "data-id",
        '<iframe src="https://player.vimeo.com/video/286898202?h=fd61acd044" width="480" height="360" frameborder="0" title="My video" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>',
    );
    $anchor.attr("href", "https://vimeo.com/286898202");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.equal(src, "https://player.vimeo.com/video/286898202?h=fd61acd044");
});

run_test("falls back to a sandboxed wrapper for non-iframe rich content", () => {
    const blockquote_html =
        '<blockquote class="bluesky-embed"><p>Hello</p></blockquote><script async src="https://embed.bsky.app/static/embed.js"></script>';
    const {$container, $anchor} = make_rich_embed_container("blockquote-oembed-container", {
        html: blockquote_html,
    });
    $anchor.attr("href", "https://bsky.app/profile/example/post/1");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    const src = last_iframe().attr("src");
    assert.ok(src.startsWith("data:text/html,"));
    const decoded = decodeURIComponent(src.slice("data:text/html,".length));
    assert.ok(decoded.includes(blockquote_html));
    assert.ok(!decoded.includes("ResizeObserver"));
});

run_test("does nothing if the anchor has no href", () => {
    const {$container, $anchor} = make_container("no-href-container", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.ok(!$container.hasClass("inline-embed-loaded"));
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

run_test("narrow Spotify embeds get a narrow-scale class and CSS variable", ({override}) => {
    miatsuco_inline_embed.reset_observers_for_testing();
    override(global, "document", make_inert_document());
    override(global, "requestAnimationFrame", (func) => func());

    let resize_callback;
    let construction_count = 0;
    class FakeResizeObserver {
        constructor(callback) {
            construction_count += 1;
            resize_callback = callback;
        }

        observe() {}
        unobserve() {}
        disconnect() {}
    }
    global.ResizeObserver = FakeResizeObserver;

    const {$container, $anchor} = make_rich_embed_container("spotify-narrow-container", {
        html: '<iframe style="border-radius: 12px" width="100%" height="152" src="https://open.spotify.com/embed/track/id" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>',
        width: 456,
        height: 152,
    });
    $anchor.attr("href", "https://open.spotify.com/track/id");

    // SPOTIFY_EMBED_WIDTH_PX is 280. jsdom elements don't compute real
    // layout, so this stubs a parent narrower than that directly.
    const container_element = $container[0];
    const parent_element = document.createElement("div");
    Object.defineProperty(parent_element, "clientWidth", {value: 200, configurable: true});
    parent_element.querySelector = (selector) =>
        selector === ":scope > .embed-rich" ? container_element : null;
    container_element.parentElement = parent_element;

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    resize_callback([{target: parent_element, contentRect: {width: 200}}]);

    assert.ok(container_element.classList.contains("spotify-embed-narrow"));
    assert.equal(
        container_element.style.getPropertyValue("--spotify-narrow-scale"),
        String(200 / 280),
    );

    const {$container: $second_container, $anchor: $second_anchor} = make_rich_embed_container(
        "spotify-narrow-container-2",
        {
            html: '<iframe style="border-radius: 12px" width="100%" height="152" src="https://open.spotify.com/embed/track/id2" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>',
            width: 456,
            height: 152,
        },
    );
    $second_anchor.attr("href", "https://open.spotify.com/track/id2");
    $second_container[0].parentElement = document.createElement("div");

    miatsuco_inline_embed.enhance_inline_embeds(
        make_content($second_container, "content-stub-spotify-second"),
    );

    assert.equal(construction_count, 1, "the observer singleton should not be re-constructed");
});

run_test("defers loading until the embed is observed as intersecting", () => {
    miatsuco_inline_embed.reset_observers_for_testing();
    const observed_elements = [];
    class FakeIntersectionObserver {
        observe(element) {
            observed_elements.push(element);
        }

        unobserve() {}
    }
    global.IntersectionObserver = FakeIntersectionObserver;

    const {$container, $anchor} = make_container("lazy-container", "youtube-video");
    $anchor.attr("data-id", "dQw4w9WgXcQ");
    $anchor.attr("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    miatsuco_inline_embed.enhance_inline_embeds(make_content($container));

    assert.ok(!$container.hasClass("inline-embed-loaded"));
    assert.equal(observed_elements.length, 1);
    assert.equal(observed_elements[0], $container[0]);
});
