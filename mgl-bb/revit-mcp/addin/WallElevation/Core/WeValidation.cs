using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Үүсгэсэн/шинэчилсэн харагдацын Revit-ээс УНШСАН бодит төлөв.  Хүрээг харагдацын өөрийн чиглэлээр
    /// (RightDirection / UpDirection / ViewDirection) илэрхийлнэ — Revit-ийн CropBox-ийн дотоод тэнхлэгийн
    /// тэмдгээс хамаарахгүй (CloneDrawings-ийн `SectionFrame.Of`-тэй ижил арга).
    /// </summary>
    public sealed class WeViewSnapshot
    {
        public bool Exists;
        public WeV3 Center;
        public WeV3 Right;
        public WeV3 Up;
        public WeV3 ViewDirection;
        /// <summary>Хагас хэмжээ: x = өргөн/2, y = өндөр/2, z = гүн/2.</summary>
        public WeV3 Half;
        public bool CropActive;
        /// <summary>Бодит far clip гүн (зүсэх хавтгайгаас, фут); NaN = уншаагүй.  Хайчлахгүй горимд маш их утга.</summary>
        public double FarClipDepth = double.NaN;
        public long TemplateId;
        /// <summary>Хүссэн загварын id (<see cref="long.MinValue"/> = шалгахгүй / төрлийн өгөгдмөл; −1 = загваргүй).</summary>
        public long WantedTemplateId = long.MinValue;
        public string IdentityKey;
        /// <summary>Ижил түлхүүртэй харагдацын тоо (энэ харагдацыг оруулаад).</summary>
        public int SameKeyCount;
    }

    public sealed class WeValidationIssue
    {
        public WeStatus Severity;
        public string Message;

        public WeValidationIssue(WeStatus severity, string message) { Severity = severity; Message = message; }
    }

    /// <summary>
    /// «Харагдац буцаж ирсэн» нь амжилт БИШ.  Энд бодитоор шалгана:
    ///   эх нь байна · зөв талаас харна · хана хүрээнд багтана · босоо хүрээ зөв · гүн хүрэлцэнэ ·
    ///   загвар хэрэглэгдсэн · таних тэмдэг байна · давхардал алга.
    /// Failed = харагдац буруу (шинээр үүсгэсэн бол устгана); Warning/RequiresReview = харагдац үлдэнэ, тайлбартай.
    /// </summary>
    public static class WallElevationValidator
    {
        public const double PointTol = 0.01;      // ≈ 3 мм
        public const double SizeTol = 0.01;

        public static List<WeValidationIssue> Check(WePlannedElevation planned, WeViewSnapshot v, bool sourceStillExists)
        {
            var issues = new List<WeValidationIssue>();
            if (planned == null || planned.Frame == null || planned.Box == null)
            {
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Төлөвлөгөөгүй харагдац"));
                return issues;
            }
            if (v == null || !v.Exists)
            {
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Харагдац олдсонгүй"));
                return issues;
            }
            if (!sourceStillExists)
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Эх хана/өрөө байхгүй болсон"));

            if (string.IsNullOrEmpty(v.IdentityKey))
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Таних тэмдэг (Extensible Storage) бичигдээгүй"));
            else if (!string.Equals(v.IdentityKey, planned.Key, StringComparison.Ordinal))
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Таних тэмдэг өөр дэлгээсийнх"));
            if (v.SameKeyCount > 1)
                issues.Add(new WeValidationIssue(WeStatus.RequiresReview, "Ижил дэлгээсийн давхардсан харагдац байна"));

            WeFrame f = planned.Frame;
            WeV3 vd = v.ViewDirection.Normalized();
            if (vd.IsZero || vd.Dot(f.ViewDirection) < 1 - WeTol.Direction)
            {
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Харагдац ханыг буруу талаас харж байна"));
                return issues;   // цаашдын хэмжилт утгагүй
            }
            if (v.Right.Normalized().Dot(f.Right) < 1 - WeTol.Direction)
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Харагдацын баруун чиглэл таарахгүй"));
            if (v.Up.Normalized().Dot(f.Up) < 1 - WeTol.Direction)
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Харагдацын дээш чиглэл босоо биш"));

            if (!v.CropActive)
                issues.Add(new WeValidationIssue(WeStatus.Warning, "Хүрээ (crop) идэвхгүй"));

            // Хана хүрээнд + гүнд багтах уу — шалгалтын цэг бүрийг харагдацын бодит хайрцгаар.
            int outside = 0;
            foreach (WeV3 p in planned.ProbePoints)
            {
                WeV3 d = p - v.Center;
                double x = d.Dot(v.Right.Normalized());
                double y = d.Dot(v.Up.Normalized());
                double z = d.Dot(vd);
                if (Math.Abs(x) > v.Half.X + PointTol || Math.Abs(y) > v.Half.Y + PointTol || Math.Abs(z) > v.Half.Z + PointTol)
                    outside++;
            }
            if (outside > 0)
                issues.Add(new WeValidationIssue(WeStatus.Failed, "Хана хүрээ/гүнд бүрэн багтсангүй (" + outside + " цэг гадна)"));

            WeV3 half = planned.Box.Half;
            if (planned.HasDeclaredCrop)
            {
                // W07: хэрэглэгчийн ТОГТООСОН хил — хэсэгчилсэн хүрээ ЗОРИУД («ханын өндрөөс бага» алдаа БИШ); харин бодит хүрээ тогтоосон хилтэй
                // таарах ёстой (эх, чиглэл, гүн, шалгалтын цэгүүд дээр хэвээр шалгагдсан).
                double cy = (v.Center - f.Origin).Dot(v.Up.Normalized());
                double actualMin = cy - v.Half.Y, actualMax = cy + v.Half.Y;
                bool loOff = !double.IsNaN(planned.CropLowerMm) && Math.Abs(actualMin - planned.Box.MinY) > SizeTol;
                bool upOff = !double.IsNaN(planned.CropUpperMm) && Math.Abs(actualMax - planned.Box.MaxY) > SizeTol;
                if (loOff || upOff)
                    issues.Add(new WeValidationIssue(WeStatus.RequiresReview, "Босоо хүрээ таны тохируулсан хилтэй таарахгүй ("
                        + WeVerticalCrop.Describe(planned.CropLowerMm, planned.CropUpperMm) + ")"));
                if (Math.Abs(v.Half.X - half.X) > SizeTol)
                    issues.Add(new WeValidationIssue(WeStatus.Warning, "Хүрээний хэмжээ төлөвлөснөөс ялгаатай"));
            }
            else
            {
                if (v.Half.Y * 2 < planned.FaceHeight - SizeTol)
                    issues.Add(new WeValidationIssue(WeStatus.Failed, "Босоо хүрээ ханын өндрөөс бага"));
                if (Math.Abs(v.Half.X - half.X) > SizeTol || Math.Abs(v.Half.Y - half.Y) > SizeTol)
                    issues.Add(new WeValidationIssue(WeStatus.Warning, "Хүрээний хэмжээ төлөвлөснөөс ялгаатай"));
            }
            if (v.Half.Z * 2 < planned.Box.Depth - SizeTol)
                issues.Add(new WeValidationIssue(WeStatus.Warning, "Харах гүн төлөвлөснөөс бага"));

            // Хэт гүн far clip: ханын нүхээр (хаалга, цонх) цаадах бүх юм зурагт орно — «аюулгүй гүн» биш.
            if (!double.IsNaN(v.FarClipDepth) && v.FarClipDepth > planned.Box.Depth * 1.5 + 1.0)
                issues.Add(new WeValidationIssue(WeStatus.Warning, "Харах гүн (far clip) хэт их — нүхээр цаадах юм харагдана"));

            if (v.WantedTemplateId != long.MinValue && v.TemplateId != v.WantedTemplateId)
                issues.Add(new WeValidationIssue(WeStatus.Warning, "Сонгосон харагдацын загвар (view template) хэрэглэгдсэнгүй"));

            return issues;
        }

        public static WeStatus Worst(IEnumerable<WeValidationIssue> issues, WeStatus start)
        {
            WeStatus s = start;
            foreach (WeValidationIssue i in issues) if (i.Severity > s) s = i.Severity;
            return s;
        }
    }
}
