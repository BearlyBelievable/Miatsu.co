import json
import logging
from urllib.parse import urlsplit

import requests
from pyoembed import ParserException, ProviderException, PyOembedException, oEmbed

# MiAtSu.Co edit: hooks out to miatsuco_oembed_providers.py.
from zerver.lib.url_preview import miatsuco_oembed_providers  # noqa: F401
from zerver.lib.url_preview.miatsuco_fxembed import SOCIAL_EMBED_HOSTS, get_fxembed_data
from zerver.lib.url_preview.types import TransientPreviewFetchError, UrlEmbedData, UrlOEmbedData


def get_oembed_data(url: str, maxwidth: int = 640, maxheight: int = 480) -> UrlEmbedData | None:
    if urlsplit(url).hostname in SOCIAL_EMBED_HOSTS:
        return get_fxembed_data(url)

    try:
        data = oEmbed(url, maxwidth=maxwidth, maxheight=maxheight)
    # MiAtSu.Co edit:
    # A missing provider or unparsable content-type is permanent, so
    # only the request and data failures below get retried.
    except (ProviderException, ParserException):
        return None
    except (
        PyOembedException,
        json.decoder.JSONDecodeError,
        requests.exceptions.ConnectionError,
    ) as e:
        logging.warning("oEmbed lookup failed for %s: %s", url, e)
        raise TransientPreviewFetchError from e

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
