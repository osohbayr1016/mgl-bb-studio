using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.RevitSide;

namespace MglBb.Gate
{
    /// <summary>Gate: хана/хучилтын бодит өгөгдлийн хэмжилт (юу ч өөрчлөхгүй).</summary>
    internal static class GatePlates
    {
        private static string F(double v) { return v.ToString("0.##", CultureInfo.InvariantCulture); }

        public static string Probe(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            // Түвшин
            foreach (Level lv in new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.ProjectElevation).Take(60))
                sb.AppendLine("level «" + lv.Name + "» elev " + F(lv.ProjectElevation * 0.3048) + " m  id " + lv.Id.Value);
            // Ханын тэмдэг
            var walls = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Walls).OfClass(typeof(Wall)).Cast<Wall>().ToList();
            var byMark = walls.Where(w => BbGeom.Mark(w).Length > 0).GroupBy(w => BbGeom.Mark(w)).OrderBy(g => g.Key, StringComparer.Ordinal).ToList();
            sb.AppendLine("walls " + walls.Count + ", marked " + byMark.Sum(g => g.Count()) + " in " + byMark.Count + " marks");
            foreach (var g in byMark.Take(40))
            {
                int reb = 0;
                double len = 0;
                var lvls = new SortedSet<string>(StringComparer.Ordinal);
                foreach (Wall w in g)
                {
                    try { reb += RebarHostData.GetRebarHostData(w)?.GetRebarsInHost().Count ?? 0; } catch { }
                    try { len += (w.Location as LocationCurve)?.Curve.Length ?? 0; } catch { }
                    try { lvls.Add((doc.GetElement(w.LevelId) as Level)?.Name ?? "?"); } catch { }
                }
                Wall w0 = g.First();
                string dir = "";
                try { XYZ d = ((w0.Location as LocationCurve).Curve as Line)?.Direction; if (d != null) dir = "(" + F(d.X) + "," + F(d.Y) + ")"; } catch { }
                sb.AppendLine("  wall «" + g.Key + "» n " + g.Count() + " len " + F(len * 0.3048) + " m rebar " + reb + " t " + F(w0.Width * 304.8) + " mm dir " + dir + " struct " + w0.StructuralUsage + " levels " + string.Join(",", lvls.Take(6)));
            }
            // Хучилт түвшнээр
            var floors = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).OfClass(typeof(Floor)).Cast<Floor>().ToList();
            sb.AppendLine("floors " + floors.Count);
            foreach (var g in floors.GroupBy(f => f.LevelId.Value).OrderBy(g => (doc.GetElement(new ElementId(g.Key)) as Level)?.ProjectElevation ?? 0).Take(40))
            {
                Level lv = doc.GetElement(new ElementId(g.Key)) as Level;
                int reb = 0, structural = 0;
                var marks = new SortedSet<string>(StringComparer.Ordinal);
                foreach (Floor f in g)
                {
                    try { reb += RebarHostData.GetRebarHostData(f)?.GetRebarsInHost().Count ?? 0; } catch { }
                    try { if (f.get_Parameter(BuiltInParameter.FLOOR_PARAM_IS_STRUCTURAL)?.AsInteger() == 1) structural++; } catch { }
                    string m = BbGeom.Mark(f);
                    if (m.Length > 0) marks.Add(m);
                }
                sb.AppendLine("  floors @ «" + (lv?.Name ?? "?") + "» n " + g.Count() + " struct " + structural + " rebar " + reb + " marks " + string.Join(",", marks.Take(6)));
            }
            // MRA / dim / tag types
            sb.AppendLine("MRA types: " + string.Join(" | ", new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotationType)).Cast<ElementType>().Select(t => t.Name)));
            // Инженерийн харагдацууд
            foreach (string name in (kv.TryGetValue("views", out string vs) ? vs : "ЦУТГАМАЛ ХАНА ЦХ-1 АРМАТУРЧЛАЛ,ЦУТГАМАЛ ХАНА ЦХ-1 ХЭВ,4.93 ТҮВШНИЙ ХУЧИЛТЫН ДООД ҮЕИЙН АРМАТУРЧЛАЛ,4.93 ТҮВШНИЙ ХУЧИЛТЫН ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ,4.93 ТҮВШНИЙ ХУЧИЛТЫН ХЭВНИЙ БАЙГУУЛАЛТ,Detail 1730").Split(','))
            {
                View v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == name);
                if (v == null) { sb.AppendLine("view «" + name + "» —"); continue; }
                var owned = new FilteredElementCollector(doc).OwnedByView(v.Id).WhereElementIsNotElementType().ToList();
                var mras = owned.OfType<MultiReferenceAnnotation>().ToList();
                var dims = owned.OfType<Dimension>().ToList();
                var tags = owned.OfType<IndependentTag>().ToList();
                string lvl = v is ViewPlan vp && vp.GenLevel != null ? " level «" + vp.GenLevel.Name + "»" : "";
                sb.AppendLine("view «" + name + "» " + v.ViewType + " 1:" + v.Scale + lvl + " mra " + mras.Count + " dims " + dims.Count + " tags " + tags.Count + " text " + owned.OfType<TextNote>().Count());
                sb.AppendLine("   mra types: " + string.Join(", ", mras.GroupBy(m => doc.GetElement(m.GetTypeId())?.Name ?? "?").Select(x => x.Key + "×" + x.Count())));
                var mraDims = new HashSet<long>(mras.Select(m => m.DimensionId.Value));
                var mraTags = new HashSet<long>(mras.Select(m => m.TagId.Value));
                sb.AppendLine("   mra dim types: " + string.Join(", ", dims.Where(d => mraDims.Contains(d.Id.Value)).GroupBy(d => d.DimensionType?.Name ?? "?").Select(x => x.Key + "×" + x.Count())));
                sb.AppendLine("   other dims: " + string.Join(", ", dims.Where(d => !mraDims.Contains(d.Id.Value)).GroupBy(d => (d.DimensionType?.Name ?? "?") + "/" + Refs(doc, d)).Select(x => x.Key + "×" + x.Count()).Take(10)));
                sb.AppendLine("   mra tag types: " + string.Join(", ", tags.Where(t => mraTags.Contains(t.Id.Value)).GroupBy(t => TypeName(doc, t)).Select(x => x.Key + "×" + x.Count())));
                sb.AppendLine("   other tags: " + string.Join(", ", tags.Where(t => !mraTags.Contains(t.Id.Value)).GroupBy(t => TypeName(doc, t)).Select(x => x.Key + "×" + x.Count()).Take(8)));
                try
                {
                    var reb = new FilteredElementCollector(doc, v.Id).OfClass(typeof(Rebar)).Cast<Rebar>().ToList();
                    var pres = reb.Take(400).GroupBy(r => { try { return r.GetPresentationMode(v).ToString(); } catch { return "?"; } }).Select(x => x.Key + "×" + x.Count());
                    var hosts = reb.Take(400).GroupBy(r => doc.GetElement(r.GetHostId())?.Category?.Name ?? "?").Select(x => x.Key + "×" + x.Count());
                    sb.AppendLine("   rebar visible " + reb.Count + " presentation " + string.Join(", ", pres) + " hosts " + string.Join(", ", hosts));
                }
                catch (Exception ex) { sb.AppendLine("   rebar ERR " + ex.Message); }
                if (v.CropBoxActive)
                {
                    BoundingBoxXYZ cb = v.CropBox;
                    sb.AppendLine("   crop " + F((cb.Max.X - cb.Min.X) * 304.8) + " x " + F((cb.Max.Y - cb.Min.Y) * 304.8) + " depth " + F((cb.Max.Z - cb.Min.Z) * 304.8));
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Харагдац бүрийн MRA: шошгоны толгой, leader-ийн хугарал/төгсгөл, хэмжээсийн шугам, арматурын хүрээ — харагдацын (right, up) тэнхлэгт, цаасны мм.
        /// <c>views=A|B</c>, <c>try=1</c> = хугарлыг түр зөөж уншаад буцаана (API зөвшөөрөх эсэх).
        /// </summary>
        public static string MraElbows(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            bool tryMove = kv.TryGetValue("try", out string tm) && tm == "1";
            foreach (string name in (kv.TryGetValue("views", out string vs) ? vs : "4.93 ТҮВШНИЙ ХУЧИЛТЫН ДООД ҮЕИЙН АРМАТУРЧЛАЛ|4.93 ТҮВШНИЙ ХУЧИЛТЫН ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ").Split('|'))
            {
                View v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == name);
                if (v == null) { sb.AppendLine("view «" + name + "» —"); continue; }
                double sc = Math.Max(1, v.Scale);
                XYZ o = v.Origin, rt = v.RightDirection, up = v.UpDirection;
                Func<XYZ, string> P = p => "(" + F((p - o).DotProduct(rt) * 304.8 / sc) + "," + F((p - o).DotProduct(up) * 304.8 / sc) + ")";
                Func<XYZ, string> D = d => "(" + F(d.DotProduct(rt)) + "," + F(d.DotProduct(up)) + ")";
                var mras = new FilteredElementCollector(doc).OwnedByView(v.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>().ToList();
                sb.AppendLine("view «" + name + "» id " + v.Id.Value + " 1:" + v.Scale + " mra " + mras.Count + " (paper mm, right/up)");
                foreach (MultiReferenceAnnotation m in mras)
                {
                    var t = doc.GetElement(m.TagId) as IndependentTag;
                    var d = doc.GetElement(m.DimensionId) as Dimension;
                    var line = new StringBuilder("  MRA " + m.Id.Value + " «" + doc.GetElement(m.GetTypeId())?.Name + "»");
                    try
                    {
                        if (d != null)
                        {
                            Line dl = d.Curve as Line;
                            line.Append(" dim dir " + (dl != null ? D(dl.Direction) : "?") + " n " + d.NumberOfSegments);
                            if (d.NumberOfSegments == 0) line.Append(" origin " + P(d.Origin) + " val " + F((d.Value ?? 0) * 304.8));
                            else line.Append(" seg " + P(d.Segments.get_Item(0).Origin) + ".." + P(d.Segments.get_Item(d.NumberOfSegments - 1).Origin) + "=" + F((d.Segments.get_Item(0).Value ?? 0) * 304.8));
                        }
                    }
                    catch (Exception ex) { line.Append(" dimERR " + ex.Message); }
                    if (t == null) { sb.AppendLine(line + " tag —"); continue; }
                    try
                    {
                        var ids = t.GetTaggedLocalElementIds();
                        line.Append(" bars " + string.Join(",", ids.Select(id => id.Value)));
                        foreach (ElementId id in ids)
                        {
                            BoundingBoxXYZ bb = doc.GetElement(id)?.get_BoundingBox(v);
                            if (bb != null) line.Append(" bbox " + P(bb.Min) + ".." + P(bb.Max));
                        }
                    }
                    catch { }
                    line.Append(" | head " + P(t.TagHeadPosition) + " leader " + t.HasLeader);
                    try { line.Append(" " + t.LeaderEndCondition); } catch { }
                    try { BoundingBoxXYZ tb = t.get_BoundingBox(v); if (tb != null) line.Append(" text " + P(tb.Min) + ".." + P(tb.Max)); } catch { }
                    try
                    {
                        foreach (Reference rf in t.GetTaggedReferences())
                        {
                            try { line.Append(t.HasLeaderElbow(rf) ? " elbow " + P(t.GetLeaderElbow(rf)) : " noelbow"); } catch (Exception ex) { line.Append(" elbowERR " + ex.GetType().Name); }
                            try { line.Append(" end " + P(t.GetLeaderEnd(rf))); } catch (Exception ex) { line.Append(" endERR " + ex.GetType().Name); }
                            if (!tryMove) continue;
                            using (var tx = new Transaction(doc, "mra elbow try"))
                            {
                                tx.Start();
                                try
                                {
                                    XYZ want = t.TagHeadPosition + rt * (5 * sc / 304.8);
                                    t.SetLeaderElbow(rf, want);
                                    doc.Regenerate();
                                    line.Append(" try→ " + P(t.GetLeaderElbow(rf)) + " want " + P(want));
                                }
                                catch (Exception ex) { line.Append(" tryERR " + ex.GetType().Name + ": " + ex.Message.Split('\n')[0]); }
                                tx.RollBack();
                            }
                        }
                    }
                    catch { }
                    line.Append(" txt «" + (t.TagText ?? "").Replace('\n', ' ').Replace('\r', ' ') + "»");
                    sb.AppendLine(line.ToString());
                }
            }
            return sb.ToString();
        }

        private static string Refs(Document doc, Dimension d)
        {
            var cats = new SortedSet<string>(StringComparer.Ordinal);
            try { foreach (Reference r in d.References) cats.Add(doc.GetElement(r.ElementId)?.Category?.Name ?? (doc.GetElement(r.ElementId)?.GetType().Name ?? "?")); } catch { }
            return string.Join("+", cats);
        }

        private static string TypeName(Document doc, Element e)
        {
            try { var t = doc.GetElement(e.GetTypeId()) as ElementType; return t == null ? "?" : t.FamilyName + " : " + t.Name; } catch { return "?"; }
        }
    }
}
