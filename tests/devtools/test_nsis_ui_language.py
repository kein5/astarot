"""Source contracts for the installer's UI language page (#1261); real runs are in installer/."""

from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")


def block(kind, name):
    return SOURCE.split(f"\n{kind} {name}\n", 1)[1].split(f"\n{kind}End", 1)[0]


def line_of(text):
    return next(number for number, line in enumerate(SOURCE.splitlines(), 1) if line.strip() == text)


class UiLanguagePageTests(unittest.TestCase):
    def test_the_page_reads_the_language_it_was_given_after_its_declaration(self):
        # makensis reads a variable named above its Var line as plain text: the page compared the
        # words "$UILang" with "ja" and always preselected English, /UILANG=ja too.
        self.assertLess(line_of("Var UILang"), line_of("Function PageChooseLanguage"))
        self.assertLess(line_of("Var SavedUiLanguage"), line_of("Function ReadSavedUiLanguage"))

    def test_a_run_by_hand_preselects_the_language_of_the_settings_it_installs_over(self):
        page = block("Function", "PageChooseLanguage")
        # The app's own /UILANG= first; only without it the settings in $INSTDIR are read.
        fallback = page.split('${If} $UILang == ""', 1)[1].split("${EndIf}", 1)[0]
        self.assertIn("Call ReadSavedUiLanguage", fallback)
        self.assertIn("StrCpy $UILang $SavedUiLanguage", fallback)
        self.assertLess(page.index('${If} $UILang == ""'), page.index('${If} $UILang == "ja"'))
        # Japanese preselects 日本語; anything else English.
        choice = page.split('${If} $UILang == "ja"', 1)[1].split("${EndIf}", 1)[0]
        self.assertIn('${NSD_CB_SelectString} $DropListLanguages "日本語"', choice)
        self.assertIn('StrCpy $SelectedLangage "ja"', choice)
        # An update still leaves the app's setting alone.
        self.assertIn("${IfThen} $UpdateMode == 1 ${|} Abort ${|}", page.split("nsDialogs::Create", 1)[0])

    def test_the_saved_language_is_read_from_its_line_without_parsing_the_json(self):
        reader = block("Function", "ReadSavedUiLanguage")
        self.assertIn('FileOpen $0 "$INSTDIR\\config.json" r', reader)
        self.assertIn("FileRead $0 $1", reader)
        self.assertIn('FileClose $0', reader)
        self.assertIn("""${StrLoc} $2 $1 '"UI_LANGUAGE"' ">\"""", reader)
        self.assertIn("""${StrLoc} $2 $1 '"ja"' ">\"""", reader)
        self.assertIn("""${StrLoc} $2 $1 '"en"' ">\"""", reader)
        self.assertNotIn("nsJSON", reader)
        # Its registers are kept for the page.
        self.assertEqual(reader.count("Push $"), reader.count("Pop $"))

    def test_the_line_it_looks_for_is_the_line_the_settings_have(self):
        # The app writes json.dump(..., indent=4) (native/core/src/config/mod.rs, to_python_json;
        # native/core/tests/config_versions.rs checks the saved file): the key on its own line.
        text = json.dumps({"MESSAGE_FORMAT": "ja \"en\"", "UI_LANGUAGE": "ja", "UI_SCALING": 100}, indent=4, ensure_ascii=False)
        lines = [line for line in text.splitlines() if '"UI_LANGUAGE"' in line]
        self.assertEqual(lines, ['    "UI_LANGUAGE": "ja",'])


if __name__ == "__main__":
    unittest.main()
