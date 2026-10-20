using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.Ui.Core
{
    /// <summary>Яагаад хэрэгсэл ОДОО нээгдэх боломжгүй (хатуу саад).</summary>
    public enum ToolBlock
    {
        None = 0,
        NoDocument = 1,
        FamilyDocument = 2,
        UnsupportedView = 3,
        TemplateView = 4,
        /// <summary>Энэ Revit хувилбарт ЭМХЭТГЭГДЭЭГҮЙ (R24).</summary>
        NotInThisBuild = 5,
        /// <summary>Өөр команд posted/ажиллаж байна.</summary>
        Busy = 6,
    }

    /// <summary>Нээж болно, гэхдээ хэрэгсэл ӨӨРӨӨ эхэлж нэвтрэх/сонгох цонх гаргана (зөөлөн).</summary>
    public enum ToolSetup
    {
        None = 0,
        SignIn = 1,
        LicensePending = 2,
        ErpProject = 3,
    }

    /// <summary>Хэрэгслийн нөхцөл шалгах ГАНЦ агшин зуурын мэдээлэл — Revit-ээс нэг удаа, хямдаар уншина.</summary>
    public sealed class ToolContext
    {
        public bool HasDocument;
        public bool IsFamilyDocument;
        public ToolViewKind ViewKind;
        public bool ViewIsTemplate;
        public ToolLicenseState License;
        public bool ErpProjectSelected;
        /// <summary>`UIApplication.CanPostCommand` талаас өөр команд дараалалд орсон.</summary>
        public bool CommandBusy;
        /// <summary>Одоо ажиллаж буй build (R24 → All, R25+ → Net8Plus).</summary>
        public ToolBuild RunningBuild = ToolBuild.Net8Plus;
    }

    public sealed class ToolAvailabilityResult
    {
        public ToolBlock Block;
        public ToolSetup Setup;
        public string Reason;
        public string Resolution;

        /// <summary>Хатуу саадгүй — «Нээх» боломжтой (зөөлөн сануулга байж болно).</summary>
        public bool CanLaunch { get { return Block == ToolBlock.None; } }
    }

    public static class ToolAvailability
    {
        /// <summary>Хэрэгслийг энэ build хамгаалж эмхэтгэсэн эсэх.</summary>
        public static bool IsInBuild(ToolMeta t, ToolBuild running)
        {
            if (t == null) return false;
            return t.Build == ToolBuild.All || running == ToolBuild.Net8Plus;
        }

        public static ToolAvailabilityResult Evaluate(ToolMeta t, ToolContext c)
        {
            if (t == null) throw new ArgumentNullException("t");
            if (c == null) c = new ToolContext();

            // 1. Энэ хувилбарт огт байхгүй
            if (!IsInBuild(t, c.RunningBuild))
                return Blocked(ToolBlock.NotInThisBuild,
                    "Энэ Revit хувилбарт байхгүй.",
                    "Revit 2025 буюу түүнээс дээш хувилбар шаардлагатай — энэ хэрэгсэл Revit 2024-д эмхэтгэгдээгүй.");

            // 2. Өөр команд дараалалд орсон
            if (c.CommandBusy)
                return Blocked(ToolBlock.Busy,
                    "Өөр команд дараалалд орсон байна.",
                    "Тэр командаа дуусгаад (эсвэл Esc дараад) дахин оролдоно уу.");

            // 3. Баримт
            if (t.RequiresProjectDocument)
            {
                if (!c.HasDocument)
                    return Blocked(ToolBlock.NoDocument,
                        "Нээлттэй төслийн файл алга.",
                        "Revit дээр төслийн (.rvt) файлаа нээнэ үү.");
                if (c.IsFamilyDocument)
                    return Blocked(ToolBlock.FamilyDocument,
                        "Family (.rfa) засварлаж байна.",
                        "Төслийн файл руугаа шилжинэ үү — энэ хэрэгсэл зөвхөн төслийн файл дээр ажиллана.");
            }

            // 4. Харагдац
            if (t.AllowedViews != ToolViews.Any && c.HasDocument && !c.IsFamilyDocument)
            {
                if (!ViewAllowed(t.AllowedViews, c.ViewKind))
                    return Blocked(ToolBlock.UnsupportedView,
                        "Идэвхтэй харагдац (" + ViewKindName(c.ViewKind) + ") энэ хэрэгсэлд тохирохгүй.",
                        DescribeViews(t.AllowedViews) + " нээгээд дахин оролдоно уу.");
                if (t.RejectTemplateView && c.ViewIsTemplate)
                    return Blocked(ToolBlock.TemplateView,
                        "Идэвхтэй харагдац нь харагдацын загвар (view template) байна.",
                        "Загвар биш, жинхэнэ харагдац нээгээд дахин оролдоно уу.");
            }

            // 5. Зөөлөн нөхцөл — нээж болно, хэрэгсэл өөрөө цонх гаргана
            var r = new ToolAvailabilityResult { Block = ToolBlock.None, Setup = ToolSetup.None };
            if (t.NeedsLicense)
            {
                if (c.License == ToolLicenseState.SignInRequired)
                {
                    r.Setup = ToolSetup.SignIn;
                    r.Reason = "Нэвтрээгүй байна.";
                    r.Resolution = "Нээхэд нэвтрэх цонх өөрөө гарна. Урьдчилан «Бүртгэл, эрх»-ээр нэвтэрч болно.";
                    return r;
                }
                if (c.License == ToolLicenseState.Pending)
                {
                    r.Setup = ToolSetup.LicensePending;
                    r.Reason = "Энэ компьютер admin-ы зөвшөөрөл хүлээж байна.";
                    r.Resolution = "Системийн админд «Бүртгэл, эрх» цонхны «Компьютерын код»-оо хэлж зөвшөөрүүлнэ үү.";
                    return r;
                }
            }
            if (t.RequiresErpProject && !c.ErpProjectSelected)
            {
                r.Setup = ToolSetup.ErpProject;
                r.Reason = "ERP төсөл сонгоогүй байна.";
                r.Resolution = "Нээхэд тохиргооны цонх өөрөө гарна — «Тохиргоо»-оос ажиллах төслөө сонгоно.";
                return r;
            }
            return r;
        }

        private static ToolAvailabilityResult Blocked(ToolBlock b, string reason, string resolution)
        {
            return new ToolAvailabilityResult { Block = b, Reason = reason, Resolution = resolution };
        }

        public static bool ViewAllowed(ToolViews allowed, ToolViewKind kind)
        {
            if (allowed == ToolViews.Any) return true;
            ToolViews flag;
            switch (kind)
            {
                case ToolViewKind.Plan: flag = ToolViews.Plan; break;
                case ToolViewKind.Section: flag = ToolViews.Section; break;
                case ToolViewKind.Elevation: flag = ToolViews.Elevation; break;
                case ToolViewKind.Detail: flag = ToolViews.Detail; break;
                case ToolViewKind.ThreeD: flag = ToolViews.ThreeD; break;
                case ToolViewKind.Sheet: flag = ToolViews.Sheet; break;
                case ToolViewKind.Schedule: flag = ToolViews.Schedule; break;
                case ToolViewKind.Drafting: flag = ToolViews.Drafting; break;
                case ToolViewKind.Other: flag = ToolViews.Other; break;
                default: return false;   // None — идэвхтэй харагдац мэдэгдэхгүй
            }
            return (allowed & flag) != 0;
        }

        public static string ViewKindName(ToolViewKind k)
        {
            switch (k)
            {
                case ToolViewKind.Plan: return "план";
                case ToolViewKind.Section: return "зүсэлт";
                case ToolViewKind.Elevation: return "фасад";
                case ToolViewKind.Detail: return "detail";
                case ToolViewKind.ThreeD: return "3D";
                case ToolViewKind.Sheet: return "хуудас";
                case ToolViewKind.Schedule: return "хүснэгт";
                case ToolViewKind.Drafting: return "draft харагдац";
                case ToolViewKind.Other: return "бусад харагдац";
                default: return "харагдац алга";
            }
        }

        /// <summary>«План, зүсэлт, фасад эсвэл detail харагдац» гэх мэт.</summary>
        public static string DescribeViews(ToolViews v)
        {
            var parts = new List<string>();
            if ((v & ToolViews.Plan) != 0) parts.Add("план");
            if ((v & ToolViews.Section) != 0) parts.Add("зүсэлт");
            if ((v & ToolViews.Elevation) != 0) parts.Add("фасад");
            if ((v & ToolViews.Detail) != 0) parts.Add("detail");
            if ((v & ToolViews.ThreeD) != 0) parts.Add("3D");
            if ((v & ToolViews.Sheet) != 0) parts.Add("хуудас");
            if ((v & ToolViews.Schedule) != 0) parts.Add("хүснэгт");
            if ((v & ToolViews.Drafting) != 0) parts.Add("draft");
            if (parts.Count == 0) return "Тохирох харагдац";
            var sb = new StringBuilder();
            for (int i = 0; i < parts.Count; i++)
            {
                if (i > 0) sb.Append(i == parts.Count - 1 ? " эсвэл " : ", ");
                sb.Append(parts[i]);
            }
            sb.Append(" харагдац");
            string s = sb.ToString();
            return char.ToUpperInvariant(s[0]) + s.Substring(1);
        }
    }

    /// <summary>`ToolEffects`-ийг хүнд ойлгогдох мөр болгоно (каталог, tooltip хоёрт нэг үг хэллэг).</summary>
    public static class ToolEffectsText
    {
        public static List<string> Describe(ToolMeta t)
        {
            var list = new List<string>();
            if (t == null) return list;
            ToolEffects e = t.Effects;
            if ((e & ToolEffects.ReadsModel) != 0) list.Add("Загварыг уншина");
            if ((e & ToolEffects.ChangesModel) != 0) list.Add("Загварыг ӨӨРЧИЛНӨ");
            if ((e & ToolEffects.TemporaryModelChanges) != 0) list.Add("Загварт ТҮР өөрчлөлт хийж, буцаана");
            if ((e & ToolEffects.CreatesFiles) != 0) list.Add("Файл үүсгэнэ");
            if ((e & ToolEffects.SendsToErp) != 0) list.Add("ERP руу илгээнэ");
            if ((e & ToolEffects.UpdatesLocalState) != 0) list.Add("Энэ компьютерт түүх/сонголт хадгална");
            if (list.Count == 0) list.Add("Загварт хүрэхгүй, юу ч илгээхгүй");
            return list;
        }
    }
}
