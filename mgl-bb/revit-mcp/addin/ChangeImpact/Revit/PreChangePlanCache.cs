using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Нэг ханын, нэг загварын төлөвийн (`ModelChangeCounter.Stamp`) ЗАЙНАС ХАМААРАХГҮЙ бэлтгэл — 200 → 300 → 450 мм-ийн дараалсан preview-д ДАХИН БАРИХГҮЙ.
    ///
    /// ⚠️ ЗӨВХӨН ХУУЛСАН (detached) өгөгдөл, id.  Амьд `Document` / `Element` / `View` / `GeometryObject` / `Solid` ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ:
    ///   • `Hub` нь резольверын ХУУЛСАН индекс (ImpactNode/ImpactEdge/id) — кэшэнд ОРОХДОО `Detach()` хийгдэж `Document`-ийн лавлагаа ТАСЛАГДСАН;
    ///     дахин ашиглахдаа job өөрийн Step-ийн `Document`-д `Attach()` хийнэ.
    ///   • `Deps` нь хэзээ ч мутаци хийгдэхгүй — job бүр `Clone()` авна (`AddNewlyVisible` нь зайнаас хамаарах нэмэлт хийдэг).
    ///   • `Memo` нь ӨМНӨХ (хөдөлгөөнгүй) төлвийн уншилт — зайнаас хамаарахгүй.
    ///
    /// Түлхүүр (`PreChangeCacheKey`) = файл + загварын өөрчлөлтийн тэмдэг + хана + линкийн төлөв + гарцын тохиргоо.  Аль нэг нь өөрчлөгдвөл ХУУЧИН entry хэрэглэгдэхгүй.
    /// </summary>
    internal sealed class PreChangePlan
    {
        public PreChangeCacheKey Key;
        public string Stamp;
        public ResolverHub Hub;
        public PreChangeDependencies Deps;
        public List<long> SourceIds = new List<long>();
        public List<long> HostedIds = new List<long>();
        public List<long> JoinedIds = new List<long>();
        public List<long> DimIds = new List<long>();
        public List<ScheduleRef> Schedules = new List<ScheduleRef>();
        public List<long> ScheduleCandidateIds = new List<long>();
        /// <summary>Хөдөлгөөнөөс ӨМНӨ эх сурвалж аль хэдийн харагдаж байсан харагдацууд.</summary>
        public HashSet<long> VisibleBeforeViews = new HashSet<long>();
        /// <summary>Хуудсанд байрласан модель харагдац, тэдгээрээс ӨМНӨ нь харагдаагүй (хөдөлсний дараа шинээр харагдах нэр дэвшигч — шүүгдээгүй).</summary>
        public List<long> PlacedCandidateViews = new List<long>();
        public long Clearance3dViewId;
        public string Clearance3dProblem;
        public UnenclosedRoomIndex Unenclosed;
        public BeforeMemo Memo = new BeforeMemo();
        /// <summary>Plan-ийн үеийн ШААРДЛАГАТАЙ дутагдал (хост элементийн хязгаар, граф ...) — зайнаас хамаарахгүй.</summary>
        public List<string> RequiredReasons = new List<string>();
        public List<string> AdvisoryReasons = new List<string>();
        public List<string> Notes = new List<string>();
        /// <summary>MEP clash-ийн линк slot-уудын дараалал — slot индекс өөр болбол memo-ийн clash хэсэг хүчингүй.</summary>
        public string ClashSlotSignature;
        /// <summary>Хаалга зөөхөд: хаалганы ХУУЛСАН контекст (хост, нүх, саад, өрөө) — зайнаас хамаарахгүй.  Хана зөөхөд null.</summary>
        public DoorContextData Door;
    }

    /// <summary>Кэшийн ганц, процессын хэмжээний хуулбар + түлхүүр бүтээгчид.</summary>
    internal static class PreChangePlanCache
    {
        internal static readonly PreChangeContextCache<PreChangePlan> Cache = new PreChangeContextCache<PreChangePlan>(3);

        internal static PreChangeCacheKey KeyOf(Document doc, DocumentKey key, string wallUid, string stamp)
        {
            return new PreChangeCacheKey
            {
                DocumentId = key != null ? key.Id : null,
                ModelStamp = stamp,
                WallUid = wallUid,
                LinkSignature = SafeLinkSignature(doc),
                ConfigSignature = SafeConfigSignature(key),
            };
        }

        /// <summary>Файл хаагдах/солигдоход кэшийг хаяна.</summary>
        internal static void Purge(string documentId)
        {
            if (!string.IsNullOrEmpty(documentId)) Cache.PurgeDocument(documentId);
        }

        /// <summary>Аль ч баримт хаагдахад (хаагдсан баримтын id хаагдсаны дараа мэдэгдэхгүй) БҮХ кэшийг хаяна — хямд (id л), дараагийн preview дахин бүтээнэ.</summary>
        internal static void PurgeAll()
        {
            Cache.Clear();
        }

        /// <summary>
        /// Линкийн ачаалагдсан байдал + transform + файлын өөрчлөлтийн хугацаа.  Линк unload/зөөх/шинэчлэх нь host-ын `DocumentChanged` БИШ тул тэмдэгт ордоггүй.
        /// Уншиж чадахгүй бол `PreChangeCacheKey.Unverifiable` → кэш ХЭЗЭЭ Ч хэрэглэгдэхгүй, Apply «шалгаж чадсангүй» гэж татгалзана (fail-closed).
        /// </summary>
        internal static string SafeLinkSignature(Document doc)
        {
            try
            {
                var sb = new StringBuilder();
                foreach (RevitLinkInstance inst in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().OrderBy(i => i.Id.Value))
                {
                    sb.Append(inst.Id.Value).Append(':');
                    Document ld = null;
                    try { ld = inst.GetLinkDocument(); } catch (Exception) { }
                    sb.Append(ld != null ? 'L' : 'U');
                    if (ld != null)
                    {
                        string path = null;
                        try { path = ld.PathName; } catch (Exception) { }
                        sb.Append('|').Append(path ?? "");
                        try { if (!string.IsNullOrEmpty(path) && File.Exists(path)) sb.Append('|').Append(File.GetLastWriteTimeUtc(path).Ticks.ToString(CultureInfo.InvariantCulture)); } catch (Exception) { }
                    }
                    try
                    {
                        Transform t = inst.GetTotalTransform();
                        foreach (double v in new[] { t.Origin.X, t.Origin.Y, t.Origin.Z, t.BasisX.X, t.BasisX.Y, t.BasisY.X, t.BasisY.Y, t.BasisZ.Z })
                            sb.Append('|').Append(Math.Round(v, 6).ToString("R", CultureInfo.InvariantCulture));
                    }
                    catch (Exception) { sb.Append("|t?"); }
                    sb.Append(';');
                }
                return PreChangeStale.Hash(sb.ToString());
            }
            catch (Exception)
            {
                return PreChangeCacheKey.Unverifiable;
            }
        }

        internal static string SafeConfigSignature(DocumentKey key)
        {
            try
            {
                IReadOnlyList<ExitInfo> exits = PreChangeExitStore.Load(key);
                return PreChangeStale.Hash("exits:" + string.Join(",", exits.Select(e => e.Uid ?? e.Id.ToString(CultureInfo.InvariantCulture)).OrderBy(x => x, StringComparer.Ordinal)));
            }
            catch (Exception)
            {
                return PreChangeCacheKey.Unverifiable;
            }
        }

        /// <summary>Clash slot-уудын дараалал (InstanceId) — memo-ийн slot индекс хэвээр утгатай эсэхийг шалгана.</summary>
        internal static string SlotSignature(ClashSpec spec)
        {
            if (spec == null) return "";
            return string.Join(",", spec.Slots.Select(s => s.InstanceId.ToString(CultureInfo.InvariantCulture)));
        }
    }

    /// <summary>
    /// Хөдөлсний ДАРАА шинээр харагдах харагдацын нэр дэвшигчийг БАТЛАГДСАН-АЮУЛГҮЙ байдлаар багасгана.
    ///
    ///   Харагдацын crop идэвхтэй (`CropBoxActive`) бөгөөд ханын (хөдөлсний дараах) хүрээ crop-ийн X эсвэл Y хүрээнээс ГАДУУР, тэнцвэргүй хоорондоо огтлолцохгүй бол
    ///   тэр харагдацад хана ХЭЗЭЭ Ч харагдахгүй → шалгах шаардлагагүй.  Нөгөө бүх тохиолдолд (crop идэвхгүй, perspective, уншигдаагүй) нэр дэвшигч ХЭВЭЭР үлдэнэ.
    ///   Үл мэдэх нөхцөлд ХАСДАГГҮЙ (худал «харагдахгүй» нь худал ногоон болно).
    /// </summary>
    internal static class PreChangeVisibilityReducer
    {
        /// <summary>Нэмэлт тэлэлт (мм): хаалганы дүүжин, тэмдэглэгээ зэрэг bbox-оос цухуйх зүйлийг хамруулна.</summary>
        internal const double PadMm = 500;

        internal static List<long> Reduce(Document doc, IEnumerable<long> candidateViewIds, Element element, XYZ moveFt, out int excluded, out int unreadable)
        {
            excluded = 0;
            unreadable = 0;
            var keep = new List<long>();
            BoundingBoxXYZ bb = null;
            try { bb = element.get_BoundingBox(null); } catch (Exception) { }
            if (bb == null) { keep.AddRange(candidateViewIds); unreadable = keep.Count; return keep; }

            double pad = PcUnits.ToInternalMm(PadMm);
            double minX = Math.Min(bb.Min.X, bb.Min.X + moveFt.X) - pad, maxX = Math.Max(bb.Max.X, bb.Max.X + moveFt.X) + pad;
            double minY = Math.Min(bb.Min.Y, bb.Min.Y + moveFt.Y) - pad, maxY = Math.Max(bb.Max.Y, bb.Max.Y + moveFt.Y) + pad;
            double minZ = bb.Min.Z - pad, maxZ = bb.Max.Z + pad;

            foreach (long id in candidateViewIds)
            {
                bool provablyOutside = false;
                try
                {
                    var v = doc.GetElement(new ElementId(id)) as View;
                    if (v != null && v.CropBoxActive)
                    {
                        var v3 = v as View3D;
                        if (v3 == null || !v3.IsPerspective)
                        {
                            BoundingBoxXYZ cb = v.CropBox;
                            if (cb != null && cb.Transform != null)
                                provablyOutside = Disjoint(cb, minX, maxX, minY, maxY, minZ, maxZ);
                        }
                    }
                }
                catch (Exception) { unreadable++; provablyOutside = false; }

                if (provablyOutside) excluded++;
                else keep.Add(id);
            }
            return keep;
        }

        private static bool Disjoint(BoundingBoxXYZ cb, double minX, double maxX, double minY, double maxY, double minZ, double maxZ)
        {
            Transform inv = cb.Transform.Inverse;
            double vMinX = double.MaxValue, vMinY = double.MaxValue, vMaxX = double.MinValue, vMaxY = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                XYZ c = inv.OfPoint(new XYZ((i & 1) == 0 ? minX : maxX, (i & 2) == 0 ? minY : maxY, (i & 4) == 0 ? minZ : maxZ));
                vMinX = Math.Min(vMinX, c.X); vMaxX = Math.Max(vMaxX, c.X);
                vMinY = Math.Min(vMinY, c.Y); vMaxY = Math.Max(vMaxY, c.Y);
            }
            // Харагдацын хавтгай (X, Y) дахь хүрээнүүд огтлолцохгүй.  Z (гүн / үзэх хүрээ) нь харагдацын төрлөөр ялгаатай тул ЗОРИУД тооцохгүй.
            return vMaxX < cb.Min.X || vMinX > cb.Max.X || vMaxY < cb.Min.Y || vMinY > cb.Max.Y;
        }
    }
}
