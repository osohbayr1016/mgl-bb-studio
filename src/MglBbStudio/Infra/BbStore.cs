using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.Infra
{
    /// <summary>
    /// Хадгалалт: стандарт (%APPDATA%\MGL\BbStudio\standard.json — байхгүй бол ЖИШЭЭ-1-ээс сурсан, багцад суулгасан өгөгдмөл) ба төсөл тус бүрийн
    /// «Асуудал – Шийдэл» Excel (Documents\MGL ББ\&lt;төслийн нэр&gt;\Асуудал-шийдэл.xlsx).  Үндсэн plugin-ий тохиргооны файлуудад ХЭЗЭЭ Ч бичихгүй.
    /// </summary>
    internal static class BbStore
    {
        public static string StandardPath { get { return Path.Combine(Paths.Root, "standard.json"); } }

        public const string EmbeddedName = "MglBb.standard-default.json";

        /// <param name="source">«хэрэглэгчийн» / «ЖИШЭЭ-1 (өгөгдмөл)» / «кодын өгөгдмөл».</param>
        public static BbStandard LoadStandard(out string source)
        {
            try
            {
                if (File.Exists(StandardPath))
                {
                    source = "сурсан стандарт (" + StandardPath + ")";
                    return BbStandard.Load(StandardPath);
                }
            }
            catch (Exception ex)
            {
                try { File.Copy(StandardPath, StandardPath + ".broken", true); } catch { }
                source = "өгөгдмөл (хадгалсан стандарт уншигдсангүй: " + ex.Message + ")";
            }
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(EmbeddedName))
                {
                    if (s != null)
                    {
                        using (var r = new StreamReader(s))
                        {
                            source = "ЖИШЭЭ-1-ээс сурсан өгөгдмөл стандарт";
                            return BbStandard.FromJson(BbJson.Parse(r.ReadToEnd()));
                        }
                    }
                }
            }
            catch { }
            source = "кодын өгөгдмөл";
            return new BbStandard();
        }

        public static void SaveStandard(BbStandard std)
        {
            if (File.Exists(StandardPath))
            {
                try { File.Copy(StandardPath, Path.Combine(Paths.Root, "standard.prev.json"), true); } catch { }
            }
            std.Save(StandardPath);
        }

        public static string IssuesPath(Document doc)
        {
            string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            string title = Safe(string.IsNullOrEmpty(doc?.Title) ? "Төсөл" : doc.Title);
            string dir = Path.Combine(docs, "MGL ББ", title);
            try { Directory.CreateDirectory(dir); } catch { }
            return Path.Combine(dir, "Асуудал-шийдэл.xlsx");
        }

        /// <summary>Шинэ асуудлуудыг төслийн Excel-д нэгтгэнэ (инженерийн «Шийдэл / Төлөв / Тайлбар» хэвээр).  Буцаах: файлын зам (бичиж чадаагүй бол null + шалтгаан).</summary>
        public static string WriteIssues(Document doc, IEnumerable<BbIssue> issues, out string error)
        {
            error = null;
            var list = (issues ?? Enumerable.Empty<BbIssue>()).Where(i => i != null).ToList();
            string path = IssuesPath(doc);
            if (list.Count == 0 && !File.Exists(path)) return null;
            try
            {
                BbIssueBook.Merge(path, list, DateTime.Now);
                return path;
            }
            catch (IOException ex)
            {
                // Excel дээр нээлттэй бол түгжигдсэн — хуулбарт бичнэ.
                string alt = Path.Combine(Path.GetDirectoryName(path), "Асуудал-шийдэл " + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".xlsx");
                try
                {
                    BbIssueBook.Merge(alt, list, DateTime.Now);
                    error = "Үндсэн Excel нээлттэй байсан тул шинэ файлд бичив.";
                    return alt;
                }
                catch (Exception ex2) { error = ex.Message + " / " + ex2.Message; return null; }
            }
            catch (Exception ex) { error = ex.Message; return null; }
        }

        private static string Safe(string s)
        {
            foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s.Trim().TrimEnd('.');
        }
    }
}
