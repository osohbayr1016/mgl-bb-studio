using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>
    /// Профайл + сонгосон хуудсууд + төслийн мэдээллээс «ЮУГ, ЯМАР НЭРЭЭР, ХААНА гаргах»
    /// төлөвлөгөө үүсгэнэ.  ЦЭВЭР — Revit-гүй; зөвхөн `IFileSystem`-ээр байгаа файлыг шалгана.
    ///
    /// Урьдчилсан харагдац (preview), preflight, бодит гаргалт ГУРАВУУЛАА энэ нэг төлөвлөгөөг
    /// ашиглана — тиймээс «preview дээр харсан нэр ≠ гарсан нэр» болохгүй.
    /// </summary>
    public static class PublishPlanner
    {
        public const int MaxPath = 259;
        private const int MaxFolderSegment = 60;

        public static PublishPlan Build(PublishProfile profile, IReadOnlyList<PublishItem> items,
            PublishContext ctx, IFileSystem fs)
        {
            if (profile == null) throw new ArgumentNullException("profile");
            if (ctx == null) throw new ArgumentNullException("ctx");
            if (fs == null) throw new ArgumentNullException("fs");
            items = items ?? new PublishItem[0];

            var plan = new PublishPlan();
            NamingSettings naming = profile.Naming ?? new NamingSettings();

            ParsedTemplate sheetTpl = NamingEngine.Parse(naming.SheetTemplate);
            ParsedTemplate combinedTpl = NamingEngine.Parse(naming.CombinedTemplate);
            ParsedTemplate modelTpl = NamingEngine.Parse(naming.ModelTemplate);
            List<ParsedTemplate> subTpl = ParseSubfolder(profile.Destination != null ? profile.Destination.SubfolderTemplate : null);

            var reportedTemplates = new HashSet<string>(StringComparer.Ordinal);
            Action<ParsedTemplate, string> reportTemplate = (t, what) =>
            {
                if (t.IsValid || !reportedTemplates.Add(what)) return;
                plan.NameIssues.Add(new NameIssue
                {
                    Kind = NameIssueKind.TemplateError,
                    Detail = what + ": " + string.Join(" ", t.Errors),
                });
            };

            var formats = (profile.Formats ?? new List<PublishFormat>())
                .Where(f => f != PublishFormat.Unknown).Distinct().ToList();

            int index = 0;
            foreach (PublishFormat format in formats)
            {
                switch (format)
                {
                    case PublishFormat.Pdf:
                        if (profile.Pdf != null && profile.Pdf.Combine && items.Count > 0)
                        {
                            reportTemplate(combinedTpl, "Нэгтгэсэн PDF-ийн нэр");
                            AddSet(plan, profile, items, ctx, format, combinedTpl, subTpl, ++index);
                        }
                        else
                        {
                            reportTemplate(sheetTpl, "Хуудасны нэр");
                            foreach (PublishItem it in items) AddItem(plan, profile, it, ctx, format, sheetTpl, subTpl, ++index);
                        }
                        break;

                    case PublishFormat.Dwg:
                        // ⚠️ DWG ҮРГЭЛЖ хуудас бүрээр (нэг харагдац → яг нэг файл).  Revit-ийн `Document.Export(…, name, views, DWG)`-д `name` нь
                        // «нэг файлын нэр ЭСВЭЛ олон файлын УГТВАР» (баримтжуулсан) — олон хуудсыг нэгтгэсэн DWG гэж төлөвлөвөл `name.dwg` үүсэхгүй,
                        // баталгаажуулалт «файл олдсонгүй» гэж бүтэлгүйтнэ.  `MergedViews` нь хуудас бүрийн DWG-ийн ТОХИРГОО (adapter-т) л.
                        reportTemplate(sheetTpl, "Хуудасны нэр");
                        foreach (PublishItem it in items) AddItem(plan, profile, it, ctx, format, sheetTpl, subTpl, ++index);
                        break;

                    case PublishFormat.Ifc:
                        reportTemplate(modelTpl, "IFC-ийн нэр");
                        AddModel(plan, profile, ctx, modelTpl, subTpl, ++index);
                        break;
                }
            }

            ResolveDuplicates(plan, naming);
            ApplyExisting(plan, profile.Overwrite, fs);
            CheckPathLength(plan);
            return plan;
        }

        /* ============================ ARTIFACTS ============================ */

        private static void AddItem(PublishPlan plan, PublishProfile profile, PublishItem item, PublishContext ctx,
            PublishFormat format, ParsedTemplate tpl, List<ParsedTemplate> sub, int index)
        {
            var tokens = PublishTokens.ForItem(ctx, item, format, index);
            NameResult r = NamingEngine.Evaluate(tpl, tokens, profile.Naming);
            var art = NewArtifact(item.Id, item.Kind, format, item.Label);
            art.MemberIds.Add(item.Id);
            ApplyName(plan, art, r, profile.Naming, tpl);
            art.Folder = ResolveFolder(plan, profile, sub, tokens, item.Id, format);
            plan.Artifacts.Add(art);
        }

        private static void AddSet(PublishPlan plan, PublishProfile profile, IReadOnlyList<PublishItem> items, PublishContext ctx,
            PublishFormat format, ParsedTemplate tpl, List<ParsedTemplate> sub, int index)
        {
            var tokens = PublishTokens.ForSet(ctx, items, format, index);
            NameResult r = NamingEngine.Evaluate(tpl, tokens, profile.Naming);
            var art = NewArtifact("*", PublishItemKind.Sheet, format, "Нэгтгэсэн (" + items.Count + " хуудас)");
            art.MemberIds.AddRange(items.Select(i => i.Id));
            ApplyName(plan, art, r, profile.Naming, tpl);
            art.Folder = ResolveFolder(plan, profile, sub, tokens, "*", format);
            plan.Artifacts.Add(art);
        }

        private static void AddModel(PublishPlan plan, PublishProfile profile, PublishContext ctx,
            ParsedTemplate tpl, List<ParsedTemplate> sub, int index)
        {
            var tokens = PublishTokens.ForSet(ctx, new PublishItem[0], PublishFormat.Ifc, index);
            NameResult r = NamingEngine.Evaluate(tpl, tokens, profile.Naming);
            var art = NewArtifact("*", PublishItemKind.Model, PublishFormat.Ifc, "Загвар (IFC)");
            ApplyName(plan, art, r, profile.Naming, tpl);
            art.Folder = ResolveFolder(plan, profile, sub, tokens, "*", PublishFormat.Ifc);
            plan.Artifacts.Add(art);
        }

        private static PlannedArtifact NewArtifact(string itemId, PublishItemKind kind, PublishFormat format, string label)
        {
            return new PlannedArtifact
            {
                ItemId = itemId,
                ItemKind = kind,
                Format = format,
                ItemLabel = label,
                Extension = Extension(format),
                Action = PlanAction.Export,
            };
        }

        public static string Extension(PublishFormat f)
        {
            switch (f)
            {
                case PublishFormat.Pdf: return ".pdf";
                case PublishFormat.Dwg: return ".dwg";
                case PublishFormat.Ifc: return ".ifc";
                default: return "";
            }
        }

        private static void ApplyName(PublishPlan plan, PlannedArtifact art, NameResult r, NamingSettings naming, ParsedTemplate tpl)
        {
            art.FileBaseName = r.Name ?? "";

            if (tpl.IsValid)
            {
                foreach (string missing in r.MissingTokens.Distinct())
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.MissingToken, ItemId = art.ItemId, Format = art.Format, Detail = missing });
                if (r.IsEmpty)
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.EmptyName, ItemId = art.ItemId, Format = art.Format });
                if (r.CharsReplaced)
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.CharsReplaced, ItemId = art.ItemId, Format = art.Format });
                if (r.Truncated)
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.Truncated, ItemId = art.ItemId, Format = art.Format, Detail = naming.MaxLength.ToString(CultureInfo.InvariantCulture) });
                foreach (string e in r.Errors)
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.TemplateError, ItemId = art.ItemId, Format = art.Format, Detail = e });
            }
        }

        /* ============================== FOLDERS ============================ */

        /// <summary>Загварыг `/` эсвэл `\` дээр (токены `{}` гадна) тайрч сегмент бүрийг тусад нь задлана.</summary>
        public static List<ParsedTemplate> ParseSubfolder(string template)
        {
            var list = new List<ParsedTemplate>();
            if (string.IsNullOrWhiteSpace(template)) return list;
            var cur = new StringBuilder();
            int depth = 0;
            foreach (char c in template)
            {
                if (c == '{') depth++;
                else if (c == '}') depth = Math.Max(0, depth - 1);
                if (depth == 0 && (c == '/' || c == '\\'))
                {
                    if (cur.Length > 0) list.Add(NamingEngine.Parse(cur.ToString()));
                    cur.Clear();
                    continue;
                }
                cur.Append(c);
            }
            if (cur.Length > 0) list.Add(NamingEngine.Parse(cur.ToString()));
            return list;
        }

        private static string ResolveFolder(PublishPlan plan, PublishProfile profile, List<ParsedTemplate> sub,
            ITokenSource tokens, string itemId, PublishFormat format)
        {
            string baseFolder = profile.Destination != null ? profile.Destination.BaseFolder : null;
            if (string.IsNullOrWhiteSpace(baseFolder)) return null;

            var parts = new List<string> { baseFolder.Trim() };
            var folderNaming = new NamingSettings
            {
                OnMissing = profile.Naming != null ? profile.Naming.OnMissing : MissingTokenPolicy.Error,
                MissingText = profile.Naming != null ? profile.Naming.MissingText : "NA",
                InvalidCharReplacement = "_",
                MaxLength = MaxFolderSegment,
            };
            foreach (ParsedTemplate seg in sub)
            {
                if (!seg.IsValid)
                {
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.TemplateError, ItemId = itemId, Format = format, Detail = "Дэд хавтас: " + string.Join(" ", seg.Errors) });
                    continue;
                }
                NameResult r = NamingEngine.Evaluate(seg, tokens, folderNaming);
                foreach (string missing in r.MissingTokens.Distinct())
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.MissingToken, ItemId = itemId, Format = format, Detail = "Дэд хавтас " + missing });
                if (string.IsNullOrEmpty(r.Name) || r.Name == "." || r.Name == "..") continue;
                parts.Add(r.Name);
            }
            return Path.Combine(parts.ToArray());
        }

        /* ============================ DUPLICATES =========================== */

        private static string Key(PlannedArtifact a)
        {
            return (a.Folder ?? "").TrimEnd('\\', '/').ToLowerInvariant() + "|" + (a.FileBaseName ?? "").ToLowerInvariant() + "|" + (a.Extension ?? "");
        }

        private static void ResolveDuplicates(PublishPlan plan, NamingSettings naming)
        {
            var groups = plan.Artifacts
                .Where(a => !string.IsNullOrEmpty(a.FileBaseName))
                .GroupBy(Key).Where(g => g.Count() > 1).ToList();
            if (groups.Count == 0) return;

            var used = new HashSet<string>(plan.Artifacts.Select(Key), StringComparer.Ordinal);
            foreach (var g in groups)
            {
                List<PlannedArtifact> members = g.ToList();
                if (naming.Duplicates == DuplicateNamePolicy.Suffix)
                {
                    for (int i = 1; i < members.Count; i++)
                    {
                        PlannedArtifact a = members[i];
                        string original = a.FileBaseName;
                        int n = 2;
                        string candidate;
                        do
                        {
                            candidate = original + "_" + n.ToString(CultureInfo.InvariantCulture);
                            a.FileBaseName = candidate;
                            n++;
                        } while (used.Contains(Key(a)));
                        used.Add(Key(a));
                        plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.DuplicateResolved, ItemId = a.ItemId, Format = a.Format, Detail = original + " → " + candidate });
                    }
                }
                else
                {
                    foreach (PlannedArtifact a in members)
                        plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.Duplicate, ItemId = a.ItemId, Format = a.Format, Detail = a.FileBaseName + a.Extension });
                }
            }
        }

        /* ============================== EXISTING =========================== */

        /// <summary>
        /// Хавтас тутмын жагсаалтыг НЭГ удаа уншиж «файл байна уу» гэдгийг санах ойгоос шийднэ.
        /// ⚠️ Нэг файл тутамд `File.Exists` дуудахгүй: сүлжээний хавтас дээр 500 хуудас × 3 формат =
        /// 1500 дуудлага нь preflight шинэчлэл бүрд (сонголт өөрчлөх бүрд) UI-г хэдэн секунд гацаана.
        /// </summary>
        private sealed class DirCache
        {
            private readonly IFileSystem _fs;
            private readonly Dictionary<string, HashSet<string>> _byDir = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

            public DirCache(IFileSystem fs) { _fs = fs; }

            public bool Exists(string fullPath)
            {
                string dir = Path.GetDirectoryName(fullPath) ?? "";
                HashSet<string> names;
                if (!_byDir.TryGetValue(dir, out names))
                {
                    names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (FileFacts f in _fs.ListFiles(dir)) names.Add(Path.GetFileName(f.Path));
                    _byDir[dir] = names;
                }
                return names.Contains(Path.GetFileName(fullPath));
            }
        }

        private static void ApplyExisting(PublishPlan plan, OverwriteMode mode, IFileSystem fs)
        {
            var cache = new DirCache(fs);
            var used = new HashSet<string>(plan.Artifacts.Select(a => FullKey(a)), StringComparer.Ordinal);
            foreach (PlannedArtifact a in plan.Artifacts)
            {
                if (string.IsNullOrEmpty(a.Folder) || string.IsNullOrEmpty(a.FileBaseName))
                {
                    a.Action = PlanAction.Export;
                    continue;
                }

                bool exists = cache.Exists(a.FullPath);
                a.TargetExists = exists;
                if (!exists) { a.Action = PlanAction.Export; continue; }

                switch (mode)
                {
                    case OverwriteMode.Skip:
                        a.Action = PlanAction.SkipExisting;
                        break;
                    case OverwriteMode.Overwrite:
                        a.Action = PlanAction.Overwrite;
                        break;
                    case OverwriteMode.Version:
                        string original = a.FileBaseName;
                        int n = 2;
                        while (n < 1000)
                        {
                            a.FileBaseName = original + "_v" + n.ToString(CultureInfo.InvariantCulture);
                            if (!cache.Exists(a.FullPath) && !used.Contains(FullKey(a))) break;
                            n++;
                        }
                        used.Add(FullKey(a));
                        a.Action = PlanAction.Versioned;
                        a.Notes.Add("Байгаа файл хэвээр үлдэнэ; шинэ нэр: " + a.FileName);
                        break;
                    default:
                        a.Action = PlanAction.Export;   // Fail — preflight блоклоно
                        break;
                }
            }
        }

        private static string FullKey(PlannedArtifact a)
        {
            return (a.FullPath ?? "").ToLowerInvariant();
        }

        private static void CheckPathLength(PublishPlan plan)
        {
            foreach (PlannedArtifact a in plan.Artifacts)
            {
                if (string.IsNullOrEmpty(a.Folder) || string.IsNullOrEmpty(a.FileBaseName)) continue;
                int len = a.FullPath.Length;
                if (len > MaxPath)
                    plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.PathTooLong, ItemId = a.ItemId, Format = a.Format, Detail = len.ToString(CultureInfo.InvariantCulture) });
            }
        }
    }
}
