#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check that project version strings stay synchronized."""

import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def read_text(relative_path: str) -> str:
    return (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")


def find_required(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text)
    if not match:
        raise AssertionError(f"未找到版本号: {label}")
    return match.group(1)


def main() -> int:
    checks = []

    index_html = read_text("index.html")
    app_version = find_required(r'const\s+APP_VERSION\s*=\s*"(v\d+\.\d+\.\d+)"', index_html, "index.html APP_VERSION")
    checks.append(("index.html APP_VERSION", app_version))

    forbidden_static = re.findall(r"v\d+\.\d+\.\d+", index_html.replace(f'"{app_version}"', ""))
    if forbidden_static:
        raise AssertionError(
            "index.html 中除 APP_VERSION 外仍存在硬编码版本号: " + ", ".join(sorted(set(forbidden_static)))
        )

    docs = [
        ("README.md", r"\*\*版本\*\*[：:]\s*(v\d+\.\d+\.\d+)"),
        ("package.json", r'"version"\s*:\s*"(\d+\.\d+\.\d+)"'),
    ]

    for path, pattern in docs:
        version = find_required(pattern, read_text(path), path)
        checks.append((path, f"v{version}" if path == "package.json" else version))

    mismatches = [(label, version) for label, version in checks if version != app_version]
    if mismatches:
        for label, version in mismatches:
            print(f"❌ {label}: {version}，应为 {app_version}")
        return 1

    for label, version in checks:
        print(f"✅ {label}: {version}")
    print("版本一致性检查通过")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"❌ {exc}")
        raise SystemExit(1)
