using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// TYPED хэрэгслүүд — Revit-ийн ҮНДСЭН thread дээр л дуудагдана
    /// (`RevitToolEventHandler.Execute`-ээс).
    ///
    /// ⚠️ Яагаад `run_revit_code`-ийн оронд эдгээр вэ:
    ///   • Roslyn-ы эмхэтгэл дуудлага бүрт ~300-800ms — агентын урсгалд удаан.
    ///   • Модель Revit API-ийн гарын үсгийг СЭДЭЖ гаргадаг тул 2-3 удаа алдана.
    ///   • Дурын C# нь аюулгүй байдлын нүх (CLAUDE.md-ийн зүйл #7).
    /// `run_revit_code` устгагдаагүй — `MGL_ALLOW_EXEC=1` тавьсан үед л
    /// ажиллах escape hatch болж үлдсэн (BridgeAuth-ыг үз).
    /// </summary>
    public static class RevitTools
    {
        /// <summary>Нэг хуудсанд шалгах элементийн дээд тоо — асар том загварт хамгаалалт.</summary>
        private const int MaxElementsPerSheet = 20000;

        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            WriteIndented = false,
        };

        /// <summary>
        /// ⚠️ TWIN — энэ жагсаалт ХОЁР ЗАМЫН гүйцэтгэгч.  Ганцаар нь бүү өөрчил.
        ///
        ///   ЗАМ А (локал Python агент):
        ///     `revit-mcp/agent/mgl_agent.py ALLOWED`
        ///       → `revit-mcp/server/revit_mcp/server.py` `@mcp.tool`
        ///       → POST /tool → `RevitToolBus.Call` → ЭНЭ switch
        ///   ЗАМ Б (add-in-ий дотоод чат):
        ///     `AgentChat.ToolSpecs()` + `AgentChat.ClientAllowedTools`
        ///       + `backend/src/lib/revitAgent.ts ALLOWED_TOOLS`
        ///       → `RevitToolBus.Call` → ЭНЭ switch
        ///
        /// Бүрэн зөрүүний хүснэгт нь `AgentChat.cs`-ийн `ClientAllowedTools`
        /// дээрх тайлбарт бий — ШИНЭ хэрэгсэл нэмэхдээ ТЭР ХҮСНЭГТИЙГ ЗАС.
        ///
        /// ⚠️ Энд БАЙХГҮЙ ч MCP серверт байдаг гурав: `get_model_info`,
        /// `get_selection` (`/execute` → Roslyn, `MGL_ALLOW_EXEC=1`-гүй бол
        /// 403) ба `ping_revit` (`/health`).  Тэднийг ЗАМ А-д зөвшөөрөхөөс
        /// ӨМНӨ энд typed handler бич — эс тэгвэл хэрэглэгч алдаа л харна.
        /// </summary>
        public static readonly string[] ToolNames =
        {
            "get_document_context",
            "list_sheets",
            "capture_baseline",
            "diff_since_baseline",
            "list_changes",
            "change_digest",
            "goto_element",
            "isolate_sheet_elements",
            "reset_isolation",
            "capture_view_image",
            // ⚠️ АРВАН НЭГ ДЭХ — ДОТООД, МАШИНЫ хэрэгсэл (`2-3` §3.7).
            //    `ComplianceScheduler` нь `RevitToolBus.TryCall`-аар л дуудна.
            //    ⛔ Дээрх ХҮСНЭГТИЙН аль ч хэрэглэгчийн замд ОРУУЛАХГҮЙ:
            //    `AgentChat.ToolSpecs()`, `AgentChat.ClientAllowedTools`,
            //    `backend/src/lib/revitAgent.ts ALLOWED_TOOLS`,
            //    `revit-mcp/agent/mgl_agent.py ALLOWED` — ДӨРВҮҮЛЭЭ.  LLM-д
            //    нээвэл хэрэглэгчийн нэрийн өмнөөс ДУРЫН элемент уншина.
            "collect_rule_inputs",
        };

        public static string Run(UIApplication app, string tool, string argsJson)
        {
#if MGL_INTELLIGENCE
            // SESSION R — Revit Intelligence-ийн typed хэрэгслүүд
            // (`Intelligence/Revit/IntelligenceTools.cs`).  ИЖИЛ ExternalEvent,
            // ИЖИЛ дараалал (R-2); дотоод, машины хэрэгсэл — LLM-д нээгдээгүй.
            // ⚠️ Баримтгүй ч ажилладаг хэрэгсэлтэй (`test_project_new`, `get_context_snapshot`)
            //    тул доорх «нээлттэй төсөл алга» шалгалтаас ӨМНӨ.
            if (Intelligence.Revit.IntelligenceTools.Handles(tool))
                return Intelligence.Revit.IntelligenceTools.Run(app, tool, ParseArgs(argsJson));
#endif

            UIDocument uidoc = app.ActiveUIDocument;
            if (uidoc == null)
                throw new InvalidOperationException("Revit-д нээлттэй төсөл алга. Эхлээд файлаа нээнэ үү.");
            Document doc = uidoc.Document;

            JsonElement args = ParseArgs(argsJson);

            switch (tool)
            {
                case "get_document_context": return GetDocumentContext(doc);
                case "list_sheets": return ListSheets(doc);
                case "capture_baseline": return CaptureBaseline(doc);
                case "diff_since_baseline": return DiffSinceBaseline(doc);
                // ⚠️ Эдгээр нь ШИНЭ СКАННЕР БИШ — `ChangeTracker`-ийн аль хэдийн
                // хадгалсан id-нуудыг тайлбарлаж, тэр рүү нь үсэрдэг.
                case "list_changes": return ChangeReport.ListChanges(doc, args);
                case "change_digest": return ChangeReport.ChangeDigest(doc, args);
                case "goto_element": return ChangeReport.GotoElement(uidoc, doc, args);
                case "isolate_sheet_elements": return IsolateSheetElements(uidoc, doc, args);
                case "reset_isolation": return ResetIsolation(doc);
                case "capture_view_image": return CaptureViewImage(doc, args);
                // ⚠️ Дотоод төсөвтэй (1500 мс) — `RevitTools.Run` эхэлмэгц
                //    цуцлалт БАЙХГҮЙ тул хамгаалалт нь ЗӨВХӨН хэрэгслийн
                //    ӨӨРИЙНХ нь deadline (`RevitToolBus.cs:474-478`).
                case "collect_rule_inputs": return RuleFactExtractor.Collect(doc, args);
                default:
                    throw new ArgumentException(
                        "Танихгүй хэрэгсэл: " + tool + ". Боломжтой: " + string.Join(", ", ToolNames));
            }
        }

        private static JsonElement ParseArgs(string argsJson)
        {
            if (string.IsNullOrWhiteSpace(argsJson))
                return JsonDocument.Parse("{}").RootElement.Clone();
            try
            {
                return JsonDocument.Parse(argsJson).RootElement.Clone();
            }
            catch
            {
                return JsonDocument.Parse("{}").RootElement.Clone();
            }
        }

        private static string GetStr(JsonElement args, string name)
        {
            if (args.ValueKind == JsonValueKind.Object &&
                args.TryGetProperty(name, out JsonElement v) &&
                v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
            return null;
        }

        /* ============================================================== */
        /*  Баримтын таних тэмдэг                                         */
        /* ============================================================== */

        /// <summary>
        /// Баримтын мөнхийн таних тэмдэг.
        ///
        /// ⚠️ `ProjectInformation` бол .rte template-д хадгалагддаг ЭНГИЙН
        /// Element тул НЭГ template-ээс үүссэн бүх төсөл ИЖИЛ `UniqueId`-тай
        /// байх БОДИТ эрсдэлтэй.  Тиймээс сервер тал энэ утгыг ТӨСӨЛ ДОТОР л
        /// өвөрмөц гэж үздэг (migration 0187), глобал биш.  Эмпирик тестээр
        /// баталгаажуулах хүртэл энэ таамаглалд БҮҮ найд.
        /// </summary>
        public static string DocUid(Document doc)
        {
            try
            {
                string uid = doc?.ProjectInformation?.UniqueId;
                if (!string.IsNullOrWhiteSpace(uid)) return uid;
            }
            catch { }
            // Эцсийн арга: файлын зам.  Save-As дээр өөрчлөгдөнө, гэхдээ
            // юу ч байхгүйгээс дээр.
            return "path:" + (doc?.PathName ?? doc?.Title ?? "unknown");
        }

        private static string GetDocumentContext(Document doc)
        {
            var payload = new
            {
                doc_uid = DocUid(doc),
                uid_source = "project_info",
                title = doc.Title,
                path_name = string.IsNullOrEmpty(doc.PathName) ? null : doc.PathName,
                file_name = string.IsNullOrEmpty(doc.PathName)
                    ? doc.Title
                    : Path.GetFileName(doc.PathName),
                is_workshared = doc.IsWorkshared,
                is_family = doc.IsFamilyDocument,
                is_link = doc.IsLinked,
                revit_version = doc.Application?.VersionNumber,
                sheet_count = CollectSheets(doc).Count,
                project_name = SafeParam(doc, BuiltInParameter.PROJECT_NAME),
                project_number = SafeParam(doc, BuiltInParameter.PROJECT_NUMBER),
            };
            return JsonSerializer.Serialize(payload, Json);
        }

        private static string SafeParam(Document doc, BuiltInParameter bip)
        {
            try
            {
                Parameter p = doc.ProjectInformation?.get_Parameter(bip);
                return p?.AsString();
            }
            catch { return null; }
        }

        /* ============================================================== */
        /*  Хуудасны жагсаалт                                             */
        /* ============================================================== */

        /// <summary>Илгээхэд тохиромжтой хуудсууд — placeholder-ыг хасна.</summary>
        public static List<ViewSheet> CollectSheets(Document doc)
        {
            var list = new List<ViewSheet>();
            foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)))
            {
                var s = (ViewSheet)e;
                try
                {
                    if (s.IsTemplate) continue;
                    if (s.IsPlaceholder) continue;
                }
                catch { }
                list.Add(s);
            }
            return list
                .OrderBy(s => s.SheetNumber, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        public class SheetDto
        {
            public string uid { get; set; }
            public string number { get; set; }
            public string name { get; set; }
            public int placed_view_count { get; set; }
        }

        public static List<SheetDto> SheetDtos(Document doc)
        {
            var outList = new List<SheetDto>();
            foreach (ViewSheet s in CollectSheets(doc))
            {
                int placed = 0;
                try { placed = s.GetAllPlacedViews()?.Count ?? 0; } catch { }
                outList.Add(new SheetDto
                {
                    uid = s.UniqueId,
                    number = s.SheetNumber ?? string.Empty,
                    name = s.Name ?? string.Empty,
                    placed_view_count = placed,
                });
            }
            return outList;
        }

        private static string ListSheets(Document doc)
        {
            return JsonSerializer.Serialize(new { sheets = SheetDtos(doc) }, Json);
        }

        /* ============================================================== */
        /*  Snapshot ба ялгаварлал                                        */
        /* ============================================================== */

        private class SheetState
        {
            public string uid { get; set; }
            public string number { get; set; }
            public int count { get; set; }
            /// <summary>Элементийн id-нуудын тогтвортой хэш — юу өөрчлөгдсөнийг илрүүлнэ.</summary>
            public string hash { get; set; }
        }

        /// `ElementId.Value` (long).  Revit 2024-2027 дөрвүүлэн дээр эмхэтгэгдэхийг
        /// шалгасан тул хувилбарын салаа ШААРДЛАГАГҮЙ (2026-08-24).
        /// </summary>
        private static long ElementIdValue(ElementId id) => id.Value;

        /// <summary>
        /// Баримт даяарх элементийн тоо.  ⚠️ ХАРАГДАЦЫН ХАМРАХ ХҮРЭЭГҮЙ
        /// collector — Revit-ийн элементийн индексийг шууд уншдаг тул
        /// regenerate үүсгэхгүй.  200k элементтэй загварт ч хэдэн зуун мс.
        /// </summary>
        internal static int ElementCount(Document doc)
        {
            try
            {
                return new FilteredElementCollector(doc)
                    .WhereElementIsNotElementType()
                    .GetElementCount();
            }
            catch { return 0; }
        }

        /// <summary>
        /// Суурь тавина.  ⚠️ O(1) + нэг хямд тоолол.
        ///
        /// Урьд нь энд БҮХ хуудсын БҮХ харагдацыг сканнердаж, бодит төсөл
        /// дээр 120 секундын хугацаа дуусдаг байв.  Одоо Revit өөрөө
        /// `DocumentChanged`-ээр хэлдэг тул зөвхөн тоолуурыг тэглэнэ.
        /// </summary>
        private static string CaptureBaseline(Document doc)
        {
            int count = ElementCount(doc);
            ChangeTracker.Reset(doc, count);

            return JsonSerializer.Serialize(new
            {
                ok = true,
                doc_uid = DocUid(doc),
                captured_at = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                element_count = count,
                // Мөрдөгч эхлээгүй бол хэрэглэгч «яагаад юу ч харагдахгүй
                // байна» гэж гайхахгүйн тулд ил хэлнэ.
                tracking = ChangeTracker.Started,
            }, Json);
        }

        /// <summary>
        /// Суурь авснаас хойш ЮУ ӨӨРЧЛӨГДСӨН.
        ///
        /// ⚠️ ЭНЭ НЬ СКАННЕРДАХГҮЙ.  `ChangeTracker` нь Revit-ийн
        /// `DocumentChanged` үйл явдлаас хуримтлуулсан тоог шууд өгнө.
        /// Урьд нь энд бүх хуудсын бүх харагдацыг regenerate хийдэг байсан
        /// тул бодит төсөл дээр 120 секундын хугацаа дуусдаг байв.
        ///
        /// ⚠️ `modified` нь одоо ХУУДАСНЫ тоо БИШ, бодитоор засварлагдсан
        /// ЭЛЕМЕНТИЙН тоо.  Хуучин арга элементийн засварыг ОГТ хардаггүй
        /// байсан (id өөрчлөгддөггүй тул хэш нь ижил гарна) — өөрөөр хэлбэл
        /// энэ засвар нь зөвхөн хурдан биш, УТГААРАА Ч ЗӨВ болсон.  Сервер
        /// тэр тоог AI тэмдэглэлд ашигладаг тул тэмдэглэлийн чанар ч
        /// шууд сайжирна.
        /// </summary>
        private static string DiffSinceBaseline(Document doc)
        {
            var warnings = new List<string>();

            // ⚠️ Мөрдөгч бүртгэгдээгүй бол ЧИМЭЭГҮЙ өнгөрөх ЁСГҮЙ — эс тэгвээс
            // «үргэлж 0 өөрчлөлт» гэж ХУДАЛ хэлнэ.
            if (!ChangeTracker.Started) warnings.Add("tracking_unavailable");

            if (!ChangeTracker.TryGet(doc, out ChangeTracker.Change ch))
            {
                // Суурь алга — ЭНЭ НЬ АЛДАА БИШ.  Одоо тавьж, шударгаар хэлнэ.
                ChangeTracker.Reset(doc, ElementCount(doc));
                warnings.Add("no_baseline");
                return JsonSerializer.Serialize(new
                {
                    baseline = (object)null,
                    warnings = warnings.ToArray(),
                    changed_sheets = new object[0],
                    totals = new { added = 0, removed = 0, modified = 0 },
                    self_reported = true,
                }, Json);
            }

            if ((DateTime.UtcNow - ch.BaselineAtUtc).TotalHours > 24)
                warnings.Add("stale_baseline");
            if (ch.Truncated) warnings.Add("truncated");

            return JsonSerializer.Serialize(new
            {
                baseline = new
                {
                    captured_at = ch.BaselineAtUtc.ToString("o", CultureInfo.InvariantCulture),
                    element_count = ch.BaselineElementCount,
                },
                current = new
                {
                    captured_at = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                    element_count = ElementCount(doc),
                },
                totals = new
                {
                    added = ch.Added.Count,
                    removed = ch.Deleted.Count,
                    modified = ch.Modified.Count,
                },
                // ⚠️ Хуудсаар задлахгүй (эзний шийдвэр, 2026-08-25) — нийт тоо
                // л харуулна.  id-нууд `ChangeTracker`-т бүрэн байгаа тул хожим
                // хуудас/ангиллаар задлах нь хялбар; ХЭРЭГЦЭЭ гарах хүртэл
                // нэмэхгүй.  Талбарыг УСТГААГҮЙ: сервер ба UI хоёулаа уншдаг.
                changed_sheets = new object[0],
                warnings = warnings.ToArray(),
                // Энэ тоо ЛОКАЛ мөрдөгчөөс ирсэн тул сервер БАТАЛГААЖУУЛААГҮЙ.
                self_reported = true,
            }, Json);
        }

        /* ============================================================== */
        /*  Тусгаарлах / буцаах                                           */
        /* ============================================================== */

        private static string IsolateSheetElements(UIDocument uidoc, Document doc, JsonElement args)
        {
            string sheetUid = GetStr(args, "sheet_uid");
            if (string.IsNullOrWhiteSpace(sheetUid))
                throw new ArgumentException("sheet_uid шаардлагатай.");

            Element el = doc.GetElement(sheetUid);
            if (!(el is ViewSheet sheet))
                throw new ArgumentException("Ийм хуудас олдсонгүй: " + sheetUid);

            var ids = new List<ElementId>();
            foreach (ElementId viewId in sheet.GetAllPlacedViews())
            {
                foreach (ElementId eid in new FilteredElementCollector(doc, viewId)
                             .WhereElementIsNotElementType()
                             .ToElementIds())
                {
                    ids.Add(eid);
                    if (ids.Count >= MaxElementsPerSheet) break;
                }
                if (ids.Count >= MaxElementsPerSheet) break;
            }

            if (ids.Count == 0)
                return JsonSerializer.Serialize(new { isolated = 0, note = "Энэ хуудсанд элемент алга." }, Json);

            View active = doc.ActiveView;
            if (active == null || !active.CanUseTemporaryVisibilityModes())
                throw new InvalidOperationException(
                    "Идэвхтэй харагдац түр тусгаарлалтыг дэмжихгүй байна (хуудас дээр биш, 3D/план дээр туршина уу).");

            // ⚠️ Түр тусгаарлалт нь БАРИМТЫГ ӨӨРЧИЛДӨГ тул Transaction шаардлагатай.
            // Энэ бол хэрэглэгчийн САНААТАЙ үйлдэл (isolate товч дарсантай адил)
            // тул Commit хийнэ — буцаахыг `reset_isolation` хийнэ.
            using (var tx = new Transaction(doc, "MGL: Хуудсыг тусгаарлах"))
            {
                tx.Start();
                active.IsolateElementsTemporary(ids);
                tx.Commit();
            }

            // ⚠️ `uidoc.ShowElements(ids)` ЭНД БАЙСАН — УСТГАСАН (2026-08-25).
            //
            // Тэр нь элементийг нээлттэй харагдацаас олж чадахгүй үед МОДАЛЬ
            // TaskDialog гаргадаг («There is no open view that shows any of
            // the highlighted elements»).  Энэ дуудлага `ExternalEvent`-ийн
            // боловсруулагч дотор, өөрөөр хэлбэл Revit-ийн ҮНДСЭН thread
            // дээр явдаг тул цонх гарвал хүн дарах хүртэл БҮХ ЗҮЙЛ зогсоно —
            // дараагийн хэрэгслийн дуудлага бүр хугацаа дуусна.  `catch` нь
            // тусалдаггүй: цонх нь ОНЦГОЙ БАЙДЛААС ӨМНӨ гарч, блоклодог.
            //
            // Алдагдал нь бага: `IsolateElementsTemporary` аль хэдийн идэвхтэй
            // харагдацад зөвхөн тэр элементүүдийг үлдээсэн тул хэрэглэгч
            // тэднийг харж байна.  `ShowElements` нь зөвхөн камерыг ойртуулдаг.

            return JsonSerializer.Serialize(new
            {
                isolated = ids.Count,
                sheet_number = sheet.SheetNumber,
                view = active.Name,
            }, Json);
        }

        private static string ResetIsolation(Document doc)
        {
            View active = doc.ActiveView;
            if (active == null) throw new InvalidOperationException("Идэвхтэй харагдац алга.");
            using (var tx = new Transaction(doc, "MGL: Тусгаарлалт цуцлах"))
            {
                tx.Start();
                active.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);
                tx.Commit();
            }
            return JsonSerializer.Serialize(new { ok = true }, Json);
        }

        /* ============================================================== */
        /*  Зураг авах (нотолгоо)                                         */
        /* ============================================================== */

        /// <summary>
        /// Идэвхтэй харагдацыг PNG болгож ТҮР фолдерт хадгална.
        ///
        /// ⚠️ Transaction ОГТ нээхгүй — `ExportImage` нь баримтыг өөрчилдөггүй.
        /// Тусгаарлах шаардлагатай бол хэрэглэгч эхлээд `isolate_sheet_elements`
        /// дуудна (тэр нь буцаагдах боломжтой жинхэнэ гүйлгээ).  Ингэснээр
        /// link баримт (зөвхөн уншигдах) дээр ч уналгүй ажиллана.
        /// </summary>
        private static string CaptureViewImage(Document doc, JsonElement args)
        {
            if (doc.IsLinked)
                throw new InvalidOperationException("Холбоос (link) баримтаас зураг авах боломжгүй.");

            View active = doc.ActiveView;
            if (active == null) throw new InvalidOperationException("Идэвхтэй харагдац алга.");

            string label = GetStr(args, "label") ?? active.Name;
            string dir = Path.Combine(Path.GetTempPath(), "MglRevitEvidence");
            Directory.CreateDirectory(dir);
            string stem = Path.Combine(
                dir,
                "view_" + DateTime.UtcNow.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture));

            var opts = new ImageExportOptions
            {
                FilePath = stem,
                ExportRange = ExportRange.SetOfViews,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
                ImageResolution = ImageResolution.DPI_150,
                ZoomType = ZoomFitType.FitToPage,
                PixelSize = 1600,
                FitDirection = FitDirectionType.Horizontal,
            };
            opts.SetViewsAndSheets(new List<ElementId> { active.Id });
            doc.ExportImage(opts);

            // Revit нь харагдацын нэрийг файлын нэрэнд залгадаг тул хайж олно.
            string found = Directory
                .GetFiles(dir, Path.GetFileName(stem) + "*.png")
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();

            if (found == null)
                throw new InvalidOperationException("Зураг үүссэнгүй.");

            return JsonSerializer.Serialize(new
            {
                path = found,
                label,
                view = active.Name,
            }, Json);
        }
    }
}
