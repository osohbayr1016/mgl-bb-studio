using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using MglBb.Core;
using MglBb.Infra;

namespace MglBb.RevitSide
{
    /// <summary>
    /// «Устгалтын анхааруулга» — ЭНЭ plugin-ий ЦОРЫН ГАНЦ байнгын event (бусад нь товч дарах хүртэл ажиллахгүй):
    ///   1. Revit-ийн Delete командын <c>BeforeExecuted</c> — сонгосон элементийн мэдээллийг (ангилал, нэр, марк, түвшин, үүсгэсэн хүн) устгахаас ӨМНӨ
    ///      авч анхааруулна; «Болих» бол командыг цуцална.  Executed-д бүртгэхгүй тул Revit-ийн өөрийн устгалт хэвээр ажиллана.
    ///   2. Устгалтын updater — устгалттай НЭГ гүйлгээнд загварт DataStorage (schema <see cref="SchemaGuid"/>) үүсгэж «хэн, хэзээ, юуг» бичнэ.
    ///      Шинэ элемент тул хэнээс ч borrow хийхгүй; Synchronize хийхэд central-д очиж хамт ажилладаг бүх хүнд харагдана; Undo бол бүртгэл ч буцна.
    ///      Сонгоогүй элемент (бусад хэрэгслийн устгалт, хамаарал) бүртгэгдэхгүй.  Optional updater — энэ нэмэлтгүй хүнд загвар анхааруулгагүй нээгдэнэ.
    ///   3. Нээх / Synchronize / Reload Latest-ээр өөр хүний шинэ бүртгэл ирвэл Idling-д «… элементийг … устгалаа» гэж нэг удаа мэдэгдэнэ.
    /// ⚠️ SchemaGuid, талбарыг ХЭЗЭЭ Ч бүү өөрчил.  Энд гарсан алдаа Revit-ийн ажлыг саатуулахгүй (бүгд барьж авна, delete-watch-error.txt).
    /// </summary>
    internal static class BbDeleteWatch
    {
        private static readonly Guid SchemaGuid = new Guid("5921c304-1980-4651-b225-8d2c0a784309");
        private const string SchemaName = "MglBbDeleteLog";
        private const string Field = "Json";
        /// <summary>Ажилтны нэрийг (WorksharingUtils) хайх дээд тоо — их сонголтод удаан.</summary>
        private const int MaxCreatorLookups = 300;
        private static readonly TimeSpan PendingLife = TimeSpan.FromMinutes(2);

        private static readonly object Gate = new object();
        private static bool _wired;
        private static bool? _licensed;
        private static Pending _pending;
        private static readonly HashSet<string> _dirty = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static BbDeleteWatchState _state;

        private sealed class Pending
        {
            public Document Doc;
            public DateTime At;
            public string View;
            public HashSet<long> Selected;
            public Dictionary<long, BbDeletedItem> Items;
        }

        public static string StatePath { get { return Path.Combine(Paths.Root, "delete-watch.json"); } }

        internal static BbDeleteWatchState State
        {
            get
            {
                lock (Gate)
                {
                    if (_state == null)
                    {
                        try { _state = BbDeleteWatchState.Load(StatePath); }
                        catch (Exception) { _state = new BbDeleteWatchState(); }
                    }
                    return _state;
                }
            }
        }

        internal static void SaveState()
        {
            try { lock (Gate) State.Save(StatePath); }
            catch (Exception ex) { Log(ex); }
        }

        internal static void Init(UIControlledApplication app)
        {
            if (_wired || app == null) return;
            _wired = true;
            Wire(app.ActiveAddInId, app.CreateAddInCommandBinding);
            app.ControlledApplication.DocumentChanged += OnChanged;
            app.ControlledApplication.DocumentOpened += (s, e) => Guard(() => MarkDirty(e.Document));
            app.ControlledApplication.DocumentSynchronizedWithCentral += (s, e) => Guard(() => MarkDirty(e.Document));
            app.Idling += OnIdling;
        }

        /// <summary>Зөвхөн Gate (тусгаар harness Revit): тэнд энэ DLL add-in биш тул OnStartup ажиллахгүй; үндсэн plugin байхгүй тул лицензийг алгасна.</summary>
        internal static void InitForGate(UIApplication app)
        {
            _licensed = true;
            if (_wired || app == null) return;
            _wired = true;
            Wire(app.ActiveAddInId, app.CreateAddInCommandBinding);
            app.Application.DocumentChanged += OnChanged;
            app.Application.DocumentSynchronizedWithCentral += (s, e) => Guard(() => MarkDirty(e.Document));
            app.Idling += OnIdling;
        }

        private static void Wire(AddInId addin, Func<RevitCommandId, AddInCommandBinding> bind)
        {
            try
            {
                var updater = new LogUpdater(addin);
                UpdaterRegistry.RegisterUpdater(updater, true);
                ElementFilter all = new LogicalOrFilter(new ElementIsElementTypeFilter(false), new ElementIsElementTypeFilter(true));
                UpdaterRegistry.AddTrigger(updater.GetUpdaterId(), all, Element.GetChangeTypeElementDeletion());
            }
            catch (Exception ex) { Log(ex); }
            try { bind(RevitCommandId.LookupPostableCommandId(PostableCommand.Delete)).BeforeExecuted += OnBeforeDelete; }
            catch (Exception ex) { Log(ex); }      // өөр нэмэлт Delete командыг аль хэдийн холбосон — бүртгэл, мэдэгдэл ажиллахгүй
        }

        private static void Guard(Action a)
        {
            try { a(); }
            catch (Exception ex) { Log(ex); }
        }

        private static void Log(Exception ex)
        {
            try { File.AppendAllText(Path.Combine(Paths.Root, "delete-watch-error.txt"), DateTime.Now.ToString("o") + " " + ex + Environment.NewLine); }
            catch { }
        }

        /// <summary>Үндсэн plugin байхгүй бол чимээгүй унтарна; лицензийг сессэд нэг л удаа шалгана.</summary>
        private static bool Licensed()
        {
            if (_licensed == null) _licensed = (MainPlugin.NoLicense || MainPlugin.Find() != null) && MainPlugin.EnsureLicensed();
            return _licensed.Value;
        }

        /* ============================== УСТГАХЫН ӨМНӨ ======================= */

        private static void OnBeforeDelete(object sender, BeforeExecutedEventArgs e)
        {
            try
            {
                Document doc = e.ActiveDocument;
                if (doc == null || doc.IsFamilyDocument || doc.IsReadOnly) return;
                ICollection<ElementId> ids = new UIDocument(doc).Selection.GetElementIds();
                if (ids == null || ids.Count == 0 || !Licensed()) return;
                Pending p = Snapshot(doc, ids);
                if (State.WarnBeforeDelete && !Confirm(doc, p))
                {
                    e.Cancel = true;
                    return;
                }
                lock (Gate) _pending = p;
            }
            catch (Exception ex) { Log(ex); }          // анхааруулга унасан ч Revit-ийн устгалтыг саатуулахгүй
        }

        private static Pending Snapshot(Document doc, ICollection<ElementId> ids)
        {
            var p = new Pending
            {
                Doc = doc,
                At = DateTime.UtcNow,
                View = doc.ActiveView?.Name ?? "",
                Selected = new HashSet<long>(ids.Select(i => i.Value)),
                Items = new Dictionary<long, BbDeletedItem>(),
            };
            foreach (ElementId id in ids)
            {
                if (p.Items.Count >= BbDeleteLog.MaxItems) break;
                Element el = doc.GetElement(id);
                if (el != null) p.Items[id.Value] = Snap(doc, el, p.Items.Count < MaxCreatorLookups);
            }
            return p;
        }

        /// <summary>Зөвхөн Gate: Delete командыг (анхааруулгагүй) дуурайж дараагийн устгалтыг бүртгэхэд бэлдэнэ.</summary>
        internal static void ArmForGate(Document doc, ICollection<ElementId> ids)
        {
            lock (Gate) _pending = Snapshot(doc, ids);
        }

        private static BbDeletedItem Snap(Document doc, Element el, bool creator)
        {
            var it = new BbDeletedItem { Id = el.Id.Value, UniqueId = el.UniqueId ?? "", Category = el.Category?.Name ?? el.GetType().Name };
            try
            {
                string name = el.Name ?? "";
                if (el is FamilyInstance fi && fi.Symbol != null) name = fi.Symbol.FamilyName + ": " + name;
                it.Name = name;
                it.Mark = el.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() ?? "";
                if (el.LevelId != null && el.LevelId != ElementId.InvalidElementId) it.Level = doc.GetElement(el.LevelId)?.Name ?? "";
                if (creator && doc.IsWorkshared) it.Creator = WorksharingUtils.GetWorksharingTooltipInfo(doc, el.Id).Creator ?? "";
            }
            catch (Exception) { }
            return it;
        }

        private static bool Confirm(Document doc, Pending p)
        {
            string me = doc.Application.Username;
            var lines = p.Items.Values.Take(8).Select(BbDeleteLog.Describe).ToList();
            int more = p.Selected.Count - lines.Count;
            if (more > 0) lines.Add("… өөр " + more);
            var others = p.Items.Values.Select(i => i.Creator).Where(c => !string.IsNullOrEmpty(c) && !BbDeleteLog.SameUser(c, me))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            string content = string.Join(Environment.NewLine, lines);
            if (others.Count > 0)
                content += Environment.NewLine + Environment.NewLine + "⚠ Үүнээс " + p.Items.Values.Count(i => others.Contains(i.Creator, StringComparer.OrdinalIgnoreCase)) +
                           " элементийг өөр хүн үүсгэсэн: " + string.Join(", ", others) + ".";
            content += Environment.NewLine + Environment.NewLine + (doc.IsWorkshared
                ? "Устгавал «… элементийг " + me + " устгалаа» гэж энэ загвар дээр хамт ажилладаг бүх хүнд харагдана (таныг Synchronize хийсний дараа)."
                : "Устгалт загварын «Устгалтын түүх»-д бүртгэгдэнэ.");

            var td = new TaskDialog("MGL ББ — Устгах")
            {
                MainIcon = TaskDialogIcon.TaskDialogIconWarning,
                MainInstruction = p.Selected.Count + " элемент устгах гэж байна",
                MainContent = content,
                VerificationText = "Дахин бүү асуу (бүртгэл, мэдэгдэл хэвээр; «Устгалтын түүх»-ээс асаана)",
                AllowCancellation = true,
                DefaultButton = TaskDialogResult.CommandLink1,
            };
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Устгах");
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Болих");
            bool ok = td.Show() == TaskDialogResult.CommandLink1;
            if (ok && td.WasVerificationChecked())
            {
                State.WarnBeforeDelete = false;
                SaveState();
            }
            return ok;
        }

        /* ============================== БҮРТГЭЛ ============================= */

        private sealed class LogUpdater : IUpdater
        {
            private readonly UpdaterId _id;

            public LogUpdater(AddInId addin) { _id = new UpdaterId(addin, new Guid("b0c7e1f2-4d6a-4f3e-9a51-2c8d7e6f1a93")); }

            public void Execute(UpdaterData data)
            {
                try
                {
                    Document doc = data.GetDocument();
                    Pending p;
                    lock (Gate) p = _pending;
                    if (p == null || !p.Doc.Equals(doc) || DateTime.UtcNow - p.At > PendingLife) return;
                    ICollection<ElementId> deleted = data.GetDeletedElementIds();
                    var picked = deleted.Where(i => p.Selected.Contains(i.Value)).ToList();
                    if (picked.Count == 0) return;
                    lock (Gate) { if (ReferenceEquals(_pending, p)) _pending = null; }

                    var b = new BbDeleteBatch
                    {
                        Key = Guid.NewGuid().ToString("N"),
                        WhenUtc = DateTime.UtcNow.ToString("o"),
                        User = doc.Application.Username ?? "",
                        View = p.View,
                        Dependents = deleted.Count - picked.Count,
                    };
                    foreach (ElementId id in picked)
                    {
                        BbDeletedItem it;
                        if (p.Items.TryGetValue(id.Value, out it)) b.Items.Add(it);
                        else b.Truncated++;
                    }
                    var ent = new Entity(GetSchema(true));
                    ent.Set(Field, BbJson.Write(b.ToJson(), false));
                    DataStorage.Create(doc).SetEntity(ent);
                }
                catch (Exception ex) { Log(ex); }
            }

            public UpdaterId GetUpdaterId() { return _id; }
            public ChangePriority GetChangePriority() { return ChangePriority.Annotations; }
            public string GetUpdaterName() { return "MGL ББ — Устгалтын бүртгэл"; }
            public string GetAdditionalInformation() { return "Сонгож устгасан элементийг (хэн, хэзээ) загварт бүртгэж хамт ажилладаг хүмүүст мэдэгдэнэ."; }
        }

        private static Schema GetSchema(bool create)
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null || !create) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("MGLE");
            b.SetDocumentation("MGL ББ «Устгалтын анхааруулга»: нэг устгалт (хэн, хэзээ, аль элемент) JSON-оор.");
            b.AddSimpleField(Field, typeof(string));
            return b.Finish();
        }

        /// <summary>Загварт бүртгэгдсэн бүх устгалт (дараалалгүй).</summary>
        internal static List<BbDeleteBatch> ReadAll(Document doc)
        {
            var list = new List<BbDeleteBatch>();
            Schema s = GetSchema(false);
            if (s == null || doc == null) return list;
            foreach (Element el in new FilteredElementCollector(doc).OfClass(typeof(DataStorage)).WherePasses(new ExtensibleStorageFilter(SchemaGuid)))
            {
                try
                {
                    Entity ent = el.GetEntity(s);
                    BbDeleteBatch b = ent != null && ent.IsValid() ? BbDeleteBatch.Parse(ent.Get<string>(Field)) : null;
                    if (b != null) list.Add(b);
                }
                catch (Exception) { }
            }
            return list;
        }

        /* ============================== БУСДАД МЭДЭГДЭХ ===================== */

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            Guard(() =>
            {
                Document doc = e.GetDocument();
                if (doc == null || doc.IsFamilyDocument) return;
                lock (Gate) { if (_pending != null && _pending.Doc.Equals(doc)) _pending = null; }   // Delete-ийн гүйлгээ дууссан (updater өмнө нь ажилласан)
                Schema s = GetSchema(false);
                if (s == null) return;
                ICollection<ElementId> added = e.GetAddedElementIds();
                if (added == null || added.Count == 0 || added.Count > 50000) return;
                foreach (ElementId id in added)
                {
                    if (doc.GetElement(id) is DataStorage ds && ds.GetEntity(s).IsValid()) { MarkDirty(doc); return; }
                }
            });
        }

        private static void MarkDirty(Document doc)
        {
            if (doc == null || doc.IsFamilyDocument) return;
            lock (Gate) _dirty.Add(BbStore.ProjectKey(doc));
        }

        private static void OnIdling(object sender, IdlingEventArgs e)
        {
            lock (Gate) { if (_dirty.Count == 0) return; }
            Guard(() =>
            {
                UIApplication uiapp = sender as UIApplication;
                UIDocument uidoc = uiapp?.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null) return;
                string key = BbStore.ProjectKey(uidoc.Document);
                lock (Gate) { if (!_dirty.Remove(key)) return; }
                if (!Licensed()) return;
                Notify(uidoc, key);
            });
        }

        private static void Notify(UIDocument uidoc, string key)
        {
            Document doc = uidoc.Document;
            List<BbDeleteBatch> all = ReadAll(doc);
            BbDeleteWatchState st = State;
            List<BbDeleteBatch> unseen;
            lock (Gate)
            {
                // Энэ төслийг анх удаа харж байна — өмнөх түүхээр дайрахгүй, сүүлийн нэг хоногийнхыг л мэдэгдэнэ.
                if (!st.Knows(key)) st.MarkSeen(key, all.Where(b => b.When < DateTime.UtcNow.AddDays(-1)).Select(b => b.Key));
                unseen = BbDeleteLog.Unseen(all, k => st.Seen(key, k), doc.Application.Username);
                st.MarkSeen(key, unseen.Select(b => b.Key));      // цонх харуулахаас ӨМНӨ — алдаа гарсан ч дахин дахин гарахгүй
            }
            SaveState();
            if (unseen.Count == 0) return;

            var users = unseen.Select(b => b.User).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var td = new TaskDialog("MGL ББ — Устгалтын мэдэгдэл")
            {
                MainIcon = TaskDialogIcon.TaskDialogIconInformation,
                MainInstruction = string.Join(", ", users) + " " + unseen.Sum(b => b.Count) + " элемент устгасан байна",
                MainContent = string.Join(Environment.NewLine, BbDeleteLog.Lines(unseen, t => t.ToLocalTime(), 15)),
                AllowCancellation = true,
            };
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Ойлголоо");
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Устгалтын түүх харах");
            if (td.Show() == TaskDialogResult.CommandLink2) DeleteLog.DeleteLogFlow.Run(uidoc);
        }

        /// <summary>Түүхийн цонхыг нээхэд бүгдийг «харсан» болгоно (дараагийн мэдэгдэлд давтагдахгүй).</summary>
        internal static void MarkAllSeen(Document doc, IEnumerable<BbDeleteBatch> all)
        {
            lock (Gate) State.MarkSeen(BbStore.ProjectKey(doc), all.Select(b => b.Key));
            SaveState();
        }
    }
}
