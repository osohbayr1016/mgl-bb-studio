using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>«Ямар ч элемент зөөх» simulation-ийн эхлэх шалгалтын дүн.  ⚠️ ЗӨВХӨН long id / текст — амьд Revit обьект ХАДГАЛАХГҮЙ.</summary>
    internal sealed class SimMoveCheck
    {
        public bool Ok;
        public string Problem;
        /// <summary>Revit ЗӨӨЛГҮЙ нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил, зөвхөн унших) — «зөөхгүй».  false = зүгээр л дэмжигдээгүй.</summary>
        public bool Refused;
        public bool NeedsAck;
        /// <summary>Хэрэглэгчийн сонгосон (Revit-д ЯГ ЭДГЭЭРИЙГ MoveElements-д өгнө).</summary>
        public List<long> SelectedIds = new List<long>();
        /// <summary>Зөөгдөх элементэд хостлогдсон (хана дээрх хаалга, цонх…) — Revit өөрөө хамт хөдөлгөнө; дэлгэц дээр хамт харуулна.</summary>
        public List<long> HostedIds = new List<long>();
        /// <summary>Нэгдсэн (join) хөрш — Revit төгсгөлийг автоматаар засна.</summary>
        public List<long> ReactiveIds = new List<long>();
        /// <summary>Хост (хаалга/цонхны хана) — нүх нь хамт хөдөлдөг тул статик геометрийн мөргөлдөөнд оролцуулахгүй.</summary>
        public List<long> HostIds = new List<long>();
        public double[] LineXY;
        public string LineReason;
        public string Name;
        public long PrimaryId;
        public string PrimaryUid;
        public SimKind Kind;
        public List<string> Notes = new List<string>();

        public IEnumerable<long> AllMovingIds { get { return SelectedIds.Concat(HostedIds); } }
    }

    /// <summary>
    /// Ямар ч загварын элементийг (Хана, хаалга, багана, шал, суваг, тавилга…) simulation-д зөөж болох эсэх + хамт хөдлөх/засагдах хөрш, хост.
    ///
    /// ТАТГАЛЗАХ (ЯАГААД-тай, Монголоор): 3D бие биш (тайлбар, түвшин, тор, өрөө), линк загварын элемент, Pin, группийн гишүүн/групп, design option, Stacked ханын гишүүн,
    /// зөвхөн унших файл, өөр хэрэглэгчид эзэмшигдсэн (workshare).  «Буруу байж болох simulation» хийхээсээ илүү ил татгалзана.
    /// </summary>
    internal static class SimElementRules
    {
        internal const int MaxSelected = 40;
        internal const int MaxHosted = 120;

        internal static SimMoveCheck Check(Document doc, IList<ElementId> ids)
        {
            var res = new SimMoveCheck();
            if (doc == null) { res.Problem = "Идэвхтэй баримт алга."; return res; }
            if (doc.IsFamilyDocument) { res.Problem = "Family файлд ажиллахгүй — зөвхөн төслийн (project) файлд."; return res; }
            if (ids == null || ids.Count == 0) { res.Problem = "Зөөх элемент сонгогдоогүй байна."; return res; }
            if (ids.Count > MaxSelected) { res.Problem = ids.Count + " элемент сонгогдсон — нэг дор хамгийн ихдээ " + MaxSelected + " элементийг зөөж шалгана."; return res; }

            try
            {
                if (doc.IsReadOnly) { res.Problem = "Файл зөвхөн унших горимд байна (read-only) — хөдөлгөөнийг шалгах боломжгүй."; res.Refused = true; return res; }

                var elements = new List<Element>();
                foreach (ElementId id in ids)
                {
                    Element e = doc.GetElement(id);
                    string problem = ElementProblem(doc, e, res);
                    if (problem != null) { res.Problem = problem; return res; }
                    elements.Add(e);
                }

                // Workshare: хамт өөрчлөгдөх элемент (хост, хөрш) өөр хэрэглэгчид эзэмшигдсэн бол Revit татгалзана.
                foreach (Element e in elements) res.SelectedIds.Add(e.Id.Value);
                res.PrimaryId = elements[0].Id.Value;
                try { res.PrimaryUid = elements[0].UniqueId; } catch (Exception) { }
                res.Kind = SimKinds.Of(elements[0]);
                res.Name = elements.Count == 1 ? SimKinds.LabelOf(elements[0]) : elements.Count + " элемент (" + SimKinds.CategoryName(elements[0]) + " …)";

                var selected = new HashSet<long>(res.SelectedIds);
                foreach (Element e in elements)
                {
                    CollectHosted(doc, e, res.HostedIds, selected);
                    CollectJoined(doc, e, res.ReactiveIds, selected);
                    FamilyInstance fi = e as FamilyInstance;
                    if (fi != null)
                    {
                        Element host = null;
                        try { host = fi.Host; } catch (Exception) { }
                        if (host != null)
                        {
                            res.HostIds.Add(host.Id.Value);
                            Wall hw = host as Wall;
                            if (hw != null && elements.Count == 1)
                            {
                                var lc = hw.Location as LocationCurve;
                                var line = lc != null ? lc.Curve as Line : null;
                                if (line != null)
                                {
                                    XYZ d = line.Direction;
                                    double l = Math.Sqrt(d.X * d.X + d.Y * d.Y);
                                    if (l > 1e-6)
                                    {
                                        res.LineXY = new[] { d.X / l, d.Y / l };
                                        res.LineReason = "Хананд суурилсан элемент — зөвхөн хананы дагуу зөөгдөнө.";
                                    }
                                }
                            }
                            else if (hw == null)
                                res.Notes.Add("Элемент «" + SimKinds.CategoryName(host) + "»-д хостлогдсон — Revit хост дээрээс гарах зөөлтийг зөвшөөрөхгүй байж болно (шалгалт гаргана).");
                        }
                    }
                }
                res.HostedIds = res.HostedIds.Distinct().Take(MaxHosted).ToList();
                res.ReactiveIds = res.ReactiveIds.Distinct().ToList();
                res.HostIds = res.HostIds.Distinct().ToList();

                if (doc.IsWorkshared)
                {
                    var dependents = res.HostedIds.Concat(res.ReactiveIds).Concat(res.HostIds);
                    int notOwned;
                    string foreign = PreChangeWallRules.DependentOwnership(doc, dependents, out notOwned);
                    if (foreign != null) { res.Problem = foreign; res.Refused = true; return res; }
                    if (notOwned > 0) res.NeedsAck = true;
                }

                res.Ok = true;
                return res;
            }
            catch (Exception ex)
            {
                res.Ok = false;
                res.Problem = "Элементийг шалгаж чадсангүй (" + ex.GetType().Name + ").";
                return res;
            }
        }

        /// <summary>null = зөөж болно.  Эс бөгөөс шалтгаан (`res.Refused`/`NeedsAck`-ыг шаардлагатай бол тавина).</summary>
        private static string ElementProblem(Document doc, Element e, SimMoveCheck res)
        {
            if (e == null || !e.IsValidObject) return "Элемент олдсонгүй (устсан байж болзошгүй).";
            if (e is RevitLinkInstance) return "Линк загварыг энд зөөх боломжгүй — линк файлаа нээж шалгана уу.";
            if (e is Group) return "Группийг шууд зөөх дэмжигдээгүй — группийн доторх элементийг эсвэл группийг засварлах горимд нээж шалгана уу.";
            if (!SimKinds.IsModelBody(e)) return "«" + SimKinds.CategoryName(e) + "» нь зөөж шалгах 3D элемент биш (тайлбар, түвшин, тор, өрөө…).";

            BoundingBoxXYZ bb = null;
            try { bb = e.get_BoundingBox(null); } catch (Exception) { }
            if (bb == null) return "Элемент геометргүй (bounding box олдсонгүй) — «" + SimKinds.CategoryName(e) + "» зөөж шалгах боломжгүй.";

            try { if (e.Pinned) { res.Refused = true; return "Элемент түгжигдсэн (Pin) байна — эхлээд Unpin хийнэ үү."; } } catch (Exception) { }
            try
            {
                if (e.GroupId != null && e.GroupId != ElementId.InvalidElementId)
                    return "Группийн гишүүн элемент — группээ засварлах горимд нээж шалгана уу (дэмжигдээгүй).";
            }
            catch (Exception) { }
            try { if (e.DesignOption != null) return "Design option доторх элемент — дэмжигдээгүй (өрөө, харагдац сонгосон option-оос хамаарна)."; } catch (Exception) { }
            var wall = e as Wall;
            if (wall != null)
            {
                try { if (wall.IsStackedWallMember) return "Stacked Wall-ийн гишүүн хана — зөөх боломжгүй (бүтэн Stacked хананы дэмжлэг дараа)."; } catch (Exception) { }
            }

            if (doc.IsWorkshared)
            {
                try
                {
                    CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, e.Id);
                    if (st == CheckoutStatus.OwnedByOtherUser)
                    {
                        string owner = null;
                        try { owner = WorksharingUtils.GetWorksharingTooltipInfo(doc, e.Id).Owner; } catch (Exception) { }
                        res.Refused = true;
                        return "Элемент өөр хэрэглэгчид эзэмшигдсэн" + (string.IsNullOrEmpty(owner) ? "" : " (" + owner + ")") + " — засах боломжгүй.";
                    }
                    if (st == CheckoutStatus.NotOwned) res.NeedsAck = true;
                }
                catch (Exception) { /* эзэмшил уншигдсангүй — Revit commit дээр өөрөө шийднэ */ }
            }
            return null;
        }

        /// <summary>Хостлогдсон (хаалга, цонх, нүх, тавилга…) элементүүд — Revit хамт хөдөлгөнө.</summary>
        private static void CollectHosted(Document doc, Element e, List<long> hosted, HashSet<long> exclude)
        {
            try
            {
                var wall = e as Wall;
                if (wall != null)
                {
                    IList<ElementId> found = wall.FindInserts(true, true, true, true);
                    if (found != null)
                        foreach (ElementId id in found)
                        {
                            if (hosted.Count >= MaxHosted) break;
                            Element x = doc.GetElement(id);
                            if (x is FamilyInstance && !exclude.Contains(id.Value)) hosted.Add(id.Value);
                        }
                    return;
                }
                ICollection<ElementId> deps = e.GetDependentElements(new ElementClassFilter(typeof(FamilyInstance)));
                if (deps == null) return;
                foreach (ElementId id in deps)
                {
                    if (hosted.Count >= MaxHosted) break;
                    var fi = doc.GetElement(id) as FamilyInstance;
                    if (fi == null || exclude.Contains(id.Value)) continue;
                    Element host = null;
                    try { host = fi.Host; } catch (Exception) { }
                    if (host != null && host.Id == e.Id) hosted.Add(id.Value);
                }
            }
            catch (Exception) { /* хостлогдсоныг уншиж чадсангүй — хамт харуулахгүй, Revit sandbox-д шалгагдана */ }
        }

        /// <summary>Нэгдсэн (join) хөрш: геометрийн join + ханын төгсгөлийн холбоос.  Revit эдгээрийг зөөлтийн үед автоматаар засна.</summary>
        private static void CollectJoined(Document doc, Element e, List<long> reactive, HashSet<long> exclude)
        {
            try
            {
                ICollection<ElementId> joined = JoinGeometryUtils.GetJoinedElements(doc, e);
                if (joined != null)
                    foreach (ElementId id in joined) if (!exclude.Contains(id.Value)) reactive.Add(id.Value);
            }
            catch (Exception) { }
            try
            {
                var lc = e.Location as LocationCurve;
                if (lc != null)
                    for (int end = 0; end < 2; end++)
                    {
                        ElementArray arr = lc.get_ElementsAtJoin(end);
                        if (arr == null) continue;
                        foreach (Element x in arr)
                            if (x != null && x.Id != e.Id && !exclude.Contains(x.Id.Value)) reactive.Add(x.Id.Value);
                    }
            }
            catch (Exception) { }
        }
    }
}
