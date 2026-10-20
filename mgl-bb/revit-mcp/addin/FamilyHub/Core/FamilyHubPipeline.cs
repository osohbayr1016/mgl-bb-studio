using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.FamilyHub.Core
{
    /// <summary>Төсөлд байгаа family-ийн товч мэдээлэл (Revit төрөлгүй).</summary>
    public sealed class ExistingFamilyInfo
    {
        public long FamilyId { get; set; }
        public string Name { get; set; }
        public string Category { get; set; }
        public List<long> SymbolIds { get; set; } = new List<long>();
        public List<string> SymbolNames { get; set; } = new List<string>();
    }

    public enum PlacementStatus { Placed, CancelledByUser, NoSymbol, Failed }

    public sealed class PlacementOutcome
    {
        public PlacementStatus Status { get; set; }
        public string Message { get; set; }
        public string SymbolName { get; set; }
    }

    /// <summary>
    /// Revit руу хүрэх ЦОРЫН ГАНЦ хаалга.  Бодит хэрэгжүүлэлт нь ExternalEvent-ээр
    /// Revit-ийн үндсэн thread дээр ажиллана; тестэд санах ойн хуурамч.
    /// </summary>
    public interface IRevitGateway
    {
        /// <summary>Ажиллаж буй Revit-ийн он (ж: 2027).  0 = мэдэгдэхгүй.</summary>
        int RevitVersion { get; }

        Task<bool> HasProjectDocumentAsync(CancellationToken ct);
        Task<FamilyHubRegistry> LoadRegistryAsync(CancellationToken ct);
        Task SaveRegistryAsync(FamilyHubRegistry registry, CancellationToken ct);
        Task<ExistingFamilyInfo> FindFamilyByNameAsync(string name, CancellationToken ct);
        Task<ExistingFamilyInfo> FindFamilyByIdAsync(long familyId, CancellationToken ct);
        /// <summary>`Document.LoadFamily` — амжилтгүй бол алдаа шидэнэ.</summary>
        Task<ExistingFamilyInfo> LoadFamilyAsync(string rfaPath, CancellationToken ct);
        /// <summary>Symbol идэвхжүүлээд Revit-ийн ЭНГИЙН байрлуулалтыг эхлүүлнэ.</summary>
        Task<PlacementOutcome> PlaceAsync(long familyId, long? symbolId, CancellationToken ct);
    }

    public enum ConflictDecision { UseExisting, Cancel }

    public sealed class NameConflict
    {
        public string FamilyName { get; set; }
        public ExistingFamilyInfo Existing { get; set; }
        public InspectedFamilyFile Incoming { get; set; }
        public FamilyProduct Product { get; set; }
    }

    /// <summary>«ИЖИЛ НЭР — ӨӨР FAMILY» — хэрэглэгчээс асууна; автоматаар ХЭЗЭЭ Ч дарж бичихгүй.</summary>
    public interface IConflictResolver
    {
        Task<ConflictDecision> ResolveNameConflictAsync(NameConflict conflict, CancellationToken ct);
    }

    public enum PipelineStage { Checking, Downloading, Validating, Deduplicating, Loading, Done, Failed }

    public interface IPipelineObserver
    {
        void Report(PipelineStage stage, string message);
    }

    public enum FileOutcomeStatus
    {
        Loaded,
        AlreadyInProject,
        MappedByHash,
        UsedExisting,
        NameConflictCancelled,
        Incompatible,
        LoadFailed,
        /// <summary>Ижил family-ийн ӨӨР Revit хувилбарын хуулбар — хамгийн тохирохыг л ачаалсан.</summary>
        SkippedVariant,
    }

    public sealed class FileOutcome
    {
        public FileOutcomeStatus Status { get; set; }
        public string FamilyName { get; set; }
        public long FamilyId { get; set; }
        public List<long> SymbolIds { get; set; } = new List<long>();
        public List<string> SymbolNames { get; set; } = new List<string>();
        public RevitCompatibility Compatibility { get; set; } = RevitCompatibility.Unknown;
        public int? SavedRevitVersion { get; set; }
        public string Sha256 { get; set; }
        public string Message { get; set; }
    }

    public enum PipelineStatus
    {
        Ok,
        AlreadyInProject,
        AuthRequired,
        MetadataOnly,
        Incompatible,
        DownloadFailed,
        InvalidPackage,
        Cancelled,
        NoDocument,
        Failed,
    }

    public sealed class PipelineResult
    {
        public PipelineStatus Status { get; set; }
        public string Message { get; set; }
        public List<FileOutcome> Files { get; set; } = new List<FileOutcome>();
        public DownloadOutcome Download { get; set; }
        /// <summary>Түр хавтас цэвэрлэгдсэн эсэх (тест 17).</summary>
        public bool TempCleaned { get; set; }
    }

    public sealed class PipelineOptions
    {
        public long MaxBytes { get; set; } = 50L * 1024 * 1024;
        public TimeSpan DownloadTimeout { get; set; } = TimeSpan.FromSeconds(120);
        /// <summary>Түр хавтасны үндэс — null бол `TempFiles.RootDir`.</summary>
        public string TempRoot { get; set; }
    }

    /// <summary>
    /// «ADD TO REVIT» дарсны дараах бүх алхам:
    /// бүртгэл шалгах → татах → шалгах → SHA-256 → давхардал → ачаалах → бүртгэх → цэвэрлэх.
    /// Revit-ийн ямар ч төрөл байхгүй — `IRevitGateway`-ээр л хүрнэ.
    ///
    /// Хоёр оролт: `AddToRevitAsync` (нийлүүлэгч URL өгнө, бид татна) ба
    /// `AddDownloadedAsync` (файл аль хэдийн түр хавтсанд бий — ж: WebView2 хөтчийн
    /// татаж авалт).  Хоёулаа НЭГ `ProcessPackageAsync`-д нийлдэг тул шалгалт,
    /// давхардал, ачаалалтын дүрэм салж чадахгүй.
    /// </summary>
    public sealed class FamilyHubPipeline
    {
        private readonly IRevitGateway _revit;
        private readonly SafeDownloader _downloader;
        private readonly IConflictResolver _conflicts;
        private readonly PipelineOptions _opt;

        public FamilyHubPipeline(IRevitGateway revit, SafeDownloader downloader, IConflictResolver conflicts, PipelineOptions options = null)
        {
            _revit = revit ?? throw new ArgumentNullException("revit");
            _downloader = downloader ?? throw new ArgumentNullException("downloader");
            _conflicts = conflicts ?? throw new ArgumentNullException("conflicts");
            _opt = options ?? new PipelineOptions();
        }

        /// <summary>
        /// Татахгүйгээр «энэ бүтээгдэхүүн төсөлд бий юу?» — UI-ийн «✓ Төсөлд байгаа» шошго.
        /// Бүртгэлд байгаа ч family нь устгагдсан бол null (бүртгэл дараа цэвэрлэгдэнэ).
        /// </summary>
        public static List<FamilyHubRegistryEntry> EntriesForProduct(FamilyHubRegistry reg, FamilyProduct p)
        {
            var list = new List<FamilyHubRegistryEntry>();
            if (reg == null || p == null) return list;
            string asset = p.ExternalAssetId ?? "";
            foreach (FamilyHubRegistryEntry e in reg.Entries)
            {
                if (!string.Equals(e.ProviderId, p.ProviderId, StringComparison.Ordinal)) continue;
                if (!string.Equals(e.ExternalProductId, p.ExternalId, StringComparison.Ordinal)) continue;
                string ea = e.ExternalAssetId ?? "";
                if (asset.Length == 0 || ea == asset || ea.StartsWith(asset + "#", StringComparison.Ordinal)) list.Add(e);
            }
            return list;
        }

        public async Task<PipelineResult> AddToRevitAsync(
            IFamilyProvider provider, FamilyProduct product, IPipelineObserver observer, CancellationToken ct)
        {
            if (provider == null) throw new ArgumentNullException("provider");
            if (product == null) throw new ArgumentNullException("product");
            observer = observer ?? NullObserver.Instance;
            var result = new PipelineResult();
            string sessionDir = null;
            try
            {
                var pre = new Prechecked();
                PipelineResult early = await PrecheckAsync(product, observer, result, pre, ct).ConfigureAwait(false);
                if (early != null) return early;

                // ── 2. Нийлүүлэгчийн метадатагаар хувилбар (байвал).
                RevitCompatibility preCompat = RevitCompatibilityCheck.FromProviderMetadata(product.RevitVersions, _revit.RevitVersion);
                if (preCompat == RevitCompatibility.Incompatible)
                    return Finish(result, observer, PipelineStatus.Incompatible,
                        "ТОХИРОХГҮЙ — нийлүүлэгчийн мэдээлсэн хувилбар " + string.Join(",", product.RevitVersions) + " > Revit " + _revit.RevitVersion);

                // ── 3. Татах.
                observer.Report(PipelineStage.Downloading, "Татаж байна…");
                FamilyDownloadResult dl = await provider.ResolveDownloadAsync(product, ct).ConfigureAwait(false);
                if (dl == null || dl.Capability != DownloadCapability.AnonymousDirect || dl.Url == null)
                {
                    PipelineStatus st = dl != null && dl.Capability == DownloadCapability.AuthRequired ? PipelineStatus.AuthRequired : PipelineStatus.MetadataOnly;
                    return Finish(result, observer, st, st == PipelineStatus.AuthRequired ? "AUTH_REQUIRED — " + (dl.Reason ?? "нийлүүлэгч нэвтрэлт шаарддаг") : (dl != null ? dl.Reason : "Татах зам байхгүй"));
                }

                sessionDir = TempFiles.NewSessionDir(_opt.TempRoot);
                string fileName = TempFiles.SafeFileName(dl.FileName ?? LastSegment(dl.Url));
                string ext = Path.GetExtension(fileName).ToLowerInvariant();
                if (ext != ".rfa" && ext != ".zip")
                    return Finish(result, observer, PipelineStatus.InvalidPackage, "Өргөтгөл зөвшөөрөгдөөгүй: " + ext);
                string dest = Path.Combine(sessionDir, fileName);

                var policy = new DownloadPolicy
                {
                    MaxBytes = _opt.MaxBytes,
                    Timeout = _opt.DownloadTimeout,
                    AllowedHosts = provider.AllowedDownloadHosts,
                };
                var progress = new Progress<long>(b => observer.Report(PipelineStage.Downloading, "Татаж байна… " + (b / 1024) + " KB"));
                DownloadOutcome down = await _downloader.DownloadAsync(dl.Url, dest, policy, ct, progress).ConfigureAwait(false);
                result.Download = down;
                if (!down.Ok)
                {
                    switch (down.Status)
                    {
                        case DownloadStatus.AuthRequired: return Finish(result, observer, PipelineStatus.AuthRequired, "AUTH_REQUIRED — " + down.Reason);
                        case DownloadStatus.Cancelled: return Finish(result, observer, PipelineStatus.Cancelled, "Цуцлагдсан");
                        default: return Finish(result, observer, PipelineStatus.DownloadFailed, down.Status + ": " + down.Reason);
                    }
                }

                return await ProcessPackageAsync(product, dest, sessionDir, pre, observer, result, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return Finish(result, observer, PipelineStatus.Cancelled, "Цуцлагдсан");
            }
            catch (Exception ex)
            {
                return Finish(result, observer, PipelineStatus.Failed, ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                Cleanup(result, sessionDir);
            }
        }

        /// <summary>
        /// Файл АЛЬ ХЭДИЙН түр хавтсанд бий (хөтчөөр татсан).  Хост/Content-Type
        /// шалгалт энд байхгүй (хөтөч татсан) — магик байт, ZIP, өргөтгөл, хэмжээ,
        /// хувилбар, давхардал бүгд ижилхэн.  `sessionDir` (файлын хавтас) төгсгөлд устгагдана.
        /// </summary>
        public async Task<PipelineResult> AddDownloadedAsync(
            FamilyProduct product, string filePath, IPipelineObserver observer, CancellationToken ct)
        {
            if (product == null) throw new ArgumentNullException("product");
            observer = observer ?? NullObserver.Instance;
            var result = new PipelineResult();
            string sessionDir = string.IsNullOrEmpty(filePath) ? null : Path.GetDirectoryName(filePath);
            try
            {
                if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
                    return Finish(result, observer, PipelineStatus.DownloadFailed, "Татсан файл олдсонгүй");
                string ext = Path.GetExtension(filePath).ToLowerInvariant();
                if (ext != ".rfa" && ext != ".zip")
                    return Finish(result, observer, PipelineStatus.InvalidPackage, "Өргөтгөл зөвшөөрөгдөөгүй: " + ext + " (зөвхөн .rfa / .zip)");
                long size = new FileInfo(filePath).Length;
                if (size > _opt.MaxBytes)
                    return Finish(result, observer, PipelineStatus.DownloadFailed, "Хэмжээ " + size + " > " + _opt.MaxBytes);

                var pre = new Prechecked();
                PipelineResult early = await PrecheckAsync(product, observer, result, pre, ct).ConfigureAwait(false);
                if (early != null) return early;

                result.Download = new DownloadOutcome { Status = DownloadStatus.Ok, FilePath = filePath, Bytes = size, Sha256 = SafeDownloader.Sha256OfFile(filePath) };
                return await ProcessPackageAsync(product, filePath, sessionDir, pre, observer, result, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return Finish(result, observer, PipelineStatus.Cancelled, "Цуцлагдсан");
            }
            catch (Exception ex)
            {
                return Finish(result, observer, PipelineStatus.Failed, ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                Cleanup(result, sessionDir);
            }
        }

        /* ───────────────────── дотоод алхмууд ───────────────────── */

        private sealed class Prechecked
        {
            public FamilyHubRegistry Registry;
            public bool Dirty;
        }

        /// <summary>0) төсөл нээлттэй юу?  1) нийлүүлэгчийн танигчаар бүртгэл (ТАТАХААС ӨМНӨ).</summary>
        private async Task<PipelineResult> PrecheckAsync(FamilyProduct product, IPipelineObserver observer, PipelineResult result, Prechecked pre, CancellationToken ct)
        {
            if (!await _revit.HasProjectDocumentAsync(ct).ConfigureAwait(false))
                return Finish(result, observer, PipelineStatus.NoDocument, "Нээлттэй төслийн файл алга (эсвэл Family засварлаж байна)");

            observer.Report(PipelineStage.Checking, "Бүртгэл шалгаж байна…");
            FamilyHubRegistry reg = await _revit.LoadRegistryAsync(ct).ConfigureAwait(false);
            pre.Registry = reg;
            List<FamilyHubRegistryEntry> known = EntriesForProduct(reg, product);
            if (known.Count == 0) return null;

            bool allAlive = true;
            foreach (FamilyHubRegistryEntry e in known)
            {
                ExistingFamilyInfo fam = await _revit.FindFamilyByIdAsync(e.RevitFamilyId, ct).ConfigureAwait(false);
                if (fam == null)
                {
                    // Family төслөөс устгагдсан — бүртгэл хуучирсан, дахин ачаалж болно.
                    reg.RemoveWhere(x => ReferenceEquals(x, e));
                    pre.Dirty = true;
                    allAlive = false;
                    continue;
                }
                result.Files.Add(Outcome(FileOutcomeStatus.AlreadyInProject, fam, e.Sha256, "Аль хэдийн төсөлд бий"));
            }
            if (allAlive)
            {
                if (pre.Dirty) await _revit.SaveRegistryAsync(reg, ct).ConfigureAwait(false);
                return Finish(result, observer, PipelineStatus.AlreadyInProject, "✓ Төсөлд байгаа — дахин татсангүй");
            }
            result.Files.Clear();
            return null;
        }

        /// <summary>4) шалгах → 5) файл бүрд хувилбар / SHA / нэр → 6) ачаалах → бүртгэл хадгалах.</summary>
        private async Task<PipelineResult> ProcessPackageAsync(
            FamilyProduct product, string packagePath, string sessionDir, Prechecked pre,
            IPipelineObserver observer, PipelineResult result, CancellationToken ct)
        {
            FamilyHubRegistry reg = pre.Registry;
            bool regDirty = pre.Dirty;

            observer.Report(PipelineStage.Validating, "Шалгаж байна…");
            ct.ThrowIfCancellationRequested();
            PackageInspection insp = FamilyPackageInspector.Inspect(packagePath, Path.Combine(sessionDir, "extract"), _opt.MaxBytes);
            if (!insp.Ok)
                return Finish(result, observer, PipelineStatus.InvalidPackage, insp.Reason);

            // Нэг family-ийн олон Revit хувилбарын хуулбар (Chair_2022 / Chair_2024 / …) —
            // хамгийн тохирох НЭГИЙГ л ачаална, бусдыг SkippedVariant.
            HashSet<InspectedFamilyFile> skipVariants = SelectVersionVariants(insp.Files, _revit.RevitVersion);

            bool multi = insp.Files.Count > 1;
            foreach (InspectedFamilyFile f in insp.Files)
            {
                ct.ThrowIfCancellationRequested();
                string assetId = multi || f.ZipEntryName != null
                    ? (product.ExternalAssetId ?? "") + "#" + (f.ZipEntryName ?? f.FileName)
                    : product.ExternalAssetId;

                RevitCompatibility compat = RevitCompatibilityCheck.FromSavedVersion(f.SavedRevitVersion, _revit.RevitVersion);
                if (skipVariants.Contains(f))
                {
                    result.Files.Add(new FileOutcome
                    {
                        Status = FileOutcomeStatus.SkippedVariant, FamilyName = f.FamilyName, Sha256 = f.Sha256,
                        Compatibility = compat, SavedRevitVersion = f.SavedRevitVersion,
                        Message = "Өөр хувилбарын хуулбар (Revit " + (f.SavedRevitVersion.HasValue ? f.SavedRevitVersion.ToString() : "?") + ") — алгасав",
                    });
                    continue;
                }
                if (compat == RevitCompatibility.Incompatible)
                {
                    result.Files.Add(new FileOutcome
                    {
                        Status = FileOutcomeStatus.Incompatible, FamilyName = f.FamilyName, Sha256 = f.Sha256,
                        Compatibility = compat, SavedRevitVersion = f.SavedRevitVersion,
                        Message = "ТОХИРОХГҮЙ — файл Revit " + f.SavedRevitVersion + "-д хадгалагдсан, энэ нь Revit " + _revit.RevitVersion,
                    });
                    continue;
                }

                observer.Report(PipelineStage.Deduplicating, "Давхардал шалгаж байна… " + f.FamilyName);

                // B) SHA-256 — өөр нийлүүлэгч/бичлэг ч ижил файл бол ХОЁР ДАХЬ хуулбар оруулахгүй.
                FamilyHubRegistryEntry byHash = reg.FindBySha256(f.Sha256);
                if (byHash != null)
                {
                    ExistingFamilyInfo fam = await _revit.FindFamilyByIdAsync(byHash.RevitFamilyId, ct).ConfigureAwait(false);
                    if (fam != null)
                    {
                        reg.Upsert(MakeEntry(product, assetId, f.Sha256, fam, mapped: true));
                        regDirty = true;
                        FileOutcome o = Outcome(FileOutcomeStatus.MappedByHash, fam, f.Sha256, "Ижил файл (SHA-256) аль хэдийн төсөлд бий — бичлэгийг түүн рүү холбов");
                        o.Compatibility = compat; o.SavedRevitVersion = f.SavedRevitVersion;
                        result.Files.Add(o);
                        continue;
                    }
                    reg.RemoveWhere(x => ReferenceEquals(x, byHash));
                    regDirty = true;
                }

                // C) Нэрийн зөрчил — ижил нэр, өөр файл.  Дарж бичихгүй, нэр өөрчлөхгүй.
                ExistingFamilyInfo sameName = await _revit.FindFamilyByNameAsync(f.FamilyName, ct).ConfigureAwait(false);
                if (sameName != null)
                {
                    ConflictDecision d = await _conflicts.ResolveNameConflictAsync(
                        new NameConflict { FamilyName = f.FamilyName, Existing = sameName, Incoming = f, Product = product }, ct).ConfigureAwait(false);
                    if (d == ConflictDecision.UseExisting)
                    {
                        reg.Upsert(MakeEntry(product, assetId, f.Sha256, sameName, mapped: true));
                        regDirty = true;
                        FileOutcome o = Outcome(FileOutcomeStatus.UsedExisting, sameName, f.Sha256, "ИЖИЛ НЭР — ӨӨР FAMILY: одоо байгааг ашиглав");
                        o.Compatibility = compat; o.SavedRevitVersion = f.SavedRevitVersion;
                        result.Files.Add(o);
                    }
                    else
                    {
                        result.Files.Add(new FileOutcome
                        {
                            Status = FileOutcomeStatus.NameConflictCancelled, FamilyName = f.FamilyName, Sha256 = f.Sha256,
                            Compatibility = compat, SavedRevitVersion = f.SavedRevitVersion,
                            Message = "ИЖИЛ НЭР — ӨӨР FAMILY: цуцлав",
                        });
                    }
                    continue;
                }

                observer.Report(PipelineStage.Loading, "Ачаалж байна… " + f.FamilyName);
                ExistingFamilyInfo loaded;
                try
                {
                    loaded = await _revit.LoadFamilyAsync(f.Path, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    result.Files.Add(new FileOutcome
                    {
                        Status = FileOutcomeStatus.LoadFailed, FamilyName = f.FamilyName, Sha256 = f.Sha256,
                        Compatibility = compat, SavedRevitVersion = f.SavedRevitVersion, Message = "Ачаалж чадсангүй: " + ex.Message,
                    });
                    continue;
                }
                reg.Upsert(MakeEntry(product, assetId, f.Sha256, loaded, mapped: false));
                regDirty = true;
                FileOutcome ok = Outcome(FileOutcomeStatus.Loaded, loaded, f.Sha256, "Family ачаалагдлаа");
                ok.Compatibility = compat; ok.SavedRevitVersion = f.SavedRevitVersion;
                result.Files.Add(ok);
            }

            if (regDirty) await _revit.SaveRegistryAsync(reg, ct).ConfigureAwait(false);

            PipelineStatus final = PipelineStatus.Ok;
            bool any = false;
            foreach (FileOutcome fo in result.Files)
                if (fo.Status == FileOutcomeStatus.Loaded || fo.Status == FileOutcomeStatus.MappedByHash || fo.Status == FileOutcomeStatus.UsedExisting) any = true;
            if (!any)
            {
                final = PipelineStatus.Failed;
                foreach (FileOutcome fo in result.Files)
                {
                    if (fo.Status == FileOutcomeStatus.Incompatible) final = PipelineStatus.Incompatible;
                    if (fo.Status == FileOutcomeStatus.NameConflictCancelled) final = PipelineStatus.Cancelled;
                }
            }
            string msg = final == PipelineStatus.Ok ? "Байрлуулахад бэлэн ✓" : FirstMessage(result);
            return Finish(result, observer, final, msg);
        }

        /// <summary>
        /// Нэг ZIP дотор «Chair_2020.rfa / Chair_2022.rfa / Chair_2024.rfa» гэх мэт ижил
        /// family-ийн хувилбарын хуулбарууд байвал ажиллаж буй Revit-д хамгийн ойр
        /// (≤ current, хамгийн шинэ) НЭГИЙГ л үлдээж бусдыг буцаана.  Нэр нь
        /// хувилбарын тэмдэгтгүй, эсвэл хадгалсан хувилбар нь ижил бол ЮУ Ч алгасахгүй
        /// (жинхэнэ өөр family-ууд).  Тестэд ил.
        /// </summary>
        public static HashSet<InspectedFamilyFile> SelectVersionVariants(IList<InspectedFamilyFile> files, int currentVersion)
        {
            var skip = new HashSet<InspectedFamilyFile>();
            if (files == null || files.Count < 2) return skip;
            var groups = new Dictionary<string, List<InspectedFamilyFile>>(StringComparer.OrdinalIgnoreCase);
            foreach (InspectedFamilyFile f in files)
            {
                string key = NormalizeVariantName(f.FamilyName);
                List<InspectedFamilyFile> g;
                if (!groups.TryGetValue(key, out g)) groups[key] = g = new List<InspectedFamilyFile>();
                g.Add(f);
            }
            foreach (List<InspectedFamilyFile> g in groups.Values)
            {
                if (g.Count < 2) continue;
                InspectedFamilyFile best = null;
                int bestVer = int.MinValue;
                foreach (InspectedFamilyFile f in g)
                {
                    int v = f.SavedRevitVersion ?? YearFromName(f.FamilyName) ?? 0;
                    if (currentVersion > 0 && v > currentVersion) continue; // ирээдүйн хувилбар — INCOMPATIBLE тэмдэглэгдэнэ
                    if (v > bestVer) { bestVer = v; best = f; }
                }
                if (best == null) continue;
                foreach (InspectedFamilyFile f in g)
                {
                    if (ReferenceEquals(f, best)) continue;
                    int v = f.SavedRevitVersion ?? YearFromName(f.FamilyName) ?? 0;
                    if (currentVersion > 0 && v > currentVersion) continue; // incompatible гэж тусад нь мэдээлэгдэнэ
                    skip.Add(f);
                }
            }
            return skip;
        }

        // «_2022», « (2022)», « R2022», «-Revit 2022», «_rvt2022».  `r`/`revit` угтвар нь ЗААВАЛ
        // тусгаарлагчийн дараа — эс тэгвэл «Chair_2022»-ийн «r» баригдаж «Chai» болно (тестэд баригдсан).
        private static readonly Regex VersionToken = new Regex(
            @"(?:[\s_\-\(\[]+(?:(?:revit|rvt|r)[\s_\-]*)?|(?<![a-z0-9]))(20\d\d)[\)\]]*",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static string NormalizeVariantName(string familyName)
        {
            if (string.IsNullOrEmpty(familyName)) return "";
            string s = VersionToken.Replace(familyName, " ");
            return Regex.Replace(s, @"\s+", " ").Trim();
        }

        private static int? YearFromName(string familyName)
        {
            if (string.IsNullOrEmpty(familyName)) return null;
            Match m = Regex.Match(familyName, @"(20\d\d)");
            int y;
            return m.Success && int.TryParse(m.Groups[1].Value, out y) ? y : (int?)null;
        }

        private static void Cleanup(PipelineResult result, string sessionDir)
        {
            // ⚠️ Амжилт/алдаа аль ч үед — түр файл үлдэхгүй.
            if (sessionDir != null)
            {
                TempFiles.TryDeleteDir(sessionDir);
                result.TempCleaned = !Directory.Exists(sessionDir);
            }
            else result.TempCleaned = true;
        }

        private static string FirstMessage(PipelineResult r)
        {
            foreach (FileOutcome fo in r.Files)
                if (fo.Status != FileOutcomeStatus.SkippedVariant) return fo.Message;
            return r.Files.Count > 0 ? r.Files[0].Message : "Юу ч ачаалагдсангүй";
        }

        private static FamilyHubRegistryEntry MakeEntry(FamilyProduct p, string assetId, string sha, ExistingFamilyInfo fam, bool mapped)
        {
            return new FamilyHubRegistryEntry
            {
                ProviderId = p.ProviderId,
                ExternalProductId = p.ExternalId,
                ExternalAssetId = assetId,
                AssetVersion = p.AssetVersion,
                Sha256 = sha,
                RevitFamilyId = fam.FamilyId,
                RevitFamilyName = fam.Name,
                RevitSymbolIds = new List<long>(fam.SymbolIds),
                LoadedAt = DateTime.UtcNow.ToString("o"),
                MappedByHash = mapped,
            };
        }

        private static FileOutcome Outcome(FileOutcomeStatus s, ExistingFamilyInfo fam, string sha, string msg)
        {
            return new FileOutcome
            {
                Status = s,
                FamilyName = fam.Name,
                FamilyId = fam.FamilyId,
                SymbolIds = new List<long>(fam.SymbolIds),
                SymbolNames = new List<string>(fam.SymbolNames),
                Sha256 = sha,
                Message = msg,
            };
        }

        private static PipelineResult Finish(PipelineResult r, IPipelineObserver obs, PipelineStatus s, string msg)
        {
            r.Status = s;
            r.Message = msg;
            obs.Report(s == PipelineStatus.Ok || s == PipelineStatus.AlreadyInProject ? PipelineStage.Done : PipelineStage.Failed, msg);
            return r;
        }

        private static string LastSegment(Uri u)
        {
            string p = u.AbsolutePath;
            int i = p.LastIndexOf('/');
            string s = i >= 0 ? p.Substring(i + 1) : p;
            return Uri.UnescapeDataString(s);
        }

        private sealed class NullObserver : IPipelineObserver
        {
            public static readonly NullObserver Instance = new NullObserver();
            public void Report(PipelineStage stage, string message) { }
        }
    }
}
