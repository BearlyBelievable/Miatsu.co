import $ from "jquery";
import type * as z from "zod/mini";

import {realm} from "./state_data.ts";
import type {thumbnail_format_schema} from "./state_data.ts";

type ThumbnailFormat = z.infer<typeof thumbnail_format_schema>;

export const thumbnail_formats: ThumbnailFormat[] = [];

export let preferred_format: ThumbnailFormat;
export let animated_format: ThumbnailFormat;

const SPOTIFY_EMBED_COMPACT_HEIGHT_PX = 80;
const SPOTIFY_EMBED_EXPANDED_HEIGHT_PX = 152;

// Upstream's 100/150/200 -> 10/15/20em scaling left the default
// height below what inline video embeds need to clear a minimum
// size (see miatsuco_inline_embed.ts).
const PREVIEW_SIZE_EM: Record<number, number> = {
    100: 12.5,
    150: 16,
    200: 20,
};
const DEFAULT_PREVIEW_SIZE_EM = 12.5;

export function get_media_preview_size(): number {
    return PREVIEW_SIZE_EM[realm.realm_media_preview_size] ?? DEFAULT_PREVIEW_SIZE_EM;
}

export function set_media_preview_size_css_variable(): void {
    $(":root").css("--media-preview-max-height", `${get_media_preview_size()}em`);

    const spotify_embed_height_px =
        realm.realm_media_preview_size > 150
            ? SPOTIFY_EMBED_EXPANDED_HEIGHT_PX
            : SPOTIFY_EMBED_COMPACT_HEIGHT_PX;
    $(":root").css("--spotify-embed-height", `${spotify_embed_height_px}px`);
}

export function initialize(): void {
    // Go looking for the size closest to 840px wide.  We assume all browsers
    // support webp.
    const format_preferences = ["webp", "jpg", "gif"];
    const sorted_formats = realm.server_thumbnail_formats.toSorted((a, b) => {
        if (a.max_width !== b.max_width) {
            return Math.abs(a.max_width - 840) < Math.abs(b.max_width - 840) ? -1 : 1;
        } else if (a.format !== b.format) {
            let a_index = format_preferences.indexOf(a.format);
            if (a_index === -1) {
                a_index = format_preferences.length;
            }
            let b_index = format_preferences.indexOf(b.format);
            if (b_index === -1) {
                b_index = format_preferences.length;
            }
            return a_index - b_index;
        }

        return 0;
    });
    preferred_format = sorted_formats.find((format) => !format.animated)!;
    animated_format = sorted_formats.find((format) => format.animated)!;
}
