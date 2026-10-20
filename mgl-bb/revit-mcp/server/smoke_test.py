"""Spawn the MCP server over stdio and exercise the protocol end-to-end.

This does NOT require Revit to be running — `ping_revit` is expected to report
that the add-in is unreachable when Revit is closed. Run with:

    .venv\\Scripts\\python.exe smoke_test.py
"""

import asyncio
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Windows consoles default to cp1252; make sure emoji in tool output prints.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


async def main() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "revit_mcp.server"],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            print("TOOLS:", [t.name for t in tools.tools])

            result = await session.call_tool("ping_revit", {})
            print("PING_REVIT:", result.content[0].text)


if __name__ == "__main__":
    asyncio.run(main())
