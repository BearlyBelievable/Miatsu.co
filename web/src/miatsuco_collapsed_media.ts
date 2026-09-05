import $ from "jquery";

import * as blueslip from "./blueslip.ts";
import {$t} from "./i18n.ts";
import {postprocess_content} from "./postprocess_content.ts";
import * as rendered_markdown from "./rendered_markdown.ts";

export function expand_media(current_target: HTMLElement): void {
    const wrapper = current_target.closest<HTMLElement>(".message-media-collapsed-image");
    const original_html = wrapper?.dataset["collapsedImageHtml"];
    if (wrapper === null || original_html === undefined) {
        blueslip.warn("Collapsed media wrapper is missing its original markup.");
        return;
    }

    const expanded_html = postprocess_content(original_html, {force_upload_thumbnails: true});
    const row = document.createElement("span");
    row.classList.add("message-media-expanded-image-row");
    row.innerHTML = expanded_html;

    const collapse_icon = document.createElement("i");
    collapse_icon.classList.add("zulip-icon", "zulip-icon-collapse");
    collapse_icon.setAttribute("aria-hidden", "true");

    const collapse_button = document.createElement("a");
    collapse_button.setAttribute("role", "button");
    collapse_button.setAttribute("tabindex", "0");
    collapse_button.classList.add(
        "message-media-recollapse-button",
        "icon-button",
        "icon-button-square",
        "icon-button-neutral",
    );
    collapse_button.setAttribute("aria-label", $t({defaultMessage: "Hide preview"}));
    collapse_button.dataset["collapsedImageHtml"] = original_html;
    collapse_button.append(collapse_icon);
    row.append(collapse_button);

    wrapper.replaceWith(row);
    rendered_markdown.update_elements($(row));
}

export function collapse_media(current_target: HTMLElement): void {
    const button = current_target.closest<HTMLElement>(".message-media-recollapse-button");
    const original_html = button?.dataset["collapsedImageHtml"];
    if (button === null || original_html === undefined) {
        blueslip.warn("Recollapse button is missing its original markup.");
        return;
    }
    const row = button.closest<HTMLElement>(".message-media-expanded-image-row");
    if (row === null) {
        return;
    }

    const collapsed_html = postprocess_content(original_html, {force_upload_thumbnails: false});
    const template = document.createElement("template");
    template.innerHTML = collapsed_html;
    const collapsed = template.content.firstElementChild;
    if (collapsed === null) {
        return;
    }
    row.replaceWith(collapsed);
}

export function initialize(): void {
    $("#main_div, #compose .preview_content").on(
        "click",
        ".message-media-collapsed-image-link, .message-media-expand-button",
        (e: JQuery.ClickEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) => {
            e.preventDefault();
            e.stopPropagation();
            expand_media(e.currentTarget);
        },
    );

    $("#main_div, #compose .preview_content").on(
        "click",
        ".message-media-recollapse-button",
        (e: JQuery.ClickEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) => {
            e.preventDefault();
            e.stopPropagation();
            collapse_media(e.currentTarget);
        },
    );
}
