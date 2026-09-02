import re
from io import StringIO
from unittest import mock

import responses
from django.core.management import call_command
from django.test import override_settings
from typing_extensions import override

from zerver.lib.cache import cache_delete, cache_set, preview_url_cache_key
from zerver.lib.test_classes import ZulipTestCase
from zerver.lib.test_helpers import mock_queue_publish
from zerver.management.commands.miatsuco_rerender_embeds import DomainThrottle
from zerver.models import Message, Realm

OTHER_SEED_LINKS = re.compile(r"https://zulip\.readthedocs\.io/.*")


@override_settings(INLINE_URL_EMBED_PREVIEW=True)
class RerenderEmbedsCommandTest(ZulipTestCase):
    COMMAND_NAME = "miatsuco_rerender_embeds"

    open_graph_html = """
        <html>
          <head>
            <meta property="og:title" content="The Rock" />
            <meta property="og:image" content="http://ia.media-imdb.com/images/rock.jpg" />
          </head>
          <body></body>
        </html>
    """

    @override
    def setUp(self) -> None:
        super().setUp()
        Realm.objects.all().update(inline_url_embed_preview=True)

    def test_requires_realm_or_all_realms(self) -> None:
        with self.assertRaises(SystemExit):
            call_command(self.COMMAND_NAME, dry_run=True)

    def test_dry_run_does_not_mutate(self) -> None:
        url = "http://test.org/"
        cache_delete(preview_url_cache_key(url))
        user = self.example_user("hamlet")
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_stream_message(user, "Denmark", content=url)

        out = StringIO()
        call_command(self.COMMAND_NAME, realm_id="zulip", dry_run=True, stdout=out)
        self.assertIn("Would check", out.getvalue())

        msg = Message.objects.get(id=msg_id)
        assert msg.rendered_content is not None
        self.assertNotIn("The Rock", msg.rendered_content)

    @responses.activate
    def test_refreshes_a_message_with_a_previewable_link(self) -> None:
        url = "http://test.org/"
        cache_delete(preview_url_cache_key(url))
        responses.add(
            responses.GET, url, body=self.open_graph_html, status=200, content_type="text/html"
        )
        responses.add(responses.GET, OTHER_SEED_LINKS, status=404)

        user = self.example_user("hamlet")
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            msg_id = self.send_stream_message(user, "Denmark", content=url)

        msg = Message.objects.get(id=msg_id)
        assert msg.rendered_content is not None
        self.assertNotIn("The Rock", msg.rendered_content)

        out = StringIO()
        with self.settings(TEST_SUITE=False):
            call_command(self.COMMAND_NAME, realm_id="zulip", stdout=out)

        msg.refresh_from_db()
        assert msg.rendered_content is not None
        self.assertIn("The Rock", msg.rendered_content)
        self.assertIn("Done: refreshed", out.getvalue())

    @responses.activate
    def test_processes_newest_message_first(self) -> None:
        url = "http://test.org/"
        cache_delete(preview_url_cache_key(url))
        responses.add(
            responses.GET, url, body=self.open_graph_html, status=200, content_type="text/html"
        )
        responses.add(responses.GET, OTHER_SEED_LINKS, status=404)

        user = self.example_user("hamlet")
        with mock_queue_publish("zerver.actions.message_send.queue_event_on_commit"):
            first_id = self.send_stream_message(user, "Denmark", content=url)
            second_id = self.send_stream_message(user, "Denmark", content=url)

        processed_ids: list[int] = []
        with (
            self.settings(TEST_SUITE=False),
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.FetchLinksEmbedData.consume",
                side_effect=lambda event: processed_ids.append(event["message_id"]),
            ),
        ):
            call_command(self.COMMAND_NAME, realm_id="zulip", stdout=StringIO())

        own_ids = [i for i in processed_ids if i in (first_id, second_id)]
        self.assertEqual(own_ids, [second_id, first_id])


class DomainThrottleTest(ZulipTestCase):
    def test_does_not_sleep_before_the_first_request_to_a_host(self) -> None:
        throttle = DomainThrottle(min_interval=1.0)
        with (
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.get_link_embed_data",
                return_value=mock.sentinel.embed_data,
            ),
            mock.patch("time.sleep") as mock_sleep,
        ):
            throttle.fetch("https://example.com/a")
        mock_sleep.assert_not_called()

    def test_sleeps_before_a_second_request_to_the_same_host(self) -> None:
        throttle = DomainThrottle(min_interval=1.0)
        with (
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.get_link_embed_data",
                return_value=mock.sentinel.embed_data,
            ),
            mock.patch("time.sleep") as mock_sleep,
        ):
            throttle.fetch("https://example.com/a")
            throttle.fetch("https://example.com/b")
        mock_sleep.assert_called_once()
        (waited,) = mock_sleep.call_args[0]
        self.assertAlmostEqual(waited, 1.0, delta=0.1)

    def test_does_not_sleep_for_a_different_host(self) -> None:
        throttle = DomainThrottle(min_interval=1.0)
        with (
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.get_link_embed_data",
                return_value=mock.sentinel.embed_data,
            ),
            mock.patch("time.sleep") as mock_sleep,
        ):
            throttle.fetch("https://example.com/a")
            throttle.fetch("https://other.example/b")
        mock_sleep.assert_not_called()

    def test_skips_pacing_for_an_already_cached_url(self) -> None:
        url = "https://example.com/cached"
        cache_set(preview_url_cache_key(url), "anything")
        throttle = DomainThrottle(min_interval=1.0)
        with (
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.get_link_embed_data",
                return_value=None,
            ) as mock_get,
            mock.patch("time.sleep") as mock_sleep,
        ):
            throttle.fetch(url)
            throttle.fetch(url)
        mock_sleep.assert_not_called()
        self.assertEqual(mock_get.call_count, 2)

    def test_backs_off_after_an_empty_result(self) -> None:
        throttle = DomainThrottle(min_interval=1.0)
        with (
            mock.patch(
                "zerver.management.commands.miatsuco_rerender_embeds.get_link_embed_data",
                return_value=None,
            ),
            mock.patch("time.sleep") as mock_sleep,
        ):
            throttle.fetch("https://example.com/a")
            throttle.fetch("https://example.com/b")
        (waited,) = mock_sleep.call_args[0]
        self.assertAlmostEqual(waited, 2.0, delta=0.1)
