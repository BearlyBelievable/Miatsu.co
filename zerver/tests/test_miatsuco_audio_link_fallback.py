from zerver.lib.camo import get_camo_url
from zerver.lib.test_miatsuco import MiatsucoMarkdownTestMixin


class MiatsucoAudioLinkFallbackTest(MiatsucoMarkdownTestMixin):
    def test_plain_link_to_uploaded_audio_still_embeds(self) -> None:
        url, path_id = self.upload_file_and_get_path_id("filename.mp3", "audio/mpeg")
        message_id = self.send_message_content(f"[Audio link](/user_uploads/{path_id})")
        expected = (
            f'<p><a href="{url}">Audio link</a></p>\n'
            f'<audio controls preload="metadata" src="{url}" title="Audio link"></audio>'
        )
        self.assert_message_content_is(message_id, expected)

    def test_plain_link_to_unsupported_upload_stays_a_link(self) -> None:
        url, path_id = self.upload_file_and_get_path_id("filename.txt", "text/plain")
        message_id = self.send_message_content(f"[Some file](/user_uploads/{path_id})")
        expected = f'<p><a href="{url}">Some file</a></p>'
        self.assert_message_content_is(message_id, expected)

    def test_plain_link_to_external_audio_still_embeds(self) -> None:
        url = "http://test.org/song.mp3"
        camo_url = get_camo_url(url)
        message_id = self.send_message_content(f"[Audio link]({url})")
        expected = (
            f'<p><a href="{url}">Audio link</a></p>\n'
            f'<audio controls preload="metadata" src="{camo_url}" title="Audio link"></audio>'
        )
        self.assert_message_content_is(message_id, expected)
