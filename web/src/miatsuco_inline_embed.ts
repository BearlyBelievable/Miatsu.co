import $ from "jquery";

import {realm} from "./state_data.ts";
import * as util from "./util.ts";

// Must match lightbox.ts's display_video() sandbox for these same types.
const IFRAME_SANDBOX =
    "allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts";

const RESIZE_REPORTER_SCRIPT =
    "<script>new ResizeObserver(()=>{parent.postMessage({miatsucoEmbedHeight:document.body.scrollHeight},'*')}).observe(document.body)</script>";

const RESIZE_HEIGHT_BUFFER_PX = 24;
const RESIZE_PADDING_PX = 24;

// Spotify embed controls get cut off internally rather than resizing
// under this min width, so we hold it at this min and scale it instead.
const SPOTIFY_EMBED_WIDTH_PX = 280;
let resize_listener_registered = false;

function update_spotify_narrow_scale(container: HTMLElement, parent: HTMLElement): void {
    const available_width = parent.clientWidth;
    const is_narrow = available_width > 0 && available_width < SPOTIFY_EMBED_WIDTH_PX;
    container.classList.toggle("spotify-embed-narrow", is_narrow);
    if (is_narrow) {
        container.style.setProperty(
            "--spotify-narrow-scale",
            String(available_width / SPOTIFY_EMBED_WIDTH_PX),
        );
    }
}

// The node test environment doesn't have ResizeObserver defined, so
// parentElement would otherwise throw without this.
function ensure_spotify_narrow_scale(container: HTMLElement): void {
    if (typeof ResizeObserver !== "function") {
        return;
    }
    const parent = container.parentElement;
    if (parent === null) {
        return;
    }
    update_spotify_narrow_scale(container, parent);
    new ResizeObserver(() => {
        update_spotify_narrow_scale(container, parent);
    }).observe(parent);
}

function ensure_resize_listener(): void {
    if (resize_listener_registered || typeof window.addEventListener !== "function") {
        return;
    }
    resize_listener_registered = true;

    window.addEventListener("message", (event: MessageEvent<unknown>) => {
        const {data} = event;
        if (typeof data !== "object" || data === null || !("miatsucoEmbedHeight" in data)) {
            return;
        }
        const {miatsucoEmbedHeight: height} = data;
        if (typeof height !== "number") {
            return;
        }
        for (const iframe of document.querySelectorAll("iframe")) {
            if (iframe.contentWindow !== event.source) {
                continue;
            }
            const $container = $(iframe).closest(".embed-rich");
            if ($container.length > 0) {
                $container.css({
                    height: height + RESIZE_HEIGHT_BUFFER_PX + 2 * RESIZE_PADDING_PX + "px",
                    padding: RESIZE_PADDING_PX + "px",
                });
            }
            break;
        }
    });
}

type EmbedSource = {
    src: string;
    allow: string | undefined;
    style: string | undefined;
    height: number | undefined | "css";
};

function extract_iframe_attr(html: string, attr: string): string | undefined {
    return new RegExp(`<iframe\\b[^>]*\\b${attr}=(["'])(.*?)\\1`, "i").exec(html)?.[2];
}

// Only accept an absolute http(s) URL, as oEmbed html is provider-supplied
// and unauthenticated for any URL via pyoembed's autodiscovery fallback.
function extract_safe_iframe_src(html: string): string | undefined {
    const src = extract_iframe_attr(html, "src");
    if (src === undefined) {
        return undefined;
    }
    let parsed;
    try {
        parsed = new URL(src);
    } catch {
        return undefined;
    }
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? src : undefined;
}

function is_safe_embed_src(src: string): boolean {
    try {
        return ["http:", "https:", "data:"].includes(new URL(src).protocol);
    } catch {
        return false;
    }
}

function resolve_css_color_var(
    css_property: "color" | "background-color",
    var_name: string,
): string | undefined {
    if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
        return undefined;
    }
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.setProperty(css_property, `var(${var_name})`);
    document.body.append(probe);
    const resolved = getComputedStyle(probe).getPropertyValue(css_property);
    probe.remove();
    return resolved;
}

function css_color_to_hex(value: string): string {
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    if (!match) {
        return "000000";
    }
    return [match[1]!, match[2]!, match[3]!]
        .map((component) => Number(component).toString(16).padStart(2, "0"))
        .join("");
}

function build_embed_source(container: JQuery, anchor: JQuery, url: string): EmbedSource {
    const data_id = anchor.attr("data-id");

    if (container.hasClass("youtube-video")) {
        let source = "https://www.youtube-nocookie.com/embed/" + data_id;
        const start_time = util.parse_youtube_start_time(url);
        if (start_time !== undefined) {
            source += "?start=" + start_time;
        }
        return {src: source, allow: undefined, style: undefined, height: undefined};
    }

    if (/^https?:\/\/(www\.)?soundcloud\.com\//i.test(url)) {
        const params = new URLSearchParams({
            url,
            auto_play: "false",
            show_artwork: realm.realm_media_preview_size < 150 ? "false" : "true",
            visual: "false",
        });
        // Matches the widget's primary color to Zulip accent, like the
        // Vimeo player below. SoundCloud's widget takes a single hex
        // triplet here unlike Vimeo's four-color scheme.
        const accent = resolve_css_color_var(
            "background-color",
            "--color-background-brand-solid-action-button",
        );
        if (accent !== undefined) {
            params.set("color", css_color_to_hex(accent));
        }
        return {
            src: "https://w.soundcloud.com/player/?" + params.toString(),
            allow: "autoplay; encrypted-media",
            style: undefined,
            height: "css",
        };
    }

    const embed_html = data_id ?? "";

    if (/^https?:\/\/open\.spotify\.com\//i.test(url)) {
        const spotify_src = extract_safe_iframe_src(embed_html);
        if (spotify_src !== undefined) {
            return {
                src: spotify_src,
                allow: extract_iframe_attr(embed_html, "allow"),
                style: extract_iframe_attr(embed_html, "style"),
                height: "css",
            };
        }
    }

    const real_src = extract_safe_iframe_src(embed_html);
    if (real_src !== undefined) {
        let final_src = real_src;
        if (/^https?:\/\/(www\.)?vimeo\.com\//i.test(url)) {
            const background = resolve_css_color_var("background-color", "--color-background");
            const accent = resolve_css_color_var(
                "background-color",
                "--color-background-brand-solid-action-button",
            );
            const text_icon = resolve_css_color_var("color", "--color-text-default");
            if (background !== undefined && accent !== undefined && text_icon !== undefined) {
                const vimeo_src = new URL(real_src);
                vimeo_src.searchParams.set(
                    "colors",
                    `${css_color_to_hex(background)},${css_color_to_hex(accent)},${css_color_to_hex(text_icon)},000000`,
                );
                final_src = vimeo_src.toString();
            }
        }
        return {
            src: final_src,
            allow: extract_iframe_attr(embed_html, "allow"),
            style: extract_iframe_attr(embed_html, "style"),
            height: undefined,
        };
    }

    return {
        src:
            "data:text/html," +
            window.encodeURIComponent(
                "<!DOCTYPE html><style>body{margin:0;background:transparent}</style>" +
                    embed_html +
                    RESIZE_REPORTER_SCRIPT,
            ),
        allow: undefined,
        style: undefined,
        height: undefined,
    };
}

function load_embed(container: JQuery): void {
    const anchor = container.find("a");
    const url = anchor.attr("href");
    if (url === undefined) {
        return;
    }

    const embed = build_embed_source(container, anchor, url);
    if (!is_safe_embed_src(embed.src)) {
        return;
    }

    const $iframe = $("<iframe>");
    $iframe.attr("sandbox", IFRAME_SANDBOX);
    $iframe.attr("src", embed.src);
    $iframe.attr("frameborder", 0);
    $iframe.attr("allowfullscreen", "true");
    $iframe.attr("referrerpolicy", "strict-origin-when-cross-origin");
    if (embed.allow !== undefined) {
        $iframe.attr("allow", embed.allow);
    }
    if (embed.style !== undefined) {
        $iframe.attr("style", embed.style);
    }

    if (embed.height !== "css") {
        const width = Number(container.attr("data-width"));
        const height = embed.height ?? Number(container.attr("data-height"));
        if (!Number.isNaN(width) && width > 0 && !Number.isNaN(height) && height > 0) {
            container.css({height: "auto", "aspect-ratio": `${width} / ${height}`});
        } else if (!Number.isNaN(height) && height > 0) {
            container.css("height", height + "px");
        }
    }

    container.empty().append($iframe);
    container.addClass("inline-embed-loaded");

    if (/^https?:\/\/open\.spotify\.com\//i.test(url)) {
        const container_element = container[0];
        if (container_element !== undefined) {
            ensure_spotify_narrow_scale(container_element);
        }
    }
}

const EMBED_PRELOAD_MARGIN_PX = 500;
let embed_intersection_observer: IntersectionObserver | undefined;

function ensure_embed_intersection_observer(): IntersectionObserver | undefined {
    if (embed_intersection_observer !== undefined) {
        return embed_intersection_observer;
    }
    // The node test environment doesn't have IntersectionObserver defined,
    // so embeds there load immediately instead of lazily.
    if (typeof IntersectionObserver !== "function") {
        return undefined;
    }
    embed_intersection_observer = new IntersectionObserver(
        (entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) {
                    continue;
                }
                observer.unobserve(entry.target);
                if (entry.target instanceof HTMLElement) {
                    load_embed($(entry.target));
                }
            }
        },
        // Starts loading slightly before the embed scrolls into view, so
        // it's ready by the time the user reaches it.
        {rootMargin: `${EMBED_PRELOAD_MARGIN_PX}px 0px`},
    );
    return embed_intersection_observer;
}

export function enhance_inline_embeds(content: JQuery): void {
    ensure_resize_listener();
    const observer = ensure_embed_intersection_observer();
    content.find(".youtube-video, .embed-video, .embed-rich").each((_index, element) => {
        const $container = $(element);
        if ($container.hasClass("inline-embed-loaded")) {
            return;
        }
        if (observer === undefined) {
            load_embed($container);
            return;
        }
        observer.observe(element);
    });
}
