import html
import json
import re
from datetime import datetime, timezone
from typing import Any
from unittest import mock

import responses
from django.test import override_settings
from requests.exceptions import ConnectionError
from typing_extensions import override

from zerver.lib.camo import get_camo_url
from zerver.lib.miatsuco_message_card_embed import MediaItem, Quote, SocialPost
from zerver.lib.test_classes import ZulipTestCase
from zerver.lib.test_helpers import mock_queue_publish
from zerver.lib.url_preview.miatsuco_fxembed import (
    bluesky_status_ref,
    get_fxembed_data,
    twitter_status_id,
)
from zerver.lib.url_preview.oembed import get_oembed_data
from zerver.lib.url_preview.types import TransientPreviewFetchError, UrlOEmbedData
from zerver.models import Message, Realm
from zerver.worker.embed_links import FetchLinksEmbedData

TWITTER_STATUS_RESPONSE = {
    "code": 200,
    "status": {
        "type": "status",
        "url": "https://x.com/jack/status/20",
        "text": "just setting up my twttr",
        "author": {
            "name": "jack",
            "screen_name": "jack",
            "avatar_url": "https://pbs.twimg.com/profile_images/jack.jpg",
        },
        "likes": 311130,
        "reposts": 124789,
        "replies": 17986,
        "created_at": "Tue Mar 21 20:50:14 +0000 2006",
        "media": {},
    },
}

BLUESKY_STATUS_RESPONSE = {
    "code": 200,
    "status": {
        "type": "status",
        "url": "https://bsky.app/profile/bsky.app/post/3msqpuobiwk2t",
        "text": "v1.130 is live!",
        "author": {
            "name": "Bluesky",
            "screen_name": "bsky.app",
            "avatar_url": "https://cdn.bsky.app/img/avatar/bsky.jpg",
        },
        "likes": 9484,
        "reposts": 2388,
        "replies": 494,
        "created_at": "2026-08-10T18:23:59.962Z",
        "media": {
            "photos": [
                {
                    "type": "photo",
                    "width": 2200,
                    "height": 1312,
                    "url": "https://cdn.bsky.app/img/feed_fullsize/photo.jpg",
                    "altText": "A screenshot.",
                }
            ]
        },
    },
}


class MiatsucoFxEmbedUrlDetectionTestCase(ZulipTestCase):
    def test_twitter_status_id(self) -> None:
        self.assertEqual(twitter_status_id("https://x.com/jack/status/20"), "20")
        self.assertEqual(twitter_status_id("https://twitter.com/jack/status/20"), "20")
        self.assertEqual(twitter_status_id("https://www.x.com/jack/status/20"), "20")
        self.assertEqual(twitter_status_id("https://mobile.twitter.com/jack/status/20"), "20")
        self.assertEqual(twitter_status_id("https://x.com/jack/status/20/"), "20")

    def test_twitter_status_id_non_status_urls(self) -> None:
        self.assertIsNone(twitter_status_id("https://x.com/jack"))
        self.assertIsNone(twitter_status_id("https://x.com/"))
        self.assertIsNone(twitter_status_id("https://example.com/jack/status/20"))
        self.assertIsNone(twitter_status_id("https://x.com/jack/status/notanumber"))

    def test_bluesky_status_ref(self) -> None:
        self.assertEqual(
            bluesky_status_ref("https://bsky.app/profile/bsky.app/post/3msqpuobiwk2t"),
            ("bsky.app", "3msqpuobiwk2t"),
        )
        self.assertEqual(
            bluesky_status_ref("https://bsky.app/profile/user.bsky.social/post/abc123/"),
            ("user.bsky.social", "abc123"),
        )

    def test_bluesky_status_ref_non_post_urls(self) -> None:
        self.assertIsNone(bluesky_status_ref("https://bsky.app/profile/bsky.app"))
        self.assertIsNone(bluesky_status_ref("https://example.com/profile/bsky.app/post/abc"))

    def test_bluesky_status_ref_rejects_unsafe_characters(self) -> None:
        self.assertIsNone(bluesky_status_ref("https://bsky.app/profile/foo%2ebar/post/abc123"))
        self.assertIsNone(bluesky_status_ref("https://bsky.app/profile/bsky.app/post/abc;x=1"))
        self.assertIsNone(bluesky_status_ref("https://bsky.app/profile/foo@bar/post/abc123"))
        self.assertIsNone(bluesky_status_ref(f"https://bsky.app/profile/{'a' * 300}/post/abc123"))


class MiatsucoFxEmbedDataTestCase(ZulipTestCase):
    @responses.activate
    def test_twitter_happy_path(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=TWITTER_STATUS_RESPONSE,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assertEqual(data.social_post.platform, "twitter")
        self.assertEqual(data.social_post.author_name, "jack")
        self.assertEqual(data.social_post.author_handle, "jack")
        self.assertEqual(data.social_post.text, "just setting up my twttr")
        self.assertEqual(data.social_post.like_count, 311130)
        self.assertEqual(data.social_post.repost_count, 124789)
        self.assertEqual(data.social_post.reply_count, 17986)
        self.assertEqual(data.social_post.media, [])
        self.assertEqual(
            data.social_post.created_at, datetime(2006, 3, 21, 20, 50, 14, tzinfo=timezone.utc)
        )

    @responses.activate
    def test_bluesky_happy_path_with_media(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxbsky.app/2/status/bsky.app/3msqpuobiwk2t",
            json=BLUESKY_STATUS_RESPONSE,
            status=200,
        )
        data = get_fxembed_data("https://bsky.app/profile/bsky.app/post/3msqpuobiwk2t")
        assert data is not None
        assert data.social_post is not None
        self.assertEqual(data.social_post.platform, "bluesky")
        self.assertEqual(data.social_post.author_handle, "bsky.app")
        self.assert_length(data.social_post.media, 1)
        self.assertEqual(data.social_post.media[0].kind, "photo")
        self.assertEqual(
            data.social_post.media[0].url, "https://cdn.bsky.app/img/feed_fullsize/photo.jpg"
        )
        self.assertEqual(data.social_post.media[0].alt_text, "A screenshot.")
        self.assertEqual(
            data.social_post.created_at,
            datetime(2026, 8, 10, 18, 23, 59, 962000, tzinfo=timezone.utc),
        )

    @responses.activate
    def test_missing_avatar(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "no avatar here",
                "author": {"name": "jack", "screen_name": "jack", "avatar_url": None},
                "media": {},
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assertIsNone(data.social_post.author_avatar_url)

    @responses.activate
    def test_quoted_status(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "look at this",
                "author": {"name": "jack", "screen_name": "jack", "avatar_url": None},
                "media": {},
                "quote": {
                    "type": "status",
                    "url": "https://x.com/other/status/10",
                    "text": "the original post",
                    "author": {
                        "name": "Other",
                        "screen_name": "other",
                        "avatar_url": "https://pbs.twimg.com/profile_images/other.jpg",
                    },
                    "media": {
                        "photos": [
                            {
                                "type": "photo",
                                "width": 100,
                                "height": 100,
                                "url": "https://pbs.twimg.com/quoted.jpg",
                                "altText": "A quoted photo.",
                            }
                        ]
                    },
                },
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        assert data.social_post.quote is not None
        self.assertIsNone(data.social_post.quote.unavailable_reason)
        self.assertEqual(data.social_post.quote.author_name, "Other")
        self.assertEqual(data.social_post.quote.author_handle, "other")
        self.assertEqual(data.social_post.quote.text, "the original post")
        self.assertEqual(data.social_post.quote.permalink, "https://x.com/other/status/10")
        self.assert_length(data.social_post.quote.media, 1)
        self.assertEqual(data.social_post.quote.media[0].url, "https://pbs.twimg.com/quoted.jpg")

    @responses.activate
    def test_quoted_status_tombstoned(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "look at this",
                "author": {"name": "jack", "screen_name": "jack", "avatar_url": None},
                "media": {},
                "quote": {"type": "tombstone", "reason": "deleted"},
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        assert data.social_post.quote is not None
        self.assertEqual(data.social_post.quote.unavailable_reason, "deleted")
        self.assertIsNone(data.social_post.quote.text)
        self.assertIsNone(data.social_post.quote.author_name)

    @responses.activate
    def test_media_parses_videos_and_skips_malformed_entries(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "look at this",
                "author": {"name": "jack", "screen_name": "jack", "avatar_url": None},
                "media": {
                    "photos": [
                        "not a dict",
                        {"type": "photo", "width": 100, "height": 100},
                    ],
                    "videos": [
                        "not a dict",
                        {"width": 100, "height": 100},
                        {
                            "url": "https://video.twimg.com/clip.mp4",
                            "width": 640,
                            "height": 360,
                        },
                    ],
                },
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assert_length(data.social_post.media, 1)
        self.assertEqual(data.social_post.media[0].kind, "video")
        self.assertEqual(data.social_post.media[0].url, "https://video.twimg.com/clip.mp4")
        self.assertEqual(data.social_post.media[0].width, 640)
        self.assertEqual(data.social_post.media[0].height, 360)

    @responses.activate
    def test_missing_media_and_author_default_to_empty(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "look at this",
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assertEqual(data.social_post.media, [])
        self.assertIsNone(data.social_post.author_name)
        self.assertIsNone(data.social_post.author_handle)
        self.assertIsNone(data.social_post.author_avatar_url)
        self.assertIsNone(data.social_post.created_at)

    @responses.activate
    def test_malformed_created_at_is_ignored(self) -> None:
        response_data = {
            "code": 200,
            "status": {
                "type": "status",
                "url": "https://x.com/jack/status/20",
                "text": "look at this",
                "author": {"name": "jack", "screen_name": "jack", "avatar_url": None},
                "media": {},
                "created_at": "not a real date",
            },
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assertIsNone(data.social_post.created_at)

    @responses.activate
    def test_no_quote(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=TWITTER_STATUS_RESPONSE,
            status=200,
        )
        data = get_fxembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert data.social_post is not None
        self.assertIsNone(data.social_post.quote)

    @responses.activate
    def test_tombstone_status(self) -> None:
        response_data = {
            "code": 200,
            "status": {"type": "tombstone", "reason": "deleted"},
        }
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=response_data,
            status=200,
        )
        self.assertIsNone(get_fxembed_data("https://x.com/jack/status/20"))

    @responses.activate
    def test_not_found(self) -> None:
        response_data = {"status": None, "thread": None, "author": None, "code": 404}
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/99999999999999999",
            json=response_data,
            # get_fxembed_data only checks the JSON code field, not the HTTP status.
            status=200,
        )
        self.assertIsNone(get_fxembed_data("https://x.com/jack/status/99999999999999999"))

    @responses.activate
    def test_network_error(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            body=ConnectionError(),
        )
        self.assertIsNone(get_fxembed_data("https://x.com/jack/status/20"))

    @responses.activate
    def test_malformed_json(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            body="not json",
            status=200,
            content_type="application/json",
        )
        self.assertIsNone(get_fxembed_data("https://x.com/jack/status/20"))

    def test_non_social_url(self) -> None:
        self.assertIsNone(get_fxembed_data("https://example.com/some/page"))

    @responses.activate
    def test_non_dict_json_response(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=[],
            status=200,
        )
        self.assertIsNone(get_fxembed_data("https://x.com/jack/status/20"))


@override_settings(INLINE_URL_EMBED_PREVIEW=True)
class MiatsucoFxEmbedOembedDispatchTestCase(ZulipTestCase):
    @responses.activate
    def test_social_hosts_short_circuit_to_fxembed(self) -> None:
        responses.add(
            responses.GET,
            "https://api.fxtwitter.com/2/status/20",
            json=TWITTER_STATUS_RESPONSE,
            status=200,
        )
        data = get_oembed_data("https://x.com/jack/status/20")
        assert data is not None
        assert isinstance(data, UrlOEmbedData)
        assert data.social_post is not None
        self.assertEqual(data.social_post.platform, "twitter")

    @responses.activate
    def test_non_social_hosts_still_use_pyoembed(self) -> None:
        responses.add(
            responses.GET,
            "https://vimeo.com/api/oembed.json",
            status=404,
        )
        with (
            self.assertLogs(level="WARNING") as warn_logs,
            self.assertRaises(TransientPreviewFetchError),
        ):
            get_oembed_data("https://vimeo.com/nonexistent")
        self.assertIn("oEmbed lookup failed for https://vimeo.com/nonexistent", warn_logs.output[0])
        self.assert_length(responses.calls, 1)
        request_url = responses.calls[0].request.url
        assert request_url is not None
        self.assertIn("vimeo.com", request_url)


def extract_message_card_embed_payload(rendered_content: str) -> dict[str, Any]:
    match = re.search(r'data-message-card-embed="([^"]*)"', rendered_content)
    assert match is not None
    return json.loads(html.unescape(match.group(1)))


@override_settings(INLINE_URL_EMBED_PREVIEW=True)
class MiatsucoFxEmbedRenderTestCase(ZulipTestCase):
    @override
    def setUp(self) -> None:
        super().setUp()
        Realm.objects.all().update(inline_url_embed_preview=True)

    @classmethod
    def create_mock_response(cls, url: str) -> None:
        responses.add(
            responses.GET,
            url,
            body="<html></html>",
            status=200,
            content_type="text/html",
        )

    @responses.activate
    def test_renders_social_embed_card(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        author_avatar_url = "https://pbs.twimg.com/profile_images/jack.jpg"
        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                author_handle="jack",
                author_avatar_url=author_avatar_url,
                text="just setting up my twttr",
                permalink=url,
                like_count=311130,
                repost_count=124789,
                reply_count=17986,
                created_at=datetime(2006, 3, 21, 20, 50, 14, tzinfo=timezone.utc),
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO") as info_logs,
        ):
            FetchLinksEmbedData().consume(event)
        self.assertTrue(
            "INFO:root:Time spent on get_link_embed_data for https://x.com/jack/status/20: "
            in info_logs.output[0]
        )

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn('class="message_embed"', msg.rendered_content)
        self.assertIn('data-platform="twitter"', msg.rendered_content)
        self.assertIn(
            f'<div class="message_embed_title"><a href="{url}" title="X - Post by jack (@jack)">'
            "X - Post by jack (@jack)</a></div>",
            msg.rendered_content,
        )
        self.assertIn(
            '<div class="message_embed_description">just setting up my twttr\n\n'
            "311K likes · 124K reposts · 17K replies</div>",
            msg.rendered_content,
        )
        self.assertIn(
            f'<a class="message_embed_image" href="{url}" '
            f'style="background-image: url(&quot;{get_camo_url(author_avatar_url)}&quot;)"></a>',
            msg.rendered_content,
        )

        payload = extract_message_card_embed_payload(msg.rendered_content)
        self.assertEqual(payload["author_avatar_url"], get_camo_url(author_avatar_url))
        self.assertEqual(payload["created_at"], "2006-03-21T20:50:14Z")
        self.assertEqual(payload["like_count"], 311130)
        self.assertEqual(payload["repost_count"], 124789)
        self.assertEqual(payload["reply_count"], 17986)
        self.assertEqual(payload["permalink"], url)
        self.assertIsNone(payload["quote"])

    @responses.activate
    def test_stats_below_a_thousand_and_in_the_millions_are_formatted(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                text="counts",
                permalink=url,
                like_count=500,
                repost_count=1500,
                reply_count=2_500_000,
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn("500 likes · 1.5K reposts · 2.5M replies", msg.rendered_content)

    @responses.activate
    def test_renders_media(self) -> None:
        url = "https://bsky.app/profile/bsky.app/post/3msqpuobiwk2t"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="bluesky",
                author_name="Bluesky",
                author_handle="bsky.app",
                text="v1.130 is live!",
                permalink=url,
                media=[
                    MediaItem(
                        kind="photo",
                        url="https://cdn.bsky.app/img/feed_fullsize/photo.jpg",
                        alt_text="A screenshot.",
                    )
                ],
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        camo_photo_url = get_camo_url("https://cdn.bsky.app/img/feed_fullsize/photo.jpg")
        self.assertIn(
            f'<a class="message_embed_image" href="{url}" '
            f'style="background-image: url(&quot;{camo_photo_url}&quot;)"></a>',
            msg.rendered_content,
        )

        payload = extract_message_card_embed_payload(msg.rendered_content)
        self.assertEqual(
            payload["media"],
            [{"kind": "photo", "url": camo_photo_url, "alt_text": "A screenshot."}],
        )

    @responses.activate
    def test_renders_quote(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                text="look at this",
                permalink=url,
                quote=Quote(
                    author_name="Other",
                    author_handle="other",
                    text="the original post",
                    permalink="https://x.com/other/status/10",
                ),
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn(
            '<div class="message_embed_description">look at this\n\n'
            "Quoting Other (@other): the original post</div>",
            msg.rendered_content,
        )

        payload = extract_message_card_embed_payload(msg.rendered_content)
        assert payload["quote"] is not None
        self.assertEqual(payload["quote"]["author_name"], "Other")
        self.assertEqual(payload["quote"]["author_handle"], "other")
        self.assertEqual(payload["quote"]["text"], "the original post")
        self.assertEqual(payload["quote"]["permalink"], "https://x.com/other/status/10")

    @responses.activate
    def test_renders_quote_unavailable(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                text="look at this",
                permalink=url,
                quote=Quote(unavailable_reason="deleted"),
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn(
            '<div class="message_embed_description">look at this\n\n'
            "Quoted post unavailable (deleted).</div>",
            msg.rendered_content,
        )

        payload = extract_message_card_embed_payload(msg.rendered_content)
        self.assertEqual(payload["quote"], {"unavailable_reason": "deleted"})

    @responses.activate
    def test_renders_quote_video(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                text="look at this",
                permalink=url,
                quote=Quote(
                    author_name="Other",
                    text="watch this",
                    media=[
                        MediaItem(
                            kind="video",
                            url="https://video.twimg.com/quoted.mp4",
                        )
                    ],
                ),
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn(
            '<div class="message_embed_description">look at this\n\n'
            "Quoting Other: watch this</div>",
            msg.rendered_content,
        )

        payload = extract_message_card_embed_payload(msg.rendered_content)
        assert payload["quote"] is not None
        self.assertEqual(
            payload["quote"]["media"],
            [
                {
                    "kind": "video",
                    "url": get_camo_url("https://video.twimg.com/quoted.mp4"),
                    "alt_text": None,
                }
            ],
        )

    @responses.activate
    def test_special_characters_are_escaped(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        dangerous_text = '<script>alert("hi")</script>'
        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name=dangerous_text,
                text=dangerous_text,
                permalink=url,
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertNotIn("<script>", msg.rendered_content)
        self.assertIn("&lt;script&gt;alert(", msg.rendered_content)

    @responses.activate
    def test_malicious_urls_are_rejected(self) -> None:
        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            social_post=SocialPost(
                platform="twitter",
                author_name="jack",
                author_avatar_url='javascript:alert("avatar")',
                text="hi",
                permalink='javascript:alert("permalink")',
                media=[
                    MediaItem(
                        kind="photo",
                        url='javascript:alert("media")',
                    )
                ],
                quote=Quote(
                    author_name="Other",
                    author_avatar_url='javascript:alert("quote-avatar")',
                    permalink='javascript:alert("quote-permalink")',
                    text="quoted",
                ),
            ),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertNotIn("javascript:", msg.rendered_content)
        self.assertEqual(msg.rendered_content.count(f'href="{url}"'), 2)

        payload = extract_message_card_embed_payload(msg.rendered_content)
        self.assertIsNone(payload["author_avatar_url"])
        self.assertIsNone(payload["permalink"])
        self.assertEqual(payload["media"], [])
        assert payload["quote"] is not None
        self.assertIsNone(payload["quote"]["author_avatar_url"])
        self.assertIsNone(payload["quote"]["permalink"])

    @responses.activate
    def test_image_preview_disabled_falls_back_to_plain_embed(self) -> None:
        realm = Realm.objects.get(string_id="zulip")
        realm.inline_image_preview = False
        realm.save(update_fields=["inline_image_preview"])

        url = "https://x.com/jack/status/20"
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_personal_message(
                self.example_user("hamlet"),
                self.example_user("cordelia"),
                content=url,
            )
        msg = Message.objects.select_related("sender").get(id=msg_id)
        event = {
            "message_id": msg_id,
            "urls": [url],
            "message_realm_id": msg.sender.realm_id,
            "message_content": url,
        }

        mocked_data = UrlOEmbedData(
            type="rich",
            image="https://pbs.twimg.com/profile_images/jack.jpg",
            title="jack",
            description="hi",
            social_post=SocialPost(platform="twitter", author_name="jack", text="hi"),
        )
        self.create_mock_response(url)
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.lib.url_preview.preview.get_oembed_data",
                lambda *args, **kwargs: mocked_data,
            ),
            self.assertLogs(level="INFO"),
        ):
            FetchLinksEmbedData().consume(event)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertNotIn("message-card-embed", msg.rendered_content)
        self.assertIn('class="message_embed"', msg.rendered_content)
        self.assertIn('class="message_embed_title"', msg.rendered_content)
        self.assertIn(">jack<", msg.rendered_content)
        self.assertIn('class="message_embed_description"', msg.rendered_content)
        self.assertIn(">hi<", msg.rendered_content)
