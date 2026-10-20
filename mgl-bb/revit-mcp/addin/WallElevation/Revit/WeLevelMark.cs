using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Түвшний тэмдэг «8,00 / ▼ Давхар 3» дэлгээсийн БАРУУН талд (жишээ хуудас 206A-G).
    /// ХЭМЖСЭН (GATEWAY, 2026-10-07): загварын ГАНЦ түвшний төрөл «Хучилтын түвшин + БА»-д толгойн тэмдэг (Symbol) оноогоогүй — түвшний
    /// шугам толгойгүй зурагдана.  Төрлийг солих нь БҮХ зурагт нөлөөлөх тул хөндөхгүй; оронд нь түвшний шугамын баруун үзүүрт тэмдэг
    /// бичнэ — дэлгээсийн өөрийн элемент (WeAnnoStore), дахин ажиллуулахад солигдоно.  Түвшний төрөлд толгой байвал Revit өөрөө зурдаг
    /// тул ЗУРАХГҮЙ.
    /// ⚠️ ХЭМЖСЭН: detail шугам, дүүргэлт нь дэлгээсийн CROP-оор тасардаг (тэмдэг crop-оос гадна — харагдаагүй); зөвхөн бичвэр (annotation)
    /// annotation crop хүртэл харагдана.  Тиймээс тэмдэг БҮХЭЛДЭЭ бичвэр: өндөр, «▼» (Arial — оффисын фонтод тэмдэгт алга), доогуур
    /// зураастай нэр (зураас = жишээ хуудасны тэмдгийн хэвтээ шугам).
    /// </summary>
    internal static class WeLevelMark
    {
        public const string TextTypeName = "MGL — Түвшний бичвэр";
        public const string SymbolTypeName = "MGL — Түвшний тэмдэг ▼";
        private const double TextMm = 2.5;

        /// <summary>Түвшний төрөлд толгойн тэмдэг оноосон уу (Revit өөрөө зурна).</summary>
        public static bool HasHead(Document doc, Level l)
        {
            try
            {
                var t = doc.GetElement(l.GetTypeId()) as LevelType;
                Parameter p = t != null ? t.get_Parameter(BuiltInParameter.LEVEL_HEAD_TAG) : null;
                return p != null && p.AsElementId() != ElementId.InvalidElementId && doc.GetElement(p.AsElementId()) != null;
            }
            catch { return false; }
        }

        /// <summary>«8,00», «-3,50», «0,00» — метр, хоёр орон, таслалтай (жишээ хуудас, монгол бичлэг).</summary>
        public static string Value(double feet)
        {
            double m = Math.Round(feet * 0.3048, 2);
            if (Math.Abs(m) < 0.005) m = 0;
            return m.ToString("0.00", CultureInfo.InvariantCulture).Replace('.', ',');
        }

        /// <summary>
        /// Тэмдгийг бичнэ: <paramref name="x"/> = дэлгээсийн дотоод X (түвшний шугамын баруун үзүүр), түвшний өндөр <paramref name="y"/> (дотоод).
        /// Бүтээсэн элемент <paramref name="ids"/>-д.
        /// </summary>
        public static void Draw(Document doc, View v, WeFrame f, Level l, double x, double y, IWeUnits u, List<ElementId> ids)
        {
            double scale = Math.Max(1, v.Scale);
            Func<double, double> paper = mm => u.MmToInternal(mm * scale);
            Func<double, double, XYZ> pt = (lx, ly) => OnPlane(v, f.ToWorld(lx, ly, 0).ToXyz());
            ElementId text = TextType(doc, TextTypeName, null);
            ElementId sym = TextType(doc, SymbolTypeName, "Arial");
            if (text == ElementId.InvalidElementId) return;
            var opt = new TextNoteOptions(text) { HorizontalAlignment = HorizontalTextAlignment.Left, VerticalAlignment = VerticalTextAlignment.Bottom };
            try
            {
                // Өндөр — тэмдгийн дээр.
                ids.Add(TextNote.Create(doc, v.Id, pt(x + paper(0.5), y + paper(TextMm + 1.6)), Value(WeAnnoSourceReader.LevelZ(l)), opt).Id);
                // ▼ — шугам дээр.
                if (sym != ElementId.InvalidElementId)
                {
                    var so = new TextNoteOptions(sym) { HorizontalAlignment = HorizontalTextAlignment.Left, VerticalAlignment = VerticalTextAlignment.Bottom };
                    ids.Add(TextNote.Create(doc, v.Id, pt(x + paper(0.3), y + paper(0.3)), "▼", so).Id);
                }
                // Нэр — доогуур зураастай (зураас = тэмдгийн хэвтээ шугам).
                TextNote name = TextNote.Create(doc, v.Id, pt(x + paper(3.8), y + paper(0.6)), l.Name, opt);
                try
                {
                    FormattedText ft = name.GetFormattedText();
                    ft.SetUnderlineStatus(true);
                    name.SetFormattedText(ft);
                }
                catch { }
                ids.Add(name.Id);
            }
            catch (Exception ex) { WeLog.Info("tidy", v.Name + ": түвшний тэмдэг «" + l.Name + "» — " + ex.Message); }
        }

        /// <summary>2.5 мм-ийн тунгалаг дэвсгэртэй бичвэрийн төрөл (оффисын өгөгдмөлөөс хувилна; <paramref name="font"/> null = тэр фонт).</summary>
        private static ElementId TextType(Document doc, string name, string font)
        {
            try
            {
                List<TextNoteType> all = new FilteredElementCollector(doc).OfClass(typeof(TextNoteType)).Cast<TextNoteType>().ToList();
                TextNoteType t = all.FirstOrDefault(x => x.Name == name);
                if (t != null) return t.Id;
                var baseType = doc.GetElement(doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType)) as TextNoteType ?? all.FirstOrDefault();
                if (baseType == null) return ElementId.InvalidElementId;
                t = (TextNoteType)baseType.Duplicate(name);
                Set(t, BuiltInParameter.TEXT_SIZE, TextMm / 304.8);
                Set(t, BuiltInParameter.TEXT_BACKGROUND, 1);   // тунгалаг — шугамыг дарахгүй
                if (font != null) Set(t, BuiltInParameter.TEXT_FONT, font);
                return t.Id;
            }
            catch (Exception ex)
            {
                WeLog.Info("tidy", "түвшний бичвэрийн төрөл — " + ex.Message);
                return ElementId.InvalidElementId;
            }
        }

        private static void Set(Element e, BuiltInParameter bip, object value)
        {
            try
            {
                Parameter p = e.get_Parameter(bip);
                if (p == null || p.IsReadOnly) return;
                if (value is double d) p.Set(d);
                else if (value is int i) p.Set(i);
                else if (value is string s) p.Set(s);
            }
            catch { }
        }

        private static XYZ OnPlane(View v, XYZ p)
        {
            XYZ n = v.ViewDirection;
            return p - n * (p - v.Origin).DotProduct(n);
        }
    }
}
