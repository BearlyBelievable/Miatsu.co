import math
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal
from xml.etree.ElementTree import Element, SubElement

import orjson

from zerver.lib.camo import get_camo_url

MESSAGE_CARD_EMBED_PLATFORM_NAMES: dict[str, str] = {"twitter": "X", "bluesky": "Bluesky"}

SanitizeUrl = Callable[[str], "str | None"]


@dataclass
class MediaItem:
    kind: Literal["photo", "gif", "video"]
    url: str
    width: int | None = None
    height: int | None = None
    alt_text: str | None = None


@dataclass
class Quote:
    author_name: str | None = None
    author_handle: str | None = None
    author_avatar_url: str | None = None
    text: str | None = None
    permalink: str | None = None
    media: list[MediaItem] = field(default_factory=list)
    unavailable_reason: str | None = None


@dataclass
class SocialPost:
    platform: Literal["twitter", "bluesky"]
    author_name: str | None = None
    author_handle: str | None = None
    author_avatar_url: str | None = None
    text: str | None = None
    permalink: str | None = None
    created_at: datetime | None = None
    like_count: int | None = None
    repost_count: int | None = None
    reply_count: int | None = None
    media: list[MediaItem] = field(default_factory=list)
    quote: Quote | None = None


def _display_name(name: str | None, handle: str | None) -> str | None:
    if name and handle:
        return f"{name} (@{handle})"
    if name:
        return name
    if handle:
        return f"@{handle}"
    return None


def post_title(social_post: SocialPost) -> str:
    platform_name = MESSAGE_CARD_EMBED_PLATFORM_NAMES.get(
        social_post.platform, social_post.platform
    )
    author_display_name = _display_name(social_post.author_name, social_post.author_handle)
    if author_display_name:
        return f"{platform_name} - Post by {author_display_name}"
    return f"{platform_name} - Post"


def _preview_image_url(social_post: SocialPost, sanitize_url: SanitizeUrl) -> str | None:
    for item in social_post.media:
        if item.kind == "video":
            continue
        safe_url = sanitize_url(item.url)
        if safe_url is not None:
            return safe_url
    if social_post.author_avatar_url is not None:
        return sanitize_url(social_post.author_avatar_url)
    return None


def _format_count(count: int) -> str:
    if count < 1000:
        return str(count)
    divisor, suffix = (1000, "K") if count < 1_000_000 else (1_000_000, "M")
    value = count / divisor
    if value < 10:
        return f"{math.floor(value * 10) / 10:.1f}{suffix}"
    return f"{math.floor(value)}{suffix}"


def _description(social_post: SocialPost) -> str | None:
    parts = []
    if social_post.text:
        parts.append(social_post.text)

    quote = social_post.quote
    if quote is not None:
        if quote.unavailable_reason is not None:
            parts.append(f"Quoted post unavailable ({quote.unavailable_reason}).")
        else:
            quote_name = _display_name(quote.author_name, quote.author_handle)
            if quote_name and quote.text:
                parts.append(f"Quoting {quote_name}: {quote.text}")
            elif quote.text:
                parts.append(f"Quoting: {quote.text}")

    stat_labels = [
        (social_post.like_count, "likes"),
        (social_post.repost_count, "reposts"),
        (social_post.reply_count, "replies"),
    ]
    stats_text = " · ".join(
        f"{_format_count(count)} {label}" for count, label in stat_labels if count is not None
    )
    if stats_text:
        parts.append(stats_text)

    return "\n\n".join(parts) if parts else None


def _media_payload(
    media: list[MediaItem], sanitize_url: SanitizeUrl
) -> list[dict[str, str | None]]:
    result = []
    for item in media:
        safe_url = sanitize_url(item.url)
        if safe_url is None:
            continue
        # The InlineImageProcessor treeprocessor rewrites real <img src>
        # elements through camo automatically, but not URLs sitting inside a
        # data attribute, so these need get_camo_url called explicitly.
        result.append(
            {
                "kind": item.kind,
                "url": get_camo_url(safe_url),
                "alt_text": item.alt_text,
            }
        )
    return result


def _payload(
    social_post: SocialPost, fallback_link: str, sanitize_url: SanitizeUrl
) -> dict[str, object]:
    safe_avatar = (
        sanitize_url(social_post.author_avatar_url)
        if social_post.author_avatar_url is not None
        else None
    )
    safe_permalink = (
        sanitize_url(social_post.permalink) if social_post.permalink is not None else None
    )
    created_at = social_post.created_at
    if created_at is not None:
        if created_at.tzinfo:
            created_at = created_at.astimezone(timezone.utc)
        else:
            created_at = created_at.replace(tzinfo=timezone.utc)

    payload: dict[str, object] = {
        "platform": social_post.platform,
        "author_name": social_post.author_name,
        "author_handle": social_post.author_handle,
        "author_avatar_url": get_camo_url(safe_avatar) if safe_avatar is not None else None,
        "created_at": created_at.isoformat().replace("+00:00", "Z") if created_at else None,
        "text": social_post.text,
        "media": _media_payload(social_post.media, sanitize_url),
        "like_count": social_post.like_count,
        "repost_count": social_post.repost_count,
        "reply_count": social_post.reply_count,
        "permalink": safe_permalink,
        "fallback_link": fallback_link,
        "quote": None,
    }

    quote = social_post.quote
    if quote is not None:
        if quote.unavailable_reason is not None:
            payload["quote"] = {"unavailable_reason": quote.unavailable_reason}
        else:
            safe_quote_avatar = (
                sanitize_url(quote.author_avatar_url)
                if quote.author_avatar_url is not None
                else None
            )
            safe_quote_permalink = (
                sanitize_url(quote.permalink) if quote.permalink is not None else None
            )
            payload["quote"] = {
                "author_name": quote.author_name,
                "author_handle": quote.author_handle,
                "author_avatar_url": (
                    get_camo_url(safe_quote_avatar) if safe_quote_avatar is not None else None
                ),
                "text": quote.text,
                "media": _media_payload(quote.media, sanitize_url),
                "permalink": safe_quote_permalink,
                "unavailable_reason": None,
            }

    return payload


def add_message_card_embed(
    root: Element, link: str, social_post: SocialPost, sanitize_url: SanitizeUrl
) -> None:
    permalink = sanitize_url(social_post.permalink) if social_post.permalink is not None else None
    href = permalink or link

    container = SubElement(root, "div")
    # The Zulip mobile app's block-content parser only recognizes a
    # fixed set of HTML shapes and falls back to raw HTML for anything
    # else, so this has to match message_embed's shape to render as a
    # native link-preview card there.
    container.set("class", "message_embed")
    container.set("data-platform", social_post.platform)

    image_url = _preview_image_url(social_post, sanitize_url)
    if image_url is not None:
        img_link = get_camo_url(image_url)
        img = SubElement(container, "a")
        img.set(
            "style",
            'background-image: url("'
            + img_link.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\a ")
            + '")',
        )
        img.set("href", href)
        img.set("class", "message_embed_image")

    data_container = SubElement(container, "div")
    data_container.set("class", "data-container")

    embed_title = post_title(social_post)
    title_elm = SubElement(data_container, "div")
    title_elm.set("class", "message_embed_title")
    a = SubElement(title_elm, "a")
    a.set("href", href)
    a.set("title", embed_title)
    a.text = embed_title

    description = _description(social_post)
    if description:
        description_elm = SubElement(data_container, "div")
        description_elm.set("class", "message_embed_description")
        description_elm.text = description

    container.set(
        "data-message-card-embed",
        orjson.dumps(_payload(social_post, link, sanitize_url)).decode(),
    )
