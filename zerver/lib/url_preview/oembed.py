import contextlib
import json
from xml.etree import ElementTree

import requests
from pyoembed import PyOembedException, oEmbed
from pyoembed.parsers.xml_parser import XmlParser
from pyoembed.providers import BaseProvider

from zerver.lib.url_preview.types import UrlEmbedData, UrlOEmbedData


# pyoembed has no built-in provider for these platforms and falls
# back to autodiscovery, which none of their pages support, so
# every URL would otherwise fail oEmbed lookup entirely.
class VimeoProvider(BaseProvider):
    priority = 10
    oembed_schemas = [
        "https://vimeo.com/*",
        "http://vimeo.com/*",
        "https://www.vimeo.com/*",
        "http://www.vimeo.com/*",
    ]
    oembed_endpoint = "https://vimeo.com/api/oembed.json"


class SoundCloudProvider(BaseProvider):
    priority = 10
    oembed_schemas = [
        "https://soundcloud.com/*",
        "http://soundcloud.com/*",
        "https://www.soundcloud.com/*",
        "http://www.soundcloud.com/*",
    ]
    oembed_endpoint = "https://soundcloud.com/oembed"


class SpotifyProvider(BaseProvider):
    # The built-in Spotify provider in pyoembed points at a dead
    # legacy endpoint (embed.spotify.com), so this overrides it with
    # the current one, at a higher priority so ours is tried first.
    priority = 1
    oembed_schemas = [
        "https://open.spotify.com/*",
        "http://open.spotify.com/*",
    ]
    oembed_endpoint = "https://open.spotify.com/oembed"


def _xml_content_parse_without_getiterator(self: XmlParser, content: str) -> dict[str, object]:
    # Element.getiterator() was removed in Python 3.9. pyoembed
    # (last released 2017, last commit 2021) never updated for it,
    # so any XML-format oEmbed response would otherwise crash here.
    element = ElementTree.XML(content)
    result: dict[str, object] = {}
    for child in element.iter():
        if child.tag == "oembed":
            continue
        text: str | int | None = child.text
        if ("height" in child.tag or "width" in child.tag) and text is not None:
            with contextlib.suppress(ValueError):
                text = int(text)
        result[child.tag] = text
    return result


XmlParser.content_parse = _xml_content_parse_without_getiterator


def get_oembed_data(url: str, maxwidth: int = 640, maxheight: int = 480) -> UrlEmbedData | None:
    try:
        data = oEmbed(url, maxwidth=maxwidth, maxheight=maxheight)
    except (PyOembedException, json.decoder.JSONDecodeError, requests.exceptions.ConnectionError):
        return None

    oembed_resource_type = data.get("type", "")
    image = data.get("url", data.get("image"))
    thumbnail = data.get("thumbnail_url")
    html = data.get("html", "")
    width = data.get("width")
    height = data.get("height")
    if oembed_resource_type == "photo" and image:
        return UrlOEmbedData(
            image=image,
            type="photo",
            title=data.get("title"),
            description=data.get("description"),
        )

    if oembed_resource_type == "video" and html and thumbnail:
        return UrlOEmbedData(
            image=thumbnail,
            type="video",
            html=strip_cdata(html),
            title=data.get("title"),
            description=data.get("description"),
        )

    if oembed_resource_type == "rich" and html:
        return UrlOEmbedData(
            image=thumbnail,
            type="rich",
            html=strip_cdata(html),
            title=data.get("title"),
            description=data.get("description"),
            width=width,
            height=height,
        )

    # Otherwise, use the title/description from pyembed as the basis
    # for our other parsers
    return UrlEmbedData(
        title=data.get("title"),
        description=data.get("description"),
    )


def strip_cdata(html: str) -> str:
    # Work around a bug in SoundCloud's XML generation:
    # <html>&lt;![CDATA[&lt;iframe ...&gt;&lt;/iframe&gt;]]&gt;</html>
    if html.startswith("<![CDATA[") and html.endswith("]]>"):
        html = html[9:-3]
    return html
