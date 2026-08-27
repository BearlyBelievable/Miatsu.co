from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


class TransientPreviewFetchError(Exception):
    """A URL preview fetch failed in a way that might succeed if
    retried, as opposed to the URL genuinely having no preview data.
    """


@dataclass
class UrlEmbedData:
    type: str | None = None
    html: str | None = None
    title: str | None = None
    description: str | None = None
    image: str | None = None

    def merge(self, other: "UrlEmbedData") -> None:
        if self.title is None and other.title is not None:
            self.title = other.title
        if self.description is None and other.description is not None:
            self.description = other.description
        if self.image is None and other.image is not None:
            self.image = other.image


@dataclass
class UrlOEmbedData(UrlEmbedData):
    type: Literal["photo", "video", "rich"]
    html: str | None = None
    width: int | None = None
    height: int | None = None
    social_post: "UrlOEmbedData.SocialPost | None" = None

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
        media: "list[UrlOEmbedData.SocialPost.MediaItem]" = field(default_factory=list)
        quote: "UrlOEmbedData.SocialPost.Quote | None" = None

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
            media: "list[UrlOEmbedData.SocialPost.MediaItem]" = field(default_factory=list)
            unavailable_reason: str | None = None
