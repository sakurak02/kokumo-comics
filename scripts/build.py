#!/usr/bin/env python3
"""Build both collections from image filenames, using only Python's standard library."""

import argparse
from datetime import date
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata


COLLECTIONS = (
    {"folder": "comics", "label": "おはなし", "kind": "number", "output": "comics.json"},
    {"folder": "memories", "label": "思い出", "kind": "date", "output": "memories.json"},
)
IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".heic"}


class BuildError(ValueError):
    pass


def collect(source, config):
    folder = source / config["folder"]
    groups = {}
    if not folder.is_dir():
        raise BuildError(f'{config["label"]}: 保存先フォルダがありません: {folder}')
    digits = r"[0-9]{3,}" if config["kind"] == "number" else r"[0-9]{8}"
    pattern = re.compile(rf"({digits})(?:-([1-9][0-9]*))?_(.+)\.webp", re.IGNORECASE)
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(source).as_posix()
        if path.is_symlink():
            raise BuildError(f"{relative}: シンボリックリンクではなく実際の画像を保存してください。")
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if config["kind"] == "number" and path.parent != folder:
            raise BuildError(f"{relative}: おはなしの画像は話数フォルダを作らず、comics直下に置いてください。例: comics/001_タイトル.webp")
        match = pattern.fullmatch(path.name)
        example = "001_タイトル.webp" if config["kind"] == "number" else "20261125_タイトル.webp"
        if not match:
            raise BuildError(f"{relative}: ファイル名の形式が違います。例: {example}")
        key, page_text, raw_title = match.groups()
        if config["kind"] == "number" and page_text is not None:
            raise BuildError(f"{relative}: おはなしは1話につき1枚です。枝番を付けず、001_タイトル.webp の形式にしてください。")
        title = unicodedata.normalize("NFC", raw_title)
        if not title.strip() or title != title.strip() or any(unicodedata.category(c).startswith("C") or c == "\\" for c in title):
            raise BuildError(f"{relative}: タイトルの前後の空白・改行・制御文字を取り除いてください。")
        page = int(page_text or "1")
        if config["kind"] == "number":
            if int(key) < 1 or f"{int(key):03d}" != key or int(key) > 9007199254740991:
                raise BuildError(f"{relative}: 作品番号は001から始まる3桁以上の半角数字にしてください。")
            identity = key
            metadata = {"number": key}
        else:
            try:
                event_date = date(int(key[:4]), int(key[4:6]), int(key[6:8]))
            except ValueError:
                raise BuildError(f"{relative}: 出来事の日付「{key}」は実在する日付ではありません。") from None
            identity = f"{key}_{title}"
            metadata = {"date": event_date.isoformat()}
        group = groups.setdefault(identity, {"id": identity, "title": title, **metadata, "pages": {}})
        if group["title"] != title:
            raise BuildError(f'{relative}: 作品番号{key}が別のタイトル「{group["title"]}」と重複しています。おはなしは1話につき1枚とし、作品番号を確認してください。')
        if page in group["pages"]:
            raise BuildError(f'{relative}: {config["label"]}「{title}」の{page}ページ目が重複しています: {group["pages"][page]}')
        group["pages"][page] = relative

    records = []
    for group in groups.values():
        pages = group.pop("pages")
        if sorted(pages) != list(range(1, len(pages) + 1)):
            raise BuildError(f'{config["label"]}「{group["title"]}」: ページ番号は1から欠番なく付けてください。現在の枝番: {sorted(pages)}')
        records.append({**group, "images": [pages[n] for n in sorted(pages)]})
    field = config["kind"]
    return sorted(records, key=lambda r: (-int(r[field].replace("-", "")), r["title"]))


def build(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output == source or output in source.parents or any(output == source / name or source / name in output.parents for name in ("comics", "memories", "css", "js", "scripts")):
        raise BuildError("出力先にはソースや画像フォルダを指定できません。通常は _site を使ってください。")
    collections = {config["folder"]: collect(source, config) for config in COLLECTIONS}
    # Validate all filenames before replacing the previous successful build.
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kokumo-build-", dir=output.parent) as temporary:
        stage = Path(temporary) / "site"
        stage.mkdir()
        for filename in ("index.html", "comic.html"):
            shutil.copy2(source / filename, stage / filename)
        for folder in ("css", "js"):
            shutil.copytree(source / folder, stage / folder)
        (stage / "data").mkdir()
        for config in COLLECTIONS:
            records = collections[config["folder"]]
            (stage / "data" / config["output"]).write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            for record in records:
                for page, relative in enumerate(record["images"], 1):
                    target = stage / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source / relative, target)
                    if config["kind"] == "number":
                        # Preserve the original image URLs as well as comic.html?id=001.
                        alias = stage / "comics" / record["number"] / f'{record["number"]}-{page}.webp'
                        alias.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source / relative, alias)
                        # Also preserve the filename-based URL used before flattening comics/.
                        named_alias = alias.parent / Path(relative).name
                        shutil.copy2(source / relative, named_alias)
        (stage / ".nojekyll").touch()
        if output.exists():
            shutil.rmtree(output)
        shutil.move(str(stage), str(output))
    return collections


def main():
    parser = argparse.ArgumentParser(description="画像ファイル名からおはなし・思い出の公開データを自動生成します。")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, help="通常はリポジトリ内の _site")
    args = parser.parse_args()
    try:
        result = build(args.source, args.output or args.source / "_site")
    except (BuildError, OSError) as error:
        print(f"ビルドエラー: {error}", file=sys.stderr)
        return 1
    for config in COLLECTIONS:
        records = result[config["folder"]]
        print(f'{config["label"]}: {len(records)}作品 / {sum(len(r["images"]) for r in records)}画像')
        for record in records:
            print(f'  {record[config["kind"]]} {record["title"]} ({len(record["images"])}ページ)')
    print(f'公開ファイル: {args.output or args.source / "_site"}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
