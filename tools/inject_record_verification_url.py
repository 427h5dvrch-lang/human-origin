#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

GENERIC_VERIFIER_BASE = "https://427h5dvrch-lang.github.io/humanorigin-verifier/"
RECORD_PAGE_BASE = "https://427h5dvrch-lang.github.io/humanorigin-verifier/record.html"


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def deep_find(obj, keys: set[str]):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and v not in (None, "", [], {}):
                return v
        for v in obj.values():
            found = deep_find(v, keys)
            if found not in (None, "", [], {}):
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = deep_find(item, keys)
            if found not in (None, "", [], {}):
                return found
    return None


def short_id(value: str | None) -> str:
    if not value:
        return "UNKNOWN"
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(value)).upper()
    return cleaned[:8] if cleaned else "UNKNOWN"


def full_id(value: str | None) -> str:
    if not value:
        return "UNKNOWN"
    cleaned = re.sub(r"[^A-Za-z0-9_.:-]", "", str(value)).strip()
    return cleaned if cleaned else "UNKNOWN"


def update_text_urls(text: str, new_url: str) -> str:
    text = re.sub(
        r'https://427h5dvrch-lang\.github\.io/humanorigin-verifier/record\.html\?[^\s<>"\']+',
        new_url,
        text,
    )
    text = text.replace("https://427h5dvrch-lang.github.io/humanorigin-verifier/", new_url)
    return text


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: inject_record_verification_url.py /path/to/bundle")
        return 1

    bundle = Path(sys.argv[1]).expanduser().resolve()
    if not bundle.is_dir():
        print(f"ERREUR: bundle introuvable: {bundle}")
        return 1

    manifest_path = bundle / "HumanOrigin_MANIFEST.json"
    manifest = read_json(manifest_path)

    preferred = bundle / "CERTIFICAT_FINAL.v1.ho.json"
    if not preferred.exists():
        preferred = bundle / "CERTIFICAT_FINAL.ho.json"

    proof = read_json(preferred) if preferred.exists() else {}
    raw_id = (
        deep_find(proof, {"certificate_id", "certificateId", "id", "record_id", "recordId"})
        or manifest.get("certificate_id")
        or manifest.get("record_id")
        or "UNKNOWN"
    )

    record_id_full = full_id(str(raw_id))
    record_id_short = short_id(str(raw_id))

    record_verification_url = f"{RECORD_PAGE_BASE}?rid={quote(record_id_short)}"

    manifest["generic_verifier_url"] = GENERIC_VERIFIER_BASE
    manifest["verifier_url"] = record_verification_url
    manifest["record_verification_url"] = record_verification_url
    manifest["record_id_full"] = record_id_full
    manifest["record_id_public"] = record_id_short
    write_json(manifest_path, manifest)

    candidates = [
        bundle / "HumanOrigin_OPEN_FIRST.html",
        bundle / "HumanOrigin_START_HERE.txt",
        bundle / "HumanOrigin_START_HERE_EN.txt",
        bundle / "HumanOrigin_START_HERE_FR.txt",
        bundle / "HumanOrigin_READ_ME_FIRST.txt",
        bundle / "HumanOrigin_READ_ME_FIRST_EN.txt",
        bundle / "HumanOrigin_READ_ME_FIRST_FR.txt",
        bundle / "HumanOrigin_VERIFY.txt",
        bundle / "HumanOrigin_VERIFY_EN.txt",
        bundle / "HumanOrigin_VERIFY_FR.txt",
    ]

    for path in candidates:
        if path.exists():
            txt = path.read_text(encoding="utf-8")
            txt2 = update_text_urls(txt, record_verification_url)
            if txt2 != txt:
                path.write_text(txt2, encoding="utf-8")

    (bundle / "HumanOrigin_RECORD_URL.txt").write_text(record_verification_url + "\n", encoding="utf-8")

    print("OK: short record verification URL injected")
    print("  record_id_full  =", record_id_full)
    print("  record_id_short =", record_id_short)
    print("  record_url      =", record_verification_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
