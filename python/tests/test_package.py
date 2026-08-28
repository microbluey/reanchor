"""What the installed package reports about itself.

`reanchor.__version__` was a hand-written literal until 0.3.0, and it said
"0.1.0" in the 0.2.0 and 0.3.0 wheels because nothing bumped it and nothing
checked it. It now comes from distribution metadata; this asserts that the
metadata the test environment installed is the version `pyproject.toml`
declares, so the two cannot drift apart again unnoticed.
"""

from __future__ import annotations

import re
from pathlib import Path

import reanchor

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def declared_version() -> str:
    # A regex rather than tomllib: `requires-python` is >=3.10 and tomllib
    # arrived in 3.11. The release workflow reads the same line the same way.
    for line in PYPROJECT.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r'version = "([^"]+)"', line.strip())
        if match:
            return match.group(1)
    raise AssertionError(f"no version line in {PYPROJECT}")


def test_reports_the_version_pyproject_declares() -> None:
    assert reanchor.__version__ == declared_version()
