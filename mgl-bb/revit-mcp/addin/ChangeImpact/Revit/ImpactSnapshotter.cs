using System;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Revit элементийг ХУУЛСАН `ImpactNode` болгоно (устсан ч дараа нь харагдахын тулд).
    ///
    /// ⚠️ Revit API — зөвхөн үндсэн thread дээр (`SmartExecutor`).  ХЭЗЭЭ Ч `DocumentChanged` handler дотор биш
    /// (тэнд зөвхөн id авна).  Уншилт бүр try/catch: нэг элементийн алдаа бүхэл шинжилгээг унагахгүй.
    /// </summary>
    internal static class ImpactSnapshotter
    {
        internal static ImpactNode Read(Element e)
        {
            var n = new ImpactNode { Id = e.Id.Value };
            try { n.Uid = e.UniqueId; } catch (Exception) { }
            try
            {
                if (e.Category != null)
                {
                    n.Category = e.Category.Name;
                    n.CategoryId = e.Category.Id.Value;
                }
            }
            catch (Exception) { }
            n.Kind = Classify(e);
            n.Name = NameOf(e);
            n.Detail = DetailOf(e, n.Kind);

            try { ElementId ov = e.OwnerViewId; if (ov != null && ov != ElementId.InvalidElementId) n.OwnerViewId = ov.Value; } catch (Exception) { }
            try { n.ViewSpecific = e.ViewSpecific; } catch (Exception) { }
            // Viewport нь хуудсанд харьяалагдана: `SheetId` нь баримтжуулсан (OwnerViewId-д найдахгүйгээр).
            try
            {
                var vp = e as Viewport;
                if (vp != null && vp.SheetId != null && vp.SheetId != ElementId.InvalidElementId)
                {
                    n.OwnerViewId = vp.SheetId.Value;
                    n.ViewSpecific = true;
                }
            }
            catch (Exception) { }
            try { ElementId t = e.GetTypeId(); if (t != null && t != ElementId.InvalidElementId) n.TypeId = t.Value; } catch (Exception) { }
            try { ElementId lv = e.LevelId; if (lv != null && lv != ElementId.InvalidElementId) n.LevelId = lv.Value; } catch (Exception) { }
            try
            {
                var fi = e as FamilyInstance;
                if (fi != null && fi.Host != null) n.HostId = fi.Host.Id.Value;
            }
            catch (Exception) { }
            return n;
        }

        internal static ImpactNodeKind Classify(Element e)
        {
            // Дараалал чухал: ViewSheet/ViewSchedule нь View-ээс удамшсан.
            if (e is ViewSheet) return ImpactNodeKind.Sheet;
            if (e is ViewSchedule) return ImpactNodeKind.Schedule;
            if (e is View) return ImpactNodeKind.View;
            if (e is Viewport || e is ScheduleSheetInstance) return ImpactNodeKind.Placement;
            if (e is IndependentTag || e is SpatialElementTag) return ImpactNodeKind.Tag;
            if (e is Dimension) return ImpactNodeKind.Dimension;
            if (e is SpatialElement) return ImpactNodeKind.Room;
            if (e is Level) return ImpactNodeKind.Level;
            if (e is RevitLinkInstance) return ImpactNodeKind.Link;
            if (e is Group) return ImpactNodeKind.Group;
            if (e is Autodesk.Revit.DB.ProjectInfo || e is Revision || e is Phase || e is ParameterFilterElement
                || e is Material || e is FillPatternElement || e is LinePatternElement || e is GraphicsStyle)
                return ImpactNodeKind.Global;
            if (e is ElementType) return ImpactNodeKind.Type;
            return ImpactNodeKind.Element;
        }

        private static string NameOf(Element e)
        {
            try
            {
                var sheet = e as ViewSheet;
                if (sheet != null) return (sheet.SheetNumber + " " + sheet.Name).Trim();

                if (e is SpatialElement)
                {
                    string num = null;
                    try { Parameter p = e.get_Parameter(BuiltInParameter.ROOM_NUMBER); if (p != null) num = p.AsString(); } catch (Exception) { }
                    return ((num ?? "") + " " + e.Name).Trim();
                }

                var type = e as ElementType;
                if (type != null)
                {
                    string fam = null;
                    try { fam = type.FamilyName; } catch (Exception) { }
                    return string.IsNullOrEmpty(fam) ? type.Name : fam + " : " + type.Name;
                }

                var fi = e as FamilyInstance;
                if (fi != null && fi.Symbol != null)
                {
                    string fam = null;
                    try { fam = fi.Symbol.FamilyName; } catch (Exception) { }
                    return string.IsNullOrEmpty(fam) ? fi.Symbol.Name : fam + " : " + fi.Symbol.Name;
                }

                string name = e.Name;
                if (!string.IsNullOrWhiteSpace(name)) return name;
                // Нэргүй элемент (хана, шал): төрлийн нэр.
                ElementId tid = e.GetTypeId();
                if (tid != null && tid != ElementId.InvalidElementId)
                {
                    Element t = e.Document.GetElement(tid);
                    if (t != null) return t.Name;
                }
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string DetailOf(Element e, ImpactNodeKind kind)
        {
            try
            {
                var sheet = e as ViewSheet;
                if (sheet != null) return "Хуудас " + sheet.SheetNumber;
                var v = e as View;
                if (v != null)
                {
                    string t = v.ViewType.ToString();
                    return v.IsTemplate ? "View template · " + t : t;
                }
                if (kind == ImpactNodeKind.Element || kind == ImpactNodeKind.Room)
                {
                    ElementId lid = e.LevelId;
                    if (lid != null && lid != ElementId.InvalidElementId)
                    {
                        Element lv = e.Document.GetElement(lid);
                        if (lv != null) return "Давхар " + lv.Name;
                    }
                }
            }
            catch (Exception) { }
            return null;
        }

        /// <summary>Хадгалагдсан `ChangeEntry` → `ImpactNode` (элемент устсан үед).</summary>
        internal static ImpactNode FromEntry(ChangeEntry c)
        {
            return new ImpactNode
            {
                Id = c.Id, Uid = c.Uid, Category = c.Category, CategoryId = c.CategoryId, Name = c.Name, Kind = c.NodeKind,
                OwnerViewId = c.OwnerViewId, HostId = c.HostId, TypeId = c.TypeId, LevelId = c.LevelId,
                ViewSpecific = c.OwnerViewId > 0, Unknown = !c.Known,
            };
        }

        internal static ChangeEntry ToEntry(ImpactNode n, ChangeKind kind)
        {
            return new ChangeEntry
            {
                Id = n.Id, Kind = kind, Uid = n.Uid, Category = n.Category, CategoryId = n.CategoryId, Name = n.Name, NodeKind = n.Kind,
                OwnerViewId = n.OwnerViewId, HostId = n.HostId, TypeId = n.TypeId, LevelId = n.LevelId, Known = !n.Unknown,
            };
        }
    }
}
