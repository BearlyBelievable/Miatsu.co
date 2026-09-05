from zerver.lib.test_miatsuco import MiatsucoMarkdownTestMixin


class MiatsucoMp3AudioPreviewTest(MiatsucoMarkdownTestMixin):
    def test_inline_mp3_audio_preview_nonstandard_mimetype(self) -> None:
        url, path_id = self.upload_file_and_get_path_id("filename.mp3", "audio/mp3")
        message_id = self.send_message_content(f"![Audio link](/user_uploads/{path_id})")
        expected = (
            f'<p><audio controls preload="metadata" src="{url}" title="Audio link"></audio></p>'
        )
        self.assert_message_content_is(message_id, expected)
