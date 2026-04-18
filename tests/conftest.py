"""
Pytest hooks: load project root `.env` so tests see the same vars as the backend API process.
Explicit environment variables take precedence (override=False).
"""

from pathlib import Path

from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=False)
