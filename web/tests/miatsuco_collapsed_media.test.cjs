"use strict";

const assert = require("node:assert/strict");

const {JSDOM} = require("jsdom");

const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const blueslip = require("./lib/zblueslip.cjs");
const $ = require("./lib/zjquery.cjs");

const {window} = new JSDOM("");
set_global("document", window.document);
set_global("window", window);
set_global("HTMLElement", window.HTMLElement);
set_global("Event", window.Event);

// zjquery can only wrap an object carrying to_$(). expand_media/collapse_media
// build real DOM nodes directly and only touch $ once, wrapping the result
// for rendered_markdown.update_elements, which this file mocks out entirely
// (its own behavior is covered by rendered_markdown.test.cjs). This bridges
// any real element to a plain array-like zjquery already knows how to return
// as-is, so that one call site does not need a full fake jQuery.
window.HTMLElement.prototype.to_$ = function () {
    return {0: this, length: 1};
};

const rendered_markdown = mock_esm("../src/rendered_markdown");

const {postprocess_content} = zrequire("postprocess_content");
const media_collapse = zrequire("miatsuco_collapsed_media");

run_test("expand_media expands using postprocess_content", () => {
    const original_html = "<p>Hello <strong>world</strong></p>";
    const expected_html = postprocess_content(original_html, {
        force_upload_thumbnails: true,
    });

    const wrapper = document.createElement("span");
    wrapper.classList.add("message-media-collapsed-image");
    wrapper.dataset.collapsedImageHtml = original_html;
    const expand_button = document.createElement("a");
    expand_button.classList.add("message-media-expand-button");
    wrapper.append(expand_button);
    const container = document.createElement("div");
    container.append(wrapper);

    let update_elements_call;
    rendered_markdown.update_elements = (arg) => {
        update_elements_call = arg;
    };

    media_collapse.expand_media(expand_button);

    assert.equal(container.querySelector(".message-media-collapsed-image"), null);
    const row = container.querySelector(".message-media-expanded-image-row");
    assert.ok(row !== null);
    assert.equal(update_elements_call[0], row);

    const recollapse_button = row.querySelector(".message-media-recollapse-button");
    assert.ok(recollapse_button !== null);
    assert.equal(recollapse_button.dataset.collapsedImageHtml, original_html);
    assert.equal(recollapse_button.getAttribute("aria-label"), "translated: Hide preview");

    const row_without_button = row.cloneNode(true);
    row_without_button.querySelector(".message-media-recollapse-button").remove();
    assert.equal(row_without_button.innerHTML, expected_html);
});

run_test("expand_media warns and leaves the DOM alone when markup is missing", () => {
    const wrapper = document.createElement("span");
    wrapper.classList.add("message-media-collapsed-image");
    const expand_button = document.createElement("a");
    expand_button.classList.add("message-media-expand-button");
    wrapper.append(expand_button);
    const container = document.createElement("div");
    container.append(wrapper);

    rendered_markdown.update_elements = () => {
        /* istanbul ignore next */
        throw new Error("should not be called");
    };

    blueslip.expect("warn", "Collapsed media wrapper is missing its original markup.");
    media_collapse.expand_media(expand_button);

    assert.equal(container.querySelector(".message-media-collapsed-image"), wrapper);
    assert.equal(container.querySelector(".message-media-expanded-image-row"), null);
});

run_test("collapse_media re-collapses using postprocess_content", () => {
    const original_html = "<p>Hello <strong>world</strong></p>";
    const expected_html = postprocess_content(original_html, {
        force_upload_thumbnails: false,
    });

    const row = document.createElement("span");
    row.classList.add("message-media-expanded-image-row");
    const expanded_content = document.createElement("p");
    expanded_content.textContent = "placeholder";
    const recollapse_button = document.createElement("a");
    recollapse_button.classList.add("message-media-recollapse-button");
    recollapse_button.dataset.collapsedImageHtml = original_html;
    row.append(expanded_content, recollapse_button);
    const container = document.createElement("div");
    container.append(row);

    media_collapse.collapse_media(recollapse_button);

    assert.equal(container.querySelector(".message-media-expanded-image-row"), null);
    assert.equal(container.innerHTML, expected_html);
});

run_test("collapse_media warns and leaves the DOM alone when markup is missing", () => {
    const row = document.createElement("span");
    row.classList.add("message-media-expanded-image-row");
    const recollapse_button = document.createElement("a");
    recollapse_button.classList.add("message-media-recollapse-button");
    row.append(recollapse_button);
    const container = document.createElement("div");
    container.append(row);

    blueslip.expect("warn", "Recollapse button is missing its original markup.");
    media_collapse.collapse_media(recollapse_button);

    assert.equal(container.querySelector(".message-media-expanded-image-row"), row);
});

run_test("collapse_media leaves the DOM alone when not inside an expanded row", () => {
    const recollapse_button = document.createElement("a");
    recollapse_button.classList.add("message-media-recollapse-button");
    recollapse_button.dataset.collapsedImageHtml = "<p>Hello <strong>world</strong></p>";
    const container = document.createElement("div");
    container.append(recollapse_button);

    media_collapse.collapse_media(recollapse_button);

    assert.equal(container.querySelector(".message-media-recollapse-button"), recollapse_button);
});

run_test("collapse_media leaves the DOM alone when there is nothing to collapse to", () => {
    const row = document.createElement("span");
    row.classList.add("message-media-expanded-image-row");
    const recollapse_button = document.createElement("a");
    recollapse_button.classList.add("message-media-recollapse-button");
    recollapse_button.dataset.collapsedImageHtml = "";
    row.append(recollapse_button);
    const container = document.createElement("div");
    container.append(row);

    media_collapse.collapse_media(recollapse_button);

    assert.equal(container.querySelector(".message-media-expanded-image-row"), row);
});

run_test("initialize wires the expand click to expand_media", () => {
    const original_html = "<p>Hello <strong>world</strong></p>";
    rendered_markdown.update_elements = () => {};

    media_collapse.initialize();
    const $container = $("#main_div, #compose .preview_content");
    const handler = $container.get_on_handler(
        "click",
        ".message-media-collapsed-image-link, .message-media-expand-button",
    );
    assert.ok(handler !== undefined);

    const wrapper = document.createElement("span");
    wrapper.classList.add("message-media-collapsed-image");
    wrapper.dataset.collapsedImageHtml = original_html;
    const expand_button = document.createElement("a");
    expand_button.classList.add("message-media-expand-button");
    wrapper.append(expand_button);
    const container = document.createElement("div");
    container.append(wrapper);

    let prevented = false;
    let stopped = false;
    handler.call(expand_button, {
        currentTarget: expand_button,
        preventDefault() {
            prevented = true;
        },
        stopPropagation() {
            stopped = true;
        },
    });

    assert.ok(prevented);
    assert.ok(stopped);
    assert.ok(container.querySelector(".message-media-expanded-image-row") !== null);
});

run_test("initialize wires the recollapse click to collapse_media", () => {
    const original_html =
        '<div class="message_inline_image">' +
        '<a href="https://example.com/uploads/img.png">' +
        '<img src="https://example.com/uploads/img.png">' +
        "</a></div>";

    media_collapse.initialize();
    const $container = $("#main_div, #compose .preview_content");
    const handler = $container.get_on_handler("click", ".message-media-recollapse-button");
    assert.ok(handler !== undefined);

    const row = document.createElement("span");
    row.classList.add("message-media-expanded-image-row");
    const recollapse_button = document.createElement("a");
    recollapse_button.classList.add("message-media-recollapse-button");
    recollapse_button.dataset.collapsedImageHtml = original_html;
    row.append(recollapse_button);
    const container = document.createElement("div");
    container.append(row);

    let prevented = false;
    let stopped = false;
    handler.call(recollapse_button, {
        currentTarget: recollapse_button,
        preventDefault() {
            prevented = true;
        },
        stopPropagation() {
            stopped = true;
        },
    });

    assert.ok(prevented);
    assert.ok(stopped);
    assert.equal(container.querySelector(".message-media-expanded-image-row"), null);
    assert.ok(container.querySelector(".message-media-collapsed-image") !== null);
});
