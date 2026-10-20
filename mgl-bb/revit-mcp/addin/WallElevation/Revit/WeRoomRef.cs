using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Өрөө host-д эсвэл LINK загварт.  ХЭМЖСЭН (MITIC интерьер, 2026-10-08): интерьерийн файлд өрөө 0, харин 620 өрөөний tag бүгд
    /// архитектурын link-ийн өрөөг заадаг — интерьерийн баг өрөөг ҮРГЭЛЖ link-ээс авдаг.  Link-ийн өрөөний түлхүүр нь ханынхтай ижил
    /// <see cref="WeLinkRef"/> мөр («link|inst|elem»), координат нь link-ийн <see cref="Transform"/>-оор host руу хөрвөнө.
    /// </summary>
    internal static class WeRoomRef
    {
        /// <summary>Өрөөний түлхүүр (host = UniqueId, link = <see cref="WeLinkRef.Make"/>).</summary>
        public static string Uid(Room r, RevitLinkInstance link)
        {
            return link == null ? r.UniqueId : WeLinkRef.Make(link, r);
        }

        /// <summary>Түлхүүрээс өрөө (+ link).  Link ачаалагдаагүй / устсан бол null.</summary>
        public static Room Resolve(Document doc, string uid, out RevitLinkInstance link)
        {
            link = null;
            if (string.IsNullOrEmpty(uid)) return null;
            if (!WeLinkRef.IsLink(uid))
            {
                try { return doc.GetElement(uid) as Room; } catch { return null; }
            }
            Element e;
            return WeLinkRef.TryResolve(doc, uid, out link, out e) ? e as Room : null;
        }

        public static Transform TransformOf(RevitLinkInstance link)
        {
            if (link == null) return Transform.Identity;
            try { return link.GetTotalTransform(); } catch { return Transform.Identity; }
        }

        /// <summary>Өрөөний tag (host) → tag хийсэн өрөө + link (host өрөө бол link = null).  Олдохгүй / link ачаалагдаагүй бол null.</summary>
        public static Room FromTag(Document doc, RoomTag tag, out RevitLinkInstance link)
        {
            link = null;
            if (tag == null) return null;
            LinkElementId lid = null;
            try { lid = tag.TaggedRoomId; } catch { lid = null; }
            if (lid != null && lid.LinkInstanceId != ElementId.InvalidElementId)
            {
                link = doc.GetElement(lid.LinkInstanceId) as RevitLinkInstance;
                Document ld = null;
                try { ld = link != null ? link.GetLinkDocument() : null; } catch { ld = null; }
                return ld != null ? ld.GetElement(lid.LinkedElementId) as Room : null;
            }
            try { return tag.Room; } catch { return null; }
        }

        /// <summary>
        /// Link-ийн өрөөний tag-ийг заасан link нь ачаалагдаагүй — сонголт чимээгүй хоосрохгүйн тулд тайлбарлах.
        /// </summary>
        public static bool IsUnloadedLinkTag(Document doc, RoomTag tag, out string linkName)
        {
            linkName = null;
            try
            {
                LinkElementId lid = tag.TaggedRoomId;
                if (lid == null || lid.LinkInstanceId == ElementId.InvalidElementId) return false;
                var li = doc.GetElement(lid.LinkInstanceId) as RevitLinkInstance;
                if (li == null) return false;
                linkName = li.Name;
                return li.GetLinkDocument() == null;
            }
            catch { return false; }
        }

        /// <summary>
        /// Link-ийн түвшин → host-ын ИЖИЛ өндөртэй түвшин (±5 мм; байхгүй бол ижил нэртэй).  Түлхүүр план, spot-ийн суурь, хуудасны
        /// тэгшлэлт бүгд host-ын түвшнээр явна.
        /// </summary>
        public static Level HostLevel(Document doc, Level linked, Transform tf)
        {
            if (linked == null) return null;
            double z = WeAnnoSourceReader.LevelZ(linked) + tf.Origin.Z;
            List<Level> levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList();
            Level best = levels.Where(l => Math.Abs(WeAnnoSourceReader.LevelZ(l) - z) < 5.0 / 304.8)
                               .OrderBy(l => Math.Abs(WeAnnoSourceReader.LevelZ(l) - z)).FirstOrDefault();
            return best ?? levels.FirstOrDefault(l => string.Equals(l.Name, linked.Name, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Host координатын цэг өрөөнд байгаа эсэх (link-ийн өрөөнд link координат руу буцаана).</summary>
        public static bool IsPointInRoom(Room r, Transform tf, XYZ hostPoint)
        {
            XYZ p = tf.IsIdentity ? hostPoint : tf.Inverse.OfPoint(hostPoint);
            return r.IsPointInRoom(p);
        }

        /// <summary>Түлхүүр план дээрх өрөөний tag-ийн зорилго (link-ийн өрөөнд link instance + өрөө).</summary>
        public static LinkElementId TagTarget(Room r, RevitLinkInstance link)
        {
            return link == null ? new LinkElementId(r.Id) : new LinkElementId(link.Id, r.Id);
        }
    }
}
