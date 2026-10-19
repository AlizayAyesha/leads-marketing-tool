#!/usr/bin/env python3
"""Crawl one public URL with Crawl4AI using installed Google Chrome (not bundled Chromium)."""

from __future__ import annotations

import asyncio
import json
import os
import sys

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


def markdown_text(result) -> str:
    md = getattr(result, "markdown", None)
    if md is None:
        return ""
    raw = getattr(md, "raw_markdown", None)
    if raw:
        return str(raw)
    return str(md)


async def crawl(url: str) -> dict:
    config = BrowserConfig(
        headless=True,
        verbose=False,
        chrome_channel="chrome",
        channel="chrome",
        extra_args=["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
    )
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
    async with AsyncWebCrawler(config=config) as crawler:
        result = await crawler.arun(url=url, config=run_config)
        text = markdown_text(result)
        ok = bool(getattr(result, "success", False) or text.strip())
        return {
            "ok": ok,
            "markdown": text,
            "error": getattr(result, "error_message", None),
        }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "markdown": "", "error": "URL required"}))
        return 1
    out = asyncio.run(crawl(sys.argv[1]))
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
