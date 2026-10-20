using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// TAG / ШОШГО.  Энэ харагдацад аль хэдийн tag-тай элементийг ДАХИН tag-лахгүй
    /// (хэрэглэгчийн гараар тавьсныг ч, өмнөх автоматыг ч).  Байрлал:
    ///   • хаалга — хаалганы «нүүр» талд, хананаас 4 мм (цаас);
    ///   • цонх — гадна талд (гадна хана бол барилгын гадна), хананаас 4 мм;
    ///   • хана — хананы гадна талд 3 мм;
    ///   • багана — диагональ дээш-баруун (тэнхлэгийн шугамаас зайлсхийнэ);
    ///   • дам нуруу — дундаж цэгээс 2.5 мм хажуу, дам нурууны чиглэлээр;
    ///   • өрөө — өрөөний байршлын цэг.
    /// Tag family ачаалаагүй ангиллыг алгасаж тайланд хэлнэ.
    /// </summary>
    /// <summary>Tag-лах элемент — хостын эсвэл link-ийн.</summary>
    internal sealed class TagCand
    {
        public Element E;
        public LinkSrc Src;
        public string K;

        public TagCand(Element e, LinkSrc src)
        {
            E = e;
            Src = src;
            K = Lk.K(src, e.Id);
        }
    }

    internal static class AaTags
    {
        public static readonly string[] Keys = { "doors", "windows", "rooms", "walls", "columns", "framing" };

        public static string Label(string key)
        {
            switch (key)
            {
                case "doors": return "Хаалга";
                case "windows": return "Цонх";
                case "rooms": return "Өрөө";
                case "walls": return "Хана";
                case "columns": return "Багана";
                default: return "Дам нуруу";
            }
        }

        public static BuiltInCategory TagCategory(string key)
        {
            switch (key)
            {
                case "doors": return BuiltInCategory.OST_DoorTags;
                case "windows": return BuiltInCategory.OST_WindowTags;
                case "rooms": return BuiltInCategory.OST_RoomTags;
                case "walls": return BuiltInCategory.OST_WallTags;
                case "columns": return BuiltInCategory.OST_StructuralColumnTags;
                default: return BuiltInCategory.OST_StructuralFramingTags;
            }
        }

        public static bool Enabled(AaOptions o, string key)
        {
            switch (key)
            {
                case "doors": return o.TagDoors;
                case "windows": return o.TagWindows;
                case "rooms": return o.TagRooms;
                case "walls": return o.TagWalls;
                case "columns": return o.TagColumns;
                default: return o.TagFraming;
            }
        }

        /// <summary>Файлын өгөгдмөл tag төрөл, байхгүй бол эхний ачаалсан.</summary>
        public static ElementId TagType(Document doc, BuiltInCategory cat)
        {
            try
            {
                ElementId def = doc.GetDefaultFamilyTypeId(new ElementId(cat));
                if (def != null && def != ElementId.InvalidElementId && doc.GetElement(def) is FamilySymbol)
                    return def;
            }
            catch
            {
                // Энэ ангилалд өгөгдмөл төрөл тохируулдаггүй.
            }
            Element first = new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsElementType().FirstElement();
            return first?.Id ?? ElementId.InvalidElementId;
        }

        /// <summary>Tag-лах элементүүд (ангилал тус бүрд) — шинжилгээ ба гүйцэтгэл хоёулаа.</summary>
        public static List<TagCand> Candidates(ViewData d, string key)
        {
            var r = new List<TagCand>();
            switch (key)
            {
                case "doors":
                case "windows":
                    if (d.Kind == AaViewKind.Plan)
                        r.AddRange(d.Openings.Where(x => x.Door == (key == "doors") && x.InScope).Select(x => new TagCand(x.Fi, x.Src)));
                    else
                        r.AddRange(d.SectionOpenings.Where(x => d.In(x.Fi, x.Src)
                            && (x.Fi.Category?.Id.Value ?? 0) == (long)(key == "doors" ? BuiltInCategory.OST_Doors : BuiltInCategory.OST_Windows))
                            .Select(x => new TagCand(x.Fi, x.Src)));
                    break;
                case "rooms":
                    if (d.Kind == AaViewKind.Plan)
                        r.AddRange(d.Rooms.Where(x => d.In(x.Room, x.Src)).Select(x => new TagCand(x.Room, x.Src)));
                    break;
                case "walls":
                    if (d.Kind == AaViewKind.Plan)
                        r.AddRange(d.Walls.Where(w => w.Dimensionable && w.InScope).Select(w => new TagCand(w.Wall, w.Src)));
                    break;
                case "columns":
                    if (d.Kind == AaViewKind.Plan)
                        r.AddRange(d.Columns.Where(c => c.InScope && (c.Fi.Category?.Id.Value ?? 0) == (long)BuiltInCategory.OST_StructuralColumns).Select(c => new TagCand(c.Fi, c.Src)));
                    break;
                default:
                    if (d.Kind == AaViewKind.Plan)
                        r.AddRange(d.Framing.Where(x => d.In(x.Fi, x.Src)).Select(x => new TagCand(x.Fi, x.Src)));
                    break;
            }
            return r;
        }

        public static bool IsTagged(ViewData d, string key, TagCand c)
            => key == "rooms" ? d.RoomTagged.Contains(c.K) : d.Tagged.Contains(c.K);

        public static void Run(ViewData d, AaOptions o, AaReport rep)
        {
            Document doc = d.Doc;
            foreach (string key in Keys)
            {
                if (!Enabled(o, key))
                    continue;
                List<TagCand> els = Candidates(d, key);
                if (els.Count == 0)
                    continue;
                ElementId typeId = TagType(doc, TagCategory(key));
                if (typeId == ElementId.InvalidElementId)
                {
                    rep.Note(Label(key) + "-ны tag family файлд ачаалаагүй тул tag тавиагүй (Insert → Load Family → Annotations).");
                    continue;
                }
                if (doc.GetElement(typeId) is FamilySymbol fs && !fs.IsActive)
                {
                    try { fs.Activate(); }
                    catch { }
                }
                foreach (TagCand cand in els)
                {
                    Element e = cand.E;
                    if (IsTagged(d, key, cand))
                    {
                        rep.TagsExisting++;
                        continue;
                    }
                    try
                    {
                        if (key == "rooms")
                        {
                            XYZ p = Lk.P(cand.Src, ((LocationPoint)e.Location).Point);
                            LinkElementId lid = cand.Src == null ? new LinkElementId(e.Id) : new LinkElementId(cand.Src.Inst.Id, e.Id);
                            RoomTag rt = doc.Create.NewRoomTag(lid, new UV(p.X, p.Y), d.View.Id);
                            if (rt != null)
                            {
                                try { if (rt.GetTypeId() != typeId) rt.ChangeTypeId(typeId); }
                                catch { }
                                rep.RoomTags++;
                                rep.Created.Add(rt.Id);
                                d.RoomTagged.Add(cand.K);
                            }
                            continue;
                        }
                        TagOrientation ori;
                        XYZ head = Head(d, key, cand, out ori);
                        if (head == null)
                        {
                            rep.TagsFailed++;
                            continue;
                        }
                        Reference target = Lk.R(cand.Src, new Reference(e));
                        if (target == null)
                        {
                            rep.TagsFailed++;
                            continue;
                        }
                        IndependentTag tag = IndependentTag.Create(doc, typeId, d.View.Id, target, false, ori, head);
                        if (tag != null)
                        {
                            rep.Tags++;
                            rep.Created.Add(tag.Id);
                            d.Tagged.Add(cand.K);
                        }
                    }
                    catch (Exception ex)
                    {
                        rep.TagsFailed++;
                        rep.Note(Label(key) + " tag: " + ex.Message);
                    }
                }
            }
        }

        private static XYZ Head(ViewData d, string key, TagCand cand, out TagOrientation ori)
        {
            ori = TagOrientation.Horizontal;
            Element e = cand.E;
            if (d.Kind != AaViewKind.Plan)
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null)
                    return null;
                var box = new Box();
                foreach (XYZ c in Lk.Corners(bb, cand.Src))
                    box.Add(d.F, d.ToView(c));
                // Цонх/хаалганы доор, төв дээр.
                return d.ToModel(new V2((box.MinU + box.MaxU) / 2, box.MinV - d.Feet(4)));
            }

            switch (key)
            {
                case "doors":
                case "windows":
                {
                    OpeningData od = d.Openings.FirstOrDefault(x => x.K == cand.K);
                    if (od == null)
                        return null;
                    WallData w = od.Host;
                    V2 center = w.Seg.Line.A + w.Seg.Dir * od.Pos;
                    V2 n = Lk.Vec2(od.Src, od.Fi.FacingOrientation).Normalized();
                    if (key == "windows" && w.Exp != Exposure.None && w.Exp != Exposure.Both)
                        n = w.Seg.Normal(w.Exp);
                    if (n.Length < 0.5)
                        n = w.Seg.LeftNormal;
                    // Хананы нормалиар л (налуу FacingOrientation-ыг хананд буулгана).
                    n = w.Seg.LeftNormal * (n.Dot(w.Seg.LeftNormal) >= 0 ? 1 : -1);
                    ori = Math.Abs(w.Seg.Dir.Dot(d.F.U)) >= Math.Abs(w.Seg.Dir.Dot(d.F.V)) ? TagOrientation.Horizontal : TagOrientation.Vertical;
                    return d.ToModel(center + n * (w.Seg.Half + d.Feet(4)));
                }
                case "walls":
                {
                    WallData w = d.Walls.FirstOrDefault(x => x.K == cand.K);
                    if (w == null)
                        return null;
                    V2 n = w.Exp == Exposure.Right ? -w.Seg.LeftNormal : w.Seg.LeftNormal;
                    ori = Math.Abs(w.Seg.Dir.Dot(d.F.U)) >= Math.Abs(w.Seg.Dir.Dot(d.F.V)) ? TagOrientation.Horizontal : TagOrientation.Vertical;
                    // Хананы 30%-д — дундаж цэгт дотор гинж, нүх байх магадлал өндөр.
                    return d.ToModel(w.Seg.Line.At(0.3) + n * (w.Seg.Half + d.Feet(3)));
                }
                case "columns":
                {
                    ColumnData c = d.Columns.FirstOrDefault(x => x.K == cand.K);
                    if (c == null)
                        return null;
                    V2 corner = d.F.U * c.MaxU + d.F.V * c.MaxV;
                    V2 diag = (d.F.U + d.F.V).Normalized();
                    return d.ToModel(corner + diag * d.Feet(3));
                }
                default:
                {
                    FramingData fd = d.Framing.FirstOrDefault(x => x.K == cand.K);
                    if (fd == null)
                        return null;
                    XYZ a = fd.A, b = fd.B;
                    var dir = new V2(b.X - a.X, b.Y - a.Y).Normalized();
                    XYZ m = fd.Mid;
                    V2 side = dir.Perp();
                    if (side.Dot(d.F.V) < 0 || (Math.Abs(side.Dot(d.F.V)) < 1e-6 && side.Dot(d.F.U) < 0))
                        side = -side;
                    if (Math.Abs(dir.Dot(d.F.U)) >= Dir.ParallelCos)
                        ori = TagOrientation.Horizontal;
                    else if (Math.Abs(dir.Dot(d.F.V)) >= Dir.ParallelCos)
                        ori = TagOrientation.Vertical;
                    else
                        ori = TagOrientation.AnyModelDirection;
                    return d.ToModel(new V2(m.X, m.Y) + side * d.Feet(2.5));
                }
            }
        }
    }
}
