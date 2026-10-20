"""Thin async HTTP client that talks to the Revit add-in running inside Revit.

⚠️ 2026-08-24 — the bridge now requires a session token.

Until this change `POST /execute` accepted arbitrary C# with **no
authentication at all**, compiled it with Roslyn and ran it inside a live Revit
`Transaction`, on the same machine that stores a ~1-year MGL API token.  Any
local process — or a drive-by request from a browser page — owned both Revit and
the MGL API.

The add-in now mints a fresh token on every Revit start and writes it to
``%APPDATA%/RevitMcpAddin/bridge.json``.  This client reads that file.  Nothing
else about the workflow changes.

Two further consequences worth knowing:

* Arbitrary code execution (``/execute``) is **off by default**.  Set
  ``MGL_ALLOW_EXEC=1`` in the *Revit* process environment to re-enable it.  The
  typed ``/tool`` endpoint needs no such flag — prefer it.
* Any path other than ``/health`` returns **401** without a token, including
  unknown paths (so a typo now reads as 401, not 404).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx

DEFAULT_URL = os.environ.get("REVIT_MCP_URL", "http://localhost:5005")
# Slightly longer than the add-in's own execution timeout.
DEFAULT_TIMEOUT = float(os.environ.get("REVIT_MCP_TIMEOUT", "75"))


def _handshake_path() -> Path:
    """Where the add-in writes the per-session bridge token."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "RevitMcpAddin" / "bridge.json"
    return Path.home() / "AppData" / "Roaming" / "RevitMcpAddin" / "bridge.json"


class BridgeNotRunning(RuntimeError):
    """Raised when the handshake file is missing — Revit is closed, or too old an add-in."""


class RevitClient:
    """Talks to the Revit MCP add-in's localhost HTTP endpoints."""

    def __init__(self, base_url: str | None = None, timeout: float = DEFAULT_TIMEOUT):
        self._explicit_url = base_url
        self.timeout = timeout

    # ------------------------------------------------------------------
    # Handshake
    # ------------------------------------------------------------------

    def _read_handshake(self) -> dict:
        path = _handshake_path()
        try:
            # ⚠️ `utf-8-sig` — BOM байсан ч уншина.  Хуучин add-in BOM-той
            # бичдэг байсан тул шинэ клиент хуучин Revit-тэй ажиллах ёстой.
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError as exc:
            raise BridgeNotRunning(
                f"Bridge handshake file not found at {path}. "
                "Open Revit with the MGL add-in loaded, then retry."
            ) from exc
        except (OSError, ValueError) as exc:
            raise BridgeNotRunning(f"Could not read {path}: {exc}") from exc

    @property
    def base_url(self) -> str:
        """Explicit URL wins; otherwise the port the add-in actually bound."""
        if self._explicit_url:
            return self._explicit_url.rstrip("/")
        try:
            port = int(self._read_handshake().get("port") or 5005)
        except (BridgeNotRunning, TypeError, ValueError):
            port = 5005
        return f"http://localhost:{port}"

    def _auth_headers(self) -> dict:
        token = self._read_handshake().get("token")
        if not token:
            raise BridgeNotRunning("Handshake file has no token; restart Revit.")
        return {"Authorization": f"Bearer {token}"}

    # ------------------------------------------------------------------
    # Endpoints
    # ------------------------------------------------------------------

    async def health(self) -> dict:
        """`/health` is deliberately token-free — it returns no model data."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/health")
            resp.raise_for_status()
            return resp.json()

    async def tool(self, name: str, args: dict | None = None) -> dict:
        """Call a TYPED tool. Preferred over `execute` — no compiler, no arbitrary code."""
        headers = self._auth_headers()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/tool",
                json={"tool": name, "args": args or {}},
                headers=headers,
            )
            if resp.status_code == 401:
                raise BridgeNotRunning(
                    "Bridge rejected the token (401). Revit was probably restarted — retry."
                )
            resp.raise_for_status()
            return resp.json()

    async def execute(self, code: str) -> dict:
        """POST a C# code string to the add-in and return its JSON result.

        Requires ``MGL_ALLOW_EXEC=1`` in the Revit process; otherwise the add-in
        answers 403 and you should use :meth:`tool` instead.
        """
        headers = self._auth_headers()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/execute", json={"code": code}, headers=headers
            )
            if resp.status_code == 401:
                raise BridgeNotRunning(
                    "Bridge rejected the token (401). Revit was probably restarted — retry."
                )
            if resp.status_code == 403:
                return {
                    "success": False,
                    "error": (
                        "Arbitrary code execution is disabled in the add-in. "
                        "Use a typed tool, or set MGL_ALLOW_EXEC=1 in Revit's "
                        "environment and restart Revit."
                    ),
                }
            resp.raise_for_status()
            return resp.json()
