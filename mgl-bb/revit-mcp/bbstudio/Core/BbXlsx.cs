using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Xml.Linq;

namespace MglBb.Core
{
    /// <summary>
    /// Гадны санггүй, хамгийн бага .xlsx бичигч/уншигч («Асуудал – Шийдэл» файл).  Бичихдээ inline string (Excel нээгээд хадгалахад
    /// sharedStrings болгоно — уншигч хоёуланг нь ойлгоно), толгойн мөр тод + хүрээтэй, мөр бүр wrap, баганын өргөн, «Төлөв» баганад
    /// жагсаалтаас сонгох (data validation), толгой хөлдөөсөн.  net48 (Revit 2024) ба net8/net10-д ижил.
    /// </summary>
    public static class BbXlsx
    {
        private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

        public sealed class Sheet
        {
            public string Name = "Sheet1";
            public readonly List<string> Header = new List<string>();
            public readonly List<double> Widths = new List<double>();
            public readonly List<List<string>> Rows = new List<List<string>>();

            /// <summary>Баганын индекс (0-ээс) → сонгох утгууд (Excel-ийн dropdown).</summary>
            public readonly Dictionary<int, string[]> Choices = new Dictionary<int, string[]>();
        }

        public static void Write(string path, IList<Sheet> sheets)
        {
            if (sheets == null || sheets.Count == 0) throw new ArgumentException("no sheets");
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                var ct = new StringBuilder();
                ct.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
                ct.Append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
                ct.Append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
                ct.Append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
                ct.Append("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>");
                ct.Append("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
                for (int i = 0; i < sheets.Count; i++)
                    ct.Append("<Override PartName=\"/xl/worksheets/sheet" + (i + 1) + ".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                ct.Append("</Types>");
                Put(zip, "[Content_Types].xml", ct.ToString());
                Put(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");

                var wb = new StringBuilder();
                wb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
                wb.Append("<workbook xmlns=\"" + S.NamespaceName + "\" xmlns:r=\"" + R.NamespaceName + "\"><sheets>");
                var rels = new StringBuilder();
                rels.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
                var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < sheets.Count; i++)
                {
                    string nm = SheetName(sheets[i].Name, i, usedNames);
                    wb.Append("<sheet name=\"" + Esc(nm) + "\" sheetId=\"" + (i + 1) + "\" r:id=\"rId" + (i + 1) + "\"/>");
                    rels.Append("<Relationship Id=\"rId" + (i + 1) + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet" + (i + 1) + ".xml\"/>");
                }
                wb.Append("</sheets></workbook>");
                rels.Append("<Relationship Id=\"rId" + (sheets.Count + 1) + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
                rels.Append("</Relationships>");
                Put(zip, "xl/workbook.xml", wb.ToString());
                Put(zip, "xl/_rels/workbook.xml.rels", rels.ToString());
                Put(zip, "xl/styles.xml", Styles);
                for (int i = 0; i < sheets.Count; i++) Put(zip, "xl/worksheets/sheet" + (i + 1) + ".xml", SheetXml(sheets[i]));
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        /// <summary>Хуудас бүрийг мөрүүд болгон уншина (эхний мөр = толгой).  Хоосон нүд = "".</summary>
        public static List<KeyValuePair<string, List<List<string>>>> Read(string path)
        {
            var res = new List<KeyValuePair<string, List<List<string>>>>();
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Read))
            {
                var shared = new List<string>();
                ZipArchiveEntry ss = zip.GetEntry("xl/sharedStrings.xml");
                if (ss != null)
                {
                    XDocument d = Load(ss);
                    foreach (XElement si in d.Root.Elements(S + "si")) shared.Add(TextOf(si));
                }
                XDocument wbd = Load(zip.GetEntry("xl/workbook.xml"));
                XDocument rels = Load(zip.GetEntry("xl/_rels/workbook.xml.rels"));
                var target = rels.Root.Elements().ToDictionary(e => (string)e.Attribute("Id"), e => (string)e.Attribute("Target"));
                foreach (XElement sh in wbd.Root.Element(S + "sheets").Elements(S + "sheet"))
                {
                    string rid = (string)sh.Attribute(R + "id");
                    if (rid == null || !target.TryGetValue(rid, out string t)) continue;
                    string entry = t.StartsWith("/", StringComparison.Ordinal) ? t.TrimStart('/') : "xl/" + t;
                    ZipArchiveEntry ze = zip.GetEntry(entry);
                    if (ze == null) continue;
                    XDocument sd = Load(ze);
                    var rows = new List<List<string>>();
                    XElement data = sd.Root.Element(S + "sheetData");
                    if (data != null)
                    {
                        foreach (XElement row in data.Elements(S + "row"))
                        {
                            int rIndex = (int?)row.Attribute("r") ?? rows.Count + 1;
                            while (rows.Count < rIndex - 1) rows.Add(new List<string>());
                            var cells = new List<string>();
                            foreach (XElement c in row.Elements(S + "c"))
                            {
                                int col = ColIndex((string)c.Attribute("r"), cells.Count);
                                while (cells.Count < col) cells.Add("");
                                cells.Add(CellText(c, shared));
                            }
                            rows.Add(cells);
                        }
                    }
                    res.Add(new KeyValuePair<string, List<List<string>>>((string)sh.Attribute("name"), rows));
                }
            }
            return res;
        }

        private static string CellText(XElement c, List<string> shared)
        {
            string t = (string)c.Attribute("t");
            if (t == "inlineStr") return TextOf(c.Element(S + "is"));
            string v = (string)c.Element(S + "v") ?? "";
            if (t == "s")
            {
                if (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) && i >= 0 && i < shared.Count) return shared[i];
                return "";
            }
            return v;
        }

        private static string TextOf(XElement e)
        {
            if (e == null) return "";
            var sb = new StringBuilder();
            foreach (XElement t in e.Descendants(S + "t")) sb.Append(t.Value);
            return sb.ToString();
        }

        /// <summary>"C12" → 2.  Шошгогүй нүд → дараалал.</summary>
        public static int ColIndex(string cellRef, int fallback)
        {
            if (string.IsNullOrEmpty(cellRef)) return fallback;
            int n = 0;
            foreach (char ch in cellRef)
            {
                if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch - 'A' + 1);
                else break;
            }
            return n > 0 ? n - 1 : fallback;
        }

        public static string ColName(int index)
        {
            var sb = new StringBuilder();
            int n = index + 1;
            while (n > 0)
            {
                int m = (n - 1) % 26;
                sb.Insert(0, (char)('A' + m));
                n = (n - 1) / 26;
            }
            return sb.ToString();
        }

        private static string SheetXml(Sheet sh)
        {
            int cols = Math.Max(sh.Header.Count, sh.Rows.Count == 0 ? 0 : sh.Rows.Max(r => r.Count));
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<worksheet xmlns=\"" + S.NamespaceName + "\" xmlns:r=\"" + R.NamespaceName + "\">");
            sb.Append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");
            if (cols > 0)
            {
                sb.Append("<cols>");
                for (int i = 0; i < cols; i++)
                {
                    double w = i < sh.Widths.Count && sh.Widths[i] > 0 ? sh.Widths[i] : 18;
                    sb.Append("<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + w.ToString(CultureInfo.InvariantCulture) + "\" customWidth=\"1\"/>");
                }
                sb.Append("</cols>");
            }
            sb.Append("<sheetData>");
            int r = 1;
            if (sh.Header.Count > 0) { AppendRow(sb, r++, sh.Header, 1); }
            foreach (List<string> row in sh.Rows) AppendRow(sb, r++, row, 2);
            sb.Append("</sheetData>");
            if (sh.Header.Count > 0) sb.Append("<autoFilter ref=\"A1:" + ColName(Math.Max(0, cols - 1)) + Math.Max(1, r - 1) + "\"/>");
            if (sh.Choices.Count > 0)
            {
                sb.Append("<dataValidations count=\"" + sh.Choices.Count + "\">");
                foreach (var kv in sh.Choices)
                {
                    string col = ColName(kv.Key);
                    string list = string.Join(",", kv.Value.Select(x => x.Replace(",", " ").Replace("\"", "'")));
                    sb.Append("<dataValidation type=\"list\" allowBlank=\"1\" showErrorMessage=\"0\" sqref=\"" + col + "2:" + col + "2000\"><formula1>\"" + Esc(list) + "\"</formula1></dataValidation>");
                }
                sb.Append("</dataValidations>");
            }
            sb.Append("<pageMargins left=\"0.4\" right=\"0.4\" top=\"0.5\" bottom=\"0.5\" header=\"0.3\" footer=\"0.3\"/>");
            sb.Append("<pageSetup orientation=\"landscape\" paperSize=\"9\"/>");
            sb.Append("</worksheet>");
            return sb.ToString();
        }

        private static void AppendRow(StringBuilder sb, int r, IList<string> cells, int style)
        {
            sb.Append("<row r=\"" + r + "\">");
            for (int c = 0; c < cells.Count; c++)
            {
                string v = cells[c] ?? "";
                sb.Append("<c r=\"" + ColName(c) + r + "\" s=\"" + style + "\" t=\"inlineStr\"><is><t xml:space=\"preserve\">" + Esc(v) + "</t></is></c>");
            }
            sb.Append("</row>");
        }

        private const string Styles =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
            "<fonts count=\"2\"><font><sz val=\"10\"/><name val=\"Arial\"/></font><font><b/><sz val=\"10\"/><color rgb=\"FFFFFFFF\"/><name val=\"Arial\"/></font></fonts>" +
            "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>" +
            "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1F3864\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>" +
            "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>" +
            "<border><left style=\"thin\"><color rgb=\"FFBFBFBF\"/></left><right style=\"thin\"><color rgb=\"FFBFBFBF\"/></right><top style=\"thin\"><color rgb=\"FFBFBFBF\"/></top><bottom style=\"thin\"><color rgb=\"FFBFBFBF\"/></bottom><diagonal/></border></borders>" +
            "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
            "<cellXfs count=\"3\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
            "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"center\" wrapText=\"1\"/></xf>" +
            "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\" wrapText=\"1\"/></xf></cellXfs>" +
            "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
            "</styleSheet>";

        private static string SheetName(string name, int i, HashSet<string> used)
        {
            string n = string.IsNullOrWhiteSpace(name) ? "Sheet" + (i + 1) : name.Trim();
            foreach (char ch in new[] { ':', '\\', '/', '?', '*', '[', ']' }) n = n.Replace(ch, '_');
            if (n.Length > 31) n = n.Substring(0, 31);
            string b = n;
            int k = 2;
            while (!used.Add(n)) { string suf = " " + k++; n = (b.Length + suf.Length > 31 ? b.Substring(0, 31 - suf.Length) : b) + suf; }
            return n;
        }

        private static void Put(ZipArchive zip, string name, string content)
        {
            ZipArchiveEntry e = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (var w = new StreamWriter(e.Open(), new UTF8Encoding(false))) w.Write(content);
        }

        private static XDocument Load(ZipArchiveEntry e)
        {
            using (Stream s = e.Open()) return XDocument.Load(s);
        }

        private static string Esc(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length);
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '&': sb.Append("&amp;"); break;
                    case '<': sb.Append("&lt;"); break;
                    case '>': sb.Append("&gt;"); break;
                    case '"': sb.Append("&quot;"); break;
                    default:
                        if (ch < 0x20 && ch != '\n' && ch != '\r' && ch != '\t') continue; // XML 1.0-д хориотой
                        sb.Append(ch);
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
