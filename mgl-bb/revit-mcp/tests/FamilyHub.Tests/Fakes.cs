using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;

namespace RevitMcpAddin.FamilyHub.Tests
{
    /// <summary>URL → хариу.  Хүсэлт бүрийг тоолно (давхардлын тест «дахин татаагүй» гэдгийг үүгээр батална).</summary>
    public sealed class StubHttpHandler : HttpMessageHandler
    {
        public readonly Dictionary<string, Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> Routes =
            new Dictionary<string, Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>>(StringComparer.Ordinal);
        public readonly List<string> Requests = new List<string>();

        public StubHttpHandler File(string url, byte[] body, string contentType = "application/octet-stream")
        {
            Routes[url] = (r, ct) => Task.FromResult(Bytes(HttpStatusCode.OK, body, contentType));
            return this;
        }

        public StubHttpHandler Status(string url, HttpStatusCode code, string body = "", string contentType = "text/plain")
        {
            Routes[url] = (r, ct) => Task.FromResult(Bytes(code, Encoding.UTF8.GetBytes(body ?? ""), contentType));
            return this;
        }

        public StubHttpHandler Redirect(string url, string location, HttpStatusCode code = HttpStatusCode.Found)
        {
            Routes[url] = (r, ct) =>
            {
                var res = new HttpResponseMessage(code);
                res.Headers.Location = new Uri(location);
                res.Content = new ByteArrayContent(new byte[0]);
                return Task.FromResult(res);
            };
            return this;
        }

        public StubHttpHandler Slow(string url, TimeSpan delay, byte[] body)
        {
            Routes[url] = async (r, ct) =>
            {
                await Task.Delay(delay, ct);
                return Bytes(HttpStatusCode.OK, body, "application/octet-stream");
            };
            return this;
        }

        /// <summary>Урсгалыг удаан гаргана — «татаж байхад цуцлах» тест.</summary>
        public StubHttpHandler Trickle(string url, byte[] body, int chunk, TimeSpan perChunk)
        {
            Routes[url] = (r, ct) =>
            {
                var res = new HttpResponseMessage(HttpStatusCode.OK);
                res.Content = new StreamContent(new TrickleStream(body, chunk, perChunk));
                res.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                return Task.FromResult(res);
            };
            return this;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            string url = request.RequestUri.ToString();
            Requests.Add(url);
            Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> f;
            if (Routes.TryGetValue(url, out f)) return f(request, cancellationToken);
            return Task.FromResult(Bytes(HttpStatusCode.NotFound, Encoding.UTF8.GetBytes("no route: " + url), "text/plain"));
        }

        private static HttpResponseMessage Bytes(HttpStatusCode code, byte[] body, string ctype)
        {
            var res = new HttpResponseMessage(code) { Content = new ByteArrayContent(body) };
            res.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(ctype);
            return res;
        }

        private sealed class TrickleStream : Stream
        {
            private readonly byte[] _data; private readonly int _chunk; private readonly TimeSpan _delay; private int _pos;
            public TrickleStream(byte[] d, int c, TimeSpan delay) { _data = d; _chunk = c; _delay = delay; }
            public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
            public override long Length => _data.Length; public override long Position { get => _pos; set => throw new NotSupportedException(); }
            public override void Flush() { }
            public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer, offset, count, CancellationToken.None).GetAwaiter().GetResult();
            public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct)
            {
                if (_pos >= _data.Length) return 0;
                await Task.Delay(_delay, ct);
                int n = Math.Min(Math.Min(count, _chunk), _data.Length - _pos);
                Array.Copy(_data, _pos, buffer, offset, n);
                _pos += n;
                return n;
            }
            public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
            public override void SetLength(long v) => throw new NotSupportedException();
            public override void Write(byte[] b, int o, int c) => throw new NotSupportedException();
        }
    }

    /// <summary>Тестийн нийлүүлэгч — бүтээгдэхүүн бүр өөрийн URL-тай.</summary>
    public sealed class StubProvider : IFamilyProvider
    {
        public string ProviderId { get; set; } = "stub";
        public string DisplayName => "Stub";
        public ProviderCapabilities Capabilities { get; } = new ProviderCapabilities { SupportsAnonymousDownload = true, SupportsAnonymousSearch = true, SupportsDirectRevitAssets = true };
        public IReadOnlyList<string> AllowedDownloadHosts { get; set; } = new[] { "files.example.test", "*.cdn.example.test" };
        public readonly List<FamilyProduct> Products = new List<FamilyProduct>();
        public readonly Dictionary<string, FamilyDownloadResult> Downloads = new Dictionary<string, FamilyDownloadResult>();

        public FamilyProduct Add(string externalId, string assetId, string name, string url, string fileName = null, params string[] revitVersions)
        {
            var p = new FamilyProduct
            {
                ProviderId = ProviderId, ExternalId = externalId, ExternalAssetId = assetId, Name = name,
                Manufacturer = "Acme", Category = "Furniture", DownloadCapability = url == null ? DownloadCapability.AuthRequired : DownloadCapability.AnonymousDirect,
                RevitVersions = new List<string>(revitVersions),
            };
            Products.Add(p);
            Downloads[p.ProviderIdentity] = url == null
                ? FamilyDownloadResult.AuthRequired("stub: login required")
                : new FamilyDownloadResult { Capability = DownloadCapability.AnonymousDirect, Url = new Uri(url), FileName = fileName ?? Path.GetFileName(new Uri(url).AbsolutePath) };
            return p;
        }

        public Task<SearchResult> SearchAsync(FamilySearchQuery query, CancellationToken ct) => Task.FromResult(new SearchResult { Items = new List<FamilyProduct>(Products) });
        public Task<FamilyProduct> GetProductAsync(string externalId, CancellationToken ct) => Task.FromResult(Products.Find(p => p.ExternalId == externalId));
        public Task<FamilyDownloadResult> ResolveDownloadAsync(FamilyProduct product, CancellationToken ct) => Task.FromResult(Downloads[product.ProviderIdentity]);
    }

    /// <summary>Санах ойн Revit.  `RegistryJson`-ыг өөр instance-д өгвөл «Revit дахин асаасан» гэсэн үг.</summary>
    public sealed class FakeRevit : IRevitGateway
    {
        public sealed class Fam { public long Id; public string Name; public string Category = "Furniture"; public List<long> SymbolIds = new List<long>(); public List<string> SymbolNames = new List<string>(); public string SourcePath; }

        public int RevitVersion { get; set; } = 2027;
        public bool HasDocument { get; set; } = true;
        public string RegistryJson { get; set; }
        public readonly List<Fam> Families = new List<Fam>();
        public int LoadCalls, SaveCalls, PlaceCalls;
        private long _nextId = 1000;

        public Fam AddExisting(string name, params string[] types)
        {
            var f = new Fam { Id = _nextId++, Name = name };
            foreach (string t in (types.Length == 0 ? new[] { "Default" } : types)) { f.SymbolIds.Add(_nextId++); f.SymbolNames.Add(t); }
            Families.Add(f);
            return f;
        }

        public Task<bool> HasProjectDocumentAsync(CancellationToken ct) => Task.FromResult(HasDocument);
        public Task<FamilyHubRegistry> LoadRegistryAsync(CancellationToken ct) => Task.FromResult(FamilyHubRegistry.FromJson(RegistryJson));
        public Task SaveRegistryAsync(FamilyHubRegistry registry, CancellationToken ct) { SaveCalls++; RegistryJson = registry.ToJson(); return Task.CompletedTask; }
        public Task<ExistingFamilyInfo> FindFamilyByNameAsync(string name, CancellationToken ct) => Task.FromResult(Describe(Families.Find(f => f.Name == name)));
        public Task<ExistingFamilyInfo> FindFamilyByIdAsync(long familyId, CancellationToken ct) => Task.FromResult(Describe(Families.Find(f => f.Id == familyId)));

        public Task<ExistingFamilyInfo> LoadFamilyAsync(string rfaPath, CancellationToken ct)
        {
            LoadCalls++;
            if (!File.Exists(rfaPath)) throw new FileNotFoundException(rfaPath);
            string name = Path.GetFileNameWithoutExtension(rfaPath);
            if (Families.Exists(f => f.Name == name)) throw new InvalidOperationException("LoadFamily=false: ижил нэртэй family байна");
            Fam fam = AddExisting(name, "Type A", "Type B");
            fam.SourcePath = rfaPath;
            return Task.FromResult(Describe(fam));
        }

        public Task<PlacementOutcome> PlaceAsync(long familyId, long? symbolId, CancellationToken ct)
        {
            PlaceCalls++;
            Fam f = Families.Find(x => x.Id == familyId);
            if (f == null) return Task.FromResult(new PlacementOutcome { Status = PlacementStatus.Failed, Message = "олдсонгүй" });
            return Task.FromResult(new PlacementOutcome { Status = PlacementStatus.Placed, SymbolName = f.SymbolNames[0] });
        }

        private static ExistingFamilyInfo Describe(Fam f)
        {
            if (f == null) return null;
            return new ExistingFamilyInfo { FamilyId = f.Id, Name = f.Name, Category = f.Category, SymbolIds = new List<long>(f.SymbolIds), SymbolNames = new List<string>(f.SymbolNames) };
        }
    }

    public sealed class ScriptedResolver : IConflictResolver
    {
        public ConflictDecision Decision = ConflictDecision.Cancel;
        public int Calls;
        public NameConflict Last;
        public Task<ConflictDecision> ResolveNameConflictAsync(NameConflict conflict, CancellationToken ct) { Calls++; Last = conflict; return Task.FromResult(Decision); }
    }

    public sealed class RecordingObserver : IPipelineObserver
    {
        public readonly List<string> Stages = new List<string>();
        public void Report(PipelineStage stage, string message) { Stages.Add(stage.ToString()); }
    }

    /// <summary>Хуурамч RFA: OLE магик + UTF-16LE «Revit Build: …» мөр + дүүргэлт.  `salt` нь SHA-г өөрчилнө.</summary>
    public static class FakeRfa
    {
        public static byte[] Make(int savedVersion, string salt = "", bool withFormatLine = false, int pad = 2048)
        {
            var ms = new MemoryStream();
            ms.Write(new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 }, 0, 8);
            ms.Write(new byte[504], 0, 504); // OLE толгойн үлдэгдэл — байрлал тэгш хэвээр
            string text = "Worksharing: Not enabled\r\nUsername: \r\nCentral Model Path: \r\n"
                        + "Revit Build: Autodesk Revit " + savedVersion + " (Build: 2018" + "0329_1100(x64))\r\n"
                        + (withFormatLine ? "Format: " + savedVersion + "\r\n" : "")
                        + "Last Save Path: C:\\x\\" + salt + ".rfa\r\n";
            byte[] t = Encoding.Unicode.GetBytes(text);
            ms.Write(t, 0, t.Length);
            byte[] s = Encoding.UTF8.GetBytes(salt);
            ms.Write(s, 0, s.Length);
            ms.Write(new byte[pad], 0, pad);
            return ms.ToArray();
        }

        public static byte[] Zip(params KeyValuePair<string, byte[]>[] entries)
        {
            var ms = new MemoryStream();
            using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
            {
                foreach (var e in entries)
                {
                    ZipArchiveEntry ze = z.CreateEntry(e.Key);
                    using (Stream s = ze.Open()) s.Write(e.Value, 0, e.Value.Length);
                }
            }
            return ms.ToArray();
        }

        public static KeyValuePair<string, byte[]> Entry(string name, byte[] body) => new KeyValuePair<string, byte[]>(name, body);
    }

    public static class TestEnv
    {
        public static string TempRoot()
        {
            string d = Path.Combine(Path.GetTempPath(), "FamilyHubTests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(d);
            return d;
        }
    }
}
