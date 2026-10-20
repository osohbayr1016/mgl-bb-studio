using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using RevitMcpAddin.FamilyHub.Core;

namespace RevitMcpAddin.FamilyHub.Revit
{
    /// <summary>
    /// `IRevitGateway`-ийн бодит хэрэгжүүлэлт — бүх ажил `FamilyHubExternalEvent`-ээр
    /// Revit-ийн үндсэн thread дээр.  Гүйлгээ (Transaction) бүр ЭНД, богино, нэрлэсэн.
    /// </summary>
    internal sealed class RevitGateway : IRevitGateway
    {
        private readonly int _version;

        public RevitGateway(UIApplication uiapp)
        {
            int v;
            _version = int.TryParse(uiapp.Application.VersionNumber, out v) ? v : 0;
        }

        public int RevitVersion { get { return _version; } }

        private static Task<T> Run<T>(Func<UIApplication, T> f, CancellationToken ct)
        {
            return FamilyHubExternalEvent.Instance.RunAsync(f, ct);
        }

        private static Document ProjectDoc(UIApplication app)
        {
            Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
            return doc != null && !doc.IsFamilyDocument ? doc : null;
        }

        public Task<bool> HasProjectDocumentAsync(CancellationToken ct)
        {
            return Run(app => ProjectDoc(app) != null, ct);
        }

        public Task<FamilyHubRegistry> LoadRegistryAsync(CancellationToken ct)
        {
            return Run(app =>
            {
                Document doc = ProjectDoc(app);
                return doc == null ? new FamilyHubRegistry() : ExtensibleStorageRegistryStore.Load(doc);
            }, ct);
        }

        public Task SaveRegistryAsync(FamilyHubRegistry registry, CancellationToken ct)
        {
            return Run(app =>
            {
                Document doc = ProjectDoc(app);
                if (doc != null) ExtensibleStorageRegistryStore.Save(doc, registry);
                return true;
            }, ct);
        }

        public Task<ExistingFamilyInfo> FindFamilyByNameAsync(string name, CancellationToken ct)
        {
            return Run(app =>
            {
                Document doc = ProjectDoc(app);
                if (doc == null) return null;
                foreach (Family f in new FilteredElementCollector(doc).OfClass(typeof(Family)))
                    if (string.Equals(f.Name, name, StringComparison.Ordinal)) return Describe(doc, f);
                return null;
            }, ct);
        }

        public Task<ExistingFamilyInfo> FindFamilyByIdAsync(long familyId, CancellationToken ct)
        {
            return Run(app =>
            {
                Document doc = ProjectDoc(app);
                if (doc == null) return null;
                var fam = doc.GetElement(new ElementId(familyId)) as Family;
                return fam == null ? null : Describe(doc, fam);
            }, ct);
        }

        public Task<ExistingFamilyInfo> LoadFamilyAsync(string rfaPath, CancellationToken ct)
        {
            return Run(app =>
            {
                Document doc = ProjectDoc(app);
                if (doc == null) throw new InvalidOperationException("Нээлттэй төслийн файл алга");
                using (var tx = new Transaction(doc, "Family Hub: family ачаалах"))
                {
                    tx.Start();
                    Family fam;
                    bool ok;
                    try
                    {
                        ok = doc.LoadFamily(rfaPath, new NoOverwriteLoadOptions(), out fam);
                    }
                    catch (Exception)
                    {
                        tx.RollBack();
                        throw;
                    }
                    if (!ok || fam == null)
                    {
                        tx.RollBack();
                        throw new InvalidOperationException("Revit family-г ачаалж чадсангүй (LoadFamily=false — ижил нэртэй family байна уу, эсвэл файл эвдэрхий)");
                    }
                    tx.Commit();
                    return Describe(doc, fam);
                }
            }, ct);
        }

        public Task<PlacementOutcome> PlaceAsync(long familyId, long? symbolId, CancellationToken ct)
        {
            return Run(app =>
            {
                UIDocument uidoc = app.ActiveUIDocument;
                Document doc = ProjectDoc(app);
                if (doc == null || uidoc == null) return new PlacementOutcome { Status = PlacementStatus.Failed, Message = "Нээлттэй төслийн файл алга" };
                var fam = doc.GetElement(new ElementId(familyId)) as Family;
                if (fam == null) return new PlacementOutcome { Status = PlacementStatus.Failed, Message = "Family төсөлд олдсонгүй (устгагдсан?)" };

                FamilySymbol sym = null;
                if (symbolId.HasValue) sym = doc.GetElement(new ElementId(symbolId.Value)) as FamilySymbol;
                if (sym == null) sym = FirstSensibleSymbol(doc, fam);
                if (sym == null) return new PlacementOutcome { Status = PlacementStatus.NoSymbol, Message = "Family-д төрөл (type) алга" };

                if (!sym.IsActive)
                {
                    using (var tx = new Transaction(doc, "Family Hub: төрөл идэвхжүүлэх"))
                    {
                        tx.Start();
                        sym.Activate();
                        doc.Regenerate();
                        tx.Commit();
                    }
                }
                try
                {
                    // Revit-ийн ЭНГИЙН байрлуулалт — координат таамаглахгүй, курсор хэрэглэгчийнх.
                    uidoc.PromptForFamilyInstancePlacement(sym);
                    return new PlacementOutcome { Status = PlacementStatus.Placed, SymbolName = sym.Name, Message = "Байрлуулалт дууссан" };
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    return new PlacementOutcome { Status = PlacementStatus.CancelledByUser, SymbolName = sym.Name, Message = "Байрлуулалтыг хэрэглэгч дуусгав (Esc)" };
                }
                catch (Exception ex)
                {
                    return new PlacementOutcome { Status = PlacementStatus.Failed, SymbolName = sym.Name, Message = "Байрлуулалт эхлүүлж чадсангүй: " + ex.Message };
                }
            }, ct);
        }

        private static FamilySymbol FirstSensibleSymbol(Document doc, Family fam)
        {
            FamilySymbol best = null;
            foreach (ElementId id in fam.GetFamilySymbolIds())
            {
                var s = doc.GetElement(id) as FamilySymbol;
                if (s == null) continue;
                if (best == null || string.Compare(s.Name, best.Name, StringComparison.OrdinalIgnoreCase) < 0) best = s;
            }
            return best;
        }

        private static ExistingFamilyInfo Describe(Document doc, Family fam)
        {
            var info = new ExistingFamilyInfo
            {
                FamilyId = fam.Id.Value,
                Name = fam.Name,
                Category = fam.FamilyCategory != null ? fam.FamilyCategory.Name : null,
            };
            var pairs = new List<KeyValuePair<string, long>>();
            foreach (ElementId id in fam.GetFamilySymbolIds())
            {
                var s = doc.GetElement(id) as FamilySymbol;
                if (s != null) pairs.Add(new KeyValuePair<string, long>(s.Name, s.Id.Value));
            }
            pairs.Sort((a, b) => string.Compare(a.Key, b.Key, StringComparison.OrdinalIgnoreCase));
            foreach (var p in pairs) { info.SymbolNames.Add(p.Key); info.SymbolIds.Add(p.Value); }
            return info;
        }

        /// <summary>
        /// ХЭЗЭЭ Ч дарж бичихгүй: ижил нэртэй family байвал ачаалалтыг ЦУЦАЛНА
        /// (pipeline үүнийг урьдчилж шалгадаг — энэ нь уралдааны хамгаалалт).
        /// Хамтын (shared) дэд family байвал ТӨСЛИЙНХИЙГ хэвээр үлдээнэ.
        /// </summary>
        private sealed class NoOverwriteLoadOptions : IFamilyLoadOptions
        {
            public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues)
            {
                overwriteParameterValues = false;
                return false;
            }

            public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues)
            {
                source = FamilySource.Project;
                overwriteParameterValues = false;
                return true;
            }
        }
    }

    /// <summary>
    /// Төслийн бүртгэл — ExtensibleStorage.  Нэг `DataStorage` элемент
    /// («MGL.FamilyHub.Registry») дээр нэг Entity: `Json` (бүх мөр), `Version`.
    /// Энэ add-in дахь АНХНЫ ExtensibleStorage schema — GUID-ийг ХЭЗЭЭ Ч бүү өөрчил
    /// (өөрчилбөл хуучин төслүүдийн бүртгэл харагдахаа болино).
    /// </summary>
    internal static class ExtensibleStorageRegistryStore
    {
        public static readonly Guid SchemaGuid = new Guid("b3f1e6c2-4a7d-4f0e-9c1b-7d2a8e5f6a01");
        public const string SchemaName = "MglFamilyHubRegistry";
        public const string StorageName = "MGL.FamilyHub.Registry";
        private const string FieldJson = "Json";
        private const string FieldVersion = "Version";

        private static Schema GetSchema()
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var sb = new SchemaBuilder(SchemaGuid);
            sb.SetSchemaName(SchemaName);
            sb.SetDocumentation("MGL Family Hub — нийлүүлэгчийн танигч / SHA-256 / Revit family бүртгэл (JSON).");
            sb.SetReadAccessLevel(AccessLevel.Public);
            sb.SetWriteAccessLevel(AccessLevel.Public);
            sb.AddSimpleField(FieldJson, typeof(string));
            sb.AddSimpleField(FieldVersion, typeof(int));
            return sb.Finish();
        }

        private static DataStorage FindStorage(Document doc, Schema schema)
        {
            foreach (DataStorage ds in new FilteredElementCollector(doc).OfClass(typeof(DataStorage)))
            {
                if (ds.Name != StorageName) continue;
                Entity e = ds.GetEntity(schema);
                if (e != null && e.IsValid()) return ds;
            }
            return null;
        }

        public static FamilyHubRegistry Load(Document doc)
        {
            try
            {
                Schema schema = GetSchema();
                DataStorage ds = FindStorage(doc, schema);
                if (ds == null) return new FamilyHubRegistry();
                Entity e = ds.GetEntity(schema);
                string json = e.Get<string>(FieldJson);
                return FamilyHubRegistry.FromJson(json);
            }
            catch
            {
                return new FamilyHubRegistry();
            }
        }

        public static void Save(Document doc, FamilyHubRegistry reg)
        {
            Schema schema = GetSchema();
            using (var tx = new Transaction(doc, "Family Hub: бүртгэл"))
            {
                tx.Start();
                DataStorage ds = FindStorage(doc, schema);
                if (ds == null)
                {
                    ds = DataStorage.Create(doc);
                    ds.Name = StorageName;
                }
                var e = new Entity(schema);
                e.Set(FieldJson, reg.ToJson());
                e.Set(FieldVersion, FamilyHubRegistry.CurrentSchemaVersion);
                ds.SetEntity(e);
                tx.Commit();
            }
        }
    }
}
