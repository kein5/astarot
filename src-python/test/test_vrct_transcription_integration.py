"""CI-safe tests for the VRCT transcription integration boundary."""

import unittest
from datetime import datetime
from queue import Queue
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from models.transcription.transcription_transcriber import AudioTranscriber


class FakeAudioSource:
    SAMPLE_RATE = 16000
    SAMPLE_WIDTH = 2
    channels = 1


# The engine behind a VAD segment here is a cloud one with its provider replaced; the local
# Whisper that played this part was removed (#288).
PROVIDER = "models.transcription.transcription_transcriber.OpenAICompatibleTranscriptionProvider"


class TestVrctTranscriptionIntegration(unittest.TestCase):
    @patch(PROVIDER)
    def test_audio_transcriber_drains_vad_segment_and_stores_transcript(self, provider_class) -> None:
        provider_class.return_value = SimpleNamespace(
            transcribe=lambda *_args, **_kwargs: ("これはVRCTのテストです", 0.95, True, "ja"))
        transcriber = AudioTranscriber(
            False,
            FakeAudioSource(),
            phrase_timeout=3,
            max_phrases=10,
            transcription_engine="Custom_Whisper",
            vad_segmented=True,
        )
        queue = Queue()
        queue.put((b"\x01\x00" * 1600, datetime.now(), "silence"))

        result = transcriber.transcribeAudioQueue(queue, ["Japanese"], ["Japan"])
        transcript = transcriber.getTranscript()

        self.assertTrue(result)
        self.assertTrue(queue.empty())
        self.assertEqual(transcript["text"], "これはVRCTのテストです")
        self.assertEqual(transcriber.asr_attempts, 1)
        self.assertEqual(transcriber.asr_successes, 1)

    @patch(PROVIDER)
    def test_audio_transcriber_reports_asr_failure_after_vad_segment(self, provider_class) -> None:
        provider_class.return_value = SimpleNamespace(transcribe=lambda *_args, **_kwargs: ("", 0.0, False, None))
        transcriber = AudioTranscriber(
            False,
            FakeAudioSource(),
            phrase_timeout=3,
            max_phrases=10,
            transcription_engine="Custom_Whisper",
            vad_segmented=True,
        )
        queue = Queue()
        queue.put((b"\x01\x00" * 1600, datetime.now(), "flush"))

        result = transcriber.transcribeAudioQueue(queue, ["Japanese"], ["Japan"])

        self.assertTrue(result)
        self.assertTrue(queue.empty())
        self.assertEqual(transcriber.asr_attempts, 1)
        self.assertEqual(transcriber.asr_successes, 0)

    def test_google_engine_uses_vrct_transcriber_path_and_stores_result(self) -> None:
        transcriber = AudioTranscriber(
            False,
            FakeAudioSource(),
            phrase_timeout=3,
            max_phrases=10,
            transcription_engine="Google",
            vad_segmented=True,
        )
        transcriber.audio_recognizer.recognize_google = MagicMock(
            return_value=("これはGoogle経路のテストです", 0.9)
        )
        queue = Queue()
        queue.put((b"\x01\x00" * 1600, datetime.now(), "silence"))

        result = transcriber.transcribeAudioQueue(queue, ["Japanese"], ["Japan"])
        transcript = transcriber.getTranscript()

        self.assertTrue(result)
        self.assertEqual(transcript["text"], "これはGoogle経路のテストです")
        transcriber.audio_recognizer.recognize_google.assert_called_once()
        _, kwargs = transcriber.audio_recognizer.recognize_google.call_args
        self.assertEqual(kwargs["language"], "ja-JP")
        self.assertTrue(kwargs["join_all_results"])


if __name__ == "__main__":
    unittest.main()
