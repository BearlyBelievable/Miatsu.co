import time
from argparse import ArgumentParser
from typing import Any
from urllib.parse import urlsplit

from typing_extensions import override

from zerver.actions.message_edit import do_update_embedded_data
from zerver.actions.message_send import render_incoming_message
from zerver.lib.cache import cache_get, preview_url_cache_key
from zerver.lib.management import ZulipBaseCommand
from zerver.lib.mention import MentionBackend, MentionData
from zerver.lib.url_preview.preview import get_link_embed_data
from zerver.models import Message, Realm
from zerver.worker.embed_links import FetchLinksEmbedData

DEFAULT_MIN_INTERVAL_SECONDS = 1.0
MAX_INTERVAL_SECONDS = 60.0


class DomainThrottle:
    """Paces oEmbed fetches per hostname, backing off automatically when
    one comes back empty."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._interval: dict[str, float] = {}
        self._last_request: dict[str, float] = {}

    def fetch(self, url: str) -> None:
        if cache_get(preview_url_cache_key(url)) is not None:
            get_link_embed_data(url)
            return

        hostname = urlsplit(url).hostname or url
        interval = self._interval.get(hostname, self.min_interval)
        elapsed = time.monotonic() - self._last_request.get(hostname, float("-inf"))
        if elapsed < interval:
            time.sleep(interval - elapsed)

        result = get_link_embed_data(url)
        self._last_request[hostname] = time.monotonic()
        if result is None:
            self._interval[hostname] = min(interval * 2, MAX_INTERVAL_SECONDS)


class Command(ZulipBaseCommand):
    help = """Refetch and re-render link previews in place for every message with a link.

This command re-renders every message with a link directly and saves
any one whose rendering changed. This avoids bumping the global
markdown_version constant (see Message.need_to_render_content), which
forces every message on the server to re-render the next time it's
read."""

    @override
    def add_arguments(self, parser: ArgumentParser) -> None:
        self.add_realm_args(parser, help="Only refresh messages in this realm.")
        parser.add_argument(
            "--all-realms",
            action="store_true",
            help="Refresh matching messages across every realm on this server.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report how many messages have a link, without changing anything.",
        )
        parser.add_argument(
            "--min-interval",
            type=float,
            default=DEFAULT_MIN_INTERVAL_SECONDS,
            help=(
                "Minimum seconds between fetches to the same provider domain "
                f"(default: {DEFAULT_MIN_INTERVAL_SECONDS})."
            ),
        )

    @override
    def handle(self, *args: Any, **options: Any) -> None:
        realm = self.get_realm(options)
        if realm is None and not options["all_realms"]:
            raise SystemExit(
                "Pass -r/--realm to scope this to one realm, or --all-realms "
                "to run across every realm on this server."
            )

        realms = [realm] if realm is not None else list(Realm.objects.all())
        count = sum(Message.objects.filter(has_link=True, realm=r).count() for r in realms)
        if options["dry_run"]:
            self.stdout.write(f"Would check {count} message(s) with a link.")
            return

        self.stdout.write(f"Checking {count} message(s) with a link, newest first...")
        throttle = DomainThrottle(options["min_interval"])
        worker = FetchLinksEmbedData()
        refreshed = 0
        i = 0
        for one_realm in realms:
            queryset = Message.objects.filter(has_link=True, realm=one_realm).order_by("-id")
            for message in queryset.select_related("sender", "realm").iterator():
                i += 1
                mention_data = MentionData(
                    mention_backend=MentionBackend(message.realm_id),
                    content=message.content,
                    message_sender=message.sender,
                )
                rendering_result = render_incoming_message(
                    message, message.content, message.realm, mention_data=mention_data
                )
                if rendering_result.links_for_preview:
                    for url in rendering_result.links_for_preview:
                        throttle.fetch(url)
                    worker.consume(
                        {
                            "message_id": message.id,
                            "message_content": message.content,
                            "message_realm_id": message.realm_id,
                            "urls": list(rendering_result.links_for_preview),
                        }
                    )
                    refreshed += 1
                elif rendering_result.rendered_content != message.rendered_content:
                    do_update_embedded_data(message.sender, message, rendering_result, mention_data)
                    refreshed += 1
                if i % 100 == 0:
                    self.stdout.write(f"  ...{i}/{count}")

        self.stdout.write(
            f"Done: refreshed {refreshed}/{count} message(s) with a previewable link."
        )
