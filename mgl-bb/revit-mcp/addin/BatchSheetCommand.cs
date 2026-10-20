using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// «Хуудас үүсгэх» ribbon команд: нэг диалогоор олон ViewSheet-ийг нэг дор
    /// үүсгэнэ. Хэрэглэгч хуудасны текст параметрүүд (жиш. *Classification,
    /// *Sub-Discipline, *Type Designator) тус бүрийн утгыг сонгож, эхлэх дугаар
    /// + тоо ширхэгээ өгнө. SheetNumber нь «дугаарт оруулах» гэж тэмдэглэсэн
    /// параметрүүд + автомат нэмэгдэх дугаараас угсарна; параметрүүд нь мөн тус
    /// тусад нь хуудасны талбарт хадгалагдана. Бүх хуудас нэг Transaction дотор
    /// үүсч COMMIT хийгдэнэ (моделд үлдэнэ). MGL сервер/токен шаардахгүй — зөвхөн
    /// локал модель дээр ажиллана.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class BatchSheetCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Хуудас үүсгэх";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Хуудас зөвхөн төслийн файлд үүснэ. Family засварлаж байгаа бол төслийн файл руу шилжинэ үү.");
                return Result.Cancelled;
            }

            List<DiscoveredParam> parameters = DiscoverSheetTextParams(doc);
            List<TitleBlockOption> titleBlocks = CollectTitleBlocks(doc);

            // Одоо байгаа дугаарууд — preview-д давхцлыг тэмдэглэх + үүсгэхэд алгасахад ашиглана.
            var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)))
            {
                string n = ((ViewSheet)e).SheetNumber;
                if (!string.IsNullOrEmpty(n))
                    existing.Add(n);
            }

            AddinSettings settings = SettingsStore.Load();
            SheetGenPrefs prefs = settings.SheetGen ?? new SheetGenPrefs();

            var dlg = new BatchSheetDialog(parameters, titleBlocks, prefs, existing);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true)
                return Result.Cancelled;

            // Сүүлийн тохиргоог санана (амжилт бүтэлгүйгээс үл хамааран — UX).
            try
            {
                prefs.Separator = dlg.Separator;
                prefs.PadWidth = dlg.PadWidth;
                prefs.NameTemplate = dlg.NameTemplate;
                prefs.TitleBlockName = dlg.TitleBlockLabel;
                prefs.Values = dlg.Rows.ToDictionary(r => r.Name, r => r.Value ?? string.Empty);
                prefs.IncludeInNumber = dlg.Rows.ToDictionary(r => r.Name, r => r.IncludeInNumber);
                settings.SheetGen = prefs;
                SettingsStore.Save(settings);
            }
            catch
            {
                // Тохиргоо хадгалагдахгүй байх нь хуудас үүсгэхэд саад болох ёсгүй.
            }

            // «Дугаарт оруулах» гэж тэмдэглэсэн, утгатай параметрүүд — эрэмбэ хадгалагдана.
            List<string> includedValues = dlg.Rows
                .Where(r => r.IncludeInNumber && !string.IsNullOrWhiteSpace(r.Value))
                .Select(r => r.Value.Trim())
                .ToList();

            // Хуудас бүрт оноох параметрүүд (утгатай нь бүгд — дугаарт орсон эсэхээс үл хамааран).
            List<KeyValuePair<string, string>> toSet = dlg.Rows
                .Where(r => !string.IsNullOrWhiteSpace(r.Value))
                .Select(r => new KeyValuePair<string, string>(r.Name, r.Value.Trim()))
                .ToList();

            int created = 0, skipped = 0, failed = 0;
            string firstNum = null, lastNum = null;
            ViewSheet firstSheet = null;

            using (var tx = new Transaction(doc, "MGL — Хуудас үүсгэх"))
            {
                tx.Start();

                // Гарчгийн хүснэгтийн symbol идэвхгүй бол идэвхжүүлнэ.
                if (dlg.TitleBlockId != ElementId.InvalidElementId)
                {
                    var sym = doc.GetElement(dlg.TitleBlockId) as FamilySymbol;
                    if (sym != null && !sym.IsActive)
                    {
                        sym.Activate();
                        doc.Regenerate();
                    }
                }

                for (int i = 0; i < dlg.Count; i++)
                {
                    int num = dlg.StartNumber + i;
                    string padded = PadNumber(num, dlg.PadWidth);
                    string composed = ComposeNumber(includedValues, padded, dlg.Separator);

                    if (existing.Contains(composed))
                    {
                        skipped++;
                        continue;
                    }

                    ViewSheet sheet;
                    try
                    {
                        sheet = ViewSheet.Create(doc, dlg.TitleBlockId);
                    }
                    catch
                    {
                        failed++;
                        continue;
                    }

                    try
                    {
                        sheet.SheetNumber = composed;
                    }
                    catch
                    {
                        // Дугаар давхцсан/буруу — шинэ хоосон хуудсыг устгаж алгасна.
                        try { doc.Delete(sheet.Id); } catch { /* устгаж чадсангүй — үлдэнэ */ }
                        skipped++;
                        continue;
                    }

                    try
                    {
                        string name = ResolveName(dlg.NameTemplate, padded);
                        if (!string.IsNullOrEmpty(name))
                            sheet.Name = name; // ViewSheet.Name = хуудасны нэр (SHEET_NAME)

                        foreach (KeyValuePair<string, string> kv in toSet)
                        {
                            Parameter p = sheet.LookupParameter(kv.Key);
                            if (p != null && !p.IsReadOnly && p.StorageType == StorageType.String)
                                p.Set(kv.Value);
                        }
                    }
                    catch
                    {
                        // Нэр/параметр оноолт бүтэлгүй — хуудас өөрөө үүссэн тул үлдээнэ.
                    }

                    existing.Add(composed);
                    created++;
                    if (firstSheet == null)
                    {
                        firstSheet = sheet;
                        firstNum = composed;
                    }
                    lastNum = composed;
                }

                tx.Commit();
            }

            if (firstSheet != null)
            {
                try { uidoc.ActiveView = firstSheet; } catch { /* идэвхжүүлж чадсангүй */ }
            }

            var sb = new StringBuilder();
            sb.AppendLine(created > 0 ? "Хуудас үүсгэлээ." : "Хуудас үүсгэсэнгүй.");
            sb.AppendLine();
            sb.AppendLine("Үүсгэсэн: " + created);
            if (skipped > 0)
                sb.AppendLine("Алгассан (дугаар давхцсан): " + skipped);
            if (failed > 0)
                sb.AppendLine("Үүсгэж чадаагүй: " + failed + "  (Revit хуудас үүсгэхээс татгалзсан — гарчгийн хүснэгт, төслийн төлөвийг шалгана уу)");
            if (firstNum != null)
                sb.AppendLine("Дугаар: " + firstNum + (lastNum != firstNum ? " … " + lastNum : string.Empty));
            if (created > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Буцаах бол Ctrl+Z — бүх хуудас нэг дор буцна.");
            }
            TaskDialog.Show(DialogTitle, sb.ToString());

            return created > 0 ? Result.Succeeded : Result.Cancelled;
        }

        // ── Дугаар/нэр угсрах туслахууд ────────────────────────────────────────

        /// <summary>Дугаар/нэр угсрах дүрэм — `Ui/Core/BatchSheetRules.cs` (Revit-гүй, тестлэгдсэн).  Цонхны урьдчилан харах ба
        /// энд ИЖИЛ функц — хоёр хуулбар байхгүй.</summary>
        internal static string PadNumber(int num, int pad) => Ui.Core.BatchSheetRules.PadNumber(num, pad);

        internal static string ComposeNumber(List<string> parts, string padded, string sep) => Ui.Core.BatchSheetRules.ComposeNumber(parts, padded, sep);

        internal static string ResolveName(string template, string padded) => Ui.Core.BatchSheetRules.ResolveName(template, padded);

        // ── Илрүүлэлт ───────────────────────────────────────────────────────────

        /// <summary>
        /// Хуудасны (OST_Sheets) instance текст параметрүүдийг олно: эхлээд
        /// ParameterBindings (хуудасгүй загварт ч ажиллана), дараа нь одоо байгаа
        /// хуудсуудаас нэмэлт параметр + combo-ийн санал болгох утгуудыг цуглуулна.
        /// </summary>
        private static List<DiscoveredParam> DiscoverSheetTextParams(Document doc)
        {
            var map = new Dictionary<string, DiscoveredParam>(StringComparer.Ordinal);

            try
            {
                ElementId sheetsCatId = new ElementId(BuiltInCategory.OST_Sheets);
                DefinitionBindingMapIterator it = doc.ParameterBindings.ForwardIterator();
                while (it.MoveNext())
                {
                    Definition def = it.Key as Definition;
                    InstanceBinding ib = it.Current as InstanceBinding;
                    if (def == null || ib == null)
                        continue;

                    bool onSheets = false;
                    foreach (Category c in ib.Categories)
                    {
                        if (c != null && c.Id == sheetsCatId)
                        {
                            onSheets = true;
                            break;
                        }
                    }
                    if (!onSheets || !IsTextDefinition(def))
                        continue;

                    AddParam(map, def.Name);
                }
            }
            catch
            {
                // Binding-ийн тооллого гэмтвэл доорх хуудаснаас илрүүлэх зам үлдэнэ.
            }

            try
            {
                foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)))
                {
                    var sheet = (ViewSheet)e;
                    foreach (Parameter p in sheet.Parameters)
                    {
                        if (p == null || p.IsReadOnly || p.StorageType != StorageType.String)
                            continue;
                        Definition d = p.Definition;
                        if (d == null || string.IsNullOrWhiteSpace(d.Name))
                            continue;
                        // Built-in параметр (Sheet Number/Name/Issue Date г.м.) оруулахгүй.
                        var idef = d as InternalDefinition;
                        if (idef != null && idef.BuiltInParameter != BuiltInParameter.INVALID)
                            continue;

                        DiscoveredParam dp = AddParam(map, d.Name);
                        string val = p.AsString();
                        if (!string.IsNullOrWhiteSpace(val) && !dp.Suggestions.Contains(val))
                            dp.Suggestions.Add(val);
                    }
                }
            }
            catch
            {
                // Хуудас уншихад алдаа — цуглуулсан хэсгээ буцаана.
            }

            List<DiscoveredParam> list = map.Values.ToList();
            foreach (DiscoveredParam dp in list)
                dp.Suggestions.Sort(StringComparer.CurrentCultureIgnoreCase);
            list.Sort((a, b) =>
            {
                int ra = KnownRank(a.Name), rb = KnownRank(b.Name);
                if (ra != rb)
                    return ra.CompareTo(rb);
                return string.Compare(a.Name, b.Name, StringComparison.CurrentCultureIgnoreCase);
            });
            return list;
        }

        private static DiscoveredParam AddParam(Dictionary<string, DiscoveredParam> map, string name)
        {
            if (!map.TryGetValue(name, out DiscoveredParam dp))
            {
                dp = new DiscoveredParam
                {
                    Name = name,
                    Suggestions = new List<string>(),
                    DefaultIncludeInNumber = KnownRank(name) < 3,
                };
                map[name] = dp;
            }
            return dp;
        }

        private static bool IsTextDefinition(Definition def)
        {
            try
            {
                return def.GetDataType() == SpecTypeId.String.Text;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Мэдэгдэж буй нэрлэлтийн параметрүүдийг тэргүүнд эрэмбэлэх зэрэглэл.</summary>
        private static int KnownRank(string name)
        {
            string n = Normalize(name);
            if (n.Contains("classification")) return 0;
            if (n.Contains("subdiscipline")) return 1;
            if (n.Contains("typedesignator")) return 2;
            return 3;
        }

        private static string Normalize(string s)
        {
            if (string.IsNullOrEmpty(s))
                return string.Empty;
            var sb = new StringBuilder(s.Length);
            foreach (char ch in s)
                if (char.IsLetterOrDigit(ch))
                    sb.Append(char.ToLowerInvariant(ch));
            return sb.ToString();
        }

        private static List<TitleBlockOption> CollectTitleBlocks(Document doc)
        {
            var list = new List<TitleBlockOption>();
            try
            {
                foreach (Element e in new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_TitleBlocks)
                    .WhereElementIsElementType())
                {
                    var sym = e as FamilySymbol;
                    if (sym == null)
                        continue;
                    list.Add(new TitleBlockOption
                    {
                        Label = sym.FamilyName + " : " + sym.Name,
                        Id = sym.Id,
                    });
                }
            }
            catch
            {
                // Гарчгийн хүснэгт уншихад алдаа — хоосон жагсаалтаар үргэлжилнэ.
            }
            list.Sort((a, b) => string.Compare(a.Label, b.Label, StringComparison.CurrentCultureIgnoreCase));
            return list;
        }
    }

    /// <summary>Илрүүлсэн хуудасны текст параметр (нэр + combo-ийн санал + анхны сонголт).</summary>
    public sealed class DiscoveredParam
    {
        public string Name { get; set; }
        public List<string> Suggestions { get; set; }
        public bool DefaultIncludeInNumber { get; set; }
    }

    /// <summary>Гарчгийн хүснэгтийн сонголт (харагдах нэр + type ElementId).</summary>
    public sealed class TitleBlockOption
    {
        public string Label { get; set; }
        public ElementId Id { get; set; }
        public override string ToString() => Label;
    }
}
