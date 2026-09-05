import contextlib
from xml.etree import ElementTree

from pyoembed.parsers.xml_parser import XmlParser
from pyoembed.providers import BaseProvider


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
