# §09 · Remote MCP server (Claude connector)

Мөн Worker дээр remote MCP server суусан тул Claude client-ууд (Desktop, Code, claude.ai connector) MGL өгөгдлийг tool болгож асууж болно. Cloudflare `agents` SDK-ийн `McpAgent` дээр (`MCP_OBJECT` Durable Object, SQLite-backed). Код `backend/src/mcp/` — `MglMcpAgent.ts` + `tools/*.ts`.

## Гол зарчим

- **Transport / routing.** `/mcp` (Streamable HTTP) + `/sse` (legacy SSE). `/api/*`-гаас гадуур; OAuthProvider батална (`authMiddleware` ажилладаггүй). Pathname branch эхэнд байх ёстой — `/mcp` Hono руу унавал 404.
- **Auth = мөн л апп-ийн JWT.** Client `Authorization: Bearer <jwt>` (SSE-д `?token=`) илгээнэ. Урт хугацааны connector-т `POST /api/auth/mcp-token`-оор ~1 жилийн `purpose:'mcp'` token гаргана. **Revoke = `JWT_SECRET` эргүүлэх** (бүх token-ыг хүчингүй болгоно).
- **Tool-ууд одоо байгаа SQL-ийг wrap хийдэг** — шинэ логик **биш**. `list_projects` / `get_project_progress` нь `PROJECT_LIST_SQL`-ийг **ижил bind тоогоор** (3× admin, 4× non-admin) + ижил complexity redaction-оор дахин ашигладаг. `list_pending_approvals` нь батлагчийн дүрмийг тольдоно. Report tool-ууд (`get_project_report`, `get_project_breakdown`) нь `getProjectHierarchyFast` гэх мэт-ийг дахин ашиглана.
- Visibility-г caller-ийн `this.props.role`-оос албадана (client member-gated; `complexity_pct`, contributor оноо admin-only). **Шинэ tool нэмэхдээ энэ хандалтын дүрмийг дахин бичихгүй, ижилээр дага.**

## Холбох

```bash
claude mcp add --transport http mgl-progress \
  https://<worker-host>/mcp \
  --header "Authorization: Bearer <jwt>"
```

stdio-only client-т `npx mcp-remote <url> --header …` фолбэк.

## Word тайлан

`docs/mcp-word-report-prompt.md` нь Claude-аар (claude.ai / Desktop) `mgl-progress` connector ашиглан төслийн тайланг **`.docx`** болгож гаргах хэрэглэгчийн заавар: MCP tool-уудын дараалал (`list_projects` → `get_report_template` → `get_report_content` → блок бичих → `.docx`) скриптэлсэн. Монголоор, RAG статус, тоог хүснэгтээр, байхгүй өгөгдөл зохиохгүй, admin-only санхүүг client-ээс нуух дүрэмтэй.
