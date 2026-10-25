using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дэлгээс дээр тухайн гишүүнд хамааралгүй огтлол / хэсэглэлийн тэмдгийг (OST_Viewers — хөрш дамнуруу, баганын огтлол, бусад callout)
    /// ЭНЭ харагдацад нууна (ББ инженерийн шаардлага 2026-10-23).  «Өөрийнх» = гишүүний харагдац, ижил хуудсанд байрласан харагдац, эсвэл нэрэнд
    /// гишүүний тэмдэг бүтэн үгээр (<see cref="BbMarkNames.IsOwn"/>).  Тэмдгийн нэр = харагдацын нэр (<see cref="BbPlates.TidyMarks"/>-д хэмжсэн).
    /// Revit-ийн «Reveal Hidden Elements»-ээр буцааж харуулна.  Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbMarkTidy
    {
        public static List<string> ElevPatterns(BbStandard std)
        {
            return new List<string> { std.Beam.ElevNamePattern, std.BeamAux.ElevNamePattern, std.Column.ElevNamePattern, std.Plate.WallFormName, std.Plate.WallRebarName }
                .Where(p => !string.IsNullOrEmpty(p)).Distinct().OrderByDescending(p => p.Length).ToList();   // «ТУСЛАХ ДАМНУРУУ …» нь «ДАМНУРУУ …»-аас өмнө
        }

        /// <summary>Дэлгээсийн гишүүний тэмдэг: нэрээр (стандартын загвар), эс бөгөөс гишүүнийг таних замаар.  Дэлгээс биш бол null.</summary>
        public static string ElevationMark(Document doc, View v, BbStandard std)
        {
            if (!(v is ViewSection) || v.IsTemplate) return null;
            string m = BbMarkNames.MarkOf(v.Name, ElevPatterns(std));
            if (m != null) return m;
            string role = BbPlates.Classify(doc, v, std.Plate, out List<Element> _, out string pmark);
            if (role != null) return role == BbPlates.RoleForm || role == BbPlates.RoleRebar ? pmark : null;
            BbViewSample smp = BbLearner.Classify(doc, v);
            return smp != null && !smp.IsSection && smp.Mark.Length > 0 ? smp.Mark : null;
        }

        /// <summary>
        /// Гишүүний хуудсанд байрласан харагдацын нэрс: дэлгээс өөрөө байрласан хуудас + нэрэнд нь тэмдэг байгаа, эсвэл тэмдэгтэй харагдац агуулсан
        /// хуудас (ЖИШЭЭ-2: «ЦХ-6 ХЭВ» хуудасгүй, түүний огтлол «Detail 1757» нь ЦХ-6-ийн хэсгийн дэлгээстэй 6-16-д).
        /// </summary>
        public static HashSet<string> SheetMates(Document doc, View elev, string mark)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            string no = elev.get_Parameter(BuiltInParameter.VIEWER_SHEET_NUMBER)?.AsString();
            foreach (ViewSheet sheet in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                var placed = sheet.GetAllPlacedViews().Select(id => doc.GetElement(id)?.Name).Where(n => !string.IsNullOrEmpty(n)).ToList();
                bool mine = sheet.SheetNumber == no
                    || (!string.IsNullOrEmpty(mark) && (BbNames.IndexOfMark(sheet.Name ?? "", mark) >= 0 || placed.Any(n => BbNames.IndexOfMark(n, mark) >= 0)));
                if (mine) names.UnionWith(placed);
            }
            return names;
        }

        /// <summary>Дэлгээс <paramref name="elev"/>-д харагдах, гишүүн <paramref name="mark"/>-д хамааралгүй тэмдгийг нууна.  Буцаах: нуусан тоо.</summary>
        public static int HideForeign(Document doc, View elev, string mark, ICollection<string> ownNames)
        {
            var own = new HashSet<string>(ownNames ?? new string[0], StringComparer.Ordinal);
            own.UnionWith(SheetMates(doc, elev, mark));
            own.Add(elev.Name);
            var hide = new List<ElementId>();
            foreach (Element e in new FilteredElementCollector(doc, elev.Id).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType())
            {
                try
                {
                    if (!BbMarkNames.IsOwn(e.Name, mark, own) && e.CanBeHidden(elev)) hide.Add(e.Id);
                }
                catch { }
            }
            if (hide.Count == 0) return 0;
            try { elev.HideElements(hide); return hide.Count; } catch { return 0; }
        }

        /// <summary>
        /// Гишүүн <paramref name="mark"/>-ийн шинэ харагдацын тэмдгийг төслийн БУСАД гишүүний (нэрээр танигдсан) дэлгээсэд нууна — өмнө нь үүсгэсэн
        /// дэлгээсэд дараа үүсгэсэн огтлолын тэмдэг гарч ирэхгүйн тулд.  Харагдах эсэхийг шалгахгүй (харагдацыг дахин тооцох нь удаан); нуусан тэмдэг харагдахгүй л үлдэнэ.
        /// </summary>
        public static int HideInOthers(Document doc, string mark, IEnumerable<View> newViews, BbStandard std)
        {
            var names = new HashSet<string>(newViews.Select(v => v.Name), StringComparer.Ordinal);
            var marks = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType().Where(e => names.Contains(e.Name ?? "")).ToList();
            if (marks.Count == 0) return 0;
            List<string> patterns = ElevPatterns(std);
            int n = 0;
            foreach (ViewSection v in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>())
            {
                if (v.IsTemplate || names.Contains(v.Name)) continue;
                string other = BbMarkNames.MarkOf(v.Name, patterns);
                if (other == null || other == mark) continue;
                var can = marks.Where(e => { try { return e.CanBeHidden(v) && !e.IsHidden(v); } catch { return false; } }).Select(e => e.Id).ToList();
                if (can.Count == 0) continue;
                try { v.HideElements(can); n += can.Count; } catch { }
            }
            return n;
        }
    }
}
