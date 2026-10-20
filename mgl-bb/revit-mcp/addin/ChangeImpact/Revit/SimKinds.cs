using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Revit-ийн ангилал → `SimKind` (өнгө, үр дагаварын бичвэр) ба simulation-д ОРОХГҮЙ ангиллууд.
    /// ⚠️ `BuiltInCategory` нь int enum (сөрөг утгатай) — харьцуулахдаа `(long)` + `Category.Id.Value` (Revit 2024+).
    /// </summary>
    internal static class SimKinds
    {
        private static readonly Dictionary<long, SimKind> Map = Build();

        private static Dictionary<long, SimKind> Build()
        {
            var m = new Dictionary<long, SimKind>();
            Action<BuiltInCategory, SimKind> add = (c, k) => m[(long)c] = k;
            add(BuiltInCategory.OST_Walls, SimKind.Wall);
            add(BuiltInCategory.OST_Floors, SimKind.Floor);
            add(BuiltInCategory.OST_StructuralFoundation, SimKind.Foundation);
            add(BuiltInCategory.OST_Roofs, SimKind.Roof);
            add(BuiltInCategory.OST_Ceilings, SimKind.Ceiling);
            add(BuiltInCategory.OST_Doors, SimKind.Door);
            add(BuiltInCategory.OST_Windows, SimKind.Window);
            add(BuiltInCategory.OST_Columns, SimKind.Column);
            add(BuiltInCategory.OST_StructuralColumns, SimKind.Column);
            add(BuiltInCategory.OST_StructuralFraming, SimKind.Framing);
            add(BuiltInCategory.OST_Stairs, SimKind.Stair);
            add(BuiltInCategory.OST_StairsRailing, SimKind.Railing);
            add(BuiltInCategory.OST_Ramps, SimKind.Stair);
            add(BuiltInCategory.OST_Furniture, SimKind.Furniture);
            add(BuiltInCategory.OST_FurnitureSystems, SimKind.Furniture);
            add(BuiltInCategory.OST_Casework, SimKind.Furniture);
            add(BuiltInCategory.OST_PlumbingFixtures, SimKind.Equipment);
            add(BuiltInCategory.OST_MechanicalEquipment, SimKind.Equipment);
            add(BuiltInCategory.OST_ElectricalEquipment, SimKind.Equipment);
            add(BuiltInCategory.OST_ElectricalFixtures, SimKind.Equipment);
            add(BuiltInCategory.OST_SpecialityEquipment, SimKind.Equipment);
            add(BuiltInCategory.OST_DuctCurves, SimKind.Duct);
            add(BuiltInCategory.OST_FlexDuctCurves, SimKind.Duct);
            add(BuiltInCategory.OST_DuctFitting, SimKind.Fitting);
            add(BuiltInCategory.OST_DuctAccessory, SimKind.Fitting);
            add(BuiltInCategory.OST_PipeCurves, SimKind.Pipe);
            add(BuiltInCategory.OST_FlexPipeCurves, SimKind.Pipe);
            add(BuiltInCategory.OST_PipeFitting, SimKind.Fitting);
            add(BuiltInCategory.OST_PipeAccessory, SimKind.Fitting);
            add(BuiltInCategory.OST_Conduit, SimKind.Conduit);
            add(BuiltInCategory.OST_ConduitFitting, SimKind.Fitting);
            add(BuiltInCategory.OST_CableTray, SimKind.CableTray);
            add(BuiltInCategory.OST_CableTrayFitting, SimKind.Fitting);
            add(BuiltInCategory.OST_LightingFixtures, SimKind.Lighting);
            add(BuiltInCategory.OST_Topography, SimKind.Topography);
            return m;
        }

        /// <summary>Simulation-д (зөөх, орчин аль алинд) ОРОХГҮЙ ангилал: өрөө/талбай (3D бие биш), түвшин/тор, камер, шугам, линкийн instance.</summary>
        private static readonly HashSet<long> Excluded = new HashSet<long>
        {
            (long)BuiltInCategory.OST_Rooms, (long)BuiltInCategory.OST_Areas, (long)BuiltInCategory.OST_MEPSpaces,
            (long)BuiltInCategory.OST_Levels, (long)BuiltInCategory.OST_Grids, (long)BuiltInCategory.OST_Cameras,
            (long)BuiltInCategory.OST_Lines, (long)BuiltInCategory.OST_RvtLinks, (long)BuiltInCategory.OST_IOSModelGroups,
            (long)BuiltInCategory.OST_Viewers, (long)BuiltInCategory.OST_VolumeOfInterest,
        };

        internal static SimKind Of(Element e)
        {
            try
            {
                Category c = e != null ? e.Category : null;
                if (c == null) return SimKind.Other;
                SimKind k;
                return Map.TryGetValue(c.Id.Value, out k) ? k : SimKind.Other;
            }
            catch (Exception) { return SimKind.Other; }
        }

        /// <summary>3D бие (геометр) байж болох загварын элемент.  Тайлбар, 2D, түвшин/тор, өрөө, линк instance БИШ.</summary>
        internal static bool IsModelBody(Element e)
        {
            try
            {
                if (e == null || !e.IsValidObject) return false;
                Category c = e.Category;
                if (c == null) return false;
                if (c.CategoryType != CategoryType.Model) return false;
                if (Excluded.Contains(c.Id.Value)) return false;
                if (e.ViewSpecific) return false;
                // Revit-ийн дотоод (sketch, area boundary…) ангилал «<...>» нэртэй — бие БИШ; дам нурууны систем (BeamSystem) нь өөрөө геометргүй.
                // Хэмжсэн: эдгээр нь орчны нэр дэвшигчийн ~30%-ийг эзэлж, хязгаарыг (cap) дэмий иддэг байв.
                string n = c.Name;
                if (!string.IsNullOrEmpty(n) && n[0] == '<') return false;
                if (e is BeamSystem) return false;
                return true;
            }
            catch (Exception) { return false; }
        }

        internal static string CategoryName(Element e)
        {
            try { return e.Category != null ? e.Category.Name : "Элемент"; }
            catch (Exception) { return "Элемент"; }
        }

        /// <summary>«Хана · Basic Wall · #123» (линкийн элемент бол « · «Link»»).  Нэр нь хэрэглэгчийн өгсөн бичвэр тул цэвэрлэж, урт бол тайрна.</summary>
        internal static string LabelOf(Element e, string linkName = null)
        {
            try
            {
                string name = null;
                try { name = e.Name; } catch (Exception) { }
                string s = CategoryName(e) + (string.IsNullOrEmpty(name) ? "" : " · " + Trim(name, 60)) + " · #" + e.Id.Value;
                if (!string.IsNullOrEmpty(linkName)) s += " · «" + Trim(linkName, 30) + "»";
                return s;
            }
            catch (Exception) { return "Элемент"; }
        }

        private static string Trim(string s, int max)
        {
            if (s == null) return "";
            s = s.Replace('\n', ' ').Replace('\r', ' ').Trim();
            return s.Length <= max ? s : s.Substring(0, max - 1) + "…";
        }
    }
}
