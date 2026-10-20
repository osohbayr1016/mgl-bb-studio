using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using MglLiraReport.Model;

namespace MglLiraReport.Docx
{
    /// <summary>
    /// Тайланг .docx болгоно (OOXML-ийг гараар — гадны сан шаардахгүй).
    ///
    /// Геометр нь жишээ тайлангаас (МЕС-23/09, A4) хэмжсэн утга:
    ///   хүрээ — зүүн 20 мм, дээд/баруун/доод 5 мм, зураас 2.25pt (VML rect, header-т page-relative);
    ///   булангийн хүснэгт — 185 × 15 мм, 3 мөр × 5 мм, footer-т (footer зай 5 мм);
    ///   нүүр хуудас — нимгэн хүрээ, лого, гарчиг, гарын үсгийн хүснэгт, хаяг (first-page footer-т).
    /// Нэг section, titlePg: нүүр хуудас өөрийн header/footer-тэй, бусад нь хүрээ + булангийн хүснэгт.
    /// </summary>
    public class DocxBuilder
    {
        public const string Font = "ISOCPEUR MON";

        // Хуудас, хүрээ (мм)
        const double PageW = 210, PageH = 297;
        const double FrameL = 20, FrameT = 5, FrameR = 5, FrameB = 5;
        const double MarginT = 12, MarginB = 25, MarginL = 25, MarginR = 10;
        const double HeaderDist = 5, FooterDist = 4.3;
        const double ContentW = PageW - MarginL - MarginR;          // 175 мм
        static readonly double[] StampCols = { 31.3, 14.0, 19.8, 14.4, 15.7, 76.6, 13.2 }; // Σ = 185
        const double StampRowH = 5;

        readonly ReportFile _file;
        readonly ProjectInfo _p;
        readonly List<(string rid, string target, byte[] data)> _docMedia = new List<(string, string, byte[])>();
        readonly List<(string rid, string target, byte[] data)> _footerMedia = new List<(string, string, byte[])>();
        int _nextRid = 10;
        int _nextDocPr = 1;
        int _mediaSeq = 1;

        public DocxBuilder(ReportFile file)
        {
            _file = file;
            _p = file.Document.Project;
        }

        public void Save(string path)
        {
            string body = BuildBody();
            string header1 = BuildFrameHeader();
            string header2 = BuildCoverHeader();
            string footer1 = BuildStampFooter();
            string footer2 = BuildCoverFooter();

            string tmp = path + ".tmp";
            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                Put(zip, "[Content_Types].xml", ContentTypes());
                Put(zip, "_rels/.rels",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                    "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
                    "</Relationships>");
                Put(zip, "docProps/core.xml", CoreProps());
                Put(zip, "word/document.xml", Wrap("w:document", "<w:body>" + body + SectPr() + "</w:body>"));
                Put(zip, "word/styles.xml", Styles());
                Put(zip, "word/settings.xml", Settings());
                Put(zip, "word/header1.xml", Wrap("w:hdr", header1));
                Put(zip, "word/header2.xml", Wrap("w:hdr", header2));
                Put(zip, "word/footer1.xml", Wrap("w:ftr", footer1));
                Put(zip, "word/footer2.xml", Wrap("w:ftr", footer2));
                Put(zip, "word/_rels/document.xml.rels", DocumentRels());
                if (_footerMedia.Count > 0) Put(zip, "word/_rels/footer1.xml.rels", MediaRels(_footerMedia));
                foreach (var m in _docMedia.Concat(_footerMedia))
                {
                    var e = zip.CreateEntry("word/" + m.target, CompressionLevel.NoCompression);
                    using (var s = e.Open()) s.Write(m.data, 0, m.data.Length);
                }
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        // ───────────────────────────── body ─────────────────────────────

        string BuildBody()
        {
            var sb = new StringBuilder();
            var pages = _file.Document.Pages;
            bool first = true;
            foreach (var page in pages)
            {
                if (!first) sb.Append(PageBreakPara());
                first = false;
                if (page.Kind == ReportPage.KindCover) sb.Append(CoverBody());
                else if (page.Kind == ReportPage.KindInfo) sb.Append(InfoBody());
                else sb.Append(ContentBody(page));
            }
            return sb.ToString();
        }

        string CoverBody()
        {
            var sb = new StringBuilder();
            byte[] logo = LoadLogo();
            if (logo != null)
                sb.Append(P(Drawing(AddDocMedia(logo, ".jpg"), 43.7, 33.6), jc: "center", before: 8, after: 5));
            sb.Append(P(R(_p.CoverLine1, 14), jc: "center"));
            sb.Append(P(R(_p.CoverLine2, 14), jc: "center"));
            if (_p.Shifr.Length > 0)
                sb.Append(P(R("ШИФР: " + _p.Shifr, 16), jc: "right", indRightMm: 21));
            sb.Append(P(R(_p.Title, 28), jc: "center", before: 118));
            sb.Append(P(R(_p.Name, 16), jc: "center", before: 2));
            sb.Append(Spacer(62));
            sb.Append(CoverSignTable());
            return sb.ToString();
        }

        string CoverSignTable()
        {
            double[] cols = { 57.1, 46.0, 33.5 };
            var sb = new StringBuilder();
            sb.Append("<w:tbl><w:tblPr>");
            sb.Append($"<w:tblW w:w=\"{Tw(cols.Sum())}\" w:type=\"dxa\"/>");
            sb.Append($"<w:tblInd w:w=\"{Tw(14)}\" w:type=\"dxa\"/>");
            sb.Append(Borders("w:tblBorders", 4, "top", "left", "bottom", "right", "insideH", "insideV"));
            sb.Append("<w:tblLayout w:type=\"fixed\"/>");
            sb.Append($"<w:tblCellMar><w:left w:w=\"{Tw(1.5)}\" w:type=\"dxa\"/><w:right w:w=\"{Tw(1.5)}\" w:type=\"dxa\"/></w:tblCellMar>");
            sb.Append("</w:tblPr><w:tblGrid>");
            foreach (var c in cols) sb.Append($"<w:gridCol w:w=\"{Tw(c)}\"/>");
            sb.Append("</w:tblGrid>");
            CoverRow(sb, cols, 17.4, "Зураг төслийн\nкомпанийн захирал", _p.Director);
            CoverRow(sb, cols, 15.8, "Гүйцэтгэсэн инженер", _p.Engineer);
            sb.Append("</w:tbl>");
            return sb.ToString();
        }

        static void CoverRow(StringBuilder sb, double[] cols, double hMm, string label, string name)
        {
            sb.Append($"<w:tr><w:trPr><w:trHeight w:val=\"{Tw(hMm)}\" w:hRule=\"atLeast\"/></w:trPr>");
            sb.Append(Cell(cols[0], P(R(label, 14)), vAlign: "center"));
            sb.Append(Cell(cols[1], P(""), vAlign: "center"));
            sb.Append(Cell(cols[2], P(R(name, 14), jc: "center"), vAlign: "center"));
            sb.Append("</w:tr>");
        }

        string InfoBody()
        {
            var sb = new StringBuilder();
            sb.Append(Spacer(22));
            void Item(string label, string value, double valueSize = 14)
            {
                sb.Append(P(R(label + ":", 14, bold: true) + R(" " + Up(value), valueSize)));
                sb.Append(P(R("", 14)));
            }
            Item("ТӨСЛИЙН БАЙРШИЛ", _p.Location);
            Item("ТӨСЛИЙН НЭР", _p.Name, 16);
            Item("ТӨСЛИЙН ШИФР", _p.Shifr);
            Item("ЗАХИАЛАГЧ", _p.Client, 16);
            Item("ЗАХИАЛАГЧИЙН ХАЯГ", _p.ClientAddress);
            Item("ЗУРАГ ТӨСЛИЙН КОМПАНИ", _p.Company);

            var authors = _p.Authors.Where(a => !string.IsNullOrWhiteSpace(a.Name)).ToList();
            for (int i = 0; i < authors.Count; i++)
            {
                string label = authors.Count > 1 ? "ЗОХИОГЧ ИНЖЕНЕР-" + (i + 1) : "ЗОХИОГЧ ИНЖЕНЕР";
                sb.Append(P(R(label + ":", 14, bold: true) + R(" " + Up(authors[i].Name), 14)));
                if (!string.IsNullOrWhiteSpace(authors[i].Qualification))
                    sb.Append(P(R("МЭРГЭШЛИЙН ЗЭРЭГ: " + Up(authors[i].Qualification), 14)));
                sb.Append(P(R("", 14)));
            }
            return sb.ToString();
        }

        string ContentBody(ReportPage page)
        {
            var sb = new StringBuilder();
            foreach (var b in page.Blocks)
            {
                switch (b.Kind)
                {
                    case ReportBlock.KindHeading:
                        double size = b.Level == 1 ? 16 : b.Level == 2 ? 14 : 12;
                        double before = b.Level == 1 ? 12 : 6;
                        sb.Append(P(R(b.Text, size, bold: true), jc: b.Centered ? "center" : null,
                            before: before, after: b.Level == 3 ? 3 : 6, keepNext: true));
                        break;
                    case ReportBlock.KindText:
                        foreach (var raw in SplitLines(b.Text))
                        {
                            string line = raw.TrimEnd();
                            if (b.Centered) { sb.Append(P(R(line.Trim(), 12), jc: "center", keepNext: true)); continue; }
                            bool bullet = line.StartsWith("- ") || line.StartsWith("• ") || line.StartsWith("o ");
                            sb.Append(P(R(line, 12), jc: "both",
                                firstLineMm: bullet || line.Length == 0 ? 0 : 10,
                                indLeftMm: bullet ? 5 : 0));
                        }
                        break;
                    case ReportBlock.KindImage:
                        sb.Append(ImageBlock(b));
                        break;
                }
            }
            if (page.Blocks.Count == 0) sb.Append(P(""));
            return sb.ToString();
        }

        string ImageBlock(ReportBlock b)
        {
            var refs = b.Images.Where(r => r.ImageId != null && _file.Images.ContainsKey(r.ImageId)).ToList();
            if (refs.Count == 0) return "";
            var sb = new StringBuilder();
            if (refs.Count == 1)
            {
                var r0 = refs[0];
                var (w, h) = Fit(r0.ImageId, ContentW * b.WidthPercent / 100.0, 200);
                bool hasTitle = r0.Title.Length > 0;
                if (hasTitle) sb.Append(P(R(r0.Title, 12), jc: "center", before: 4, keepNext: true));
                sb.Append(P(Drawing(AddDocMedia(_file.Images[r0.ImageId], Path.GetExtension(r0.ImageId)), w, h),
                    jc: "center", before: hasTitle ? 0 : 6, keepNext: r0.Caption.Length > 0 || r0.Note.Length > 0));
                // Жишээ тайлангийн 5.2: утга нь зургийн доор БАРУУН талд («min=220.41mm»).
                if (r0.Note.Length > 0) sb.Append(P(R(r0.Note, 12), jc: "right", keepNext: r0.Caption.Length > 0));
                if (r0.Caption.Length > 0) sb.Append(P(R(r0.Caption, 12), jc: "center", after: 6));
                return sb.ToString();
            }

            // 2 зураг зэрэгцээ — хүрээгүй хүснэгт
            double colW = ContentW / 2;
            sb.Append("<w:tbl><w:tblPr>");
            sb.Append($"<w:tblW w:w=\"{Tw(ContentW)}\" w:type=\"dxa\"/><w:jc w:val=\"center\"/>");
            sb.Append("<w:tblBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tblBorders>");
            sb.Append("<w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid>");
            sb.Append($"<w:gridCol w:w=\"{Tw(colW)}\"/><w:gridCol w:w=\"{Tw(colW)}\"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>");
            foreach (var r in refs.Take(2))
            {
                var (w, h) = Fit(r.ImageId, colW - 4, 120);
                string inner = (r.Title.Length > 0 ? P(R(r.Title, 12), jc: "center", before: 4) : "")
                             + P(Drawing(AddDocMedia(_file.Images[r.ImageId], Path.GetExtension(r.ImageId)), w, h), jc: "center", before: r.Title.Length > 0 ? 0 : 6)
                             + (r.Note.Length > 0 ? P(R(r.Note, 12), jc: "right") : "")
                             + P(R(r.Caption, 12), jc: "center", after: 6);
                sb.Append(Cell(colW, inner, vAlign: "bottom"));
            }
            sb.Append("</w:tr></w:tbl>");
            sb.Append(P(""));
            return sb.ToString();
        }

        // ───────────────────────────── header / footer ─────────────────────────────

        static string BuildFrameHeader() =>
            FrameRect(FrameL, FrameT, PageW - FrameL - FrameR, PageH - FrameT - FrameB, 2.25);

        // Нүүр хуудасны нимгэн хүрээ (жишээнээс: зүүн ≈10.9, дээд ≈8.5, баруун/доод ≈8.6 мм)
        static string BuildCoverHeader() => FrameRect(10.9, 8.5, PageW - 10.9 - 8.6, PageH - 8.5 - 8.6, 0.5);

        static string FrameRect(double xMm, double yMm, double wMm, double hMm, double strokePt)
        {
            string style = string.Format(CultureInfo.InvariantCulture,
                "position:absolute;margin-left:{0:0.##}pt;margin-top:{1:0.##}pt;width:{2:0.##}pt;height:{3:0.##}pt;" +
                "z-index:-251658240;mso-position-horizontal-relative:page;mso-position-vertical-relative:page",
                Pt(xMm), Pt(yMm), Pt(wMm), Pt(hMm));
            return "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/></w:rPr></w:pPr>" +
                   "<w:r><w:rPr><w:sz w:val=\"2\"/></w:rPr><w:pict>" +
                   $"<v:rect style=\"{style}\" filled=\"f\" stroked=\"t\" strokecolor=\"black\" strokeweight=\"{strokePt.ToString(CultureInfo.InvariantCulture)}pt\"/>" +
                   "</w:pict></w:r></w:p>";
        }

        string BuildStampFooter()
        {
            var c = StampCols;
            var sb = new StringBuilder();
            sb.Append("<w:tbl><w:tblPr>");
            sb.Append($"<w:tblW w:w=\"{Tw(c.Sum())}\" w:type=\"dxa\"/>");
            // Word хүснэгтийн зураасыг ирмэгийн баруун/доод талд зурдаг — 0.38 мм шилжүүлж хүрээний шугамын голд оруулна.
            sb.Append($"<w:tblInd w:w=\"{Tw(FrameL - MarginL - 0.38)}\" w:type=\"dxa\"/>");
            sb.Append(Borders("w:tblBorders", 18, "top", "left", "bottom", "right", "insideH", "insideV"));
            sb.Append("<w:tblLayout w:type=\"fixed\"/>");
            sb.Append($"<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"{Tw(0.6)}\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"{Tw(0.6)}\" w:type=\"dxa\"/></w:tblCellMar>");
            sb.Append("</w:tblPr><w:tblGrid>");
            foreach (var w in c) sb.Append($"<w:gridCol w:w=\"{Tw(w)}\"/>");
            sb.Append("</w:tblGrid>");

            string name = P(R(Up(_p.Name), 12), jc: "center");
            string shifr = P(R(_p.Shifr, 12), jc: "center");

            // 1-р мөр
            Row(sb, () =>
                Cell(c[0], P(R("Тооцоны программ", 10))) +
                Cell(c[1] + c[2], P(R(_p.Program, 10), jc: "center"), span: 2) +
                Cell(c[3] + c[4], shifr, span: 2, vMerge: "restart") +
                Cell(c[5], name, vMerge: "restart") +
                Cell(c[6], P(R("Хуудас", 10), jc: "center")));
            // 2-р мөр
            Row(sb, () =>
                Cell(c[0], P(R("Лицензийн дугаар", 10))) +
                Cell(c[1] + c[2], P(R(_p.License, 10), jc: "center"), span: 2) +
                Cell(c[3] + c[4], P(""), span: 2, vMerge: "continue") +
                Cell(c[5], P(""), vMerge: "continue") +
                Cell(c[6], P(PageField(10), jc: "center"), vMerge: "restart"));
            // 3-р мөр
            string sig = P("");
            string sigId = _p.EngineerSignatureImage;
            if (!string.IsNullOrEmpty(sigId) && _file.Images.TryGetValue(sigId, out var sigBytes))
            {
                var (w, h) = Fit(sigId, c[1] - 1.5, StampRowH - 0.3);
                sig = P(Drawing(AddFooterMedia(sigBytes, Path.GetExtension(sigId)), w, h), jc: "center");
            }
            Row(sb, () =>
                Cell(c[0], P(R("Гүйцэтгэсэн", 10))) +
                Cell(c[1], sig) +
                Cell(c[2], P(R(_p.Engineer, 10), jc: "center")) +
                Cell(c[3], P(R("Огноо", 10))) +
                Cell(c[4], P(R(_p.Date, 10), jc: "center")) +
                Cell(c[5], P(""), vMerge: "continue") +
                Cell(c[6], P(""), vMerge: "continue"));
            sb.Append("</w:tbl>");
            // Footer нь параграфаар төгсөх ёстой — хүснэгтийг өргөхгүйн тулд 1pt өндөртэй.
            sb.Append("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/></w:rPr></w:pPr></w:p>");
            return sb.ToString();
        }

        static void Row(StringBuilder sb, Func<string> cells)
        {
            sb.Append($"<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val=\"{Tw(StampRowH)}\" w:hRule=\"exact\"/></w:trPr>");
            sb.Append(cells());
            sb.Append("</w:tr>");
        }

        string BuildCoverFooter()
        {
            var sb = new StringBuilder();
            foreach (var line in SplitLines(_p.CompanyAddress).Where(l => l.Trim().Length > 0))
                sb.Append(P(R(line.Trim(), 12), jc: "center"));
            string year = _p.Year.Trim();
            if (year.Length > 0 && !year.EndsWith("он")) year += " он";
            // Хаягийг хүрээний доод талаас дээш өргөнө (жишээнд доод ирмэгээс ~32 мм).
            sb.Append(P(R(year, 12), jc: "center", after: 74));
            return sb.ToString();
        }

        // ───────────────────────────── OOXML туслахууд ─────────────────────────────

        static string P(string runs, string jc = null, double before = 0, double after = 0,
            double indLeftMm = 0, double indRightMm = 0, double firstLineMm = 0, bool keepNext = false)
        {
            var sb = new StringBuilder("<w:p><w:pPr>");
            if (keepNext) sb.Append("<w:keepNext/>");
            sb.Append($"<w:spacing w:before=\"{(int)Math.Round(before * 20)}\" w:after=\"{(int)Math.Round(after * 20)}\"/>");
            if (indLeftMm != 0 || indRightMm != 0 || firstLineMm != 0)
                sb.Append($"<w:ind w:left=\"{Tw(indLeftMm)}\" w:right=\"{Tw(indRightMm)}\" w:firstLine=\"{Tw(firstLineMm)}\"/>");
            if (jc != null) sb.Append($"<w:jc w:val=\"{jc}\"/>");
            sb.Append("</w:pPr>").Append(runs).Append("</w:p>");
            return sb.ToString();
        }

        static string Spacer(double heightPt) =>
            $"<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"{(int)Math.Round(heightPt * 20)}\" w:lineRule=\"exact\"/></w:pPr></w:p>";

        static string PageBreakPara() =>
            "<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/></w:rPr></w:pPr></w:p>";

        static string R(string text, double sizePt, bool bold = false)
        {
            string rPr = "<w:rPr>" + (bold ? "<w:b/><w:bCs/>" : "") +
                         $"<w:sz w:val=\"{(int)Math.Round(sizePt * 2)}\"/><w:szCs w:val=\"{(int)Math.Round(sizePt * 2)}\"/></w:rPr>";
            var sb = new StringBuilder();
            var lines = SplitLines(text ?? "");
            for (int i = 0; i < lines.Length; i++)
            {
                sb.Append("<w:r>").Append(rPr);
                if (i > 0) sb.Append("<w:br/>");
                sb.Append("<w:t xml:space=\"preserve\">").Append(Esc(lines[i])).Append("</w:t></w:r>");
            }
            return sb.ToString();
        }

        static string PageField(double sizePt)
        {
            string rPr = $"<w:rPr><w:sz w:val=\"{(int)(sizePt * 2)}\"/></w:rPr>";
            return $"<w:r>{rPr}<w:fldChar w:fldCharType=\"begin\"/></w:r>" +
                   $"<w:r>{rPr}<w:instrText xml:space=\"preserve\"> PAGE </w:instrText></w:r>" +
                   $"<w:r>{rPr}<w:fldChar w:fldCharType=\"separate\"/></w:r>" +
                   $"<w:r>{rPr}<w:t>2</w:t></w:r>" +
                   $"<w:r>{rPr}<w:fldChar w:fldCharType=\"end\"/></w:r>";
        }

        static string Cell(double wMm, string content, int span = 1, string vMerge = null, string vAlign = "center")
        {
            var sb = new StringBuilder("<w:tc><w:tcPr>");
            sb.Append($"<w:tcW w:w=\"{Tw(wMm)}\" w:type=\"dxa\"/>");
            if (span > 1) sb.Append($"<w:gridSpan w:val=\"{span}\"/>");
            if (vMerge == "restart") sb.Append("<w:vMerge w:val=\"restart\"/>");
            else if (vMerge == "continue") sb.Append("<w:vMerge/>");
            sb.Append($"<w:vAlign w:val=\"{vAlign}\"/>");
            sb.Append("</w:tcPr>").Append(content).Append("</w:tc>");
            return sb.ToString();
        }

        static string Borders(string tag, int sz, params string[] sides)
        {
            var sb = new StringBuilder("<" + tag + ">");
            foreach (var s in sides) sb.Append($"<w:{s} w:val=\"single\" w:sz=\"{sz}\" w:space=\"0\" w:color=\"000000\"/>");
            return sb.Append("</" + tag + ">").ToString();
        }

        string Drawing(string rid, double wMm, double hMm)
        {
            int id = _nextDocPr++;
            long cx = Emu(wMm), cy = Emu(hMm);
            return "<w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">" +
                   $"<wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:docPr id=\"{id}\" name=\"Зураг {id}\"/>" +
                   "<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>" +
                   "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">" +
                   $"<pic:pic><pic:nvPicPr><pic:cNvPr id=\"{id}\" name=\"image{id}\"/><pic:cNvPicPr/></pic:nvPicPr>" +
                   $"<pic:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>" +
                   $"<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr>" +
                   "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
        }

        string AddDocMedia(byte[] data, string ext) => AddMedia(_docMedia, data, ext);
        string AddFooterMedia(byte[] data, string ext) => AddMedia(_footerMedia, data, ext);

        string AddMedia(List<(string, string, byte[])> list, byte[] data, string ext)
        {
            ext = (ext ?? ".png").ToLowerInvariant();
            if (ext == ".jpeg") ext = ".jpg";
            string rid = "rId" + _nextRid++;
            list.Add((rid, "media/image" + _mediaSeq++ + ext, data));
            return rid;
        }

        /// <summary>Зургийн харьцааг хадгалж maxW × maxH (мм) дотор багтаана.</summary>
        (double w, double h) Fit(string imageId, double maxW, double maxH)
        {
            double ratio = 0.75;
            try
            {
                using (var ms = new MemoryStream(_file.Images[imageId]))
                using (var img = Image.FromStream(ms, false, false))
                    if (img.Width > 0) ratio = (double)img.Height / img.Width;
            }
            catch { }
            double w = maxW, h = maxW * ratio;
            if (h > maxH) { h = maxH; w = maxH / ratio; }
            return (w, h);
        }

        static byte[] LoadLogo()
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var s = asm.GetManifestResourceStream("MglLiraReport.Assets.mgl-logo.jpg"))
            {
                if (s == null) return null;
                using (var ms = new MemoryStream()) { s.CopyTo(ms); return ms.ToArray(); }
            }
        }

        string SectPr() =>
            "<w:sectPr>" +
            "<w:headerReference w:type=\"default\" r:id=\"rId3\"/><w:headerReference w:type=\"first\" r:id=\"rId4\"/>" +
            "<w:footerReference w:type=\"default\" r:id=\"rId5\"/><w:footerReference w:type=\"first\" r:id=\"rId6\"/>" +
            $"<w:pgSz w:w=\"{Tw(PageW)}\" w:h=\"{Tw(PageH)}\"/>" +
            $"<w:pgMar w:top=\"{Tw(MarginT)}\" w:right=\"{Tw(MarginR)}\" w:bottom=\"{Tw(MarginB)}\" w:left=\"{Tw(MarginL)}\" " +
            $"w:header=\"{Tw(HeaderDist)}\" w:footer=\"{Tw(FooterDist)}\" w:gutter=\"0\"/>" +
            "<w:titlePg/></w:sectPr>";

        const string Ns =
            " xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"" +
            " xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"" +
            " xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\"" +
            " xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"" +
            " xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"" +
            " xmlns:v=\"urn:schemas-microsoft-com:vml\"" +
            " xmlns:o=\"urn:schemas-microsoft-com:office:office\"" +
            " xmlns:w10=\"urn:schemas-microsoft-com:office:word\"";

        static string Wrap(string root, string inner) =>
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><" + root + Ns + ">" + inner + "</" + root + ">";

        string ContentTypes()
        {
            var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
            sb.Append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
            sb.Append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
            sb.Append("<Default Extension=\"png\" ContentType=\"image/png\"/>");
            sb.Append("<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>");
            const string wml = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
            sb.Append($"<Override PartName=\"/word/document.xml\" ContentType=\"{wml}document.main+xml\"/>");
            sb.Append($"<Override PartName=\"/word/styles.xml\" ContentType=\"{wml}styles+xml\"/>");
            sb.Append($"<Override PartName=\"/word/settings.xml\" ContentType=\"{wml}settings+xml\"/>");
            sb.Append($"<Override PartName=\"/word/header1.xml\" ContentType=\"{wml}header+xml\"/>");
            sb.Append($"<Override PartName=\"/word/header2.xml\" ContentType=\"{wml}header+xml\"/>");
            sb.Append($"<Override PartName=\"/word/footer1.xml\" ContentType=\"{wml}footer+xml\"/>");
            sb.Append($"<Override PartName=\"/word/footer2.xml\" ContentType=\"{wml}footer+xml\"/>");
            sb.Append("<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>");
            sb.Append("</Types>");
            return sb.ToString();
        }

        string DocumentRels()
        {
            const string t = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
            var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            sb.Append($"<Relationship Id=\"rId1\" Type=\"{t}styles\" Target=\"styles.xml\"/>");
            sb.Append($"<Relationship Id=\"rId2\" Type=\"{t}settings\" Target=\"settings.xml\"/>");
            sb.Append($"<Relationship Id=\"rId3\" Type=\"{t}header\" Target=\"header1.xml\"/>");
            sb.Append($"<Relationship Id=\"rId4\" Type=\"{t}header\" Target=\"header2.xml\"/>");
            sb.Append($"<Relationship Id=\"rId5\" Type=\"{t}footer\" Target=\"footer1.xml\"/>");
            sb.Append($"<Relationship Id=\"rId6\" Type=\"{t}footer\" Target=\"footer2.xml\"/>");
            foreach (var m in _docMedia) sb.Append($"<Relationship Id=\"{m.rid}\" Type=\"{t}image\" Target=\"{m.target}\"/>");
            sb.Append("</Relationships>");
            return sb.ToString();
        }

        static string MediaRels(List<(string rid, string target, byte[] data)> media)
        {
            var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            foreach (var m in media)
                sb.Append($"<Relationship Id=\"{m.rid}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"{m.target}\"/>");
            return sb.Append("</Relationships>").ToString();
        }

        static string Styles() =>
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
            "<w:docDefaults><w:rPrDefault><w:rPr>" +
            $"<w:rFonts w:ascii=\"{Font}\" w:hAnsi=\"{Font}\" w:eastAsia=\"{Font}\" w:cs=\"{Font}\"/>" +
            "<w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/><w:lang w:val=\"mn-MN\" w:eastAsia=\"mn-MN\" w:bidi=\"ar-SA\"/>" +
            "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
            "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>" +
            "<w:style w:type=\"character\" w:default=\"1\" w:styleId=\"DefaultParagraphFont\"><w:name w:val=\"Default Paragraph Font\"/><w:uiPriority w:val=\"1\"/><w:semiHidden/></w:style>" +
            "<w:style w:type=\"table\" w:default=\"1\" w:styleId=\"TableNormal\"><w:name w:val=\"Normal Table\"/><w:semiHidden/>" +
            "<w:tblPr><w:tblInd w:w=\"0\" w:type=\"dxa\"/><w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/>" +
            "<w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr></w:style>" +
            "</w:styles>";

        static string Settings() =>
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
            "<w:defaultTabStop w:val=\"708\"/><w:characterSpacingControl w:val=\"doNotCompress\"/>" +
            "<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/></w:compat>" +
            "</w:settings>";

        string CoreProps()
        {
            string now = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                   "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
                   "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
                   "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
                   $"<dc:title>{Esc(_p.Title.Replace('\n', ' '))} — {Esc(_p.Name)}</dc:title><dc:creator>MGL LIRA тайлан</dc:creator>" +
                   $"<dcterms:created xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:created>" +
                   $"<dcterms:modified xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:modified></cp:coreProperties>";
        }

        static void Put(ZipArchive zip, string name, string xml)
        {
            var e = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (var s = e.Open())
            {
                var bytes = new UTF8Encoding(false).GetBytes(xml);
                s.Write(bytes, 0, bytes.Length);
            }
        }

        static string[] SplitLines(string s) => (s ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

        static string Up(string s) => (s ?? "").ToUpperInvariant();

        static int Tw(double mm) => (int)Math.Round(mm * 1440 / 25.4);
        static long Emu(double mm) => (long)Math.Round(mm * 36000);
        static double Pt(double mm) => mm * 72 / 25.4;

        static string Esc(string s)
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
                        if (ch == '\t' || ch >= 0x20) sb.Append(ch); // XML 1.0-д хүчингүй хяналтын тэмдэгт хаягдана
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
