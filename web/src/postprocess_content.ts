import assert from "minimalistic-assert";
import * as z from "zod/mini";

import {$t} from "./i18n.ts";
import * as thumbnail from "./thumbnail.ts";
import {user_settings} from "./user_settings.ts";
import * as util from "./util.ts";

let inertDocument: Document | undefined;

const message_card_embed_media_item_schema = z.object({
    kind: z.enum(["photo", "gif", "video"]),
    url: z.string(),
    alt_text: z.nullable(z.string()),
});

const message_card_embed_quote_schema = z.object({
    unavailable_reason: z.nullable(z.string()),
    author_name: z.optional(z.nullable(z.string())),
    author_handle: z.optional(z.nullable(z.string())),
    author_avatar_url: z.optional(z.nullable(z.string())),
    text: z.optional(z.nullable(z.string())),
    media: z.optional(z.array(message_card_embed_media_item_schema)),
    permalink: z.optional(z.nullable(z.string())),
});

const message_card_embed_payload_schema = z.object({
    platform: z.enum(["twitter", "bluesky"]),
    author_name: z.nullable(z.string()),
    author_handle: z.nullable(z.string()),
    author_avatar_url: z.nullable(z.string()),
    created_at: z.nullable(z.string()),
    text: z.nullable(z.string()),
    media: z.array(message_card_embed_media_item_schema),
    like_count: z.nullable(z.number()),
    repost_count: z.nullable(z.number()),
    reply_count: z.nullable(z.number()),
    permalink: z.nullable(z.string()),
    fallback_link: z.string(),
    quote: z.nullable(message_card_embed_quote_schema),
});

type MessageCardEmbedMediaItem = z.infer<typeof message_card_embed_media_item_schema>;
type MessageCardEmbedQuote = z.infer<typeof message_card_embed_quote_schema>;

const MESSAGE_CARD_EMBED_PLATFORM_ICONS: Record<string, [string, string]> = {
    twitter: ["X", "x"],
    bluesky: ["Bluesky", "bluesky"],
};

function format_engagement_count(count: number): string {
    if (count < 1000) {
        return String(count);
    }
    const [divisor, suffix] = count < 1_000_000 ? [1000, "K"] : [1_000_000, "M"];
    const value = count / divisor;
    if (value < 10) {
        return (Math.floor(value * 10) / 10).toFixed(1) + suffix;
    }
    return String(Math.floor(value)) + suffix;
}

function build_message_card_embed_media_item(item: MessageCardEmbedMediaItem): HTMLElement {
    assert(inertDocument !== undefined);
    const wrapper = inertDocument.createElement("div");
    wrapper.classList.add("message_inline_image");
    if (item.kind === "video") {
        wrapper.classList.add("message_inline_video");
        const video = inertDocument.createElement("video");
        video.setAttribute("preload", "metadata");
        video.setAttribute("src", item.url);
        wrapper.append(video);
    } else {
        const link = inertDocument.createElement("a");
        link.setAttribute("href", item.url);
        if (item.alt_text) {
            link.setAttribute("title", item.alt_text);
        }
        const img = inertDocument.createElement("img");
        img.setAttribute("loading", "lazy");
        img.setAttribute("src", item.url);
        link.append(img);
        wrapper.append(link);
    }
    return wrapper;
}

function build_message_card_embed_header(
    header: HTMLElement,
    author: {
        author_name?: string | null | undefined;
        author_handle?: string | null | undefined;
        author_avatar_url?: string | null | undefined;
    },
    created_at: string | null,
    platform_icon: [string, string] | undefined,
): void {
    assert(inertDocument !== undefined);

    if (author.author_avatar_url) {
        const avatar = inertDocument.createElement("img");
        avatar.classList.add("message-card-embed-avatar");
        avatar.setAttribute("loading", "lazy");
        avatar.setAttribute("src", author.author_avatar_url);
        header.append(avatar);
    }

    const author_elm = inertDocument.createElement("span");
    author_elm.classList.add("message-card-embed-author");

    if (author.author_name) {
        const name_elm = inertDocument.createElement("span");
        name_elm.classList.add("message-card-embed-author-name");
        name_elm.textContent = author.author_name;
        author_elm.append(name_elm);
    }

    let handle_elm: HTMLElement | undefined;
    if (author.author_handle) {
        handle_elm = inertDocument.createElement("span");
        handle_elm.classList.add("message-card-embed-author-handle");
        handle_elm.textContent = "@" + author.author_handle;
        author_elm.append(handle_elm);
    }

    if (created_at) {
        if (handle_elm) {
            handle_elm.append(" · ");
        }
        const time_elm = inertDocument.createElement("time");
        time_elm.classList.add("message-card-embed-timestamp");
        time_elm.setAttribute("datetime", created_at);
        time_elm.textContent = created_at;
        (handle_elm ?? author_elm).append(time_elm);
    }

    header.append(author_elm);

    if (platform_icon) {
        const [label_text, icon_name] = platform_icon;
        const badge = inertDocument.createElement("span");
        badge.classList.add("message-card-embed-badge");
        badge.setAttribute("aria-label", label_text);
        const icon = inertDocument.createElement("i");
        icon.classList.add("zulip-icon", `zulip-icon-${icon_name}`);
        icon.setAttribute("aria-hidden", "true");
        badge.append(icon);
        header.append(badge);
    }
}

function build_message_card_embed_quote(container: Element, quote: MessageCardEmbedQuote): void {
    assert(inertDocument !== undefined);

    if (quote.unavailable_reason !== null) {
        const unavailable = inertDocument.createElement("div");
        unavailable.classList.add("message-card-embed-quote-unavailable");
        unavailable.textContent = `Quoted post unavailable (${quote.unavailable_reason})`;
        container.append(unavailable);
        return;
    }

    const quote_container = inertDocument.createElement("div");
    quote_container.classList.add("message-card-embed-quote");

    const header = inertDocument.createElement("div");
    header.classList.add("message-card-embed-header");
    build_message_card_embed_header(header, quote, null, undefined);
    quote_container.append(header);

    if (quote.text) {
        const text_elm = inertDocument.createElement("div");
        text_elm.classList.add("message-card-embed-text");
        text_elm.textContent = quote.text;
        quote_container.append(text_elm);
    }

    if (quote.media && quote.media.length > 0) {
        const media_container = inertDocument.createElement("div");
        media_container.classList.add("message-card-embed-media");
        for (const item of quote.media) {
            media_container.append(build_message_card_embed_media_item(item));
        }
        quote_container.append(media_container);
    }

    container.append(quote_container);
}

function enhance_message_card_embed(message_embed: Element, payload_json: string): void {
    assert(inertDocument !== undefined);

    let payload;
    try {
        payload = message_card_embed_payload_schema.parse(JSON.parse(payload_json));
    } catch {
        return;
    }

    message_embed.classList.add("message-card-embed");
    message_embed.replaceChildren();

    const header = inertDocument.createElement("div");
    header.classList.add("message-card-embed-header");
    build_message_card_embed_header(
        header,
        payload,
        payload.created_at,
        MESSAGE_CARD_EMBED_PLATFORM_ICONS[payload.platform],
    );
    message_embed.append(header);

    if (payload.text) {
        const text_elm = inertDocument.createElement("div");
        text_elm.classList.add("message-card-embed-text");
        text_elm.textContent = payload.text;
        message_embed.append(text_elm);
    }

    if (payload.media.length > 0) {
        const media_container = inertDocument.createElement("div");
        media_container.classList.add("message-card-embed-media");
        for (const item of payload.media) {
            media_container.append(build_message_card_embed_media_item(item));
        }
        message_embed.append(media_container);
    }

    const footer = inertDocument.createElement("div");
    footer.classList.add("message-card-embed-footer");

    const stat_labels: [number | null, string][] = [
        [payload.like_count, "likes"],
        [payload.repost_count, "reposts"],
        [payload.reply_count, "replies"],
    ];
    const stats_text = stat_labels
        .filter((entry): entry is [number, string] => entry[0] !== null)
        .map(([count, label]) => `${format_engagement_count(count)} ${label}`)
        .join(" · ");
    if (stats_text) {
        const stats_elm = inertDocument.createElement("span");
        stats_elm.classList.add("message-card-embed-stats");
        stats_elm.textContent = stats_text;
        footer.append(stats_elm);
    }

    if (payload.quote) {
        build_message_card_embed_quote(message_embed, payload.quote);
    }

    const view_original = inertDocument.createElement("a");
    view_original.classList.add("message-card-embed-view-original");
    view_original.setAttribute("href", payload.permalink ?? payload.fallback_link);
    view_original.textContent = "View original";
    footer.append(view_original);

    message_embed.append(footer);
}

function build_collapsed_media_wrapper(
    link_text: string,
    original_html: string,
    platform?: string | null,
): HTMLSpanElement {
    assert(inertDocument !== undefined);

    const collapsed_link = inertDocument.createElement("span");
    collapsed_link.classList.add("message-media-collapsed-image-link");
    collapsed_link.textContent = link_text;

    const expand_button = inertDocument.createElement("a");
    expand_button.setAttribute("role", "button");
    expand_button.setAttribute("tabindex", "0");
    expand_button.classList.add(
        "message-media-expand-button",
        "icon-button",
        "icon-button-square",
        "icon-button-neutral",
    );
    expand_button.setAttribute("aria-label", $t({defaultMessage: "Show preview"}));
    const expand_icon = inertDocument.createElement("i");
    expand_icon.classList.add("zulip-icon", "zulip-icon-expand");
    expand_icon.setAttribute("aria-hidden", "true");
    expand_button.append(expand_icon);

    // Deliberately not tagged .message-media-inline-image: that
    // class is what several other click handlers key off of to
    // assume an <img> is present, which isn't true here. The
    // stashed original markup lives on the wrapper, not on either
    // clickable child, so either one can trigger expansion via the
    // same lookup in lightbox.ts.
    const media_wrapper = inertDocument.createElement("span");
    media_wrapper.classList.add("message-media-collapsed-image");
    media_wrapper.dataset["collapsedImageHtml"] = original_html;
    if (platform) {
        media_wrapper.setAttribute("data-platform", platform);
    }
    media_wrapper.append(collapsed_link, expand_button);
    return media_wrapper;
}

export function postprocess_content(
    html: string,
    options: {
        force_show_upload_thumbnails?: boolean;
        force_hide_upload_thumbnails?: boolean;
    } = {},
): string {
    const show_upload_thumbnails =
        options.force_hide_upload_thumbnails === true
            ? false
            : user_settings.miatsuco_web_show_upload_thumbnails ||
              options.force_show_upload_thumbnails === true;

    inertDocument ??= new DOMParser().parseFromString("", "text/html");
    const template = inertDocument.createElement("template");
    template.innerHTML = html;

    process_emoji_only_message(template.content);

    for (const ol of template.content.querySelectorAll("ol")) {
        const list_start = Number(ol.getAttribute("start") ?? 1);
        // We don't count the first item in the list, as it
        // will be identical to the start value
        const list_length = ol.children.length - 1;
        const max_list_counter = list_start + list_length;
        // We count the characters in the longest list counter,
        // and use that to offset the list accordingly in CSS
        const max_list_counter_string_length = max_list_counter.toString().length;
        ol.classList.add(`counter-length-${max_list_counter_string_length}`);
        // We subtract 1 from list_start, as `count 0` displays 1.
        ol.style.setProperty("counter-reset", `count ${list_start - 1}`);
    }

    // Here we're setting up better processing of message embeds;
    // In the future, we will be able to write logic here to permit
    // recipients to remove embeds on a per-message basis.
    // We want to do this processing up front, so that embeds benefit
    // from other processing below for links and images
    for (const message_embed of template.content.querySelectorAll(".message_embed")) {
        if (!show_upload_thumbnails) {
            // Collapse website previews the same way as uploaded-file
            // previews: never fetch a preview image, and show a
            // compact click-to-expand link instead.
            const title_link =
                message_embed.querySelector<HTMLAnchorElement>(".message_embed_title a");
            const image_link =
                message_embed.querySelector<HTMLAnchorElement>(".message_embed_image");
            const href = title_link?.getAttribute("href") ?? image_link?.getAttribute("href");
            if (href) {
                const link_text = title_link?.textContent;
                const media_wrapper = build_collapsed_media_wrapper(
                    link_text && link_text.length > 0 ? link_text : href,
                    message_embed.outerHTML,
                    message_embed.getAttribute("data-platform"),
                );
                message_embed.parentNode?.replaceChild(media_wrapper, message_embed);
                continue;
            }
        }

        const message_card_embed_payload_json =
            message_embed.getAttribute("data-message-card-embed");
        if (message_card_embed_payload_json !== null) {
            enhance_message_card_embed(message_embed, message_card_embed_payload_json);
            continue;
        }

        const message_embed_title_link = message_embed.querySelector(".message_embed_title a");
        // Add a class to the anchor tag on embed-title links for easier
        // reference from CSS
        message_embed_title_link?.classList.add("message-embed-title-link");
    }

    for (const elt of template.content.querySelectorAll("a")) {
        // Ensure that all external links have target="_blank"
        // rel="opener noreferrer".  This ensures that external links
        // never replace the Zulip web app while also protecting
        // against reverse tabnapping attacks, without relying on the
        // correctness of how Zulip's Markdown processor generates links.
        //
        // Fragment links, which we intend to only open within the
        // Zulip web app using our hashchange system, do not require
        // these attributes.
        const href = elt.getAttribute("href");
        if (href === null) {
            continue;
        }
        let url;
        try {
            url = new URL(href, window.location.href);
        } catch {
            elt.removeAttribute("href");
            elt.removeAttribute("title");
            continue;
        }

        // eslint-disable-next-line no-script-url
        if (["data:", "javascript:", "vbscript:"].includes(url.protocol)) {
            // Remove unsafe links completely.
            elt.removeAttribute("href");
            elt.removeAttribute("title");
            continue;
        }

        // We detect URLs that are just fragments by comparing the URL
        // against a new URL generated using only the hash.
        if (url.hash === "" || url.href !== new URL(url.hash, window.location.href).href) {
            elt.setAttribute("target", "_blank");
            elt.setAttribute("rel", "noopener noreferrer");
        } else {
            elt.removeAttribute("target");
        }

        if (!elt.parentElement?.classList.contains("message_inline_image")) {
            // For non-media (images, video) user uploads, the following block
            // ensures that the title attribute always displays the filename,
            // as a security measure.
            let title: string;
            let legacy_title: string;
            if (
                url.origin === window.location.origin &&
                url.pathname.startsWith("/user_uploads/")
            ) {
                // We add the word "download" to make clear what will
                // happen when clicking the file.  This is particularly
                // important in the desktop app, where hovering a URL does
                // not display the URL like it does in the web app.
                title = legacy_title = $t(
                    {defaultMessage: "Download {filename}"},
                    {
                        filename: decodeURIComponent(
                            url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
                        ),
                    },
                );
            } else {
                title = url.toString();
                legacy_title = href;
            }
            elt.setAttribute(
                "title",
                ["", legacy_title].includes(elt.title) ? title : `${title}\n${elt.title}`,
            );
        }
    }

    // We need to quickly wrap inline images so we can pass them onto the
    // image-processing loop below.
    for (const inline_img_elt of template.content.querySelectorAll(".inline-image")) {
        const original_src = inline_img_elt.getAttribute("data-original-src");
        assert(typeof original_src === "string");
        const alt = inline_img_elt.getAttribute("alt");

        if (!show_upload_thumbnails) {
            // Bandwidth- and space-saving personal preference: never
            // insert an <img> with a fetchable src into the DOM for
            // uploaded files. Show a compact click-to-expand link
            // instead, and stash the original, unprocessed markup so
            // a click handler can build the real preview on demand
            // by re-running this same function.
            const filename_from_url = (() => {
                try {
                    return decodeURIComponent(
                        original_src.slice(original_src.lastIndexOf("/") + 1),
                    );
                } catch {
                    return original_src.slice(original_src.lastIndexOf("/") + 1);
                }
            })();
            const link_text = alt && alt.length > 0 ? alt : filename_from_url;
            const media_wrapper = build_collapsed_media_wrapper(
                link_text,
                inline_img_elt.outerHTML,
            );
            inline_img_elt.parentNode?.replaceChild(media_wrapper, inline_img_elt);
            continue;
        }

        const media_wrapper = inertDocument.createElement("span");
        media_wrapper.classList.add("message-media-inline-image");

        // If one or more inline images sit in a paragraph in isolation,
        // or are separated only by line breaks, we will include those
        // images in a gallery via the logic further down in this file.
        const inline_img_parent_elt = inline_img_elt.parentElement;
        // We want to determine the length after trimming out the spaces
        // from line breaks; this value will be precisely zero if the
        // containing paragraph has no text content, including things
        // that might be tucked in a link or a bold tag, etc.
        const inline_img_parent_elt_name = inline_img_parent_elt?.tagName.toLowerCase();

        if (inline_img_parent_elt_name === "p" && !is_media_run_inline_with_text(inline_img_elt)) {
            media_wrapper.classList.add("message-media-gallery-image");
            // Multiple images may be separated by break tags, which will
            // be unnecessary and make trouble for correctly placing
            // adjacent images into a single gallery, when we process them.
            // However, in a message with deliberate line breaks elsewhere,
            // like between lines of text, we need to be careful to preserve
            // those and instead just remove those that precede the
            // inline_img_elt we're working with.
            const image_elt_prev_element_sibling = inline_img_elt.previousElementSibling;

            // We remove any previous element-sibling break tags, but leave
            // the any trailing break tags to properly detect other images
            // that may need to be included in a gallery. Any trailing break
            // tags are removed at the point that the gallery gets inserted
            // into the DOM (at which point they will be trailing the gallery
            // itself).
            if (image_elt_prev_element_sibling?.tagName?.toLowerCase() === "br") {
                image_elt_prev_element_sibling.remove();
            }
        } else if (is_media_run_inline_with_text(inline_img_elt)) {
            // When an inline image opens a message, we use CSS to adjust
            // the space added to the start of the image, keeping it flush
            // with the message box.
            const image_elt_prev_sibling_node = inline_img_elt.previousSibling;
            if (image_elt_prev_sibling_node === null) {
                inline_img_elt.classList.add("image-opens-message");
            }
        }

        const media_link = inertDocument.createElement("a");
        media_link.setAttribute("href", original_src);
        media_link.setAttribute("target", "_blank");
        media_link.setAttribute("rel", "noopener noreferrer");

        if (alt) {
            media_link.setAttribute("title", alt);
        }

        media_link.append(inline_img_elt.cloneNode(true));
        media_wrapper.append(media_link);
        inline_img_elt.parentNode?.replaceChild(media_wrapper, inline_img_elt);
    }

    for (const message_media_wrapper of template.content.querySelectorAll(
        ".message_inline_image, .message-media-inline-image",
    )) {
        const message_media_link = message_media_wrapper.querySelector("a");
        const message_media_image = message_media_wrapper.querySelector("img");
        const message_media_video = message_media_wrapper.querySelector("video");

        if (
            !show_upload_thumbnails &&
            (message_media_image ?? message_media_video) &&
            message_media_link
        ) {
            // Collapse linked image/video previews the same way as
            // uploaded-file previews: never fetch a preview image or
            // video, and show a compact click-to-expand link
            // instead. Any wrapper reaching this point while the
            // setting is off is guaranteed to be a link preview, not
            // an uploaded file, since those are already intercepted
            // and collapsed above.
            const href = message_media_link.getAttribute("href");
            if (href) {
                const link_text =
                    message_media_link.getAttribute("title") ??
                    message_media_link.getAttribute("aria-label");
                let platform;
                if (message_media_wrapper.classList.contains("youtube-video")) {
                    platform = "youtube";
                } else if (message_media_wrapper.classList.contains("embed-video")) {
                    platform = "vimeo";
                } else if (/^https?:\/\/open\.spotify\.com\//i.test(href)) {
                    platform = "spotify";
                } else if (/^https?:\/\/(www\.)?soundcloud\.com\//i.test(href)) {
                    platform = "soundcloud";
                }
                const media_wrapper = build_collapsed_media_wrapper(
                    link_text && link_text.length > 0 ? link_text : href,
                    message_media_wrapper.outerHTML,
                    platform,
                );
                message_media_wrapper.parentNode?.replaceChild(
                    media_wrapper,
                    message_media_wrapper,
                );
                continue;
            }
        }

        // We want a class to refer to media links
        message_media_link?.classList.add("media-anchor-element");

        // For inline media, we want to handle the tooltips explicitly and
        // disable the browser's built in handling of the title attribute.
        const title = message_media_link?.getAttribute("title");
        if (typeof title === "string") {
            message_media_link?.setAttribute("aria-label", title);
            message_media_link?.removeAttribute("title");
        }

        // Update older, smaller default.jpg YouTube preview images
        // with higher-quality preview images (320px wide)
        if (message_media_wrapper.classList.contains("youtube-video")) {
            assert(message_media_image instanceof HTMLImageElement);
            const img_src = message_media_image.src;
            if (img_src.endsWith("/default.jpg")) {
                const mq_src = img_src.replace(/\/default.jpg$/, "/mqdefault.jpg");
                message_media_image.src = mq_src;
            }
        }

        // Replace the legacy .message_inline_image class, whose
        // name would add confusion when Zulip supports inline
        // images via standard Markdown, with dedicated classes
        // for video and image previews.
        if (message_media_video) {
            message_media_wrapper.classList.replace(
                "message_inline_image",
                "message-media-preview-video",
            );
            message_media_video.classList.add("media-video-element", "media-image-element");
        } else if (message_media_image) {
            message_media_wrapper.classList.replace(
                "message_inline_image",
                "message-media-preview-image",
            );
            message_media_image.classList.add("media-image-element");
            message_media_image.setAttribute("loading", "lazy");

            // We can't just check whether `inline_image.src` starts with
            // `/user_uploads/thumbnail`, even though that's what the
            // server writes in the markup, because Firefox will have
            // already prepended the origin to the source of an image.
            let image_url;
            try {
                image_url = new URL(message_media_image.src, window.location.origin);
            } catch {
                // If the image source URL can't be parsed, likely due to
                // some historical bug in the Markdown processor, just
                // drop the invalid image element.
                message_media_image
                    .closest(".message-media-preview-image, .message-media-inline-image")!
                    .remove();
                continue;
            }

            if (
                image_url.origin === window.location.origin &&
                image_url.pathname.startsWith("/user_uploads/thumbnail/")
            ) {
                let thumbnail_name = thumbnail.preferred_format.name;
                if (message_media_image.getAttribute("data-animated") === "true") {
                    if (
                        user_settings.web_animate_image_previews === "always" ||
                        // Treat on_hover as "always" on mobile web, where
                        // hovering is impossible and there's much less on
                        // the screen.
                        (user_settings.web_animate_image_previews === "on_hover" &&
                            util.is_mobile())
                    ) {
                        thumbnail_name = thumbnail.animated_format.name;
                    } else {
                        // If we're showing a still thumbnail, show a play
                        // button so that users that it can be played.
                        message_media_image
                            .closest(".message-media-preview-image, .message-media-inline-image")!
                            .classList.add("message_inline_animated_image_still");
                    }
                }
                message_media_image.src = message_media_image.src.replace(
                    /\/[^/]+$/,
                    "/" + thumbnail_name,
                );
            }
        }

        // To prevent layout shifts and flexibly size image previews,
        // we read the image's original dimensions, when present, and
        // set those values as `height` and `width` attributes on the
        // image source.
        if (message_media_image?.hasAttribute("data-original-dimensions")) {
            const original_dimensions_attribute = message_media_image.getAttribute(
                "data-original-dimensions",
            );
            assert(original_dimensions_attribute);
            const original_dimensions: string[] = original_dimensions_attribute.split("x");
            assert(
                original_dimensions.length === 2 &&
                    typeof original_dimensions[0] === "string" &&
                    typeof original_dimensions[1] === "string",
            );

            const original_width = Number(original_dimensions[0]);
            const original_height = Number(original_dimensions[1]);
            const font_size_in_use = user_settings.web_font_size_px;
            // At 20px/1em, image boxes are 200px by 80px in either
            // horizontal or vertical orientation; 80 / 200 = 0.4
            // We need to show more of the background color behind
            // these extremely tall or extremely wide images, and
            // use a subtler background color than on other images
            const image_min_aspect_ratio = 0.4;
            // "Dinky" images are those that are shorter than the
            // height reserved for thumbnails
            const image_box_em = thumbnail.get_media_preview_size();
            const is_dinky_image = original_height / font_size_in_use <= image_box_em;
            const has_extreme_aspect_ratio =
                original_width / original_height <= image_min_aspect_ratio ||
                original_height / original_width <= image_min_aspect_ratio;
            const is_portrait_image = original_width <= original_height;

            message_media_image.setAttribute("width", `${original_width}`);
            message_media_image.setAttribute("height", `${original_height}`);

            // Despite setting `width` and `height` values above, the
            // flexbox gallery collapses until images have loaded. We
            // therefore have to prevent a layout shift that would
            // otherwise happen by setting the width attribute here.
            // And by setting this value in ems, we ensure that
            // images scale as users adjust the information-density
            // settings.
            message_media_image.style.setProperty(
                "width",
                `${(image_box_em * original_width) / original_height}em`,
            );

            // To avoid a layout shift especially on portrait images, we
            // set the `aspect-ratio`, which flexbox respects and will
            // therefore preserve exactly the correct amount of space
            // prior to the image loading.
            message_media_image.style.setProperty(
                "aspect-ratio",
                `${original_width} / ${original_height}`,
            );

            if (is_dinky_image) {
                message_media_image.classList.add("dinky-thumbnail");
                // For dinky images, we just set the original width
                message_media_image.style.setProperty("width", `${original_width}px`);
            }

            if (has_extreme_aspect_ratio) {
                message_media_image.classList.add("extreme-aspect-ratio");
            }

            if (is_portrait_image) {
                message_media_image.classList.add("portrait-thumbnail");
            } else {
                message_media_image.classList.add("landscape-thumbnail");
            }
        }
    }

    // After all other processing on images has been done, we look for
    // adjacent images and videos, and tuck them structurally into galleries.
    for (const elt of template.content.querySelectorAll(
        ".message-media-gallery-image, .message-media-preview-image, .message-media-preview-video, .message-card-embed",
    )) {
        let gallery_element;

        const is_part_of_open_gallery = elt.previousElementSibling?.classList.contains(
            "message-thumbnail-gallery",
        );

        if (is_part_of_open_gallery) {
            // If the current media element's previous sibling is a gallery,
            // it should be kept with the other media in that gallery.
            gallery_element = elt.previousElementSibling;
        } else {
            // Otherwise, we've found an image element that follows some other
            // content (or is the first in the message) and need to create a
            // gallery for it, and perhaps other adjacent sibling media elements,
            // if they exist.
            if (elt.classList.contains("message-media-gallery-image")) {
                // Because inline images may be presented in galleries in the middle
                // of a paragraph, we create those as `<span>` elements. That prevents
                // the client-side markdown from doing a slipshod job of inserting
                // empty `<p>` elements or leaving orphaned text nodes around a `<div>`,
                // which isn't allowed to appear inside of a `<p>`.
                gallery_element = inertDocument.createElement("span");
            } else {
                // However, for legacy galleries that always appear after a paragraph,
                // we create a `<div>` element.
                gallery_element = inertDocument.createElement("div");
            }

            // Regardless of what element the gallery is, we add the
            // .message-thumbnail-gallery class, whose CSS selectors
            // will style this as a flexbox regardless.
            gallery_element.classList.add("message-thumbnail-gallery");

            // We insert a new gallery just before the media element we've found
            elt.before(gallery_element);
        }

        // Move the media element into the current gallery
        gallery_element?.append(elt);

        // Delete any trailing <br> tag after new gallery element; this can
        // happen when there's an image trailed by a break and more text.
        if (gallery_element?.nextElementSibling?.tagName.toLowerCase() === "br") {
            gallery_element.nextElementSibling.remove();
        }
    }

    return template.innerHTML;
}

// If an image is run inline with text--that is, there are non-whitespace
// text nodes adjacent the image--we will not put it into a gallery.
function is_media_run_inline_with_text(media_elt: Element): boolean {
    const media_elt_previous_sibling_node = media_elt.previousSibling;
    const media_elt_next_sibling_node = media_elt.nextSibling;

    // A standalone image in its own paragraph will have no sibling nodes
    if (media_elt_previous_sibling_node === null && media_elt_next_sibling_node === null) {
        return false;
    }

    // For images that have text nodes, we need to consider the nodeValue;
    // these will be `null` for element nodes. We do not want to trim these
    // values, because that would wipe out newlines, "\n", which we are
    // interested in detecting.
    const previous_sibling_node_value = media_elt_previous_sibling_node?.nodeValue;
    const next_sibling_node_value = media_elt_next_sibling_node?.nodeValue;

    // For images that have adjacent element nodes, we examine the nodeName.
    const previous_sibling_node_name = media_elt_previous_sibling_node?.nodeName?.toLowerCase();
    const next_sibling_node_name = media_elt_next_sibling_node?.nodeName?.toLowerCase();

    // Any adjacent newlines or break tags mean that this image not run
    // inline with text.
    if (
        previous_sibling_node_value === "\n" ||
        next_sibling_node_value === "\n" ||
        previous_sibling_node_name === "br" ||
        next_sibling_node_name === "br"
    ) {
        return false;
    }

    return true;
}

// Process single-paragraph messages that contain only emoji.
function process_emoji_only_message(content: DocumentFragment): void {
    // Exit as quickly as possible when more than one child element
    // exists or the first child element is not a paragraph.
    if (content.childElementCount !== 1 || content.firstElementChild?.tagName !== "P") {
        return;
    }

    // Now we look at the collection of child nodes on the single
    // paragraph to make sure there is no text in the paragraph's
    // text nodes.
    const paragraph_child_nodes = content.firstElementChild?.childNodes;
    assert(paragraph_child_nodes !== undefined);
    for (const node of paragraph_child_nodes) {
        if (node.nodeName === "#text" && node.textContent?.trim() !== "") {
            // If we find a #text node that doesn't trim down
            // to the empty string, then the message has text
            // content, so we should exit swiftly.
            return;
        }
    }

    // Having gotten this far, we check the child elements to make
    // sure there are none other than spans for system emoji or
    // img tags for realm emoji--both of which take the .emoji class.
    const paragraph_child_elements = content.firstElementChild?.children;
    assert(paragraph_child_elements !== undefined);
    for (const element of paragraph_child_elements) {
        if (!element.classList.contains("emoji")) {
            // Any element without the .emoji class is obviously not
            // emoji, so we again exit swiftly.
            return;
        }
    }

    // If we haven't returned by now, this is an emoji-only message,
    // so we add .emoji-only to the paragraph element for styling
    // the emoji in CSS.
    content.firstElementChild?.classList.add("emoji-only");
}
