import json
import os
from datetime import datetime, timezone
from typing import Any
from xml.etree.ElementTree import Element

import orjson

from zerver.lib.camo import get_camo_url
from zerver.lib.miatsuco_message_card_embed import (
    MediaItem,
    Quote,
    SocialPost,
    add_message_card_embed,
    post_title,
)
from zerver.lib.test_classes import ZulipTestCase


def sanitize_url(url: str) -> str | None:
    return url


class MiatsucoMessageCardEmbedTitleTestCase(ZulipTestCase):
    def test_title_with_name_and_handle(self) -> None:
        social_post = SocialPost(platform="twitter", author_name="Jack", author_handle="jack")
        self.assertEqual(post_title(social_post), "X - Post by Jack (@jack)")

    def test_title_with_handle_only(self) -> None:
        social_post = SocialPost(platform="bluesky", author_handle="bsky.app")
        self.assertEqual(post_title(social_post), "Bluesky - Post by @bsky.app")

    def test_title_with_no_author_info(self) -> None:
        social_post = SocialPost(platform="twitter")
        self.assertEqual(post_title(social_post), "X - Post")


class MiatsucoMessageCardEmbedBuildTestCase(ZulipTestCase):
    def build(self, social_post: SocialPost, link: str = "https://x.com/jack/status/20") -> Element:
        root = Element("div")
        add_message_card_embed(root, link, social_post, sanitize_url)
        return root

    def payload(self, root: Element) -> dict[str, object]:
        embed = root.find("div")
        assert embed is not None
        return json.loads(embed.get("data-message-card-embed", "{}"))

    def test_uses_permalink_over_fallback_link_when_present(self) -> None:
        social_post = SocialPost(platform="twitter", permalink="https://x.com/jack/status/20/real")
        root = self.build(social_post, link="https://x.com/jack/status/20")
        embed = root.find("div")
        assert embed is not None
        title_link = embed.find(".//div[@class='message_embed_title']/a")
        assert title_link is not None
        self.assertEqual(title_link.get("href"), "https://x.com/jack/status/20/real")

    def test_falls_back_to_link_without_permalink(self) -> None:
        social_post = SocialPost(platform="twitter")
        root = self.build(social_post, link="https://x.com/jack/status/20")
        embed = root.find("div")
        assert embed is not None
        title_link = embed.find(".//div[@class='message_embed_title']/a")
        assert title_link is not None
        self.assertEqual(title_link.get("href"), "https://x.com/jack/status/20")

    def test_preview_image_skips_video_media_for_a_photo(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            media=[
                MediaItem(kind="video", url="https://example.com/video.mp4"),
                MediaItem(kind="photo", url="https://example.com/photo.jpg"),
            ],
        )
        root = self.build(social_post)
        embed = root.find("div")
        assert embed is not None
        image_link = embed.find("a[@class='message_embed_image']")
        assert image_link is not None
        self.assertIn(get_camo_url("https://example.com/photo.jpg"), image_link.get("style", ""))

    def test_preview_image_falls_back_to_author_avatar_without_media(self) -> None:
        social_post = SocialPost(platform="twitter", author_avatar_url="https://example.com/av.jpg")
        root = self.build(social_post)
        embed = root.find("div")
        assert embed is not None
        image_link = embed.find("a[@class='message_embed_image']")
        assert image_link is not None
        self.assertIn(get_camo_url("https://example.com/av.jpg"), image_link.get("style", ""))

    def test_no_image_link_without_media_or_avatar(self) -> None:
        social_post = SocialPost(platform="twitter")
        root = self.build(social_post)
        embed = root.find("div")
        assert embed is not None
        self.assertIsNone(embed.find("a[@class='message_embed_image']"))

    def test_description_includes_text_and_stats(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            text="hello world",
            like_count=5,
            repost_count=0,
            reply_count=None,
        )
        root = self.build(social_post)
        embed = root.find("div")
        assert embed is not None
        description = embed.find(".//div[@class='message_embed_description']")
        assert description is not None
        self.assertEqual(description.text, "hello world\n\n5 likes · 0 reposts")

    def test_description_omitted_without_text_or_quote_or_stats(self) -> None:
        social_post = SocialPost(platform="twitter")
        root = self.build(social_post)
        embed = root.find("div")
        assert embed is not None
        self.assertIsNone(embed.find("div[@class='message_embed_description']"))

    def test_description_quotes_a_named_author(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            quote=Quote(author_name="Cordelia", text="great point"),
        )
        root = self.build(social_post)
        description = self.payload_description(root)
        self.assertEqual(description, "Quoting Cordelia: great point")

    def test_description_quotes_an_unnamed_author(self) -> None:
        social_post = SocialPost(platform="twitter", quote=Quote(text="great point"))
        root = self.build(social_post)
        description = self.payload_description(root)
        self.assertEqual(description, "Quoting: great point")

    def test_description_notes_an_unavailable_quote(self) -> None:
        social_post = SocialPost(platform="twitter", quote=Quote(unavailable_reason="deleted"))
        root = self.build(social_post)
        description = self.payload_description(root)
        self.assertEqual(description, "Quoted post unavailable (deleted).")

    def payload_description(self, root: Element) -> str | None:
        embed = root.find("div")
        assert embed is not None
        description = embed.find(".//div[@class='message_embed_description']")
        return description.text if description is not None else None

    def test_stats_formatting_thousands_and_millions(self) -> None:
        social_post = SocialPost(platform="twitter", text="x", like_count=1_500_000)
        description = self.payload_description(self.build(social_post))
        assert description is not None
        self.assertIn("1.5M likes", description)

    def test_stats_formatting_without_a_decimal_above_ten_thousand(self) -> None:
        social_post = SocialPost(platform="twitter", text="x", like_count=25_000)
        description = self.payload_description(self.build(social_post))
        assert description is not None
        self.assertIn("25K likes", description)

    def test_media_payload_drops_an_item_with_an_unsafe_url(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            media=[
                MediaItem(kind="photo", url="javascript:alert(1)"),
                MediaItem(kind="photo", url="https://example.com/safe.jpg"),
            ],
        )
        root = Element("div")
        add_message_card_embed(
            root,
            "https://x.com/jack/status/20",
            social_post,
            lambda url: None if url.startswith("javascript:") else url,
        )
        payload = self.payload(root)
        media_payload = payload["media"]
        assert isinstance(media_payload, list)
        self.assert_length(media_payload, 1)
        self.assertEqual(media_payload[0]["url"], get_camo_url("https://example.com/safe.jpg"))

    def test_payload_localizes_a_naive_created_at_to_utc(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            created_at=datetime(2020, 1, 1, 12, 0, 0),  # noqa: DTZ001
        )
        payload = self.payload(self.build(social_post))
        self.assertEqual(payload["created_at"], "2020-01-01T12:00:00Z")

    def test_payload_preserves_an_aware_created_at_as_utc(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            created_at=datetime(2020, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        )
        payload = self.payload(self.build(social_post))
        self.assertEqual(payload["created_at"], "2020-01-01T12:00:00Z")

    def test_payload_quote_media_is_sanitized_and_camo_wrapped(self) -> None:
        social_post = SocialPost(
            platform="twitter",
            quote=Quote(
                text="q",
                media=[MediaItem(kind="photo", url="https://example.com/quote.jpg")],
            ),
        )
        payload = self.payload(self.build(social_post))
        quote_payload = payload["quote"]
        assert isinstance(quote_payload, dict)
        self.assertEqual(quote_payload["media"][0]["kind"], "photo")


class MiatsucoMessageCardEmbedContractTestCase(ZulipTestCase):
    def load_cases(self) -> list[dict[str, Any]]:
        with open(
            os.path.join(
                os.path.dirname(__file__), "fixtures/miatsuco_message_card_embed_test_cases.json"
            ),
            "rb",
        ) as f:
            cases: list[dict[str, Any]] = orjson.loads(f.read())
        return cases

    def social_post_for_case(self, name: str) -> tuple[SocialPost, str]:
        if name == "full_post_with_media_and_quote":
            return (
                SocialPost(
                    platform="twitter",
                    author_name="Jack",
                    author_handle="jack",
                    author_avatar_url="https://example.com/avatar.jpg",
                    created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    text="hello world",
                    media=[
                        MediaItem(
                            kind="photo", url="https://example.com/photo.jpg", alt_text="A photo."
                        )
                    ],
                    like_count=5,
                    repost_count=2,
                    reply_count=1,
                    permalink="https://x.com/jack/status/20",
                    quote=Quote(
                        author_name="Cordelia",
                        author_handle="cordelia",
                        author_avatar_url="https://example.com/cordelia.jpg",
                        text="great point",
                        media=[MediaItem(kind="video", url="https://example.com/video.mp4")],
                        permalink="https://x.com/cordelia/status/10",
                    ),
                ),
                "https://x.com/jack/status/20",
            )
        if name == "minimal_post":
            return (
                SocialPost(platform="bluesky"),
                "https://bsky.app/profile/example/post/1",
            )
        if name == "quote_unavailable":
            return (
                SocialPost(
                    platform="twitter",
                    author_name="Jack",
                    author_handle="jack",
                    text="look at this",
                    permalink="https://x.com/jack/status/20",
                    quote=Quote(unavailable_reason="deleted"),
                ),
                "https://x.com/jack/status/20",
            )
        raise AssertionError(f"No social_post builder for fixture case {name!r}.")

    def assert_same_shape(self, actual: object, expected: object, path: str) -> None:
        if expected is None:
            return
        if isinstance(expected, dict):
            assert isinstance(actual, dict), f"{path} should be an object."
            self.assertEqual(set(actual.keys()), set(expected.keys()), path)
            for key, expected_value in expected.items():
                self.assert_same_shape(actual[key], expected_value, f"{path}.{key}")
        elif isinstance(expected, list):
            assert isinstance(actual, list), f"{path} should be an array."
            for i, expected_item in enumerate(expected):
                self.assert_same_shape(actual[i], expected_item, f"{path}[{i}]")
        else:
            self.assertEqual(type(actual), type(expected), path)

    def test_python_payload_matches_the_shared_contract(self) -> None:
        cases = self.load_cases()
        self.assertGreater(len(cases), 0)
        for case in cases:
            social_post, fallback_link = self.social_post_for_case(case["name"])
            root = Element("div")
            add_message_card_embed(root, fallback_link, social_post, lambda url: url)
            embed = root.find("div")
            assert embed is not None
            actual_payload = json.loads(embed.get("data-message-card-embed", "{}"))
            self.assert_same_shape(actual_payload, case["expected_payload"], case["name"])
