import {isValid, parseISO} from "date-fns";
import $ from "jquery";
import * as z from "zod/mini";

import {$t} from "./i18n.ts";
import * as timerender from "./timerender.ts";

const RECENT_POST_CUTOFF_HOURS = 24;

function format_post_timestamp(date: Date): string {
    const ms_old = Date.now() - date.getTime();
    const hours_old = ms_old / (60 * 60 * 1000);
    if (hours_old >= RECENT_POST_CUTOFF_HOURS) {
        const is_current_year = date.getFullYear() === new Date().getFullYear();
        return timerender.get_localized_date_or_time_for_format(
            date,
            is_current_year ? "dayofyear" : "dayofyear_year",
        );
    }

    const minutes_old = Math.floor(ms_old / (60 * 1000));
    if (minutes_old < 1) {
        return $t({defaultMessage: "Now"});
    }
    if (minutes_old < 60) {
        return $t({defaultMessage: "{minutes}m"}, {minutes: minutes_old});
    }
    return $t({defaultMessage: "{hours}h"}, {hours: Math.floor(hours_old)});
}

export function enhance_message_card_embed_timestamps(content: JQuery): void {
    content.find(".message-card-embed-timestamp").each((_index, element) => {
        const $time = $(element);
        const time_str = $time.attr("datetime");
        if (time_str === undefined) {
            return;
        }
        const timestamp = parseISO(time_str);
        if (!isValid(timestamp)) {
            return;
        }
        $time.text(format_post_timestamp(timestamp));
    });
}

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

function build_message_card_embed_media_item(
    doc: Document,
    item: MessageCardEmbedMediaItem,
): HTMLElement {
    const wrapper = doc.createElement("div");
    wrapper.classList.add("message_inline_image");
    if (item.kind === "video") {
        wrapper.classList.add("message_inline_video");
        const video = doc.createElement("video");
        video.setAttribute("preload", "metadata");
        video.setAttribute("src", item.url);
        wrapper.append(video);
    } else {
        const link = doc.createElement("a");
        link.setAttribute("href", item.url);
        if (item.alt_text) {
            link.setAttribute("title", item.alt_text);
        }
        const img = doc.createElement("img");
        img.setAttribute("loading", "lazy");
        img.setAttribute("src", item.url);
        link.append(img);
        wrapper.append(link);
    }
    return wrapper;
}

function build_message_card_embed_header(
    doc: Document,
    header: HTMLElement,
    author: {
        author_name?: string | null | undefined;
        author_handle?: string | null | undefined;
        author_avatar_url?: string | null | undefined;
    },
    created_at: string | null,
    platform_icon: [string, string] | undefined,
): void {
    if (author.author_avatar_url) {
        const avatar = doc.createElement("img");
        avatar.classList.add("message-card-embed-avatar");
        avatar.setAttribute("loading", "lazy");
        avatar.setAttribute("src", author.author_avatar_url);
        header.append(avatar);
    }

    const author_elm = doc.createElement("span");
    author_elm.classList.add("message-card-embed-author");

    if (author.author_name) {
        const name_elm = doc.createElement("span");
        name_elm.classList.add("message-card-embed-author-name");
        name_elm.textContent = author.author_name;
        author_elm.append(name_elm);
    }

    let handle_elm: HTMLElement | undefined;
    if (author.author_handle) {
        handle_elm = doc.createElement("span");
        handle_elm.classList.add("message-card-embed-author-handle");
        handle_elm.textContent = "@" + author.author_handle;
        author_elm.append(handle_elm);
    }

    if (created_at) {
        if (handle_elm) {
            handle_elm.append(" · ");
        }
        const time_elm = doc.createElement("time");
        time_elm.classList.add("message-card-embed-timestamp");
        time_elm.setAttribute("datetime", created_at);
        time_elm.textContent = created_at;
        (handle_elm ?? author_elm).append(time_elm);
    }

    header.append(author_elm);

    if (platform_icon) {
        const [label_text, icon_name] = platform_icon;
        const badge = doc.createElement("span");
        badge.classList.add("message-card-embed-badge");
        badge.setAttribute("aria-label", label_text);
        const icon = doc.createElement("i");
        icon.classList.add("zulip-icon", `zulip-icon-${icon_name}`);
        icon.setAttribute("aria-hidden", "true");
        badge.append(icon);
        header.append(badge);
    }
}

function build_message_card_embed_quote(
    doc: Document,
    container: Element,
    quote: MessageCardEmbedQuote,
): void {
    if (quote.unavailable_reason !== null) {
        const unavailable = doc.createElement("div");
        unavailable.classList.add("message-card-embed-quote-unavailable");
        unavailable.textContent = `Quoted post unavailable (${quote.unavailable_reason})`;
        container.append(unavailable);
        return;
    }

    const quote_container = doc.createElement("div");
    quote_container.classList.add("message-card-embed-quote");

    const header = doc.createElement("div");
    header.classList.add("message-card-embed-header");
    build_message_card_embed_header(doc, header, quote, null, undefined);
    quote_container.append(header);

    if (quote.text) {
        const text_elm = doc.createElement("div");
        text_elm.classList.add("message-card-embed-text");
        text_elm.textContent = quote.text;
        quote_container.append(text_elm);
    }

    if (quote.media && quote.media.length > 0) {
        const media_container = doc.createElement("div");
        media_container.classList.add("message-card-embed-media");
        for (const item of quote.media) {
            media_container.append(build_message_card_embed_media_item(doc, item));
        }
        quote_container.append(media_container);
    }

    container.append(quote_container);
}

export function enhance_message_card_embed(
    doc: Document,
    message_embed: Element,
    payload_json: string,
): void {
    let payload;
    try {
        payload = message_card_embed_payload_schema.parse(JSON.parse(payload_json));
    } catch {
        return;
    }

    message_embed.classList.add("message-card-embed");
    message_embed.replaceChildren();

    const header = doc.createElement("div");
    header.classList.add("message-card-embed-header");
    build_message_card_embed_header(
        doc,
        header,
        payload,
        payload.created_at,
        MESSAGE_CARD_EMBED_PLATFORM_ICONS[payload.platform],
    );
    message_embed.append(header);

    if (payload.text) {
        const text_elm = doc.createElement("div");
        text_elm.classList.add("message-card-embed-text");
        text_elm.textContent = payload.text;
        message_embed.append(text_elm);
    }

    if (payload.media.length > 0) {
        const media_container = doc.createElement("div");
        media_container.classList.add("message-card-embed-media");
        for (const item of payload.media) {
            media_container.append(build_message_card_embed_media_item(doc, item));
        }
        message_embed.append(media_container);
    }

    const footer = doc.createElement("div");
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
        const stats_elm = doc.createElement("span");
        stats_elm.classList.add("message-card-embed-stats");
        stats_elm.textContent = stats_text;
        footer.append(stats_elm);
    }

    if (payload.quote) {
        build_message_card_embed_quote(doc, message_embed, payload.quote);
    }

    const view_original = doc.createElement("a");
    view_original.classList.add("message-card-embed-view-original");
    view_original.setAttribute("href", payload.permalink ?? payload.fallback_link);
    view_original.textContent = "View original";
    footer.append(view_original);

    message_embed.append(footer);
}
