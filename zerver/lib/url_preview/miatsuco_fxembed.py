import re
from typing import Literal
from urllib.parse import urlsplit

import requests

from zerver.lib.outgoing_http import OutgoingSession
from zerver.lib.url_preview.types import UrlOEmbedData

FXEMBED_TIMEOUT = 10

TWITTER_HOSTS = {"twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com"}
TWITTER_STATUS_PATH_RE = re.compile(r"^/[A-Za-z0-9_]{1,15}/status/(\d{2,20})/?$")

BLUESKY_HOST = "bsky.app"
BLUESKY_POST_PATH_RE = re.compile(
    r"^/profile/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)/post/([A-Za-z0-9]{1,20})/?$"
)

SOCIAL_EMBED_HOSTS = TWITTER_HOSTS | {BLUESKY_HOST}


class FxEmbedSession(OutgoingSession):
    def __init__(self) -> None:
        super().__init__(role="fxembed", timeout=FXEMBED_TIMEOUT)


def twitter_status_id(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.hostname not in TWITTER_HOSTS:
        return None
    match = TWITTER_STATUS_PATH_RE.match(parts.path)
    if match is None:
        return None
    return match.group(1)


def bluesky_status_ref(url: str) -> tuple[str, str] | None:
    parts = urlsplit(url)
    if parts.hostname != BLUESKY_HOST:
        return None
    match = BLUESKY_POST_PATH_RE.match(parts.path)
    if match is None:
        return None
    return (match.group(1), match.group(2))


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _parse_media(media: object) -> list[UrlOEmbedData.SocialPost.MediaItem]:
    if not isinstance(media, dict):
        return []

    items: list[UrlOEmbedData.SocialPost.MediaItem] = []
    for photo in media.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        url = _str_or_none(photo.get("url"))
        if url is None:
            continue
        kind: Literal["photo", "gif"] = "gif" if photo.get("type") == "gif" else "photo"
        items.append(
            UrlOEmbedData.SocialPost.MediaItem(
                kind=kind,
                url=url,
                width=_int_or_none(photo.get("width")),
                height=_int_or_none(photo.get("height")),
                alt_text=_str_or_none(photo.get("altText")),
            )
        )

    for video in media.get("videos") or []:
        if not isinstance(video, dict):
            continue
        url = _str_or_none(video.get("url"))
        if url is None:
            continue
        items.append(
            UrlOEmbedData.SocialPost.MediaItem(
                kind="video",
                url=url,
                width=_int_or_none(video.get("width")),
                height=_int_or_none(video.get("height")),
            )
        )

    return items


def _parse_author(
    status: dict[str, object],
) -> tuple[str | None, str | None, str | None]:
    author = status.get("author")
    if not isinstance(author, dict):
        return None, None, None
    return (
        _str_or_none(author.get("name")),
        _str_or_none(author.get("screen_name")),
        _str_or_none(author.get("avatar_url")),
    )


def _parse_quote(quote: object) -> UrlOEmbedData.SocialPost.Quote | None:
    if not isinstance(quote, dict):
        return None

    if quote.get("type") == "tombstone":
        return UrlOEmbedData.SocialPost.Quote(
            unavailable_reason=_str_or_none(quote.get("reason")) or "unavailable"
        )

    author_name, author_handle, author_avatar_url = _parse_author(quote)
    return UrlOEmbedData.SocialPost.Quote(
        author_name=author_name,
        author_handle=author_handle,
        author_avatar_url=author_avatar_url,
        text=_str_or_none(quote.get("text")),
        permalink=_str_or_none(quote.get("url")),
        media=_parse_media(quote.get("media")),
    )


def _parse_status(
    status: object, url: str, platform: Literal["twitter", "bluesky"]
) -> UrlOEmbedData | None:
    if not isinstance(status, dict) or status.get("type") == "tombstone":
        return None

    author_name, author_handle, author_avatar_url = _parse_author(status)
    text = _str_or_none(status.get("text"))
    media = _parse_media(status.get("media"))

    return UrlOEmbedData(
        type="rich",
        image=media[0].url if media else author_avatar_url,
        title=author_name,
        description=text,
        social_post=UrlOEmbedData.SocialPost(
            platform=platform,
            author_name=author_name,
            author_handle=author_handle,
            author_avatar_url=author_avatar_url,
            text=text,
            permalink=_str_or_none(status.get("url")) or url,
            created_at_display=_str_or_none(status.get("created_at")),
            like_count=_int_or_none(status.get("likes")),
            repost_count=_int_or_none(status.get("reposts")),
            reply_count=_int_or_none(status.get("replies")),
            media=media,
            quote=_parse_quote(status.get("quote")),
        ),
    )


def get_fxembed_data(url: str) -> UrlOEmbedData | None:
    endpoint: str
    platform: Literal["twitter", "bluesky"]

    twitter_id = twitter_status_id(url)
    if twitter_id is not None:
        endpoint = f"https://api.fxtwitter.com/2/status/{twitter_id}"
        platform = "twitter"
    else:
        bluesky_ref = bluesky_status_ref(url)
        if bluesky_ref is None:
            return None
        handle, rkey = bluesky_ref
        endpoint = f"https://api.fxbsky.app/2/status/{handle}/{rkey}"
        platform = "bluesky"

    try:
        response = FxEmbedSession().get(endpoint)
        data = response.json()
    except (requests.exceptions.RequestException, ValueError):
        return None

    if not isinstance(data, dict) or data.get("code") != 200:
        return None

    return _parse_status(data.get("status"), url, platform)
