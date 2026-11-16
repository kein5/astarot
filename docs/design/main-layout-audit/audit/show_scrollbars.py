"""Pytest plugin for the layout audit: draw scrollbars like the app does.

Playwright starts headless Chromium with --hide-scrollbars; the audit needs them visible.
"""
from playwright.sync_api._generated import BrowserType

_launch = BrowserType.launch


def launch(self, *args, **kwargs):
    kwargs.setdefault("ignore_default_args", ["--hide-scrollbars"])
    return _launch(self, *args, **kwargs)


BrowserType.launch = launch
