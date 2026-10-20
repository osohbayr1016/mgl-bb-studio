using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>Ажлын үе шат → алхмууд.  `models` = synthetic golden model үүсгэж, Interior-ийг нээгээд тооллого хийнэ.</summary>
    internal static class Plan
    {
        public static void Build(GateRunner r)
        {
            // Гарахад «өөрчлөлтийг хадгалах уу?» — тест модел түр зуурынх, ХАДГАЛАХГҮЙ.
            r.Rules.Add(new DialogRule { Name = "save-on-exit", IdContains = "Save", Result = (int)TaskDialogResult.No, Once = false });
            string phase = r.Job.Phase;
            if (phase == "models" || phase == "all") Models(r);
            if (phase == "all") Scenarios.Enqueue(r);
        }

        private static void Models(GateRunner r)
        {
            ModelFactory f = null;
            string a = null, b = null, interior = null;
            r.Enqueue("models.architecture-a", app =>
            {
                f = new ModelFactory(app.Application, r.Job);
                a = f.BuildArchitecture(Synth.ArchitectureA(), "Architecture_Test.rvt");
                return StepState.Done;
            }, 15, true);
            r.Enqueue("models.architecture-b", app => { b = f.BuildArchitecture(Synth.ArchitectureB(), "Architecture_B_Test.rvt"); return StepState.Done; }, 15, true);
            r.Enqueue("models.interior", app =>
            {
                interior = f.BuildInterior(a, b);
                foreach (KeyValuePair<string, object> kv in f.Facts) r.Facts[kv.Key] = kv.Value;
                r.Facts["warnings_swallowed"] = f.Warnings.Seen.Count;
                File.WriteAllLines(Path.Combine(r.Job.RunDir, "model-warnings.txt"), f.Warnings.Seen);
                return StepState.Done;
            }, 15, true);
            r.Enqueue("models.open-interior", app =>
            {
                app.OpenAndActivateDocument(interior);
                return StepState.Done;
            }, 10, true);
            r.Enqueue("models.census", app => Census(r, app.ActiveUIDocument.Document));
        }

        /// <summary>Нээгдсэн Interior_Test-ийн тооллого — загвар тодорхойлолтоо хангаж буйг БАТАЛНА (буруу загвар дээр тест утгагүй).</summary>
        private static StepState Census(GateRunner r, Document doc)
        {
            var problems = new List<string>();
            int hostRooms = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().GetElementCount();
            r.Facts["census.host_rooms"] = hostRooms;
            if (hostRooms != 0) problems.Add("host-д өрөө " + hostRooms + " (0 байх ёстой)");

            List<RevitLinkInstance> links = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().ToList();
            r.Facts["census.links"] = links.Count;
            if (links.Count != 3) problems.Add("link " + links.Count + " (3 байх ёстой)");
            foreach (RevitLinkInstance li in links)
            {
                Document ld = li.GetLinkDocument();
                if (ld == null) { problems.Add("link ачаалагдаагүй: " + li.Name); continue; }
                List<Room> rooms = new FilteredElementCollector(ld).OfCategory(BuiltInCategory.OST_Rooms).Cast<Room>().ToList();
                int enclosed = rooms.Count(x => x.Area > 1e-6);
                Transform tf = li.GetTotalTransform();
                double ang = Math.Atan2(tf.BasisX.Y, tf.BasisX.X) * 180 / Math.PI;
                r.Facts["census.link." + li.Id.Value] = li.Name + " | өрөө " + enclosed + "/" + rooms.Count + " | angle " + U.F(ang)
                                                         + " | origin " + U.F(U.ToMm(tf.Origin.X)) + "," + U.F(U.ToMm(tf.Origin.Y)) + "," + U.F(U.ToMm(tf.Origin.Z));
                if (enclosed != rooms.Count) problems.Add(li.Name + ": хүрээлэгдээгүй өрөө " + (rooms.Count - enclosed));
            }
            int tags = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().GetElementCount();
            r.Facts["census.room_tags"] = tags;
            if (tags == 0) problems.Add("link-ийн өрөөний tag 0");
            foreach (string key in new[] { "upper_storey_host_ids", "lower_storey_host_ids" })
            {
                object v;
                string ids = r.Facts.TryGetValue(key, out v) ? v as string : null;
                int n = string.IsNullOrEmpty(ids) ? 0 : ids.Split(',').Count(s => doc.GetElement(new ElementId(long.Parse(s))) != null);
                r.Facts["census." + key + ".count"] = n;
                if (n == 0) problems.Add(key + " хоосон");
            }
            int sheets = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).GetElementCount();
            r.Facts["census.sheets"] = sheets;
            r.Facts["census.active_view"] = doc.ActiveView != null ? doc.ActiveView.Name : "(none)";
            r.Facts["census.problems"] = problems.Count == 0 ? "" : string.Join(" | ", problems);
            foreach (string p in problems) GateLog.Error("census: " + p);
            return problems.Count == 0 ? StepState.Done : StepState.Failed;
        }
    }
}
