using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Энэ хэрэгслийн үүсгэсэн»-ийг ЭЛЕМЕНТ ДЭЭР (Extensible Storage) тэмдэглэнэ — `AutoAnnotate/AaStore`-ийн
    /// ижил арга.  Нэмэлт shared parameter ХЭРЭГГҮЙ (загварт параметр нэмэхгүй, `.txt` файл хэрэггүй).
    ///
    /// ⚠️ SchemaGuid-ийг ХЭЗЭЭ Ч бүү өөрчил, талбар бүү нэм/хас (Revit хориглодог).  Шинэ талбар хэрэгтэй бол
    /// ШИНЭ schema (шинэ GUID) үүсгэ.
    /// </summary>
    internal static class RfScheduleStore
    {
        private static readonly Guid SchemaGuid = new Guid("0b6f3a52-6c1d-4f43-9a0e-5d3b7e1a2c84");
        private const string SchemaName = "MglRfScheduleClone";

        private static Schema Schema()
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Түүвэр хувилах»: энэ түүвэр аль эх түүвэр, аль Partition-оос үүссэн.");
            b.AddSimpleField("TemplateUid", typeof(string));
            b.AddSimpleField("Partition", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        /// <summary>Нээлттэй Transaction дотор.</summary>
        public static bool Write(Element schedule, string templateUid, string partition)
        {
            try
            {
                var ent = new Entity(Schema());
                ent.Set("TemplateUid", templateUid ?? string.Empty);
                ent.Set("Partition", partition ?? string.Empty);
                // Stamp = түүврийн ӨӨРИЙН UniqueId (талбар нэмэхгүй — schema хөдөлгөхгүй).  Revit Duplicate/Copy нь Entity-г ХУУЛДАГ
                // (RevitAPI.xml) тул хэрэглэгч манай түүврийг гараар хуулбарласан бол хуулбар нь ӨӨРИЙН UniqueId-тай тул Stamp таарахгүй →
                // «манай» гэж ТООЦОГДОХГҮЙ (Солих/Орхигдсон-ыг хуулбарт хэзээ ч хийхгүй).
                ent.Set("Stamp", schedule.UniqueId ?? string.Empty);
                schedule.SetEntity(ent);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Тэмдэглэсэн Partition; үгүй, уншигдахгүй, эсвэл тэмдэглэгээ ӨӨР элементээс хуулагдсан бол null.</summary>
        public static string ReadPartition(Element schedule)
        {
            string template;
            return Read(schedule, out template);
        }

        /// <summary>Тэмдэглэгээнд заасан эх түүврийн UniqueId (зөвхөн «манай» үед); үгүй бол null.</summary>
        public static string ReadTemplateUid(Element schedule)
        {
            string template;
            return Read(schedule, out template) == null ? null : template;
        }

        private static string Read(Element schedule, out string templateUid)
        {
            templateUid = null;
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s == null || schedule == null) return null;
            try
            {
                Entity ent = schedule.GetEntity(s);
                if (ent == null || !ent.IsValid()) return null;
                string p = ent.Get<string>("Partition");
                if (string.IsNullOrEmpty(p)) return null;
                // Stamp нь энэ түүврийн ӨӨРИЙН UniqueId биш бол энэ нь хуулбар (эсвэл өөр загварт шилжсэн) — «манай» биш.
                string stamp = ent.Get<string>("Stamp");
                if (!string.Equals(stamp, schedule.UniqueId, StringComparison.Ordinal)) return null;
                templateUid = ent.Get<string>("TemplateUid");
                return p;
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Revit-ийн анхааруулгыг (хэмжээс давхцах, түүвэр хоосон г.м.) харуулахгүй, алдааг (Error) Revit-д үлдээнэ.
    /// Хэрэглэгчийн өөр элементийг ХЭЗЭЭ Ч устгахгүй.
    /// </summary>
    internal sealed class RfWarningSwallower : IFailuresPreprocessor
    {
        public int Hidden;

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            try
            {
                foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
                {
                    if (f.GetSeverity() == FailureSeverity.Warning)
                    {
                        accessor.DeleteWarning(f);
                        Hidden++;
                    }
                }
            }
            catch
            {
                // Анхааруулга цэвэрлэж чадаагүй нь аюултай биш.
            }
            return FailureProcessingResult.Continue;
        }
    }
}
