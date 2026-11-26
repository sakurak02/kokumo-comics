import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("site_build", Path(__file__).resolve().parents[1] / "scripts" / "build.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for folder in ("comics", "memories", "css", "js"):
            (self.root / folder).mkdir()
        for page in ("index.html", "comic.html"):
            (self.root / page).write_text("<!doctype html>", encoding="utf-8")

    def image(self, name):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"unchanged-image-bytes")
        return path

    def stories(self):
        return builder.collect(self.root, builder.COLLECTIONS[0])

    def memories(self):
        return builder.collect(self.root, builder.COLLECTIONS[1])

    def test_numeric_story_order_including_over_one_hundred(self):
        for number in range(1, 106):
            self.image(f"comics/{number:03}/{number:03}_おはなし.webp")
        records = self.stories()
        self.assertEqual(len(records), 105)
        self.assertEqual([r["number"] for r in records], [f"{n:03}" for n in range(105, 0, -1)])
        self.assertNotIn("date", records[0])

    def test_pages_sort_numerically_and_share_one_record(self):
        for page in reversed(range(1, 11)):
            prefix = "001" if page == 1 else f"001-{page}"
            self.image(f"comics/001/{prefix}_おはなし.webp")
        records = self.stories()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["images"][1], "comics/001/001-2_おはなし.webp")
        self.assertEqual(records[0]["images"][-1], "comics/001/001-10_おはなし.webp")

    def test_memory_event_dates_and_same_day_entries(self):
        for name in ("20261125_空", "20261123_雲", "20261125_散歩"):
            self.image(f"memories/{name}.webp")
        records = self.memories()
        self.assertEqual([r["date"] for r in records], ["2026-11-25", "2026-11-25", "2026-11-23"])
        self.assertEqual(len({r["id"] for r in records}), 3)
        self.assertNotIn("number", records[0])

    def test_memory_pages_use_the_same_rules(self):
        self.image("memories/20261125-2_空.webp")
        self.image("memories/20261125_空.webp")
        self.assertEqual(len(self.memories()[0]["images"]), 2)

    def test_invalid_date_is_actionable(self):
        self.image("memories/20260230_空.webp")
        with self.assertRaisesRegex(builder.BuildError, "20260230.*実在する日付"):
            self.memories()

    def test_wrong_name_and_extension_are_rejected(self):
        for filename in ("001.webp", "001-1.webp", "001_タイトル.png", "000_タイトル.webp", "001_ タイトル.webp"):
            with self.subTest(filename=filename):
                path = self.image("comics/" + filename)
                with self.assertRaises(builder.BuildError):
                    self.stories()
                path.unlink()

    def test_duplicate_story_number_with_different_title(self):
        self.image("comics/001_空.webp")
        self.image("comics/nested/001_雲.webp")
        with self.assertRaisesRegex(builder.BuildError, "作品番号001.*重複"):
            self.stories()

    def test_duplicate_page_even_in_different_folders(self):
        self.image("comics/001_空.webp")
        self.image("comics/nested/001-1_空.webp")
        with self.assertRaisesRegex(builder.BuildError, "1ページ目が重複"):
            self.stories()

    def test_unicode_equivalent_names_cannot_duplicate_an_entry(self):
        self.image("memories/a/20261125_が.webp")
        self.image("memories/b/20261125_か\u3099.webp")
        with self.assertRaisesRegex(builder.BuildError, "重複"):
            self.memories()

    def test_missing_page_is_rejected(self):
        self.image("comics/001_空.webp")
        self.image("comics/001-3_空.webp")
        with self.assertRaisesRegex(builder.BuildError, "欠番なく"):
            self.stories()

    def test_title_punctuation_is_preserved(self):
        self.image("comics/001_ここくも、みつかる # 100%.webp")
        self.assertEqual(self.stories()[0]["title"], "ここくも、みつかる # 100%")

    def test_build_creates_data_and_old_image_url_without_changing_bytes(self):
        original = self.image("comics/001/001_ここくも、みつかる.webp")
        output = self.root / "_site"
        builder.build(self.root, output)
        records = json.loads((output / "data/comics.json").read_text(encoding="utf-8"))
        self.assertEqual(records[0]["id"], "001")
        self.assertEqual(records[0]["title"], "ここくも、みつかる")
        self.assertEqual((output / "comics/001/001-1.webp").read_bytes(), original.read_bytes())
        self.assertEqual(json.loads((output / "data/memories.json").read_text()), [])
        self.assertFalse((self.root / "data/comics.json").exists())
        # Rebuild deterministically; deleted sources must disappear from output.
        original.unlink()
        builder.build(self.root, output)
        self.assertFalse((output / "comics/001/001-1.webp").exists())

    def test_validation_error_keeps_previous_successful_build(self):
        output = self.root / "_site"
        builder.build(self.root, output)
        before = (output / "data/comics.json").read_bytes()
        self.image("comics/wrong.webp")
        with self.assertRaises(builder.BuildError):
            builder.build(self.root, output)
        self.assertEqual((output / "data/comics.json").read_bytes(), before)

    def test_output_cannot_replace_source_or_image_folders(self):
        for output in (self.root, self.root.parent, self.root / "comics", self.root / "memories/output"):
            with self.subTest(output=output), self.assertRaises(builder.BuildError):
                builder.build(self.root, output)


if __name__ == "__main__":
    unittest.main()
