using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck
{
    /// <summary>
    /// Линкийн нэг INSTANCE (host доторх `RevitLinkInstance`).  ⚠️ Revit-ийн амьд обьектыг ХАДГАЛАХГҮЙ:
    /// зөвхөн id/нэр.  Хэрэглэх үед `ClashLinks.Resolve`-оор шинээр авна (хэрэглэгч линкийг тэр завсар
    /// unload хийсэн байж болно).
    /// </summary>
    internal sealed class LinkSlot
    {
        public long InstanceId;
        public string InstanceUid;
        public string Name;
        /// <summary>Линкийн баримтын `DocumentKey.Id` (нэг файл олон instance-аар орсон ч ижил).</summary>
        public string LinkDocId;
    }

    /// <summary>Нэг талын нэг элемент — ХУУЛСАН (detached) өгөгдөл.  Revit обьект ХАДГАЛАХГҮЙ.</summary>
    internal sealed class SideItem
    {
        public ElementKey Key;
        public long IdValue;
        /// <summary>-1 = host; бусад нь `ClashJob.Links` индекс.</summary>
        public int Slot;
        public Aabb Box;
    }

    /// <summary>Линкийн instance + баримт + transform-ыг (дахин) авах туслах.</summary>
    internal static class ClashLinks
    {
        internal sealed class Resolved
        {
            public RevitLinkInstance Instance;
            public Document Doc;
            public Transform Transform;
        }

        /// <summary>null = линк олдсонгүй / unload хийгдсэн.</summary>
        internal static Resolved Resolve(Document host, LinkSlot slot)
        {
            try
            {
                var inst = host.GetElement(new ElementId(slot.InstanceId)) as RevitLinkInstance;
                if (inst == null) return null;
                Document ld = inst.GetLinkDocument();
                if (ld == null) return null;
                return new Resolved { Instance = inst, Doc = ld, Transform = inst.GetTotalTransform() };
            }
            catch (Exception)
            {
                return null;
            }
        }

        internal static string DisplayName(RevitLinkInstance inst)
        {
            try
            {
                string n = inst.Name;
                int colon = n.IndexOf(':');
                return colon > 0 ? n.Substring(0, colon).Trim() : n;
            }
            catch (Exception) { return "Link"; }
        }
    }

    internal static class ClashUnits
    {
        public const double FeetToMm = 304.8;
        public const double CubicFeetToCm3 = 28316.846592;

        internal static Aabb ToMm(XYZ min, XYZ max)
        {
            return new Aabb(min.X * FeetToMm, min.Y * FeetToMm, min.Z * FeetToMm, max.X * FeetToMm, max.Y * FeetToMm, max.Z * FeetToMm);
        }
    }
}
