using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SmartPublish.Core
{
    public sealed class PreflightFinding
    {
        public string RuleId { get; set; }
        public PreflightSeverity Severity { get; set; }
        /// <summary>Тодорхой хуудас/харагдацад хамаарах бол id; бусад үед null.</summary>
        public string ItemId { get; set; }
        public PublishFormat Format { get; set; }
        public string Message { get; set; }
        public string Hint { get; set; }
    }

    public sealed class PreflightReport
    {
        public List<PreflightFinding> Findings { get; set; } = new List<PreflightFinding>();

        public int Blocking { get { return Findings.Count(f => f.Severity == PreflightSeverity.Blocking); } }
        public int Warnings { get { return Findings.Count(f => f.Severity == PreflightSeverity.Warning); } }
        public int Infos { get { return Findings.Count(f => f.Severity == PreflightSeverity.Info); } }
        public bool CanRun { get { return Blocking == 0; } }

        /// <summary>Блоклосон хуудасны id-ууд (UI «Блоклосныг хасах»-д).</summary>
        public HashSet<string> BlockedItemIds()
        {
            return new HashSet<string>(Findings
                .Where(f => f.Severity == PreflightSeverity.Blocking && !string.IsNullOrEmpty(f.ItemId) && f.ItemId != "*")
                .Select(f => f.ItemId), StringComparer.Ordinal);
        }
    }

    /// <summary>Revit-ээс ХУУЛСАН орчны баримт (preflight Revit-гүй байхын тулд).</summary>
    public sealed class EnvironmentFacts
    {
        /// <summary>Загвар доторх ӨМНӨ ТОДОРХОЙЛОГДСОН DWG экспортын тохиргооны нэрс.</summary>
        public HashSet<string> DwgSetupNames { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public bool DwgModuleAvailable { get; set; } = true;
        public bool IfcModuleAvailable { get; set; } = true;
        /// <summary>IFC-ийг шүүх боломжтой 3D харагдацын нэрс.</summary>
        public HashSet<string> ThreeDViewNames { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public bool IsFamilyDocument { get; set; }
        /// <summary>Профайлын PDF тохиргооны Revit enum-д задрахгүй нэрс («Orientation=Sideways»).</summary>
        public List<string> InvalidPdfSettings { get; set; } = new List<string>();
    }

    public sealed class PreflightContext
    {
        public PublishProfile Profile { get; set; }
        public IReadOnlyList<PublishItem> Items { get; set; } = new PublishItem[0];
        public PublishPlan Plan { get; set; } = new PublishPlan();
        public PublishContext Project { get; set; } = new PublishContext();
        public EnvironmentFacts Env { get; set; } = new EnvironmentFacts();
        public IFileSystem Fs { get; set; }
    }

    /// <summary>
    /// ДҮРЭМ ТУС БҮР өөрийн `Id`-тэй, ЦЭВЭР (Revit-гүй, зөвхөн `PreflightContext`-ийг уншина).
    /// ⚠️ Дүрэм ЗАГВАРЫГ ЗАСДАГГҮЙ — «автоматаар засъя» гэж модель өөрчлөх ёсгүй; зөвхөн
    /// мэдээлж, хэрхэн засахыг санал болгоно.
    /// </summary>
    public interface IPreflightRule
    {
        string Id { get; }
        /// <summary>false = профайл энэ дүрмийн Blocking-ийг БУУРУУЛАХ ёсгүй (бүтцийн боломжгүй байдал).</summary>
        bool Downgradable { get; }
        IEnumerable<PreflightFinding> Evaluate(PreflightContext c);
    }

    public static class PreflightIds
    {
        public const string EmptySet = "empty_set";
        public const string NoFormats = "no_formats";
        public const string DocumentState = "document_state";
        public const string TemplateInvalid = "template_invalid";
        public const string MissingToken = "missing_token";
        public const string EmptyFilename = "empty_filename";
        public const string InvalidChars = "invalid_chars";
        public const string NameTruncated = "name_truncated";
        public const string DuplicateNames = "duplicate_names";
        public const string PathTooLong = "path_too_long";
        public const string DestinationMissing = "destination_missing";
        public const string DestinationNotWritable = "destination_not_writable";
        public const string RequiredParameter = "required_parameter";
        public const string MissingRevision = "missing_revision";
        public const string NotPrintable = "not_printable";
        public const string PlaceholderSheet = "placeholder_sheet";
        public const string DuplicateSheetNumbers = "duplicate_sheet_numbers";
        public const string DwgSetup = "dwg_setup";
        public const string IfcOptions = "ifc_options";
        public const string OverwriteConflict = "overwrite_conflict";
        public const string PdfSettings = "pdf_settings";
        public const string CombinedPdf = "combined_pdf";
        public const string LargeSet = "large_set";
    }

    internal sealed class DelegateRule : IPreflightRule
    {
        private readonly Func<PreflightContext, IEnumerable<PreflightFinding>> _eval;
        public string Id { get; private set; }
        public bool Downgradable { get; private set; }

        public DelegateRule(string id, bool downgradable, Func<PreflightContext, IEnumerable<PreflightFinding>> eval)
        {
            Id = id;
            Downgradable = downgradable;
            _eval = eval;
        }

        public IEnumerable<PreflightFinding> Evaluate(PreflightContext c) { return _eval(c); }
    }

    public static class PreflightEngine
    {
        public static IReadOnlyList<IPreflightRule> DefaultRules { get { return Rules; } }

        public static PreflightReport Run(PreflightContext ctx, IReadOnlyList<IPreflightRule> rules = null)
        {
            if (ctx == null) throw new ArgumentNullException("ctx");
            rules = rules ?? Rules;
            var report = new PreflightReport();

            foreach (IPreflightRule rule in rules)
            {
                IEnumerable<PreflightFinding> found;
                try
                {
                    found = rule.Evaluate(ctx).ToList();
                }
                catch (Exception ex)
                {
                    // Нэг дүрмийн алдаа бусдыг БОЛИУЛАХ ёсгүй, гэхдээ чимээгүй өнгөрөх ёсгүй —
                    // шалгалт хийгдээгүйг ил Warning болгоно (Blocking биш: дүрмийн өөрийнх нь алдаа).
                    found = new[]
                    {
                        new PreflightFinding
                        {
                            RuleId = rule.Id,
                            Severity = PreflightSeverity.Warning,
                            Message = "Шалгалт «" + rule.Id + "» ажиллаж чадсангүй (" + ex.GetType().Name + ").",
                            Hint = "Үүнийг MGL-д мэдэгдээрэй; бусад шалгалт хэвийн.",
                        },
                    };
                }

                foreach (PreflightFinding f in found)
                {
                    f.RuleId = rule.Id;
                    f.Severity = ApplyOverride(ctx.Profile, rule, f.Severity);
                    report.Findings.Add(f);
                }
            }

            report.Findings = report.Findings
                .OrderByDescending(f => f.Severity)
                .ThenBy(f => f.RuleId, StringComparer.Ordinal)
                .ThenBy(f => f.ItemId ?? "", StringComparer.Ordinal)
                .ToList();
            return report;
        }

        private static PreflightSeverity ApplyOverride(PublishProfile p, IPreflightRule rule, PreflightSeverity original)
        {
            PreflightSeverity ov;
            if (p == null || p.SeverityOverrides == null || !p.SeverityOverrides.TryGetValue(rule.Id, out ov)) return original;
            if (!rule.Downgradable && ov < original) return original;
            return ov;
        }

        private static PreflightFinding F(PreflightSeverity sev, string msg, string hint = null, string itemId = null, PublishFormat fmt = PublishFormat.Unknown)
        {
            return new PreflightFinding { Severity = sev, Message = msg, Hint = hint, ItemId = itemId, Format = fmt };
        }

        private static string LabelOf(PreflightContext c, string itemId)
        {
            if (string.IsNullOrEmpty(itemId) || itemId == "*") return "";
            PublishItem it = c.Items.FirstOrDefault(i => i.Id == itemId);
            return it != null ? it.Label : itemId;
        }

        private static bool HasFormat(PreflightContext c, PublishFormat f)
        {
            return c.Profile.Formats != null && c.Profile.Formats.Contains(f);
        }

        /* ============================== ДҮРМҮҮД ============================= */

        private static readonly IReadOnlyList<IPreflightRule> Rules = new List<IPreflightRule>
        {
            new DelegateRule(PreflightIds.DocumentState, false, c =>
            {
                var l = new List<PreflightFinding>();
                if (c.Env.IsFamilyDocument)
                    l.Add(F(PreflightSeverity.Blocking, "Family баримтаас гаргалт хийх боломжгүй.", "Төслийн (project) файл нээнэ үү."));
                return l;
            }),

            new DelegateRule(PreflightIds.NoFormats, false, c =>
            {
                var l = new List<PreflightFinding>();
                bool any = c.Profile.Formats != null && c.Profile.Formats.Any(f => f != PublishFormat.Unknown);
                if (!any) l.Add(F(PreflightSeverity.Blocking, "Профайлд гаргах формат (PDF/DWG/IFC) сонгоогүй байна.", "Профайлаа засаж ядаж нэг формат сонгоно уу."));
                return l;
            }),

            new DelegateRule(PreflightIds.EmptySet, false, c =>
            {
                var l = new List<PreflightFinding>();
                bool sheetFormats = c.Profile.Formats != null && c.Profile.Formats.Any(f => f == PublishFormat.Pdf || f == PublishFormat.Dwg);
                if (sheetFormats && c.Items.Count == 0 && !HasFormat(c, PublishFormat.Ifc))
                    l.Add(F(PreflightSeverity.Blocking, "Гаргах хуудас сонгоогүй байна.", "Жагсаалтаас хуудсаа тэмдэглэнэ үү."));
                return l;
            }),

            new DelegateRule(PreflightIds.TemplateInvalid, false, c =>
                c.Plan.NameIssues.Where(i => i.Kind == NameIssueKind.TemplateError)
                    .GroupBy(i => i.Detail ?? "")
                    .Select(g => F(PreflightSeverity.Blocking, "Нэршлийн загварт алдаа байна: " + g.Key, "Профайлын нэршлийн загварыг засна уу (жишээ: {ProjectNumber}_{SheetNumber}_{SheetName}[_{Revision}])."))
                    .ToList()),

            new DelegateRule(PreflightIds.MissingToken, true, c =>
            {
                var l = new List<PreflightFinding>();
                MissingTokenPolicy pol = c.Profile.Naming != null ? c.Profile.Naming.OnMissing : MissingTokenPolicy.Error;
                PreflightSeverity sev = pol == MissingTokenPolicy.Error ? PreflightSeverity.Blocking : PreflightSeverity.Info;
                foreach (NameIssue i in c.Plan.NameIssues.Where(x => x.Kind == NameIssueKind.MissingToken))
                    l.Add(F(sev, "«" + LabelOfOrSet(c, i.ItemId) + "» — нэрэнд ашиглах " + i.Detail + " хоосон байна.",
                        pol == MissingTokenPolicy.Error ? "Параметрийг бөглөх, эсвэл загварт `[ ... ]` бүлэг ашиглан нэмэлт болгоно уу." : null,
                        i.ItemId, i.Format));
                return l;
            }),

            new DelegateRule(PreflightIds.EmptyFilename, false, c =>
                c.Plan.NameIssues.Where(i => i.Kind == NameIssueKind.EmptyName)
                    .Select(i => F(PreflightSeverity.Blocking, "«" + LabelOfOrSet(c, i.ItemId) + "» — файлын нэр хоосон болж байна.", "Нэршлийн загварыг шалгана уу.", i.ItemId, i.Format))
                    .ToList()),

            new DelegateRule(PreflightIds.InvalidChars, true, c =>
                c.Plan.NameIssues.Where(i => i.Kind == NameIssueKind.CharsReplaced)
                    .Select(i => F(PreflightSeverity.Info, "«" + LabelOfOrSet(c, i.ItemId) + "» — файлын нэрийн хориотой тэмдэгт (\\ / : * ? \" < > |) орлогдоно.", null, i.ItemId, i.Format))
                    .ToList()),

            new DelegateRule(PreflightIds.NameTruncated, true, c =>
                c.Plan.NameIssues.Where(i => i.Kind == NameIssueKind.Truncated)
                    .Select(i => F(PreflightSeverity.Warning, "«" + LabelOfOrSet(c, i.ItemId) + "» — файлын нэр " + i.Detail + " тэмдэгтээр тайрагдсан.", "Нэршлийг богиносгох эсвэл дээд уртыг нэмнэ үү.", i.ItemId, i.Format))
                    .ToList()),

            new DelegateRule(PreflightIds.DuplicateNames, true, c =>
            {
                var l = new List<PreflightFinding>();
                foreach (NameIssue i in c.Plan.NameIssues.Where(x => x.Kind == NameIssueKind.Duplicate))
                    l.Add(F(PreflightSeverity.Blocking, "Давхардсан файлын нэр: " + i.Detail + " («" + LabelOfOrSet(c, i.ItemId) + "»).",
                        "Нэршилд хуудасны дугаар/параметр нэмнэ, эсвэл профайлд «давхардлыг дагавраар шийд» сонгоно.", i.ItemId, i.Format));
                foreach (NameIssue i in c.Plan.NameIssues.Where(x => x.Kind == NameIssueKind.DuplicateResolved))
                    l.Add(F(PreflightSeverity.Info, "Давхардсан нэр дагавраар шийдэгдлээ: " + i.Detail, null, i.ItemId, i.Format));
                return l;
            }),

            new DelegateRule(PreflightIds.PathTooLong, false, c =>
                c.Plan.NameIssues.Where(i => i.Kind == NameIssueKind.PathTooLong)
                    .Select(i => F(PreflightSeverity.Blocking, "«" + LabelOfOrSet(c, i.ItemId) + "» — замын урт " + i.Detail + " тэмдэгт (дээд " + PublishPlanner.MaxPath + ").",
                        "Богино хавтас сонгох эсвэл нэршлийг богиносгоно уу.", i.ItemId, i.Format))
                    .ToList()),

            new DelegateRule(PreflightIds.DestinationMissing, false, DestinationExists),
            new DelegateRule(PreflightIds.DestinationNotWritable, false, DestinationWritable),

            new DelegateRule(PreflightIds.RequiredParameter, true, c =>
            {
                var l = new List<PreflightFinding>();
                if (c.Profile.RequiredParameters == null || c.Profile.RequiredParameters.Count == 0) return l;
                foreach (PublishItem it in c.Items.Where(i => i.Kind == PublishItemKind.Sheet))
                {
                    var missing = new List<string>();
                    foreach (string p in c.Profile.RequiredParameters.Where(x => !string.IsNullOrWhiteSpace(x)))
                    {
                        string v;
                        if (!it.Values.TryGetValue(p.Trim(), out v) || string.IsNullOrWhiteSpace(v)) missing.Add(p.Trim());
                    }
                    if (missing.Count > 0)
                        l.Add(F(PreflightSeverity.Blocking, "«" + it.Label + "» — шаардлагатай параметр хоосон: " + string.Join(", ", missing) + ".",
                            "Хуудасны параметрийг бөглөнө үү.", it.Id));
                }
                return l;
            }),

            new DelegateRule(PreflightIds.MissingRevision, true, c =>
            {
                var l = new List<PreflightFinding>();
                if (c.Profile.Revision == null || !c.Profile.Revision.Required) return l;
                foreach (PublishItem it in c.Items.Where(i => i.Kind == PublishItemKind.Sheet && string.IsNullOrWhiteSpace(i.RevisionNumber)))
                    l.Add(F(PreflightSeverity.Blocking, "«" + it.Label + "» — ревиз байхгүй (профайл ревиз шаарддаг).", "Хуудсанд ревиз нэмнэ үү.", it.Id));
                return l;
            }),

            new DelegateRule(PreflightIds.NotPrintable, false, c =>
            {
                var l = new List<PreflightFinding>();
                if (!HasFormat(c, PublishFormat.Pdf) && !HasFormat(c, PublishFormat.Dwg)) return l;
                foreach (PublishItem it in c.Items.Where(i => !i.CanBePrinted && !i.IsPlaceholder))
                    l.Add(F(PreflightSeverity.Blocking, "«" + it.Label + "» — энэ харагдацыг хэвлэх/экспортлох боломжгүй.", "Жагсаалтаас хасна уу.", it.Id));
                return l;
            }),

            new DelegateRule(PreflightIds.PlaceholderSheet, false, c =>
                c.Items.Where(i => i.IsPlaceholder)
                    .Select(i => F(PreflightSeverity.Blocking, "«" + i.Label + "» — placeholder хуудас (бодит агуулгагүй) тул гаргаж болохгүй.", "Жагсаалтаас хасна уу.", i.Id))
                    .ToList()),

            new DelegateRule(PreflightIds.DuplicateSheetNumbers, true, c =>
            {
                var l = new List<PreflightFinding>();
                foreach (var g in c.Items.Where(i => !string.IsNullOrWhiteSpace(i.Number))
                    .GroupBy(i => i.Number.Trim(), StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
                    foreach (PublishItem it in g)
                        l.Add(F(PreflightSeverity.Warning, "Хуудасны дугаар «" + g.Key + "» давхардсан (" + g.Count() + ").", "Дугаарыг давхардуулахгүй байх нь зүйтэй.", it.Id));
                return l;
            }),

            new DelegateRule(PreflightIds.DwgSetup, false, c =>
            {
                var l = new List<PreflightFinding>();
                if (!HasFormat(c, PublishFormat.Dwg)) return l;
                if (!c.Env.DwgModuleAvailable)
                {
                    l.Add(F(PreflightSeverity.Blocking, "DWG экспортын модуль энэ Revit-д суугаагүй байна.", null, null, PublishFormat.Dwg));
                    return l;
                }
                string setup = c.Profile.Dwg != null ? c.Profile.Dwg.SetupName : null;
                if (string.IsNullOrWhiteSpace(setup))
                    l.Add(F(PreflightSeverity.Info, "DWG-ийн тохиргооны нэр заагаагүй — Revit-ийн анхдагч тохиргоогоор гарна.", "Компанийн DWG setup-ыг профайлд сонгохыг зөвлөе.", null, PublishFormat.Dwg));
                else if (!c.Env.DwgSetupNames.Contains(setup.Trim()))
                    l.Add(F(PreflightSeverity.Blocking, "DWG тохиргоо «" + setup + "» энэ загварт байхгүй байна.", "Revit-ийн «Export Setups → DWG»-ээс шалгаад профайлд зөв нэрийг сонгоно уу.", null, PublishFormat.Dwg));
                return l;
            }),

            new DelegateRule(PreflightIds.IfcOptions, false, c =>
            {
                var l = new List<PreflightFinding>();
                if (!HasFormat(c, PublishFormat.Ifc)) return l;
                if (!c.Env.IfcModuleAvailable)
                {
                    l.Add(F(PreflightSeverity.Blocking, "IFC экспортын модуль энэ Revit-д суугаагүй байна.", null, null, PublishFormat.Ifc));
                    return l;
                }
                string view = c.Profile.Ifc != null ? c.Profile.Ifc.FilterViewName : null;
                if (!string.IsNullOrWhiteSpace(view) && !c.Env.ThreeDViewNames.Contains(view.Trim()))
                    l.Add(F(PreflightSeverity.Blocking, "IFC-ийн шүүлтүүр харагдац «" + view + "» олдсонгүй.", "3D харагдацын нэрийг шалгаж профайлд зөв сонгоно уу.", null, PublishFormat.Ifc));
                l.Add(F(PreflightSeverity.Info, "IFC нь хуудас биш, ЗАГВАРЫГ" + (string.IsNullOrWhiteSpace(view) ? "" : " «" + view + "» харагдацаар шүүж") + " гаргана.", null, null, PublishFormat.Ifc));
                return l;
            }),

            new DelegateRule(PreflightIds.PdfSettings, true, c =>
                (HasFormat(c, PublishFormat.Pdf) ? c.Env.InvalidPdfSettings : new List<string>())
                    .Select(s => F(PreflightSeverity.Warning, "PDF тохиргоо танигдсангүй: " + s + " — Revit-ийн анхдагчаар гарна.", "Профайлын PDF тохиргоог шалгана уу.", null, PublishFormat.Pdf))
                    .ToList()),

            new DelegateRule(PreflightIds.CombinedPdf, true, c =>
            {
                var l = new List<PreflightFinding>();
                if (HasFormat(c, PublishFormat.Pdf) && c.Profile.Pdf != null && c.Profile.Pdf.Combine && c.Items.Count > 1)
                    l.Add(F(PreflightSeverity.Info, "Нэгтгэсэн PDF: нэг хуудас бүтэлгүйтвэл бүх PDF-д нөлөөлнө (хуудас тус бүрээр тусгаарлагдахгүй).", null, null, PublishFormat.Pdf));
                return l;
            }),

            new DelegateRule(PreflightIds.OverwriteConflict, true, c =>
            {
                var l = new List<PreflightFinding>();
                OverwriteMode mode = c.Profile.Overwrite;
                foreach (PlannedArtifact a in c.Plan.Artifacts.Where(x => x.TargetExists))
                {
                    string who = "«" + (string.IsNullOrEmpty(a.ItemLabel) ? a.FileName : a.ItemLabel) + "» (" + a.FileName + ")";
                    switch (mode)
                    {
                        case OverwriteMode.Fail:
                            l.Add(F(PreflightSeverity.Blocking, who + " — файл аль хэдийн байна.", "Профайлын «байгаа файл» горимыг өөрчилнө үү.", a.ItemId, a.Format));
                            break;
                        case OverwriteMode.Overwrite:
                            l.Add(F(PreflightSeverity.Warning, who + " — байгаа файлыг дарж бичнэ.", null, a.ItemId, a.Format));
                            break;
                        case OverwriteMode.Skip:
                            l.Add(F(PreflightSeverity.Info, who + " — файл байгаа тул алгасна.", null, a.ItemId, a.Format));
                            break;
                        case OverwriteMode.Version:
                            l.Add(F(PreflightSeverity.Info, who + " — файл байгаа тул шинэ нэр: " + a.FileName + ".", null, a.ItemId, a.Format));
                            break;
                    }
                }
                return l;
            }),

            new DelegateRule(PreflightIds.LargeSet, true, c =>
            {
                var l = new List<PreflightFinding>();
                int total = c.Plan.Artifacts.Count;
                if (total >= 150)
                    l.Add(F(PreflightSeverity.Info, total + " файл гарна — хэдэн минут үргэлжилж болно; Revit энэ хугацаанд завгүй байна.", null));
                return l;
            }),
        };

        private static string LabelOfOrSet(PreflightContext c, string itemId)
        {
            if (itemId == "*") return "нэгтгэсэн файл";
            string l = LabelOf(c, itemId);
            return string.IsNullOrEmpty(l) ? "файл" : l;
        }

        private static IEnumerable<PreflightFinding> DestinationExists(PreflightContext c)
        {
            var l = new List<PreflightFinding>();
            DestinationRule d = c.Profile.Destination ?? new DestinationRule();
            if (string.IsNullOrWhiteSpace(d.BaseFolder))
            {
                l.Add(F(PreflightSeverity.Blocking, "Гаргах хавтас сонгоогүй байна.", "Профайлд үндсэн хавтсыг заана уу."));
                return l;
            }
            string b = d.BaseFolder.Trim();
            bool rooted;
            try { rooted = System.IO.Path.IsPathRooted(b); } catch (ArgumentException) { rooted = false; }
            if (!rooted)
            {
                l.Add(F(PreflightSeverity.Blocking, "Гаргах хавтас бүтэн зам байх ёстой (`" + b + "` — харьцангуй зам).", "Жишээ: D:\\Гаргалт\\Төсөл-1 эсвэл \\\\сервер\\хавтас."));
                return l;
            }
            if (c.Fs == null) return l;
            if (!c.Fs.DirectoryExists(b))
            {
                if (d.CreateMissing)
                    l.Add(F(PreflightSeverity.Info, "Хавтас байхгүй — гаргалтын үед үүсгэнэ."));
                else
                    l.Add(F(PreflightSeverity.Blocking, "Гаргах хавтас байхгүй байна.", "Хавтсыг үүсгэнэ үү, эсвэл профайлд «хавтас үүсгэх»-ийг идэвхжүүлнэ үү."));
            }
            return l;
        }

        private static IEnumerable<PreflightFinding> DestinationWritable(PreflightContext c)
        {
            var l = new List<PreflightFinding>();
            DestinationRule d = c.Profile.Destination ?? new DestinationRule();
            if (c.Fs == null || string.IsNullOrWhiteSpace(d.BaseFolder)) return l;
            string probe = d.BaseFolder.Trim();

            // Хавтас байхгүй бол хамгийн ойрын БАЙГАА эцэг хавтсанд бичих эрхийг шалгана.
            int guard = 0;
            while (!c.Fs.DirectoryExists(probe) && guard++ < 32)
            {
                string parent;
                try { parent = System.IO.Path.GetDirectoryName(probe.TrimEnd('\\', '/')); }
                catch (ArgumentException) { parent = null; }
                if (string.IsNullOrEmpty(parent) || parent == probe) return l;   // үндэс хүртэл байхгүй — DestinationMissing мэдээлнэ
                probe = parent;
            }
            if (!c.Fs.DirectoryExists(probe)) return l;

            string err;
            if (!c.Fs.TryProbeWritable(probe, out err))
                l.Add(F(PreflightSeverity.Blocking, "Гаргах хавтсанд бичих боломжгүй байна" + (string.IsNullOrEmpty(err) ? "" : " (" + err + ")") + ".",
                    "Эрх, сүлжээний холболт, диск дүүрсэн эсэхийг шалгана уу."));
            return l;
        }
    }
}
