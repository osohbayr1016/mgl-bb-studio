using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck
{
    /// <summary>
    /// Хос элементийн НАРИЙН геометр шалгалт — ЗӨВХӨН bbox-оор шүүгдсэн нэр дэвшигчид.
    ///
    /// АЖИЛЛАГАА:
    ///   1. Элемент бүрийн ТОД solid-уудыг host координатад авна (`GeometryInstance.GetInstanceGeometry()` нь
    ///      модель координатад; линкийн элемент `SolidUtils.CreateTransformed(solid, link.GetTotalTransform())`-ээр
    ///      host руу).  Эзлэхүүн ≈ 0 / нүүргүй solid-ийг хаяна.
    ///   2. Solid бүрийн bbox-оор хоёр дахь шүүлт; давхцсан хосод л `BooleanOperationsUtils.ExecuteBooleanOperation(Intersect)`.
    ///   3. Дүн:
    ///        ConfirmedClash — нийт огтлолцлын эзлэхүүн ≥ дүрмийн босго
    ///        NoClash        — ЯГ шалгагдсан, босгоос бага / огтлолцохгүй, АЛДАА ГАРААГҮЙ
    ///        Unsupported    — аль нэг элемент бодисгүй (арматур, 2D, шугам...) — «шалгаж чадахгүй»
    ///        GeometryError  — геометр унших / boolean үйлдэл ямар нэг хосод унасан
    ///
    /// ⚠️ ГУРВАН ТОДОРХОЙ ЭРСДЭЛ (барьж байна):
    ///   • Boolean үйлдэл «Failed to perform the Boolean operation» шиддэг — ХОС БҮРД try/catch; нэг муу хос
    ///     бүх гүйлтийг унагахгүй.  Хэрэв ЯМАР Ч огтлолцол олдоогүй мөртлөө ядаж нэг хос унасан бол дүн
    ///     `NoClash` БИШ `GeometryError` (баталгаагүй нь «цэвэр» биш).
    ///   • Бодисгүй элемент (`Solid` олдоогүй) нь `NoClash` БИШ `Unsupported`.  `ElementIntersectsElementFilter`-ийн
    ///     мэдэгдэж буй хязгаар (зарим join хийсэн бетон, арматур) ч энэ ангиллаар ил болно.
    ///   • Solid-ийг УРТ хугацаагаар барихгүй: `SolidCache` нь солидын тоогоор хязгаарлагдсан (LRU), загвар
    ///     өөрчлөгдвөл (`ModelChangeCounter`) ЦЭВЭРЛЭГДЭНЭ — хуучин геометрээр хариулахгүй.
    ///
    /// ⚠️ Revit API — үндсэн thread, хүчинтэй контекст.  Загварыг ӨӨРЧЛӨХГҮЙ (транзакцгүй).
    /// </summary>
    internal sealed class GeometryVerifier : IDisposable
    {
        internal const int MaxCachedSolids = 6000;

        private sealed class SolidEntry
        {
            public Solid Solid;
            public Aabb Box;
        }

        private sealed class SolidSet
        {
            public List<SolidEntry> Solids = new List<SolidEntry>();
            /// <summary>Бодис олдсонгүй (эсвэл геометр null) — шалгах боломжгүй.</summary>
            public bool Unsupported;
            /// <summary>Геометр унших алдаа.</summary>
            public bool Error;
            public string Reason;
            /// <summary>
            /// Энэ багцыг эзэмшдэг Revit геометрийн обьектууд (GeometryElement, хөрвүүлсэн Solid).  `Dispose` хийхгүй бол
            /// олон мянган элементтэй гүйлтэд native санах ой GC-ийн finalizer хүртэл хуримтлагдана.
            /// ⚠️ GeometryElement-ийг dispose хийвэл түүнээс авсан Solid ч хүчингүй болно — тиймээс хамт л.
            /// </summary>
            public readonly List<IDisposable> Owned = new List<IDisposable>();

            public void DisposeAll()
            {
                foreach (IDisposable d in Owned)
                {
                    try { d.Dispose(); } catch (Exception) { }
                }
                Owned.Clear();
                Solids.Clear();
            }
        }

        private readonly Document _host;
        private readonly Dictionary<string, SolidSet> _cache = new Dictionary<string, SolidSet>(StringComparer.Ordinal);
        private readonly LinkedList<string> _lru = new LinkedList<string>();
        private readonly Dictionary<string, LinkedListNode<string>> _lruNodes = new Dictionary<string, LinkedListNode<string>>(StringComparer.Ordinal);
        private int _cachedSolidCount;
        private readonly Dictionary<int, ClashLinks.Resolved> _links = new Dictionary<int, ClashLinks.Resolved>();
        private readonly IReadOnlyList<LinkSlot> _slots;
        private readonly Options _options;

        internal int PairsTested { get; private set; }
        internal int BooleanOps { get; private set; }
        internal int BooleanFailures { get; private set; }

        internal GeometryVerifier(Document host, IReadOnlyList<LinkSlot> slots)
        {
            _host = host;
            _slots = slots;
            _options = new Options
            {
                DetailLevel = ViewDetailLevel.Fine,
                ComputeReferences = false,
                IncludeNonVisibleObjects = false,
            };
        }

        /// <summary>Загвар өөрчлөгдсөн — кэш дэх БҮХ solid ХУУЧИРСАН.  Revit обьектуудыг dispose хийнэ.</summary>
        internal void Invalidate()
        {
            foreach (SolidSet s in _cache.Values) s.DisposeAll();
            DisposeGraveyard();
            _cache.Clear();
            _lru.Clear();
            _lruNodes.Clear();
            _cachedSolidCount = 0;
            _links.Clear();
        }

        // Кэшнээс хасагдсан багцыг ШУУД dispose хийхгүй: `Verify` дотор өөр нэг хос хараахан ашиглаж байж болно.
        private readonly List<SolidSet> _graveyard = new List<SolidSet>();

        private void DisposeGraveyard()
        {
            foreach (SolidSet s in _graveyard) s.DisposeAll();
            _graveyard.Clear();
        }

        public void Dispose()
        {
            Invalidate();
            try { _options.Dispose(); } catch (Exception) { }
        }

        /// <summary>
        /// Step бүрийн эхэнд: кэшлэсэн линкүүдийг дахин авч (Document/Transform хуучирсан байж болно — хэрэглэгч
        /// линкийг unload/reload/зөөсөн).  Ямар нэг линк өөрчлөгдсөн бол БҮХ solid-ийн кэшийг цэвэрлэнэ.
        /// </summary>
        internal void BeginStep()
        {
            if (_links.Count == 0) return;
            foreach (KeyValuePair<int, ClashLinks.Resolved> kv in _links.ToList())
            {
                ClashLinks.Resolved fresh = ClashLinks.Resolve(_host, _slots[kv.Key]);
                if (!SameLink(kv.Value, fresh)) { Invalidate(); return; }
                _links[kv.Key] = fresh;
            }
        }

        private static bool SameLink(ClashLinks.Resolved a, ClashLinks.Resolved b)
        {
            if (a == null || b == null) return a == null && b == null;
            // Кэшлэсэн линкийн баримт ХААГДСАН (unload/reload) бол `Equals` үнэн гарсан ч (Revit-ийн дотоод хаяг дахин ашиглагдах) ижил линк БИШ.
            if (!SmartDocs.IsAlive(a.Doc) || !SmartDocs.Same(a.Doc, b.Doc)) return false;
            Transform x = a.Transform, y = b.Transform;
            return x.Origin.IsAlmostEqualTo(y.Origin) && x.BasisX.IsAlmostEqualTo(y.BasisX)
                && x.BasisY.IsAlmostEqualTo(y.BasisY) && x.BasisZ.IsAlmostEqualTo(y.BasisZ);
        }

        /* ============================== PAIR =============================== */

        internal PairResult Verify(SideItem a, SideItem b, ClashRule rule, int ai, int bi)
        {
            PairsTested++;
            DisposeGraveyard();            // өмнөх хосын үед кэшнээс хасагдсан багцууд — одоо хэн ч ашиглахгүй
            var res = new PairResult { A = ai, B = bi };

            SolidSet sa = Solids(a), sb = Solids(b);
            if (sa.Error || sb.Error)
            {
                res.Verdict = ClashVerdict.GeometryError;
                res.Reason = sa.Error ? sa.Reason : sb.Reason;
                return res;
            }
            if (sa.Unsupported || sb.Unsupported)
            {
                res.Verdict = ClashVerdict.Unsupported;
                res.Reason = sa.Unsupported ? sa.Reason : sb.Reason;
                return res;
            }

            double totalFt3 = 0;
            int failures = 0;
            Aabb? union = null;

            foreach (SolidEntry ea in sa.Solids)
            {
                foreach (SolidEntry eb in sb.Solids)
                {
                    Aabb ba = ea.Box, bb = eb.Box;
                    if (!ba.Overlaps(ref bb, 0)) continue;     // solid-ийн bbox давхцахгүй — boolean хэрэггүй
                    BooleanOps++;
                    try
                    {
                        Solid inter = BooleanOperationsUtils.ExecuteBooleanOperation(ea.Solid, eb.Solid, BooleanOperationsType.Intersect);
                        if (inter != null)
                        {
                            try
                            {
                                if (inter.Volume > 1e-12)
                                {
                                    totalFt3 += inter.Volume;
                                    Aabb ib = SolidBox(inter, null);
                                    union = union.HasValue ? Aabb.Union(union.Value, ib) : ib;
                                }
                            }
                            finally { inter.Dispose(); }       // түр үр дүнгийн native санах ойг шууд чөлөөлнө
                        }
                    }
                    catch (Exception)
                    {
                        // «Failed to perform the Boolean operation» (InvalidOperation) ба бусад геометрийн алдаа — ХОС БҮРД.
                        // Нэг муу хос бүх гүйлтийг унагахгүй, гэхдээ «clash байхгүй» гэж ТООЦОГДОХГҮЙ (доор).
                        failures++;
                        BooleanFailures++;
                    }
                }
            }

            double cm3 = totalFt3 * ClashUnits.CubicFeetToCm3;
            if (cm3 >= rule.MinVolumeCm3 && cm3 > 0)
            {
                res.Verdict = ClashVerdict.ConfirmedClash;
                res.VolumeCm3 = cm3;
                if (union.HasValue)
                {
                    res.Box = union.Value.ToArray();
                    res.Point = union.Value.Center();
                }
                return res;
            }

            if (failures > 0)
            {
                res.Verdict = ClashVerdict.GeometryError;
                res.Reason = "Boolean үйлдэл " + failures + " хосод амжилтгүй — «clash байхгүй» гэж батлах боломжгүй.";
                return res;
            }

            res.Verdict = ClashVerdict.NoClash;
            if (cm3 > 0) res.Reason = "Огтлолцол " + Math.Round(cm3, 2) + " см³ — босгоос бага.";
            return res;
        }

        /* ============================== SOLIDS ============================= */

        private SolidSet Solids(SideItem item)
        {
            string key = item.Key.ToString();
            SolidSet set;
            if (_cache.TryGetValue(key, out set))
            {
                Touch(key);
                return set;
            }

            set = Extract(item);
            _cache[key] = set;
            _lruNodes[key] = _lru.AddFirst(key);
            _cachedSolidCount += Math.Max(1, set.Solids.Count);
            while (_cachedSolidCount > MaxCachedSolids && _lru.Count > 1)
            {
                string old = _lru.Last.Value;
                _lru.RemoveLast();
                _lruNodes.Remove(old);
                SolidSet gone;
                if (_cache.TryGetValue(old, out gone))
                {
                    _cachedSolidCount -= Math.Max(1, gone.Solids.Count);
                    _cache.Remove(old);
                    _graveyard.Add(gone);          // дараагийн Verify-ийн эхэнд dispose
                }
            }
            return set;
        }

        private void Touch(string key)
        {
            LinkedListNode<string> node;
            if (_lruNodes.TryGetValue(key, out node))
            {
                _lru.Remove(node);
                _lruNodes[key] = _lru.AddFirst(key);
            }
        }

        private SolidSet Extract(SideItem item)
        {
            var set = new SolidSet();
            try
            {
                Document doc = _host;
                Transform toHost = null;
                if (item.Slot >= 0)
                {
                    ClashLinks.Resolved link;
                    if (!_links.TryGetValue(item.Slot, out link))
                    {
                        link = ClashLinks.Resolve(_host, _slots[item.Slot]);
                        _links[item.Slot] = link;
                    }
                    if (link == null)
                    {
                        set.Error = true;
                        set.Reason = "Линк (" + _slots[item.Slot].Name + ") unload хийгдсэн эсвэл олдсонгүй.";
                        return set;
                    }
                    doc = link.Doc;
                    toHost = link.Transform;
                }

                Element e = doc.GetElement(new ElementId(item.IdValue));
                if (e == null)
                {
                    set.Error = true;
                    set.Reason = "Элемент загвараас устсан.";
                    return set;
                }

                GeometryElement ge = e.get_Geometry(_options);
                if (ge == null)
                {
                    set.Unsupported = true;
                    set.Reason = "Геометргүй элемент.";
                    return set;
                }
                set.Owned.Add(ge);

                Collect(ge, toHost, set, 0);
                if (set.Solids.Count == 0)
                {
                    set.Unsupported = true;
                    set.Reason = "Бодис (solid) геометр байхгүй — шалгах боломжгүй.";
                    set.DisposeAll();                      // ашиглах solid байхгүй — геометрийн обьектыг шууд чөлөөлнө
                }
            }
            catch (Exception ex)
            {
                set.DisposeAll();
                set.Error = true;
                set.Reason = "Геометр унших алдаа (" + ex.GetType().Name + ").";
            }
            return set;
        }

        private void Collect(GeometryElement ge, Transform toHost, SolidSet set, int depth)
        {
            if (depth > 4) return;
            foreach (GeometryObject go in ge)
            {
                var solid = go as Solid;
                if (solid != null)
                {
                    if (!Usable(solid)) continue;
                    Solid use = solid;
                    if (toHost != null && !toHost.IsIdentity)
                    {
                        use = SolidUtils.CreateTransformed(solid, toHost);
                        set.Owned.Add(use);                    // хөрвүүлсэн хуулбар нь тусдаа обьект
                    }
                    set.Solids.Add(new SolidEntry { Solid = use, Box = SolidBox(use, null) });
                    continue;
                }

                var inst = go as GeometryInstance;
                if (inst != null)
                {
                    GeometryElement inner = inst.GetInstanceGeometry();
                    if (inner != null)
                    {
                        set.Owned.Add(inner);                  // GetInstanceGeometry() дуудлага бүр шинэ GeometryElement үүсгэнэ
                        Collect(inner, toHost, set, depth + 1);
                    }
                }
            }
        }

        private static bool Usable(Solid s)
        {
            try { return s != null && s.Volume > 1e-9 && s.Faces.Size > 0; }
            catch (Exception) { return false; }
        }

        /// <summary>Solid-ийн bbox-ыг (local + transform) host координатын AABB (мм) болгоно.</summary>
        private static Aabb SolidBox(Solid s, Transform extra)
        {
            BoundingBoxXYZ bb = s.GetBoundingBox();
            Transform t = bb.Transform;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                var corner = new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z);
                XYZ w = t.OfPoint(corner);
                if (extra != null) w = extra.OfPoint(w);
                if (w.X < minX) minX = w.X; if (w.X > maxX) maxX = w.X;
                if (w.Y < minY) minY = w.Y; if (w.Y > maxY) maxY = w.Y;
                if (w.Z < minZ) minZ = w.Z; if (w.Z > maxZ) maxZ = w.Z;
            }
            return new Aabb(minX * ClashUnits.FeetToMm, minY * ClashUnits.FeetToMm, minZ * ClashUnits.FeetToMm,
                            maxX * ClashUnits.FeetToMm, maxY * ClashUnits.FeetToMm, maxZ * ClashUnits.FeetToMm);
        }
    }
}
