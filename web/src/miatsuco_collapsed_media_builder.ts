import {$t} from "./i18n.ts";

export function build_collapsed_media_wrapper(
    doc: Document,
    link_text: string,
    original_html: string,
    platform?: string | null,
): HTMLSpanElement {
    const collapsed_link = doc.createElement("span");
    collapsed_link.classList.add("message-media-collapsed-image-link");
    collapsed_link.textContent = link_text;

    const expand_button = doc.createElement("a");
    expand_button.setAttribute("role", "button");
    expand_button.setAttribute("tabindex", "0");
    expand_button.classList.add(
        "message-media-expand-button",
        "icon-button",
        "icon-button-square",
        "icon-button-neutral",
    );
    expand_button.setAttribute("aria-label", $t({defaultMessage: "Show preview"}));
    const expand_icon = doc.createElement("i");
    expand_icon.classList.add("zulip-icon", "zulip-icon-expand");
    expand_icon.setAttribute("aria-hidden", "true");
    expand_button.append(expand_icon);

    const media_wrapper = doc.createElement("span");
    media_wrapper.classList.add("message-media-collapsed-image");
    media_wrapper.dataset["collapsedImageHtml"] = original_html;
    if (platform) {
        media_wrapper.setAttribute("data-platform", platform);
    }
    media_wrapper.append(collapsed_link, expand_button);
    return media_wrapper;
}
