using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.FamilyHub.Core
{
    public enum PackageKind { Rfa, Zip, Unknown }

    /// <summary>Шалгагдсан, ачаалахад бэлэн НЭГ .rfa файл.</summary>
    public sealed class InspectedFamilyFile
    {
        public string Path { get; set; }
        public string FileName { get; set; }
        /// <summary>Revit family-ийн нэр = файлын нэр (өргөтгөлгүй).</summary>
        public string FamilyName { get; set; }
        public string Sha256 { get; set; }
        public long Bytes { get; set; }
        /// <summary>Файл дотроос уншсан «хадгалсан Revit хувилбар» (ж: 2018).  Олдоогүй бол null.</summary>
        public int? SavedRevitVersion { get; set; }
        public string RevitBuildLine { get; set; }
        /// <summary>ZIP доторх эх нэр (zip биш бол null).</summary>
        public string ZipEntryName { get; set; }
    }

    public sealed class PackageInspection
    {
        public bool Ok { get; set; }
        public string Reason { get; set; }
        public PackageKind Kind { get; set; }
        public List<InspectedFamilyFile> Files { get; set; } = new List<InspectedFamilyFile>();
        public List<string> SkippedEntries { get; set; } = new List<string>();

        internal static PackageInspection Fail(PackageKind kind, string reason)
        {
            return new PackageInspection { Ok = false, Kind = kind, Reason = reason };
        }
    }

    /// <summary>
    /// Татсан файлыг ИТГЭЛГҮЙ гэж үзэн задална: .rfa (OLE compound магик) эсвэл
    /// .rfa агуулсан .zip.  ZIP traversal хамгаалалт, гүйцэтгэгдэх/скрипт файл
    /// байвал БҮХЭЛД НЬ татгалзана, зөвхөн .rfa-г л задална, зарласан
    /// хэмжээнээс хэтрүүлж бичихгүй.
    /// </summary>
    public static class FamilyPackageInspector
    {
        private static readonly byte[] OleMagic = { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 };
        private static readonly byte[] ZipMagic = { 0x50, 0x4B, 0x03, 0x04 };

        /// <summary>
        /// Аль нэг нь ZIP дотор байвал БҮХ архивыг татгалзана.  Жагсаалт
        /// «мэдэгдэж буй аюултай» гэсэн үг — цагаан жагсаалт нь <c>.rfa</c> л.
        /// </summary>
        public static readonly string[] ForbiddenExtensions =
        {
            ".exe", ".dll", ".com", ".scr", ".pif", ".msi", ".msp", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe",
            ".js", ".jse", ".wsf", ".wsh", ".hta", ".jar", ".lnk", ".reg", ".sh", ".py", ".rb", ".pl", ".cpl",
            ".inf", ".ocx", ".sys", ".drv", ".msc", ".appx", ".application", ".gadget", ".dyn", ".dyf", ".rvt",
        };

        public static PackageKind DetectKind(string path)
        {
            try
            {
                using (FileStream fs = File.OpenRead(path))
                {
                    var head = new byte[8];
                    int n = fs.Read(head, 0, 8);
                    if (n >= 8 && StartsWith(head, OleMagic)) return PackageKind.Rfa;
                    if (n >= 4 && StartsWith(head, ZipMagic)) return PackageKind.Zip;
                }
            }
            catch { }
            return PackageKind.Unknown;
        }

        public static PackageInspection Inspect(string downloadedPath, string extractDir, long maxTotalBytes)
        {
            if (!File.Exists(downloadedPath)) return PackageInspection.Fail(PackageKind.Unknown, "Файл олдсонгүй");
            PackageKind kind = DetectKind(downloadedPath);
            string ext = System.IO.Path.GetExtension(downloadedPath).ToLowerInvariant();

            if (kind == PackageKind.Rfa)
            {
                if (ext != ".rfa")
                    return PackageInspection.Fail(kind, "Агуулга нь RFA боловч өргөтгөл нь " + ext + " — татгалзав");
                var r = new PackageInspection { Ok = true, Kind = kind };
                r.Files.Add(Describe(downloadedPath, null));
                return r;
            }

            if (kind == PackageKind.Zip)
            {
                if (ext != ".zip")
                    return PackageInspection.Fail(kind, "Агуулга нь ZIP боловч өргөтгөл нь " + ext + " — татгалзав");
                return InspectZip(downloadedPath, extractDir, maxTotalBytes);
            }

            return PackageInspection.Fail(kind, "Файлын магик байт нь RFA (OLE) ч биш, ZIP ч биш");
        }

        private static PackageInspection InspectZip(string zipPath, string extractDir, long maxTotalBytes)
        {
            var result = new PackageInspection { Ok = true, Kind = PackageKind.Zip };
            var rfaEntries = new List<ZipArchiveEntry>();
            try
            {
                using (FileStream fs = File.OpenRead(zipPath))
                using (var zip = new ZipArchive(fs, ZipArchiveMode.Read, leaveOpen: false))
                {
                    long declaredTotal = 0;
                    var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        string full = (e.FullName ?? "").Replace('\\', '/');
                        if (full.Length == 0) continue;
                        if (IsTraversal(full))
                            return PackageInspection.Fail(PackageKind.Zip, "ZIP traversal: " + full);
                        if (full.EndsWith("/")) continue; // хавтас
                        string name = full.Substring(full.LastIndexOf('/') + 1);
                        string eext = System.IO.Path.GetExtension(name).ToLowerInvariant();
                        if (Array.IndexOf(ForbiddenExtensions, eext) >= 0)
                            return PackageInspection.Fail(PackageKind.Zip, "ZIP дотор гүйцэтгэгдэх/скрипт файл: " + full);
                        declaredTotal += Math.Max(0, e.Length);
                        if (declaredTotal > maxTotalBytes)
                            return PackageInspection.Fail(PackageKind.Zip, "ZIP-ийн задарсан хэмжээ " + maxTotalBytes + "-аас их");
                        if (eext == ".rfa")
                        {
                            if (!seenNames.Add(name))
                                return PackageInspection.Fail(PackageKind.Zip, "ZIP дотор ижил нэртэй хоёр RFA: " + name);
                            rfaEntries.Add(e);
                        }
                        else
                        {
                            result.SkippedEntries.Add(full);
                        }
                    }

                    if (rfaEntries.Count == 0)
                        return PackageInspection.Fail(PackageKind.Zip, "ZIP дотор .rfa файл алга");

                    Directory.CreateDirectory(extractDir);
                    foreach (ZipArchiveEntry e in rfaEntries)
                    {
                        string safe = TempFiles.SafeFileName(e.Name);
                        string dest = System.IO.Path.Combine(extractDir, safe);
                        // Зарласан хэмжээ + 1 байтаас хэтэрвэл толгой худал → татгалзана.
                        long cap = e.Length;
                        using (Stream src = e.Open())
                        using (var dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            var buf = new byte[1 << 16];
                            long written = 0;
                            int n;
                            while ((n = src.Read(buf, 0, buf.Length)) > 0)
                            {
                                written += n;
                                if (written > cap)
                                {
                                    dst.Dispose();
                                    TryDelete(dest);
                                    return PackageInspection.Fail(PackageKind.Zip, "ZIP entry зарласан хэмжээнээсээ том: " + e.FullName);
                                }
                                dst.Write(buf, 0, n);
                            }
                        }
                        if (DetectKind(dest) != PackageKind.Rfa)
                        {
                            TryDelete(dest);
                            return PackageInspection.Fail(PackageKind.Zip, "ZIP доторх .rfa нь OLE биш: " + e.FullName);
                        }
                        result.Files.Add(Describe(dest, e.FullName));
                    }
                }
            }
            catch (InvalidDataException ex)
            {
                return PackageInspection.Fail(PackageKind.Zip, "ZIP эвдэрхий: " + ex.Message);
            }
            catch (IOException ex)
            {
                return PackageInspection.Fail(PackageKind.Zip, "ZIP уншиж чадсангүй: " + ex.Message);
            }
            return result;
        }

        public static bool IsTraversal(string entryFullName)
        {
            string f = entryFullName.Replace('\\', '/');
            if (f.StartsWith("/")) return true;
            if (f.Length >= 2 && f[1] == ':') return true;
            foreach (string seg in f.Split('/'))
                if (seg == ".." || seg == ".") return true;
            foreach (char c in f)
                if (c < 32) return true;
            return false;
        }

        private static InspectedFamilyFile Describe(string path, string zipEntry)
        {
            string line;
            int? ver = ReadSavedRevitVersion(path, out line);
            var fi = new FileInfo(path);
            return new InspectedFamilyFile
            {
                Path = path,
                FileName = fi.Name,
                FamilyName = System.IO.Path.GetFileNameWithoutExtension(fi.Name),
                Sha256 = SafeDownloader.Sha256OfFile(path),
                Bytes = fi.Length,
                SavedRevitVersion = ver,
                RevitBuildLine = line,
                ZipEntryName = zipEntry,
            };
        }

        private static readonly Regex BuildYear = new Regex(@"Autodesk Revit(?: Architecture| Structure| MEP| LT)? (20\d\d)", RegexOptions.CultureInvariant);
        private static readonly Regex FormatYear = new Regex(@"Format:\s*(20\d\d)", RegexOptions.CultureInvariant);

        /// <summary>
        /// RFA/RVT-ийн `BasicFileInfo` стрийм нь UTF-16LE текст агуулдаг:
        /// «Revit Build: Autodesk Revit 2018 (Build: …)» ба (2019+) «Format: 2024».
        /// OLE-г бүрэн задлахгүйгээр байтын түвшинд хайна — POC-д хангалттай,
        /// олдохгүй бол `null` (UNKNOWN) — ХЭЗЭЭ Ч таамаглахгүй.
        /// </summary>
        public static int? ReadSavedRevitVersion(string path, out string buildLine)
        {
            buildLine = null;
            try
            {
                byte[] data = File.ReadAllBytes(path);
                string s = Encoding.Unicode.GetString(data);
                int idx = s.IndexOf("Revit Build:", StringComparison.Ordinal);
                if (idx < 0)
                {
                    // UTF-16 хос байтын зөрөөтэй тохиолдол — нэг байт шилжүүлж дахин.
                    if (data.Length > 1) s = Encoding.Unicode.GetString(data, 1, data.Length - 1);
                    idx = s.IndexOf("Revit Build:", StringComparison.Ordinal);
                }
                if (idx < 0) return null;
                int end = s.IndexOfAny(new[] { '\r', '\n', '\0' }, idx);
                buildLine = s.Substring(idx, (end < 0 ? Math.Min(s.Length, idx + 120) : end) - idx).Trim();

                // 2019+ файлд "Format: 20xx" мөр тусдаа бий — тэр нь ХАДГАЛСАН формат.
                int fidx = s.IndexOf("Format:", idx, StringComparison.Ordinal);
                if (fidx >= 0 && fidx - idx < 2000)
                {
                    Match fm = FormatYear.Match(s, fidx, Math.Min(40, s.Length - fidx));
                    if (fm.Success) return int.Parse(fm.Groups[1].Value);
                }
                Match m = BuildYear.Match(buildLine);
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
            catch { }
            return null;
        }

        private static bool StartsWith(byte[] data, byte[] prefix)
        {
            if (data.Length < prefix.Length) return false;
            for (int i = 0; i < prefix.Length; i++) if (data[i] != prefix[i]) return false;
            return true;
        }

        private static void TryDelete(string p)
        {
            try { if (File.Exists(p)) File.Delete(p); } catch { }
        }
    }

    public static class RevitCompatibilityCheck
    {
        /// <summary>Файлаас уншсан хувилбар vs ажиллаж буй Revit.</summary>
        public static RevitCompatibility FromSavedVersion(int? savedVersion, int currentVersion)
        {
            if (!savedVersion.HasValue || currentVersion <= 0) return RevitCompatibility.Unknown;
            if (savedVersion.Value > currentVersion) return RevitCompatibility.Incompatible;
            if (savedVersion.Value == currentVersion) return RevitCompatibility.Compatible;
            // Хуучин файл — Revit ачаалахдаа upgrade хийнэ; ихэнхдээ амжилттай, гэхдээ БАТАЛГААГҮЙ.
            return RevitCompatibility.LikelyCompatible;
        }

        /// <summary>Нийлүүлэгчийн МЭДЭЭЛСЭН хувилбарууд — байхгүй бол UNKNOWN, хэзээ ч таамаглахгүй.</summary>
        public static RevitCompatibility FromProviderMetadata(IList<string> revitVersions, int currentVersion)
        {
            if (revitVersions == null || revitVersions.Count == 0 || currentVersion <= 0) return RevitCompatibility.Unknown;
            bool anyOlder = false, anyParsed = false;
            foreach (string v in revitVersions)
            {
                int y;
                if (!TryYear(v, out y)) continue;
                anyParsed = true;
                if (y == currentVersion) return RevitCompatibility.Compatible;
                if (y < currentVersion) anyOlder = true;
            }
            if (!anyParsed) return RevitCompatibility.Unknown;
            return anyOlder ? RevitCompatibility.LikelyCompatible : RevitCompatibility.Incompatible;
        }

        private static bool TryYear(string v, out int year)
        {
            year = 0;
            if (string.IsNullOrEmpty(v)) return false;
            Match m = Regex.Match(v, @"(20\d\d)");
            return m.Success && int.TryParse(m.Groups[1].Value, out year);
        }

        /// <summary>Хэрэглэгчид харуулах монгол шошго (машин токен <see cref="Label"/> нь лог, тестэд хэвээр).</summary>
        public static string DisplayLabel(RevitCompatibility c)
        {
            switch (c)
            {
                case RevitCompatibility.Compatible: return "тохирно";
                case RevitCompatibility.LikelyCompatible: return "магадгүй тохирно";
                case RevitCompatibility.Incompatible: return "ТОХИРОХГҮЙ";
                default: return "тодорхойгүй";
            }
        }

        public static string Label(RevitCompatibility c)
        {
            switch (c)
            {
                case RevitCompatibility.Compatible: return "COMPATIBLE";
                case RevitCompatibility.LikelyCompatible: return "LIKELY_COMPATIBLE";
                case RevitCompatibility.Incompatible: return "INCOMPATIBLE";
                default: return "UNKNOWN";
            }
        }
    }
}
