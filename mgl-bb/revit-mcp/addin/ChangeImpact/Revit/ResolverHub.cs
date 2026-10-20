using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Холбооны РЕЗОЛЬВЕРУУД — нэг элементээс «өөрчлөлт хаашаа дамжих вэ»-г Revit-ийн ТОДОРХОЙ холбоогоор олно.
    /// Холбоо бүр: эх, зорилт, төрөл, ИТГЭЛ (A-D), ШАЛТГААН, резольверын нэр.  Итгэлийн дүрэм (хэзээ ч дээшлүүлэхгүй):
    ///
    ///   A  view_owner (харагдацад ХАМААРАХ элемент), viewport_sheet / schedule_instance (хуудсанд байрласан)
    ///   B  Revit-ийн өгөгдлийн холбоо: tag_host, dimension_ref, host_hosted/host, type_instances, dependent,
    ///      level_views, room_boundary, group_member, mep_connected, view_template, dependent_view, revision_sheet
    ///   C  visibility (харагдацын шүүлтүүрээр «магадгүй харагдана»), schedule_membership (хүснэгтийн мөрөнд орсон)
    ///   D  schedule_category (ангилал таарч байна), project_info (title block-д харагдаж болно) — шууд нотолгоо алга
    ///
    /// ⚠️ Revit API — зөвхөн үндсэн thread дээр, ХЭЗЭЭ Ч `Step`-ээс `Step` рүү Revit обьект ХАДГАЛАХГҮЙ (зөвхөн id).
    /// Загварыг ӨӨРЧИЛӨХГҮЙ (транзакцгүй).  Резольвер бүр ТУСДАА try/catch: нэг нь унавал тэмдэглэнэ, бусад нь ажиллана.
    /// </summary>
    internal sealed partial class ResolverHub
    {
        private Document _doc;
        private readonly Dictionary<long, ImpactNode> _nodes = new Dictionary<long, ImpactNode>();
        private readonly Dictionary<long, List<ImpactEdge>> _structural = new Dictionary<long, List<ImpactEdge>>();
        private readonly Dictionary<long, List<ImpactEdge>> _indexed = new Dictionary<long, List<ImpactEdge>>();
        private readonly HashSet<string> _noteSet = new HashSet<string>(StringComparer.Ordinal);
        private int _resolverFailures;
        private const int MaxChildren = 1000;

        internal readonly List<string> Notes = new List<string>();
        internal int ResolverFailures { get { return _resolverFailures; } }
        internal int UnknownNodes { get; private set; }
        /// <summary>
        /// Холбоосын зорилт (харагдацад хамаарах элементийн эзэн харагдац, суулгасан элементийн хост) уншигдаагүй тул A/B холбоо ОРХИГДСОН тоо.
        /// «Нөлөөлөл олдсонгүй» нь орхигдсон холбоог үгүйсгэж чадахгүй → тайлан «бүрэн БИШ» (`CompletenessInputs.UnreadableLinks`).
        /// </summary>
        internal int UnreadableLinks { get; private set; }

        private readonly HashSet<string> _truncationKinds = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>
        /// Хязгаар (cap) хэтэрч зарим холбоо ОРХИГДСОН тоо.  ⚠️ «Нөлөөлөл олдсонгүй» нь орхигдсон холбоог үгүйсгэж чадахгүй —
        /// тиймээс энэ тоо &gt; 0 бол тайлан «бүрэн БИШ» (`Incomplete`) гэж тэмдэглэгдэнэ.
        /// </summary>
        internal int Truncations { get; private set; }
        /// <summary>Ялгаатай хязгаарын төрөл бүрийн ТОВЧ тайлбар (тайлангийн шалтгаан).</summary>
        internal readonly List<string> TruncationReasons = new List<string>();
        /// <summary>Төслийн ерөнхий тохиргоо (Phase, Filter, Material...) өөрчлөгдсөн ч нөлөөллийг ТООЦООЛООГҮЙ тоо.</summary>
        internal int GlobalUnenumerated { get; private set; }

        internal ResolverHub(Document doc)
        {
            _doc = doc;
        }

        /// <summary>
        /// Кэшлэгдсэн (ХУУЛСАН: ImpactNode/ImpactEdge/id-ийн индекс) hub-ийг шинэ ажилд дахин ашиглахын тулд ЗӨВХӨН энэ Step-ийн амьд `Document`-д холбоно.
        /// ⚠️ Hub-д амьд обьект ХАДГАЛАГДАХГҮЙ: `Detach()` нь `Document`-ийн лавлагааг ТАСЛАНА — кэш `Document`-ийг урт хугацаанд барихгүй.
        /// </summary>
        internal void Attach(Document doc) { _doc = doc; }

        internal void Detach() { _doc = null; }

        private void Note(string text)
        {
            if (_noteSet.Add(text)) Notes.Add(text);
        }

        /// <summary>Хязгаарт хүрсэн: тоолж, тэмдэглэж, шалтгааныг тайланд өгнө (чимээгүй таслахгүй).</summary>
        private void Truncated(string code, string reason)
        {
            Truncations++;
            Note("⚠ " + reason);
            if (_truncationKinds.Add(code)) TruncationReasons.Add(reason);
        }

        /// <summary>`MaxChildren`-ээс олон бол эхнийг нь л авч, ИЛ тэмдэглэнэ.</summary>
        private IEnumerable<T> Cap<T>(ICollection<T> items, string code, string what, ImpactNode n)
        {
            if (items.Count <= MaxChildren) return items;
            Truncated(code, "«" + Short(n) + "» — " + what + ": " + items.Count + " байна, эхний " + MaxChildren + "-г л авав.");
            return items.Take(MaxChildren);
        }

        private void Fail(string resolver, Exception ex)
        {
            _resolverFailures++;
            Note("Резольвер «" + resolver + "» зарим элементэд алдаатай (" + ex.GetType().Name + ") — тэр холбоо орхигдсон.");
            // Лог: резольверын нэр + алдааны ТӨРӨЛ л (элементийн нэр, агуулга ОРОХГҮЙ); анхны 20 л (логийг дүүргэхгүй).
            if (_resolverFailures <= 20)
                SmartLog.Warn("impact", "resolver_failed", new { resolver, ex = ex.GetType().Name });
        }

        /* ============================== NODES ============================== */

        internal Element Live(long id)
        {
            try { return _doc.GetElement(new ElementId(id)); }
            catch (Exception) { return null; }
        }

        /// <summary>Зангилааны тайлбар: амьд элемент → уншина; устсан → бүртгэлийн кэш; үгүй бол «мэдээлэл алга».</summary>
        internal ImpactNode Node(long id)
        {
            ImpactNode n;
            if (_nodes.TryGetValue(id, out n)) return n;

            Element e = Live(id);
            if (e != null)
            {
                n = ImpactSnapshotter.Read(e);
            }
            else if (ImpactCapture.TryGetNode(_doc, id, out n))
            {
                // кэшийн хуулбар (устсан)
            }
            else
            {
                n = new ImpactNode { Id = id, Unknown = true };
                UnknownNodes++;
            }
            _nodes[id] = n;
            return n;
        }

        /// <summary>
        /// Мэдэгдэж буй зангилаа (бүртгэлийн мөрөөс сэргээсэн) оруулна.  Аль хэдийн ИДЭВХТЭЙ зангилаа байвал хөндөхгүй; харин «мэдээлэл алга»
        /// (Unknown) тэмдэглэгээг бодит мэдээллээр СОЛИНО (хаалттай workset-д байсан/дараа нь устсан элементийн хуучин идентити).
        /// </summary>
        internal void Seed(ImpactNode n)
        {
            if (n == null) return;
            ImpactNode existing;
            if (_nodes.TryGetValue(n.Id, out existing))
            {
                if (!existing.Unknown) return;
                UnknownNodes = Math.Max(0, UnknownNodes - 1);
            }
            _nodes[n.Id] = n;
        }

        internal string Label(long id)
        {
            ImpactNode n = Node(id);
            return n.Label;
        }

        /* ============================== EXPAND ============================= */

        /// <summary>Бүтцийн (индексгүй) холбоо — кэштэй.  Эхний граф үүнийг л хэрэглэнэ.</summary>
        internal IReadOnlyList<ImpactEdge> Structural(long id)
        {
            List<ImpactEdge> list;
            if (_structural.TryGetValue(id, out list)) return list;
            list = new List<ImpactEdge>();
            _structural[id] = list;          // давталтаас хамгаална
            ImpactNode n = Node(id);
            Element e = Live(id);

            Guard("view_owner", () => ViewOwner(n, list));
            Guard("host", () => HostEdge(n, e, list));
            Guard("group", () => GroupEdge(n, e, list));

            switch (n.Kind)
            {
                case ImpactNodeKind.View:
                    Guard("view_to_sheet", () => ViewToSheet(n, e, list));
                    Guard("view_template", () => ViewsOfTemplate(n, e, list));
                    break;
                case ImpactNodeKind.Schedule:
                    Guard("schedule_instance", () => ScheduleToSheet(n, list));
                    break;
                case ImpactNodeKind.Type:
                    Guard("type_instances", () => TypeInstances(n, e, list));
                    break;
                case ImpactNodeKind.Level:
                    Guard("level_views", () => LevelViews(n, list));
                    break;
                case ImpactNodeKind.Global:
                    Guard("global", () => GlobalEdges(n, e, list));
                    break;
                case ImpactNodeKind.Element:
                case ImpactNodeKind.Room:
                case ImpactNodeKind.Link:
                case ImpactNodeKind.Group:
                    Guard("tags_dimensions", () => TagsAndDimensions(n, list));
                    Guard("dependents", () => Dependents(n, e, list));
                    Guard("room_sides", () => RoomSides(n, e, list));
                    Guard("mep", () => MepNeighbours(n, e, list));
                    break;
            }
            // ⚠️ Кэшэд ДЕДУПЛИКАЦИЙН ДАРААХ жагсаалтыг хадгална: өмнө нь давталтын хамгаалалтын түр жагсаалт (давхардалтай) кэшэд үлдэж,
            // хоёр дахь граф (`Combined`) нэг холбоог олон удаа авч `PathCount`-ыг хөөрөгддөг байв.
            List<ImpactEdge> result = Dedupe(list);
            _structural[id] = result;
            return result;
        }

        /// <summary>Индексээр гарах холбоо (өрөөний хил, харагдац, хүснэгт).  Хоёр дахь граф нэмж хэрэглэнэ.</summary>
        internal IReadOnlyList<ImpactEdge> Indexed(long id)
        {
            List<ImpactEdge> list;
            if (_indexed.TryGetValue(id, out list)) return list;
            list = new List<ImpactEdge>();
            _indexed[id] = list;
            Guard("indexed", () => IndexedEdges(id, list));
            List<ImpactEdge> result = Dedupe(list);
            _indexed[id] = result;
            return result;
        }

        internal IReadOnlyList<ImpactEdge> Combined(long id, bool useIndexed)
        {
            IReadOnlyList<ImpactEdge> s = Structural(id);
            if (!useIndexed) return s;
            IReadOnlyList<ImpactEdge> x = Indexed(id);
            if (x.Count == 0) return s;
            var all = new List<ImpactEdge>(s.Count + x.Count);
            all.AddRange(s);
            all.AddRange(x);
            return Dedupe(all);              // бүтцийн ба индексийн холбоо давхцаж болно (ижил зорилт + холбоо)
        }

        private void Guard(string resolver, Action a)
        {
            try { a(); }
            catch (Exception ex) { Fail(resolver, ex); }
        }

        private static List<ImpactEdge> Dedupe(List<ImpactEdge> list)
        {
            if (list.Count < 2) return list;
            var index = new Dictionary<string, int>(StringComparer.Ordinal);
            var res = new List<ImpactEdge>(list.Count);
            foreach (ImpactEdge e in list)
            {
                string k = e.To + "|" + e.Relationship;
                int at;
                if (!index.TryGetValue(k, out at)) { index[k] = res.Count; res.Add(e); }
                else if (ImpactConf.Rank(e.Confidence) < ImpactConf.Rank(res[at].Confidence)) res[at] = e;   // ижил холбоо — ХҮЧТЭЙ нь үлдэнэ
            }
            return res;
        }

        private static ImpactEdge Edge(long from, long to, string rel, ImpactConfidence conf, string reason, string resolver)
        {
            return new ImpactEdge { From = from, To = to, Relationship = rel, Confidence = conf, Reason = reason, Resolver = resolver };
        }

        /* ============================== A: DIRECT ========================== */

        /// <summary>Харагдацад ХАМААРАХ (view-specific) элемент → тэр харагдац.  Viewport/хүснэгтийн instance → хуудас.</summary>
        private void ViewOwner(ImpactNode n, List<ImpactEdge> output)
        {
            if (n.OwnerViewId <= 0 || n.OwnerViewId == n.Id) return;
            ImpactNode owner = Node(n.OwnerViewId);
            if (owner.Unknown)
            {
                // Харагдацад хамаарах элементийн ЭЗЭН харагдац уншигдсангүй — A холбоог үүсгэж чадсангүй.  Чимээгүй алгасахгүй.
                UnreadableLinks++;
                return;
            }
            string what = owner.Kind == ImpactNodeKind.Sheet ? "хуудсанд" : "харагдацад";
            output.Add(Edge(n.Id, owner.Id, "view_owner", ImpactConfidence.A,
                "«" + Short(n) + "» нь зөвхөн «" + Short(owner) + "» " + what + " хамаарна (view-specific)", "view_owner"));
        }

        private void ViewToSheet(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            EnsureViewportIndex();
            List<long> vps;
            if (_viewportsByView.TryGetValue(n.Id, out vps))
            {
                foreach (long vp in vps)
                {
                    long sheet;
                    if (!_viewportSheet.TryGetValue(vp, out sheet)) continue;
                    ImpactNode s = Node(sheet);
                    output.Add(Edge(n.Id, sheet, "viewport_sheet", ImpactConfidence.A,
                        "«" + Short(n) + "» харагдац «" + Short(s) + "» хуудсанд байрласан", "placement"));
                }
            }

            var v = e as View;
            if (v != null)
            {
                ICollection<ElementId> dep = null;
                try { dep = v.GetDependentViewIds(); } catch (Exception) { }
                if (dep != null)
                    foreach (ElementId d in Cap(dep, "dependent_views", "хамаарагч харагдац", n))
                        output.Add(Edge(n.Id, d.Value, "dependent_view", ImpactConfidence.B,
                            "«" + Short(n) + "»-ийн тэмдэглэгээ хамаарагч (dependent) харагдацад ч харагдана", "placement"));
            }
        }

        private void ScheduleToSheet(ImpactNode n, List<ImpactEdge> output)
        {
            EnsureViewportIndex();
            List<long> inst;
            if (!_scheduleInstances.TryGetValue(n.Id, out inst)) return;
            foreach (long i in inst)
                output.Add(Edge(n.Id, i, "schedule_instance", ImpactConfidence.A,
                    "«" + Short(n) + "» хүснэгт хуудсанд байрласан (instance)", "placement"));
        }

        /* ============================== B: DATA RELATIONS ================== */

        private void HostEdge(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            long host = n.HostId;
            if (host <= 0 && e != null)
            {
                var fi = e as FamilyInstance;
                if (fi != null && fi.Host != null) host = fi.Host.Id.Value;
            }
            if (host <= 0 || host == n.Id) return;
            ImpactNode h = Node(host);
            if (h.Unknown)
            {
                UnreadableLinks++;          // хост уншигдсангүй — B холбоо орхигдсон (чимээгүй алгасахгүй)
                return;
            }
            output.Add(Edge(n.Id, host, "host", ImpactConfidence.B,
                "«" + Short(n) + "» нь «" + Short(h) + "» хост дээр байрласан — хостын нүх/хэлбэр өөрчлөгдөж болно", "host"));
        }

        private void GroupEdge(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            if (e == null) return;
            ElementId gid = e.GroupId;
            if (gid == null || gid == ElementId.InvalidElementId) return;
            output.Add(Edge(n.Id, gid.Value, "group_member", ImpactConfidence.B,
                "«" + Short(n) + "» нь группын гишүүн — группын төрөл бүх хуулбарт нөлөөлнө", "group"));
        }

        private void TypeInstances(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            var type = e as ElementType;
            if (type == null) return;

            // Ангилалаар ХУРДАН шүүгээд (quick filter) зөвхөн тэр ангиллын элементэд «төрлийн параметр» шүүлт (slow) —
            // системийн төрөл (WallType), family symbol, тэр байтугай annotation (tag, text) төрөлд ч ижил ажиллана.
            // (`FamilyInstanceFilter` нь зөвхөн FamilyInstance олдог тул tag-ийн family symbol-д хүрэхгүй.)
            ICollection<ElementId> ids = null;
            if (type.Category != null)
            {
                var rule = new FilterElementIdRule(new ParameterValueProvider(new ElementId(BuiltInParameter.ELEM_TYPE_PARAM)), new FilterNumericEquals(), type.Id);
                ids = new FilteredElementCollector(_doc).OfCategoryId(type.Category.Id).WhereElementIsNotElementType()
                    .WherePasses(new ElementParameterFilter(rule)).ToElementIds();
            }
            else
            {
                var sym = type as FamilySymbol;
                if (sym != null)
                    ids = new FilteredElementCollector(_doc).WherePasses(new FamilyInstanceFilter(_doc, sym.Id)).ToElementIds();
            }
            if (ids == null)
            {
                // Энэ төрлийн хувилбарыг тоолох арга олдсонгүй (ангилалгүй, FamilySymbol биш) — «хувилбар алга» гэж ҮЗЭХГҮЙ.
                Truncated("type_unresolved", "«" + Short(n) + "» төрлийн хувилбаруудыг тодорхойлж чадсангүй (ангилалгүй төрөл) — нөлөөлөл бүрэн биш.");
                return;
            }

            foreach (ElementId id in Cap(ids, "type_instances", "төрлийн хувилбар", n))
                output.Add(Edge(n.Id, id.Value, "type_instances", ImpactConfidence.B,
                    "«" + Short(n) + "» төрлийг ашигладаг элемент (төрөл өөрчлөгдвөл бүх хувилбарт нөлөөлнө)", "type_instances"));
        }

        private void LevelViews(ImpactNode n, List<ImpactEdge> output)
        {
            EnsureViewIndex();
            List<long> views;
            if (_viewsByLevel.TryGetValue(n.Id, out views))
                foreach (long v in Cap(views, "level_views", "давхарт хамаарах харагдац", n))
                    output.Add(Edge(n.Id, v, "level_views", ImpactConfidence.B,
                        "«" + Short(n) + "» давхарт хамаарах харагдац (түвшин/нэр өөрчлөгдвөл харагдац өөрчлөгдөнө)", "level"));
            // Давхрын өөрчлөлт нь тэр давхар дээрх БҮХ элементэд нөлөөлж болох ч бид элементүүдийг ЖАГСААХГҮЙ — «бүрэн биш».
            Truncated("level_elements", "Давхрын (Level) өөрчлөлт нь давхар дээрх БҮХ элементэд нөлөөлж болно — зөвхөн давхарт хамаарах харагдацыг харуулав, элементүүдийг жагсаагаагүй.");
        }

        private void ViewsOfTemplate(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            var v = e as View;
            if (v == null || !v.IsTemplate) return;
            EnsureViewIndex();
            List<long> views;
            if (_viewsByTemplate.TryGetValue(n.Id, out views))
                foreach (long vid in Cap(views, "view_template", "template-ийг ашигладаг харагдац", n))
                    output.Add(Edge(n.Id, vid, "view_template", ImpactConfidence.B,
                        "«" + Short(n) + "» view template-ийг ашигладаг харагдац", "view_template"));
        }

        private void TagsAndDimensions(ImpactNode n, List<ImpactEdge> output)
        {
            EnsureTagIndex();
            List<long> tags;
            if (_tagsByHost.TryGetValue(n.Id, out tags))
                foreach (long t in Cap(tags, "tags", "tag", n))
                    output.Add(Edge(n.Id, t, "tag_host", ImpactConfidence.B,
                        "«" + Short(n) + "»-ийг тэмдэглэсэн tag (текст/байрлал өөрчлөгдөж болно)", "tags"));

            EnsureDimensionIndex();
            List<long> dims;
            if (_dimsByRef.TryGetValue(n.Id, out dims))
                foreach (long d in Cap(dims, "dimensions", "хэмжээс", n))
                    output.Add(Edge(n.Id, d, "dimension_ref", ImpactConfidence.B,
                        "«" + Short(n) + "»-ийг лавласан хэмжээс (утга өөрчлөгдөж болно)", "dimensions"));
        }

        /// <summary>Revit-ийн «логик хүүхдүүд» (хостолсон, хамаарагч) — устгагдах үед хамт устах элементүүд.</summary>
        private void Dependents(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            if (e == null) return;
            ICollection<ElementId> deps = e.GetDependentElements(null);
            if (deps == null || deps.Count == 0) return;
            foreach (ElementId id in Cap(deps, "dependents", "хамаарагч элемент", n))
            {
                if (id.Value == n.Id) continue;
                Element c = Live(id.Value);
                if (c == null || c is ElementType) continue;
                // Tag/хэмжээсийг индекс аль хэдийн тусгасан — давхар уншихгүй.
                if (c is IndependentTag || c is SpatialElementTag || c is Dimension) continue;

                var fi = c as FamilyInstance;
                bool hosted = false;
                try { hosted = fi != null && fi.Host != null && fi.Host.Id == e.Id; } catch (Exception) { }
                output.Add(Edge(n.Id, id.Value, hosted ? "host_hosted" : "dependent", ImpactConfidence.B,
                    hosted ? "«" + Short(n) + "» хост дээр хостолсон элемент" : "«" + Short(n) + "»-ээс хамаарагч (логик хүүхэд) элемент", "dependents"));
            }
        }

        /// <summary>
        /// Хаалга/цонх: `FromRoom` / `ToRoom` — хаалганы хоёр талын өрөө (нэг талын өрөө нь эсвэл гадаа байж болно).
        /// ⚠️ Revit нь энэ холбоог ФАЗ-аас хамааруулж тодорхойлдог; олдоогүй (null) нь «хамааралгүй» гэсэн үг БИШ.
        /// </summary>
        private void RoomSides(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            var fi = e as FamilyInstance;
            if (fi == null) return;
            Autodesk.Revit.DB.Architecture.Room from = null, to = null;
            try { from = fi.FromRoom; } catch (Exception) { }
            try { to = fi.ToRoom; } catch (Exception) { }
            foreach (Autodesk.Revit.DB.Architecture.Room r in new[] { from, to })
            {
                if (r == null) continue;
                output.Add(Edge(n.Id, r.Id.Value, "room_side", ImpactConfidence.B,
                    "«" + Short(n) + "» нь «" + Short(Node(r.Id.Value)) + "» өрөөний хаалга/цонх (FromRoom/ToRoom) — өрөөний хил, нээлт өөрчлөгдөж болно", "rooms"));
            }
        }

        /// <summary>MEP: холбогч (connector)-оор ШУУД холбогдсон хөрш.  Гүн нь графын `MaxDepth`-ээр хязгаарлагдана.</summary>
        private void MepNeighbours(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            if (e == null) return;
            ConnectorManager cm = null;
            var curve = e as MEPCurve;
            if (curve != null) cm = curve.ConnectorManager;
            else
            {
                var fi = e as FamilyInstance;
                if (fi != null && fi.MEPModel != null) cm = fi.MEPModel.ConnectorManager;
            }
            if (cm == null) return;

            var seen = new HashSet<long>();
            foreach (Connector c in cm.Connectors)
            {
                foreach (Connector other in c.AllRefs)
                {
                    Element owner = other.Owner;
                    if (owner == null || owner.Id == e.Id || owner is MEPSystem) continue;
                    if (!seen.Add(owner.Id.Value)) continue;
                    output.Add(Edge(n.Id, owner.Id.Value, "mep_connected", ImpactConfidence.B,
                        "«" + Short(n) + "» MEP холболтоор «" + Short(Node(owner.Id.Value)) + "»-тай шууд холбогдсон (хэмжээ/налуу өөрчлөгдвөл хөрш өөрчлөгдөж болно)", "mep"));
                    if (seen.Count >= 64)
                    {
                        Truncated("mep_neighbours", "«" + Short(n) + "» MEP элемент 64-өөс олон хөрштэй — эхний 64-г л авав.");
                        return;
                    }
                }
            }
        }

        private void GlobalEdges(ImpactNode n, Element e, List<ImpactEdge> output)
        {
            EnsureViewportIndex();
            if (e is Autodesk.Revit.DB.ProjectInfo)
            {
                foreach (long s in Cap(_sheetIds, "project_info_sheets", "хуудас", n))
                    output.Add(Edge(n.Id, s, "project_info", ImpactConfidence.D,
                        "Төслийн мэдээлэл (Project Information) нь хуудасны title block-д харагдаж болно", "global"));
                return;
            }
            var rev = e as Revision;
            if (rev != null)
            {
                foreach (long s in _sheetIds)
                {
                    var sheet = Live(s) as ViewSheet;
                    if (sheet == null) continue;
                    bool has = false;
                    try { has = sheet.GetAllRevisionIds().Contains(rev.Id); } catch (Exception) { }
                    if (has)
                        output.Add(Edge(n.Id, s, "revision_sheet", ImpactConfidence.B,
                            "Хуудас энэ revision-ыг (revision schedule-д) агуулдаг", "global"));
                }
                return;
            }
            GlobalUnenumerated++;
            Note("Төслийн ерөнхий тохиргоо («" + Short(n) + "») өөрчлөгдсөн — олон харагдац/хуудсанд нөлөөлж болох ч нарийвчлан тооцоолоогүй.");
        }

        /* ============================== POST-INDEX EDGES =================== */

        private void IndexedEdges(long id, List<ImpactEdge> output)
        {
            ImpactNode n = Node(id);
            List<long> rooms;
            if (RoomsByBoundary.TryGetValue(id, out rooms))
                foreach (long r in rooms)
                    output.Add(Edge(id, r, "room_boundary", ImpactConfidence.B,
                        "«" + Short(n) + "» нь «" + Short(Node(r)) + "» өрөөний хилийг үүсгэнэ (талбай/хил өөрчлөгдөж болно)", "rooms"));

            List<long> views;
            if (VisibleViews.TryGetValue(id, out views))
                foreach (long v in views)
                    output.Add(Edge(id, v, "visibility", ImpactConfidence.C,
                        "«" + Short(n) + "» нь «" + Short(Node(v)) + "» харагдацад магадгүй харагдана (Revit-ийн харагдацын шүүлтүүр; crop/нуугдсан/хаагдсан байж болно)", "visibility"));

            List<ScheduleHit> hits;
            if (ScheduleHits.TryGetValue(id, out hits))
                foreach (ScheduleHit h in hits)
                    output.Add(Edge(id, h.ScheduleId, h.Verified ? "schedule_membership" : "schedule_category",
                        h.Verified ? ImpactConfidence.C : ImpactConfidence.D,
                        h.Verified
                            ? "«" + Short(n) + "» нь «" + Short(Node(h.ScheduleId)) + "» хүснэгтийн мөрөнд орсон (аль параметр харагдахыг мэдэхгүй)"
                            : "«" + Short(n) + "»-ийн ангилал «" + Short(Node(h.ScheduleId)) + "» хүснэгтийнхтэй таарч байна (шүүлтүүр/багана тодорхойгүй — таамаг)",
                        "schedules"));
        }

        /* ============================== HELPERS ============================ */

        private static string Short(ImpactNode n)
        {
            if (n.Unknown && string.IsNullOrEmpty(n.Name)) return "#" + n.Id;
            string s = !string.IsNullOrEmpty(n.Name) ? n.Name : (n.Category ?? "Элемент");
            return s.Length > 60 ? s.Substring(0, 57) + "..." : s;
        }
    }
}
