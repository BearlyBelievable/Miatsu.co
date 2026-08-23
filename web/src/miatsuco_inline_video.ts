import $ from "jquery";

import {$t} from "./i18n.ts";

// MiAtSu.Co fork: make inline videos play in place with the native HTML5
// player, instead of acting as a poster-frame link that opens the lightbox.
//
// Upstream renders an inline video as a non-interactive preview <video>
// with no controls, wrapped in an <a href> pointing at the file, with a
// CSS play-button overlay drawn via ::after. A delegated handler (see
// lightbox.ts) catches clicks on the container and opens the lightbox (a
// separate <video controls>). Audio, by contrast, embeds a real player and
// plays inline. This brings video in line with audio and with an ordinary
// HTML5 player, making the lightbox unnecessary for anything but images.
//
// For each supported inline video we:
//   - Add `controls`, making the embed a real player
//   - Add a marker class so the CSS play-button overlay and zoom cursor are
//     suppressed (see rendered_markdown.css)
//   - Stop click propagation from the <video> so upstream's delegated
//     lightbox handler does not fire (we do not call preventDefault here, so
//     the native player's own controls keep working)
//   - Call preventDefault on the wrapping <a> so interacting with the player does
//     not navigate to the raw file
//
// Unsupported-format videos are left alone, so upstream's fallback (hidden
// preview, download link) still applies.
//
// This runs from the rendered-content hook (see rendered_markdown.ts) so it
// applies to each message as it renders, rather than modifying upstream's
// markdown output or editing its lightbox handler. See
// docs/contributing/miatsuco-fork-conventions.md.

// Map a video URL to the container MIME type the backend uses to decide the
// file is an inline video (see is_video in zerver/lib/markdown/__init__.py:
// video/mp4, video/quicktime, video/webm). The <video> carries only a src, no
// type attribute, so the extension is all we have. This is a coarse container
// check, not a codec check. It's used only to detect a browser that cannot
// play the container at all, so returning undefined (proceed as normal) for
// anything unrecognized is the safe default.
function container_mime_type_for_url(src: string): string | undefined {
    // Drop any query string or fragment before reading the extension.
    const path = src.split(/[?#]/, 1)[0] ?? src;
    const extension = path.split(".").pop()?.toLowerCase();
    switch (extension) {
        case "mp4":
            return "video/mp4";
        case "mov":
            return "video/quicktime";
        case "webm":
            return "video/webm";
        default:
            return undefined;
    }
}

// Marks a video container as unplayable and turns its wrapping <a> into a
// visible fallback link, instead of the container just disappearing.
export function mark_video_format_unsupported($container: JQuery): void {
    $container.addClass("video-format-unsupported");
    $container.find("a").text($t({defaultMessage: "Video preview unavailable"}));
}

export function enhance_inline_videos(content: JQuery): void {
    // Callers pass a container element whose inline videos are descendants
    // (the rendered-content hook passes the message content wrapper; the
    // collapse and expand handler passes the expanded row after the video
    // has been appended into it). We therefore match descendants only.
    content.find(".message_inline_video").each((_index, container) => {
        const $container = $(container);
        if ($container.hasClass("video-format-unsupported")) {
            return;
        }
        if ($container.attr("data-miatsuco-inline-video") === "1") {
            return;
        }
        const $video = $container.find("video");
        if ($video.length === 0) {
            return;
        }

        // If the browser is certain it can't play this container, present the
        // download link instead of a player that would refuse to start.
        const video_element = $video[0];
        const src = $video.attr("src");
        if (
            video_element !== undefined &&
            typeof video_element.canPlayType === "function" &&
            src !== undefined
        ) {
            const mime_type = container_mime_type_for_url(src);
            if (mime_type !== undefined && video_element.canPlayType(mime_type) === "") {
                mark_video_format_unsupported($container);
                return;
            }
        }

        $container.attr("data-miatsuco-inline-video", "1");

        // Turn the poster preview into a real player.
        $video.attr("controls", "true");
        $container.addClass("miatsuco-inline-video-playable");

        // Drop the media-image-element class (postprocess_content adds it to
        // inline videos alongside media-video-element).
        $video.removeClass("media-image-element");

        // Disable native drag-and-drop on the player and its wrapping
        // anchor.
        const $anchor = $container.find("a");
        $video.attr("draggable", "false");
        $anchor.attr("draggable", "false");

        // Keep clicks on the player from reaching upstream's delegated
        // lightbox handler, without suppressing the native controls.
        $video.on("click", (event) => {
            event.stopPropagation();
        });

        $anchor.on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    });
}
