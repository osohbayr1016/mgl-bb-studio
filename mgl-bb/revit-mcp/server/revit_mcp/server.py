"""Revit MCP server.

Exposes a few tools over stdio that Claude can call. The heavy lifting happens
inside Revit: tools forward a C# code string to the Revit add-in over localhost
HTTP, and the add-in compiles + runs it against the Revit API.
"""

from __future__ import annotations

import logging
import sys

from mcp.server.fastmcp import FastMCP

from .revit_client import RevitClient
from . import snippets

# Log to stderr ONLY — stdout is the MCP stdio channel and must stay clean.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s [revit-mcp] %(levelname)s: %(message)s",
)
log = logging.getLogger("revit-mcp")

mcp = FastMCP("revit-mcp")
client = RevitClient()


def _format(result: dict) -> str:
    """Turn the add-in's JSON result into a readable text block for the model."""
    if not isinstance(result, dict):
        return str(result)

    parts: list[str] = []
    if result.get("success"):
        parts.append("✅ SUCCESS")
        ret = result.get("result")
        if ret not in (None, "", "null"):
            parts.append(f"Return value: {ret}")
    else:
        parts.append("❌ FAILED")
        if result.get("error"):
            parts.append("Error:\n" + str(result["error"]))

    output = result.get("output")
    if output:
        parts.append("Output:\n" + str(output).rstrip())

    return "\n".join(parts)


async def _run(code: str) -> str:
    try:
        result = await client.execute(code)
    except Exception as exc:  # noqa: BLE001 - surface any connection issue to the model
        return (
            f"ERROR: could not reach the Revit add-in at {client.base_url} ({exc}).\n"
            "Make sure Revit 2027 is open with a project loaded and the 'Revit MCP' "
            "add-in is active."
        )
    return _format(result)


@mcp.tool()
async def run_revit_code(code: str) -> str:
    """Execute C# Revit API code inside the running Revit 2027 session and return the result.

    The code is compiled and run with Roslyn on Revit's main thread. These usings are
    ALREADY imported (do not add them): System, System.Linq, System.Collections.Generic,
    Autodesk.Revit.DB, Autodesk.Revit.UI.

    Globals already available (do NOT redeclare them):
      - Doc   : Autodesk.Revit.DB.Document        (the active document)
      - UiDoc : Autodesk.Revit.UI.UIDocument
      - UiApp : Autodesk.Revit.UI.UIApplication
      - Print(object msg) : appends a line to the text output returned to you

    IMPORTANT RULES:
      1. A Transaction named "MCP Script" is ALREADY OPEN. Do NOT create, start, commit,
         or roll back your own Transaction — just modify Doc directly. (Only if you truly
         need several separate undo steps should you use a TransactionGroup.)
      2. This is a C# *script* (top-level statements). Use `return <value>;` to report a
         result (its ToString() is sent back). Use Print(...) for extra logging.
      3. Use FilteredElementCollector for queries. Lengths/coordinates are in FEET
         (Revit internal units). Convert from mm with
         UnitUtils.ConvertToInternalUnits(200, UnitTypeId.Millimeters).
      4. On any compile/runtime error the change is rolled back and the error text is
         returned to you — read it and retry with corrected code.

    Example — create a 10 ft wall on the lowest level:
        var level = new FilteredElementCollector(Doc).OfClass(typeof(Level))
            .Cast<Level>().OrderBy(l => l.Elevation).First();
        var wall = Wall.Create(Doc, Line.CreateBound(new XYZ(0,0,0), new XYZ(10,0,0)),
            level.Id, false);
        return "Created wall " + wall.Id;
    """
    return await _run(code)


@mcp.tool()
async def get_model_info() -> str:
    """Return basic info about the active Revit document: title, active view, levels, and
    element counts (walls, doors, rooms, grids). Useful for orienting before editing."""
    return await _run(snippets.MODEL_INFO)


@mcp.tool()
async def get_selection() -> str:
    """Return the elements currently selected in Revit (id, category, name)."""
    return await _run(snippets.SELECTION)


async def _tool(name: str, args: dict | None = None) -> str:
    """Call a typed tool and format the result for the model."""
    try:
        result = await client.tool(name, args or {})
    except Exception as exc:  # noqa: BLE001
        return (
            f"ERROR calling {name}: {exc}. "
            "Make sure Revit is open with a project loaded and the MGL add-in active."
        )
    if not result.get("success"):
        return f"FAILED {name}: {result.get('error')}"
    return result.get("result") or "{}"


@mcp.tool()
async def get_document_context() -> str:
    """Identity + summary of the active Revit document: durable doc_uid, title,
    file name, workshared/link flags, Revit version, sheet count, project name
    and number. Start here to learn what model is open."""
    return await _tool("get_document_context")


@mcp.tool()
async def list_sheets() -> str:
    """Every non-placeholder sheet in the active document as JSON:
    uid (durable), number, name, placed_view_count. Sheet uid survives
    renumbering and renaming — always key on it, never on the number."""
    return await _tool("list_sheets")


@mcp.tool()
async def capture_baseline() -> str:
    """Snapshot the model's per-sheet element state to disk so a later
    `diff_since_baseline` can report what changed. Read-only; writes only a
    local JSON file, never the Revit model."""
    return await _tool("capture_baseline")


@mcp.tool()
async def diff_since_baseline() -> str:
    """Compare the model against the stored baseline and report which SHEETS
    changed plus overall element counts.

    Note the honest limits, and repeat them to the user: this compares element
    IDs, so it CANNOT see edits to a parameter or geometry of an element that
    already existed. A day spent coordinating, annotating or dimensioning
    produces a near-zero diff. `self_reported` is always true — these numbers
    come from a local snapshot the server has not verified."""
    return await _tool("diff_since_baseline")


@mcp.tool()
async def isolate_sheet_elements(sheet_uid: str) -> str:
    """Isolate every element appearing on the given sheet in the ACTIVE view
    and zoom to them. This modifies the view (an undoable transaction) —
    call `reset_isolation` to restore."""
    return await _tool("isolate_sheet_elements", {"sheet_uid": sheet_uid})


@mcp.tool()
async def reset_isolation() -> str:
    """Cancel temporary hide/isolate on the active view."""
    return await _tool("reset_isolation")


@mcp.tool()
async def ping_revit() -> str:
    """Check whether the Revit add-in's HTTP server is reachable."""
    try:
        info = await client.health()
        return f"✅ Revit add-in reachable: {info}"
    except Exception as exc:  # noqa: BLE001
        return (
            f"❌ Revit add-in NOT reachable at {client.base_url} ({exc}).\n"
            "Open Revit 2027 with the 'Revit MCP' add-in loaded."
        )


def main() -> None:
    log.info("Starting revit-mcp server (bridge -> %s)", client.base_url)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
