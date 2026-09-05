from dataclasses import dataclass
from typing import Literal

from zerver.lib.miatsuco_message_card_embed import SocialPost


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
    # MiAtSu.Co edit: hooks out to miatsuco_message_card_embed.py.
    social_post: SocialPost | None = None
