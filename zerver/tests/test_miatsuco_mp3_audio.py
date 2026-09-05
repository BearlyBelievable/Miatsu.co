from zerver.lib.test_miatsuco import MiatsucoMarkdownTestMixin


class MiatsucoMp3AudioPreviewTest(MiatsucoMarkdownTestMixin):
    def test_inline_mp3_audio_preview_nonstandard_mimetype(self) -> None:
        # Uppy's own MIME type guessing reports the non-standard
        # audio/mp3 (rather than audio/mpeg) for an .mp3 upload when
        # the browser itself reports no type, so the server needs to
        # treat this the same as audio/mpeg for uploaded files.
        url, path_id = self.upload_file_and_get_path_id("filename.mp3", "audio/mp3")
        message_id = self.send_message_content(f"![Audio link](/user_uploads/{path_id})")
        expected = (
            f'<p><audio controls preload="metadata" src="{url}" title="Audio link"></audio></p>'
        )
        self.assert_message_content_is(message_id, expected)
