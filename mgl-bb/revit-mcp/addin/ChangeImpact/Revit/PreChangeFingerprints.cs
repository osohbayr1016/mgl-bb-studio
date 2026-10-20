using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>Preview-ийн хурууны хээг (хуучирсан эсэх) Revit-ээс тооцно.  Preview ба Apply ЯГ ИЖИЛ функцээр.</summary>
    internal static class PreChangeFingerprints
    {
        internal static PreChangeFingerprint Compute(Document doc, DocumentKey key, long wallId, PreChangeRequest request)
        {
            var fp = new PreChangeFingerprint { DocumentId = key != null ? key.Id : null, SourceId = wallId, VectorMm = request != null ? request.VectorMm : null };
            fp.ModelStamp = ModelChangeCounter.Stamp(doc);
            fp.LinkSignature = PreChangePlanCache.SafeLinkSignature(doc);
            fp.ConfigSignature = PreChangePlanCache.SafeConfigSignature(key);

            Element wall = null;
            try { wall = doc.GetElement(new ElementId(wallId)); } catch (Exception) { }
            if (wall == null || !wall.IsValidObject) { fp.SourceExists = false; return fp; }

            try { fp.SourceUid = wall.UniqueId; } catch (Exception) { }
            try { fp.TypeId = wall.GetTypeId().Value; } catch (Exception) { }
            ElementPlace place = PreChangeCapture.ReadPlace(doc, wallId);
            fp.Location = place != null && place.Location != null
                ? place.Location.Select(v => PreChangeTolerance.Quantize(v, PreChangeTolerance.LengthMm)).ToArray()
                : null;

            var w = wall as Wall;
            if (w != null)
            {
                var notes = new List<string>();
                int total; bool trunc;
                List<long> hosted = PreChangeWallRules.InsertIds(w, out total, out trunc);
                List<long> joined = PreChangeCapture.PlanJoined(doc, w, notes);
                XYZ move = request != null ? PcUnits.VectorFromMm(request.VectorMm) : XYZ.Zero;
                List<long> rooms = PreChangeCapture.PlanRooms(doc, w, move, notes);
                fp.DependencyHash = DependencyHash(hosted, joined, rooms);
            }
            return fp;
        }

        /// <summary>
        /// Preview-д аль хэдийн төлөвлөсөн (хост, join, өрөө) жагсаалтаас хурууны хээ — preview бүрт ДАХИН төлөвлөхгүй (хаалттай биш өрөөний скан давтагдахгүй).
        /// ⚠️ `Compute`-тай ЯГ ИЖИЛ хэш: Apply нь `Compute`-ээр дахин тооцоод preview-ийнхтэй тулгана.
        /// </summary>
        internal static PreChangeFingerprint ComputeFrom(Document doc, DocumentKey key, long wallId, PreChangeRequest request, string modelStamp,
            IEnumerable<long> hosted, IEnumerable<long> joined, IEnumerable<long> rooms)
        {
            var fp = new PreChangeFingerprint { DocumentId = key != null ? key.Id : null, SourceId = wallId, VectorMm = request != null ? request.VectorMm : null, ModelStamp = modelStamp };
            fp.LinkSignature = PreChangePlanCache.SafeLinkSignature(doc);
            fp.ConfigSignature = PreChangePlanCache.SafeConfigSignature(key);
            Element wall = null;
            try { wall = doc.GetElement(new ElementId(wallId)); } catch (Exception) { }
            if (wall == null || !wall.IsValidObject) { fp.SourceExists = false; return fp; }
            try { fp.SourceUid = wall.UniqueId; } catch (Exception) { }
            try { fp.TypeId = wall.GetTypeId().Value; } catch (Exception) { }
            ElementPlace place = PreChangeCapture.ReadPlace(doc, wallId);
            fp.Location = place != null && place.Location != null
                ? place.Location.Select(v => PreChangeTolerance.Quantize(v, PreChangeTolerance.LengthMm)).ToArray()
                : null;
            fp.DependencyHash = DependencyHash(hosted, joined, rooms);
            return fp;
        }

        /// <summary>
        /// Хаалга зөөхийн хурууны хээ.  `plannedRooms` өгвөл (preview) тэр жагсаалтаар, үгүй бол (Apply) ДАХИН төлөвлөнө — ИЖИЛ `PreChangeDoorContext.PlanRooms`.
        /// Хэш = хост + хаалга + нэр дэвшигч өрөөнүүд: хост солигдвол, шинэ өрөө гарвал preview хуучирна.
        /// </summary>
        internal static PreChangeFingerprint ComputeDoor(Document doc, DocumentKey key, PreChangeRequest request, string modelStamp, IEnumerable<long> plannedRooms)
        {
            long doorId = request != null ? request.SourceId : 0;
            var fp = new PreChangeFingerprint { DocumentId = key != null ? key.Id : null, SourceId = doorId, VectorMm = request != null ? request.VectorMm : null };
            fp.ModelStamp = modelStamp ?? ModelChangeCounter.Stamp(doc);
            fp.LinkSignature = PreChangePlanCache.SafeLinkSignature(doc);
            fp.ConfigSignature = PreChangePlanCache.SafeConfigSignature(key);

            Element el = null;
            try { el = doc.GetElement(new ElementId(doorId)); } catch (Exception) { }
            if (el == null || !el.IsValidObject) { fp.SourceExists = false; return fp; }
            try { fp.SourceUid = el.UniqueId; } catch (Exception) { }
            try { fp.TypeId = el.GetTypeId().Value; } catch (Exception) { }
            ElementPlace place = PreChangeCapture.ReadPlace(doc, doorId);
            fp.Location = place != null && place.Location != null
                ? place.Location.Select(v => PreChangeTolerance.Quantize(v, PreChangeTolerance.LengthMm)).ToArray()
                : null;

            long hostId = 0;
            var fi = el as FamilyInstance;
            Wall host = null;
            try { host = fi != null ? fi.Host as Wall : null; hostId = host != null ? host.Id.Value : 0; } catch (Exception) { }

            IEnumerable<long> rooms = plannedRooms;
            if (rooms == null)
            {
                var notes = new List<string>();
                XYZ move = request != null ? PcUnits.VectorFromMm(request.VectorMm) : XYZ.Zero;
                rooms = fi != null ? PreChangeDoorContext.PlanRooms(doc, fi, host, move, null, notes) : new List<long>();
            }
            fp.DependencyHash = PreChangeStale.Hash("host:" + hostId, "h:" + doorId, "r:" + string.Join(",", rooms.OrderBy(x => x)));
            return fp;
        }

        private static string DependencyHash(IEnumerable<long> hosted, IEnumerable<long> joined, IEnumerable<long> rooms)
        {
            return PreChangeStale.Hash(
                "h:" + string.Join(",", hosted.OrderBy(x => x)),
                "j:" + string.Join(",", joined.OrderBy(x => x)),
                "r:" + string.Join(",", rooms.OrderBy(x => x)));
        }
    }
}
