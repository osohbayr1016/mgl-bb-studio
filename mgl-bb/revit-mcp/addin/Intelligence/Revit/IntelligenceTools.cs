using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Revit
{
    /// <summary>
    /// SESSION R-ИЙН TYPED ХЭРЭГСЛҮҮД — `RevitTools.Run`-ийн switch-ээс
    /// (`#if MGL_INTELLIGENCE`) дуудагдана; өөр ExternalEvent БАЙХГҮЙ (R-2).
    ///
    /// ⚠️ ЭДГЭЭР НЬ ДОТООД, МАШИНЫ хэрэгсэл — `collect_rule_inputs`-тэй ижил
    ///    ангилал.  LLM-ийн хэрэгслийн жагсаалтад (`AgentChat.ToolSpecs`,
    ///    `ClientAllowedTools`, `revitAgent.ts ALLOWED_TOOLS`, `mgl_agent.py`)
    ///    ОРУУЛААГҮЙ.  Чат нь Session D-ийн холболтоор `IMglAiRevitClient`-ээр
    ///    контекст авна, хэрэгслийг шууд дуудахгүй.
    ///
    /// Бүх хэрэгсэл `ToolResult&lt;T&gt;` JSON буцаана (§59): status · data ·
    /// warnings · source_type · captured_at · elapsed_ms.
    /// </summary>
    internal static class IntelligenceTools
    {
        internal static readonly string[] ToolNames =
        {
            "get_context_snapshot", "get_selection", "get_element_summary",
            "scene_index", "scene_relations", "scene_refresh", "find_elements",
            "select_elements", "show_element", "scene_snapshot", "issues_list",
            // DEVELOPMENT / TEST ONLY — синтетик тест загвар (`TestModelFixture`, хаалттай).
            "test_model_gate", "test_model_create", "test_model_mutate", "test_model_save", "test_project_new", "test_project_open", "test_project_close",
            "ai_ask", "ai_poll",
            "action_preview", "action_apply", "action_current",
        };

        internal static bool Handles(string tool)
        {
            return Array.IndexOf(ToolNames, tool) >= 0;
        }

        internal static string Run(UIApplication app, string tool, JsonElement args)
        {
            var sw = Stopwatch.StartNew();
            UIDocument uidoc = app.ActiveUIDocument;
            Document doc = uidoc != null ? uidoc.Document : null;
            RevitIntelligenceHost host = RevitIntelligenceHost.Instance;
            switch (tool)
            {
                case "get_context_snapshot":
                    {
                        RevitContextSnapshot snap = RevitContextExtractor.Snapshot(app, host != null ? host.CurrentLink : null);
                        return Ok(snap, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "get_selection":
                    {
                        if (doc == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        var list = new List<RevitElementSummary>();
                        int max = GetInt(args, "max", RevitContextExtractor.MaxSummaries);
                        foreach (ElementId id in uidoc.Selection.GetElementIds())
                        {
                            if (list.Count >= max) break;
                            Element e = doc.GetElement(id);
                            if (e != null) list.Add(RevitContextExtractor.Summarize(doc, e, RevitContextExtractor.SummaryDepth.Full));
                        }
                        if (list.Count == 0) return Fail<object>(RevitErrorState.NO_SELECTION, sw);
                        return Ok(list, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "get_element_summary":
                    {
                        if (doc == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        var list = new List<RevitElementSummary>();
                        foreach (long id in GetIds(args))
                        {
                            if (list.Count >= 50 || sw.ElapsedMilliseconds > 600) break;
                            Element e = doc.GetElement(new ElementId(id));
                            if (e != null) list.Add(RevitContextExtractor.Summarize(doc, e, RevitContextExtractor.SummaryDepth.Full));
                        }
                        return Ok(list, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "scene_index":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        SceneGraphStore g = host.GraphFor(doc);
                        SceneGraphExtractor.IndexResult r = SceneGraphExtractor.BuildIndex(doc, g);
                        return Ok(new { nodes = r.Nodes, edges = r.Edges, ms = r.Ms, budget_exhausted = r.BudgetExhausted, truncated = r.Truncated, version = g.Version }, ToolSourceType.SCENE_GRAPH, sw);
                    }
                case "scene_relations":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        SceneGraphStore g = host.GraphFor(doc);
                        SceneGraphExtractor.RelationsResult r = SceneGraphExtractor.BuildRoomRelations(doc, g, GetInt(args, "cursor", 0));
                        return Ok(new { rooms = r.RoomsProcessed, edges = r.Edges, cursor = r.NextCursor, done = r.Done, ms = r.Ms, version = g.Version }, ToolSourceType.SCENE_GRAPH, sw);
                    }
                case "scene_refresh":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        SceneGraphStore g = host.GraphFor(doc);
                        bool geometry = GetBool(args, "geometry", true);
                        SceneGraphExtractor.RefreshResult r = SceneGraphExtractor.Refresh(doc, g, GetIds(args), geometry);
                        return Ok(new { refreshed = r.Refreshed, deleted = r.Deleted, enriched = r.Enriched, remaining = r.Remaining, ms = r.Ms, budget_exhausted = r.BudgetExhausted, version = g.Version }, ToolSourceType.SCENE_GRAPH, sw);
                    }
                case "find_elements":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        ElementQuery q = args.ValueKind == JsonValueKind.Object ? JsonSerializer.Deserialize<ElementQuery>(args.GetRawText(), IntelligenceJson.Options) : new ElementQuery();
                        List<SceneNode> nodes = host.GraphFor(doc).Query(q);
                        return Ok(nodes, ToolSourceType.SCENE_GRAPH, sw);
                    }
                case "select_elements":
                    {
                        if (doc == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        var ids = new List<ElementId>();
                        foreach (long id in GetIds(args))
                        {
                            if (doc.GetElement(new ElementId(id)) != null) ids.Add(new ElementId(id));
                        }
                        uidoc.Selection.SetElementIds(ids);
                        return Ok(new { selected = ids.Count }, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "show_element":
                    {
                        // Track 2-ийн `goto_element` — сонгоод, идэвхтэй харагдацад төвлөрүүлнэ; `ShowElements`
                        // ХЭЗЭЭ Ч (модаль цонх ExternalEvent дотор гацаана — `ChangeReport.cs`).
                        if (doc == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        long id = GetLong(args, "element_id");
                        string inner = ChangeReport.GotoElement(uidoc, doc, JsonDocument.Parse("{\"element_id\":" + id + "}").RootElement);
                        return Ok(JsonDocument.Parse(inner).RootElement.Clone(), ToolSourceType.REVIT_MODEL, sw);
                    }
                case "scene_snapshot":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        return Ok(host.GraphFor(doc).Snapshot(), ToolSourceType.SCENE_GRAPH, sw);
                    }
                case "issues_list":
                    {
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        string key = DocKeys.Normalize(RevitTools.DocUid(doc));
                        return Ok(host.IssuesOf(key, GetBool(args, "include_resolved", true)), ToolSourceType.SCENE_GRAPH, sw);
                    }
                /* ───────── DEVELOPMENT / TEST ONLY · NON-PRODUCTION · SYNTHETIC ───────── */
                case "action_preview":
                    {
                        // R4.1: typed envelope → детерминист шалгалт → preview (ХОЛБООСТОЙ).  Бичихгүй.
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        JsonElement ae;
                        if (!args.TryGetProperty("action", out ae)) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        RevitActionEnvelope env = IntelligenceJson.Deserialize<RevitActionEnvelope>(ae.GetRawText());
                        return Ok(RevitActionExecutor.Preview(doc, host, env), ToolSourceType.REVIT_MODEL, sw);
                    }
                case "action_apply":
                    {
                        // R4.1: ЗӨВХӨН баталгаатай — UI (USER_UI) эсвэл DEV bridge-ийн ИЛ токен "USER-CONFIRMS-<preview_id>"
                        //   (тест л; загварын хариу/хэрэгсэл/ERP ХЭЗЭЭ Ч баталгаа биш, §20).  Transaction энд (API thread).
                        if (doc == null || host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        ActionConfirmation conf = null;
                        JsonElement ce;
                        if (args.TryGetProperty("confirmation", out ce)) conf = IntelligenceJson.Deserialize<ActionConfirmation>(ce.GetRawText());
                        else
                        {
                            string pid = GetStr(args, "preview_id");
                            string token = GetStr(args, "confirm");
                            RevitActionEnvelope a0; ActionPreview pv0;
                            if (pid != null && token == "USER-CONFIRMS-" + pid && host.Actions.TryGet(pid, out a0, out pv0))
                                conf = new ActionConfirmation { PreviewId = pid, BindingHash = pv0.BindingHash, ConfirmedBy = "DEV_BRIDGE_TOKEN", ConfirmedAt = DateTime.UtcNow.ToString("o") };
                            else
                                conf = new ActionConfirmation { PreviewId = pid, BindingHash = null, ConfirmedBy = "NONE" };
                        }
                        bool force = GetBool(args, "test_force_postcondition_fail", false);
                        return Ok(RevitActionExecutor.Apply(doc, host, conf, force), ToolSourceType.REVIT_MODEL, sw);
                    }
                case "action_current":
                    {
                        if (host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        return Ok(new { current = host.Actions.Current, last = host.Actions.LastResult, max_level = ActionSafety.MaxLevel.ToString(), enabled = ActionSafety.EnabledWriteKinds }, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "ai_ask":
                    {
                        // DEV/ТЕСТ: хуваалцсан хөдөлгүүрээр асууна (тасалбар; хариу ai_poll-оор).  Revit thread-д ХҮЛЭЭХГҮЙ.
                        if (host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        string q = GetStr(args, "question");
                        if (string.IsNullOrWhiteSpace(q)) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        return Ok(new { ticket = host.AskTicket(q) }, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "ai_poll":
                    {
                        if (host == null) return Fail<object>(RevitErrorState.NO_DOCUMENT, sw);
                        RevitTurnResult r;
                        bool known = host.TryGetTicket(GetStr(args, "ticket"), out r);
                        return Ok(new { known, done = r != null, result = r }, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "test_project_open":
                    return Ok(TestModelFixture.OpenTestProject(app, GetStr(args, "path")), ToolSourceType.REVIT_MODEL, sw);
                case "test_project_close":
                    return Ok(TestModelFixture.CloseTestProject(app, GetStr(args, "path")), ToolSourceType.REVIT_MODEL, sw);
                case "test_model_gate":
                    return Ok(TestModelFixture.Gate(doc, GetStr(args, "confirm")), ToolSourceType.REVIT_MODEL, sw);
                case "test_model_create":
                    {
                        TestModelManifest m = TestModelFixture.Create(app, GetStr(args, "confirm"));
                        if (host != null) host.AfterTestModelCreated(app.ActiveUIDocument.Document);
                        return Ok(m, ToolSourceType.REVIT_MODEL, sw);
                    }
                case "test_model_mutate":
                    return Ok(TestModelFixture.Mutate(app, GetStr(args, "op")), ToolSourceType.REVIT_MODEL, sw);
                case "test_model_save":
                    return Ok(new { saved_path = TestModelFixture.Save(app) }, ToolSourceType.REVIT_MODEL, sw);
                case "test_project_new":
                    return Ok(TestModelFixture.NewTestProject(app), ToolSourceType.REVIT_MODEL, sw);
                default:
                    throw new ArgumentException("Танихгүй Intelligence хэрэгсэл: " + tool);
            }
        }

        /* ---------------------------------------------------------------- */

        private static string Ok<T>(T data, ToolSourceType src, Stopwatch sw)
        {
            return IntelligenceJson.Serialize(ToolResult<T>.Ok(data, src, Math.Round(sw.Elapsed.TotalMilliseconds, 2)));
        }

        private static string Fail<T>(RevitErrorState st, Stopwatch sw)
        {
            ToolResult<T> r = ToolResult<T>.Fail(st, null);
            r.ElapsedMs = Math.Round(sw.Elapsed.TotalMilliseconds, 2);
            return IntelligenceJson.Serialize(r);
        }

        internal static List<long> GetIds(JsonElement args)
        {
            var ids = new List<long>();
            JsonElement arr;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("ids", out arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement e in arr.EnumerateArray())
                {
                    long v;
                    if (e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out v)) ids.Add(v);
                    else if (e.ValueKind == JsonValueKind.String && long.TryParse(e.GetString(), out v)) ids.Add(v);
                    if (ids.Count >= 5000) break;
                }
            }
            return ids;
        }

        private static string GetStr(JsonElement args, string name)
        {
            JsonElement v;
            return args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }

        private static int GetInt(JsonElement args, string name, int def)
        {
            JsonElement v;
            return args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : def;
        }

        private static long GetLong(JsonElement args, string name)
        {
            JsonElement v;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out v))
            {
                long r;
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out r)) return r;
                if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), out r)) return r;
            }
            return 0;
        }

        private static bool GetBool(JsonElement args, string name, bool def)
        {
            JsonElement v;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out v))
            {
                if (v.ValueKind == JsonValueKind.True) return true;
                if (v.ValueKind == JsonValueKind.False) return false;
            }
            return def;
        }
    }
}
