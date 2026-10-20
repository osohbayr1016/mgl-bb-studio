using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AddinInspect
{
    /// <summary>
    /// RevitMcpAddin.dll-ийн metadata шалгалт.  DLL-ийг ачаалахгүй (Revit-ийн assembly-гүйгээр ажиллана).  Exit code 0 = бүх шалгалт PASS.
    /// </summary>
    public static class Program
    {
        private sealed class Check
        {
            public string Id { get; set; }
            public string Status { get; set; }
            public string Expected { get; set; }
            public string Actual { get; set; }
        }

        private static readonly Dictionary<int, string> Runtime = new Dictionary<int, string>
        {
            { 2024, ".NETFramework,Version=v4.8" },
            { 2025, ".NETCoreApp,Version=v8.0" },
            { 2026, ".NETCoreApp,Version=v8.0" },
            { 2027, ".NETCoreApp,Version=v10.0" },
        };

        /// <summary>Тест, harness, гүүрний код production DLL-д ОРОХ ЁСГҮЙ — төрлийн нэрийн хэсэг.</summary>
        private static readonly string[] ForbiddenTypeParts = { "LiveGate", "WeGate", "Harness", "UiSmoke", "TestRunner" };

        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length < 2) { Console.Error.WriteLine("usage: AddinInspect <dll> <year> [--json out.json]"); return 2; }
            string dll = args[0];
            int year = int.Parse(args[1]);
            string json = null;
            for (int i = 2; i < args.Length; i++) if (args[i] == "--json" && i + 1 < args.Length) json = args[++i];

            var checks = new List<Check>();
            Action<string, bool, string, string> add = (id, ok, exp, act) => checks.Add(new Check { Id = id, Status = ok ? "PASS" : "FAIL", Expected = exp, Actual = act });

            if (!File.Exists(dll))
            {
                add("dll.exists", false, dll, "missing");
                return Finish(checks, json, dll, year, null, null);
            }
            string sha;
            using (var fs = File.OpenRead(dll)) sha = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
            string fileVersion = FileVersionInfo.GetVersionInfo(dll).FileVersion ?? string.Empty;

            using (var stream = File.OpenRead(dll))
            using (var pe = new PEReader(stream))
            {
                MetadataReader md = pe.GetMetadataReader();

                // 1. Target runtime
                string tfm = AssemblyAttributeString(md, "System.Runtime.Versioning", "TargetFrameworkAttribute");
                string wantTfm;
                Runtime.TryGetValue(year, out wantTfm);
                add("runtime.target_framework", wantTfm != null && tfm == wantTfm, wantTfm ?? "(тодорхойгүй он)", tfm ?? "(attribute алга)");

                // 2. Revit API references
                foreach (string name in new[] { "RevitAPI", "RevitAPIUI" })
                {
                    AssemblyReference? r = md.AssemblyReferences.Select(h => md.GetAssemblyReference(h))
                        .Cast<AssemblyReference?>().FirstOrDefault(a => md.GetString(a.Value.Name) == name);
                    string act = r.HasValue ? r.Value.Version.ToString() : "(лавлагаа алга)";
                    add("revitapi.ref." + name, r.HasValue && r.Value.Version.Major == year - 2000, (year - 2000) + ".x", act);
                }

                // 2b. Эмхэтгэсэн API хувилбар ↔ ЭНЭ PC-д суусан Revit (NuGet `2024.*` / `2027.*` бэхлээгүй тул шинэ minor-оор эмхэтгэгдэж болно).
                //     Шинэ minor-т нэмэгдсэн гишүүн хуучин Revit дээр MissingMethodException өгнө → WARN (одоо хэрэглэгдэж буй API-д нөлөөгүй байж болно).
                string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Autodesk", "Revit " + year, "RevitAPI.dll");
                if (File.Exists(installed))
                {
                    // Autodesk 2024 assembly хувилбарыг 24.0.0.0 хэвээр үлдээдэг (update бүрд биш) — FILE хувилбараар (24.1.0.66) харьцуулна.
                    Version inst;
                    if (!Version.TryParse(FileVersionInfo.GetVersionInfo(installed).FileVersion ?? string.Empty, out inst)) inst = AssemblyVersionOf(installed);
                    AssemblyReference? r = md.AssemblyReferences.Select(h => md.GetAssemblyReference(h))
                        .Cast<AssemblyReference?>().FirstOrDefault(a => md.GetString(a.Value.Name) == "RevitAPI");
                    if (r.HasValue && inst != null)
                    {
                        Version comp = r.Value.Version;
                        bool newer = comp.Major == inst.Major && comp.Minor > inst.Minor;
                        checks.Add(new Check { Id = "revitapi.compiled_vs_installed", Status = newer ? "WARN" : "PASS",
                                               Expected = "эмхэтгэсэн ≤ суусан (" + inst + ")", Actual = comp.ToString() });
                    }
                }
                else checks.Add(new Check { Id = "revitapi.compiled_vs_installed", Status = "NOT_RUN", Expected = "Revit " + year + " суусан", Actual = "алга — " + installed });

                // 3. WallElevationCommand: public, IExternalCommand
                TypeDefinition? cmd = md.TypeDefinitions.Select(h => md.GetTypeDefinition(h)).Cast<TypeDefinition?>()
                    .FirstOrDefault(t => md.GetString(t.Value.Namespace) == "RevitMcpAddin.WallElevation" && md.GetString(t.Value.Name) == "WallElevationCommand");
                bool isPublic = cmd.HasValue && (cmd.Value.Attributes & System.Reflection.TypeAttributes.VisibilityMask) == System.Reflection.TypeAttributes.Public;
                add("command.WallElevationCommand.public", isPublic, "public class", cmd.HasValue ? cmd.Value.Attributes.ToString() : "(алга)");
                bool implementsCmd = cmd.HasValue && cmd.Value.GetInterfaceImplementations()
                    .Select(h => md.GetInterfaceImplementation(h).Interface)
                    .Any(ih => ih.Kind == HandleKind.TypeReference && md.GetString(md.GetTypeReference((TypeReferenceHandle)ih).Name) == "IExternalCommand");
                add("command.WallElevationCommand.IExternalCommand", implementsCmd, "implements IExternalCommand", implementsCmd ? "yes" : "no");

                // 4. InternalsVisibleTo — black-box тест сонгосон (2026-10-13): production DLL-д friend assembly БАЙХГҮЙ.
                List<string> ivt = AssemblyAttributeStrings(md, "System.Runtime.CompilerServices", "InternalsVisibleToAttribute");
                add("security.no_internals_visible_to", ivt.Count == 0, "(байхгүй)", ivt.Count == 0 ? "(байхгүй)" : string.Join(", ", ivt));

                // 5. Тест/harness төрөл
                List<string> bad = md.TypeDefinitions.Select(h => md.GetTypeDefinition(h))
                    .Select(t => md.GetString(t.Namespace) + "." + md.GetString(t.Name))
                    .Where(n => ForbiddenTypeParts.Any(p => n.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0)).ToList();
                add("security.no_test_types", bad.Count == 0, "(байхгүй)", bad.Count == 0 ? "(байхгүй)" : string.Join(", ", bad.Take(5)));

                // 6. Debug build биш (DebuggableAttribute DisableOptimizations)
                bool debug = IsDebugBuild(md);
                add("build.optimized", !debug, "Release (optimized)", debug ? "DEBUG (DisableOptimizations)" : "optimized");
            }
            return Finish(checks, json, dll, year, sha, fileVersion);
        }

        private static int Finish(List<Check> checks, string json, string dll, int year, string sha, string fileVersion)
        {
            foreach (Check c in checks)
                Console.WriteLine("  " + (c.Status == "PASS" ? "ok  " : c.Status.PadRight(4)) + " " + c.Id + "  expected=" + c.Expected + "  actual=" + c.Actual);
            // WARN / NOT_RUN нь exit code-д нөлөөлөхгүй — gate тайланд тусад нь гарна.
            bool ok = checks.All(c => c.Status != "FAIL");
            Console.WriteLine((ok ? "PASS " : "FAIL ") + checks.Count(c => c.Status == "PASS") + "/" + checks.Count
                              + (checks.Any(c => c.Status == "WARN") ? " · WARN " + checks.Count(c => c.Status == "WARN") : "")
                              + "  " + Path.GetFileName(dll) + " (" + year + ")  sha256=" + sha);
            if (json != null)
            {
                var doc = new { schema = "mgl-we-addin-inspect-v1", dll, year, sha256 = sha, file_version = fileVersion, ok, checks };
                File.WriteAllText(json, JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
            }
            return ok ? 0 : 1;
        }

        private static Version AssemblyVersionOf(string path)
        {
            try
            {
                using (var s = File.OpenRead(path))
                using (var pe = new PEReader(s))
                    return pe.GetMetadataReader().GetAssemblyDefinition().Version;
            }
            catch { return null; }
        }

        private static string AssemblyAttributeString(MetadataReader md, string ns, string name)
        {
            return AssemblyAttributeStrings(md, ns, name).FirstOrDefault();
        }

        private static List<string> AssemblyAttributeStrings(MetadataReader md, string ns, string name)
        {
            var list = new List<string>();
            foreach (CustomAttributeHandle h in md.GetAssemblyDefinition().GetCustomAttributes())
            {
                CustomAttribute ca = md.GetCustomAttribute(h);
                if (!AttributeIs(md, ca, ns, name)) continue;
                BlobReader br = md.GetBlobReader(ca.Value);
                if (br.ReadUInt16() != 1) continue;   // prolog
                list.Add(br.ReadSerializedString());
            }
            return list;
        }

        private static bool AttributeIs(MetadataReader md, CustomAttribute ca, string ns, string name)
        {
            if (ca.Constructor.Kind != HandleKind.MemberReference) return false;
            MemberReference mr = md.GetMemberReference((MemberReferenceHandle)ca.Constructor);
            if (mr.Parent.Kind != HandleKind.TypeReference) return false;
            TypeReference tr = md.GetTypeReference((TypeReferenceHandle)mr.Parent);
            return md.GetString(tr.Namespace) == ns && md.GetString(tr.Name) == name;
        }

        private static bool IsDebugBuild(MetadataReader md)
        {
            foreach (CustomAttributeHandle h in md.GetAssemblyDefinition().GetCustomAttributes())
            {
                CustomAttribute ca = md.GetCustomAttribute(h);
                if (!AttributeIs(md, ca, "System.Diagnostics", "DebuggableAttribute")) continue;
                // Хоёр constructor: (DebuggingModes) — int32, DisableOptimizations = 256; (bool tracking, bool optimizerDisabled).
                MemberReference mr = md.GetMemberReference((MemberReferenceHandle)ca.Constructor);
                BlobReader sig = md.GetBlobReader(mr.Signature);
                sig.ReadByte();                       // calling convention
                sig.ReadCompressedInteger();          // parameter count
                sig.ReadByte();                       // return type (void)
                byte first = sig.ReadByte();          // 0x02 = bool, 0x11 = valuetype (enum)
                BlobReader br = md.GetBlobReader(ca.Value);
                if (br.ReadUInt16() != 1) continue;
                if (first == 0x02) { br.ReadBoolean(); return br.ReadBoolean(); }
                return (br.ReadInt32() & 256) != 0;
            }
            return false;
        }
    }
}
