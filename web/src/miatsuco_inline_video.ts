import $ from "jquery";

// MiAtSu.Co fork: make inline videos play in place with the native HTML5
// player, instead of acting as a poster-frame link that opens the lightbox.
//
// Upstream renders an inline video as a non-interactive preview: a <video>
// with no `controls`, wrapped in an <a href> pointing at the file, with a
// CSS play-button overlay drawn via ::after. A delegated handler (see
// lightbox.ts) catches clicks on the container and opens the lightbox (a
// separate <video controls>). Audio, by contrast, embeds a real player and
// plays inline. This brings video in line with audio and with an ordinary
// HTML5 player: the embed itself plays, and the player's own fullscreen
// control handles enlarging, so the lightbox is unnecessary.
//
// For each supported inline video we:
//   - add `controls`, making the embed a real player;
//   - add a marker class so the CSS play-button overlay and zoom cursor are
//     suppressed (see rendered_markdown.css);
//   - stop click propagation from the <video> so upstream's delegated
//     lightbox handler does not fire (we do not call preventDefault here, so
//     the native player's own controls keep working); and
//   - preventDefault on the wrapping <a> so interacting with the player does
//     not navigate to the raw file.
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
// check, not a codec check; it is used only to detect a browser that cannot
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

        // If the browser is certain it cannot play this container, present the
        // download-link fallback instead of a player that would refuse to
        // start. A refused native play() surfaces as a promise rejection, not
        // an "error" event, so upstream's error handler never fires for it and
        // the player would otherwise sit there snapping back to paused. We act
        // only on canPlayType's definitive "" (cannot play); "maybe" and
        // "probably" both proceed, so a file the browser might play is never
        // hidden. This is a container check, not a codec check, so it does not
        // catch a supported container holding an unsupported codec; that case
        // still relies on the error-event fallback.
        const video_element = $video[0];
        const src = $video.attr("src");
        if (
            video_element !== undefined &&
            typeof video_element.canPlayType === "function" &&
            src !== undefined
        ) {
            const mime_type = container_mime_type_for_url(src);
            if (mime_type !== undefined && video_element.canPlayType(mime_type) === "") {
                $container.addClass("video-format-unsupported");
                return;
            }
        }

        $container.attr("data-miatsuco-inline-video", "1");

        // Turn the poster preview into a real player.
        $video.attr("controls", "true");
        $container.addClass("miatsuco-inline-video-playable");

        // Drop the media-image-element class (postprocess_content adds it to
        // inline videos alongside media-video-element). That class is what
        // gives the preview its zoom-in cursor and its "Click to view or
        // download" hover tooltip, both of which describe the old
        // click-to-open-lightbox behavior and no longer apply to a player
        // that plays in place. The media-video-element class, which carries
        // the layout, is left in place.
        $video.removeClass("media-image-element");

        // Disable native drag-and-drop on the player and its wrapping
        // anchor. Both a <video> and an <a href> are draggable by default,
        // so dragging the seek bar across the video surface (which overlaps
        // the video for tall/portrait clips) would otherwise start dragging
        // the file or link instead of seeking. This is drag-and-drop only
        // and does not affect the native player controls. Upstream uses the
        // same draggable="false" approach on its own anchors.
        const $anchor = $container.find("a");
        $video.attr("draggable", "false");
        $anchor.attr("draggable", "false");

        // Keep clicks on the player from reaching upstream's delegated
        // lightbox handler, without suppressing the native controls.
        $video.on("click", (event) => {
            event.stopPropagation();
        });

        // Stop the wrapping <a> from navigating to the raw file.
        $anchor.on("click", (event) => {
            event.preventDefault();
        });
    });
}
