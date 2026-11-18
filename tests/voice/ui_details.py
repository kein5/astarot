"""Helpers for browser tests of settings pages with folded sections."""


def open_engine_settings(page):
    """One-time setup (models, runtimes, servers) starts folded; open it, as a user would, to reach its fields.

    Only the folds in sight are opened: one inside a page's closed 「詳細設定」 (#554) stays as it
    is, as for a user; open_more_settings opens that first.
    """
    page.locator("details[data-setup] > summary").first.wait_for()
    closed = page.locator("details[data-setup]:not([open]) > summary:visible")
    while closed.count():
        closed.first.click()


open_setup = open_engine_settings


def open_more_settings(page):
    """Open the page's 「詳細設定」 (#554), as a user would, to reach what is set once."""
    page.locator("details[data-advanced] > summary").first.wait_for()
    closed = page.locator("details[data-advanced]:not([open]) > summary")
    while closed.count():
        closed.first.click()
