using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using MglLiraReport.Docx;
using MglLiraReport.Model;
using MglLiraReport.Results;

namespace MglLiraReport.UI
{
    /// <summary>
    /// Тооцооны тайлангийн засварлагч.  1-р (нүүр) ба 2-р (төслийн мэдээлэл) хуудас тогтмол —
    /// тэдгээрийн агуулга «Төслийн мэдээлэл»-ээс бөглөгдөнө.  3-аас хойш хэрэглэгч хуудас үүсгэж,
    /// хуудас бүрт гарчиг / текст / зураг (+ тайлбар) блок нэмнэ.  Word-д хуудас бүр шинэ хуудаснаас эхэлнэ.
    /// </summary>
    public class ReportEditorForm : Form
    {
        readonly ILiraSource _lira;
        ReportFile _file;
        bool _dirty;
        bool _loading;

        ComboBox _kind;
        Label _pathLabel;
        ListBox _pages;
        Panel _right;
        TextBox _pageTitle;
        FlowLayoutPanel _blocks;
        ToolStripStatusLabel _status;

        static readonly Color Navy = Color.FromArgb(41, 60, 87);

        public ReportEditorForm(ILiraSource lira)
        {
            _lira = lira;
            Text = "MGL тооцооны тайлан";
            Font = new Font("Segoe UI", 9.5f);
            Size = new Size(1180, 820);
            MinimumSize = new Size(900, 560);
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;

            BuildUi();
            NewReport(ReportDocument.KindConcrete, ask: false);
        }

        // ───────────────────────────── UI ─────────────────────────────

        void BuildUi()
        {
            var tools = new ToolStrip { GripStyle = ToolStripGripStyle.Hidden, Padding = new Padding(6, 2, 6, 2), ImageScalingSize = new Size(16, 16) };
            var newMenu = new ToolStripDropDownButton("Шинэ тайлан");
            newMenu.DropDownItems.Add("Төмөр бетон бүтээцийн тайлан", null, (s, e) => NewReport(ReportDocument.KindConcrete, ask: true));
            newMenu.DropDownItems.Add("Металл бүтээцийн тайлан", null, (s, e) => NewReport(ReportDocument.KindSteel, ask: true));
            tools.Items.Add(newMenu);
            tools.Items.Add(new ToolStripButton("Нээх…", null, (s, e) => OpenReport()));
            tools.Items.Add(new ToolStripButton("Хадгалах", null, (s, e) => Save(false)));
            tools.Items.Add(new ToolStripButton("Өөр нэрээр хадгалах…", null, (s, e) => Save(true)));
            tools.Items.Add(new ToolStripSeparator());
            tools.Items.Add(new ToolStripButton("Төслийн мэдээлэл…", null, (s, e) => EditProjectInfo()) { Font = new Font(Font, FontStyle.Bold) });
            tools.Items.Add(new ToolStripSeparator());
            tools.Items.Add(new ToolStripButton("Word гаргах…", null, (s, e) => ExportWord()) { Font = new Font(Font, FontStyle.Bold), ForeColor = Navy });
            if (_lira != null)
            {
                tools.Items.Add(new ToolStripSeparator());
                var lira = new ToolStripDropDownButton("LIRA") { Font = new Font(Font, FontStyle.Bold), ForeColor = Navy };
                lira.DropDownItems.Add("Шилжилтийн хуудас үүсгэх (зураг + min/max)…", null, (s, e) => CreateDisplacementPage());
                lira.DropDownItems.Add(new ToolStripSeparator());
                lira.DropDownItems.Add("Оношилгоо ажиллуулах (хүснэгтүүдийг шалгах)", null, (s, e) => RunDiagnostics());
                tools.Items.Add(lira);
            }

            var top = new Panel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(10, 8, 10, 4) };
            var kindLabel = new Label { Text = "Тайлангийн төрөл:", AutoSize = true, Location = new Point(10, 12) };
            _kind = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230, Location = new Point(130, 8) };
            _kind.Items.AddRange(new object[] { "Төмөр бетон бүтээц", "Металл бүтээц" });
            _kind.SelectedIndexChanged += (s, e) =>
            {
                if (_loading) return;
                _file.Document.Kind = _kind.SelectedIndex == 1 ? ReportDocument.KindSteel : ReportDocument.KindConcrete;
                MarkDirty();
            };
            _pathLabel = new Label { AutoSize = true, Location = new Point(380, 12), ForeColor = Color.DimGray };
            top.Controls.AddRange(new Control[] { kindLabel, _kind, _pathLabel });

            var split = new SplitContainer { Dock = DockStyle.Fill, FixedPanel = FixedPanel.Panel1, SplitterWidth = 6 };
            split.Panel1MinSize = 200;

            // Зүүн: хуудасны жагсаалт
            var left = split.Panel1;
            left.Padding = new Padding(8, 4, 4, 8);
            var pagesLabel = new Label { Text = "Хуудаснууд", Dock = DockStyle.Top, Height = 24, Font = new Font(Font, FontStyle.Bold), ForeColor = Navy };
            _pages = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false, Font = new Font("Segoe UI", 10f), ItemHeight = 24, DrawMode = DrawMode.OwnerDrawFixed };
            _pages.DrawItem += DrawPageItem;
            _pages.SelectedIndexChanged += (s, e) => ShowPage();
            var pageButtons = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 70, ColumnCount = 3, RowCount = 2 };
            for (int i = 0; i < 3; i++) pageButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3f));
            pageButtons.RowStyles.Add(new RowStyle(SizeType.Percent, 50f));
            pageButtons.RowStyles.Add(new RowStyle(SizeType.Percent, 50f));
            pageButtons.Controls.Add(Btn("+ Хуудас", (s, e) => AddPage()), 0, 0);
            pageButtons.SetColumnSpan(pageButtons.GetControlFromPosition(0, 0), 2);
            pageButtons.Controls.Add(Btn("Устгах", (s, e) => DeletePage()), 2, 0);
            pageButtons.Controls.Add(Btn("▲ Дээш", (s, e) => MovePage(-1)), 0, 1);
            pageButtons.Controls.Add(Btn("▼ Доош", (s, e) => MovePage(1)), 1, 1);
            pageButtons.Controls.Add(Btn("Хуулах", (s, e) => DuplicatePage()), 2, 1);
            left.Controls.Add(_pages);
            left.Controls.Add(pageButtons);
            left.Controls.Add(pagesLabel);

            // Баруун: сонгосон хуудас
            _right = new Panel { Dock = DockStyle.Fill, Padding = new Padding(4, 4, 8, 8) };
            split.Panel2.Controls.Add(_right);

            var status = new StatusStrip();
            _status = new ToolStripStatusLabel { Spring = true, TextAlign = ContentAlignment.MiddleLeft };
            status.Items.Add(_status);
            if (_lira != null) status.Items.Add(new ToolStripStatusLabel(_lira.Describe()));

            Controls.Add(split);
            Controls.Add(top);
            Controls.Add(tools);
            Controls.Add(status);
            Shown += (s, e) => split.SplitterDistance = 250;
        }

        static Button Btn(string text, EventHandler click)
        {
            var b = new Button { Text = text, Dock = DockStyle.Fill, Margin = new Padding(2) };
            b.Click += click;
            return b;
        }

        void DrawPageItem(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0 || _file == null) return;
            e.DrawBackground();
            var page = _file.Document.Pages[e.Index];
            string label = (e.Index + 1) + ".  " + PageLabel(page);
            var color = (e.State & DrawItemState.Selected) != 0 ? SystemColors.HighlightText : page.IsFixed ? Navy : SystemColors.ControlText;
            using (var f = page.IsFixed ? new Font(e.Font, FontStyle.Bold) : new Font(e.Font, FontStyle.Regular))
                TextRenderer.DrawText(e.Graphics, label, f, new Rectangle(e.Bounds.X + 4, e.Bounds.Y, e.Bounds.Width - 4, e.Bounds.Height),
                    color, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            e.DrawFocusRectangle();
        }

        static string PageLabel(ReportPage p)
        {
            if (p.Kind == ReportPage.KindCover) return "Нүүр хуудас";
            if (p.Kind == ReportPage.KindInfo) return "Төслийн мэдээлэл";
            if (p.Title.Length > 0) return p.Title;
            var h = p.Blocks.FirstOrDefault(b => b.Kind == ReportBlock.KindHeading && b.Text.Trim().Length > 0);
            return h != null ? h.Text.Trim() : "(нэргүй хуудас)";
        }

        // ───────────────────────────── хуудас ─────────────────────────────

        void LoadFile(ReportFile file)
        {
            _loading = true;
            _file = file;
            _kind.SelectedIndex = file.Document.Kind == ReportDocument.KindSteel ? 1 : 0;
            RefreshPages(file.Document.Pages.Count > 2 ? 2 : 0);
            _dirty = false;
            _loading = false;
            UpdateTitle();
        }

        void RefreshPages(int select)
        {
            _pages.BeginUpdate();
            _pages.Items.Clear();
            foreach (var p in _file.Document.Pages) _pages.Items.Add(p);
            _pages.EndUpdate();
            if (_pages.Items.Count > 0) _pages.SelectedIndex = Math.Max(0, Math.Min(select, _pages.Items.Count - 1));
        }

        ReportPage CurrentPage => _pages.SelectedIndex >= 0 ? _file.Document.Pages[_pages.SelectedIndex] : null;

        void AddPage()
        {
            var page = new ReportPage { Kind = ReportPage.KindContent };
            page.Blocks.Add(new ReportBlock { Kind = ReportBlock.KindHeading, Level = 1, Text = "" });
            int at = Math.Max(_pages.SelectedIndex + 1, 2);
            _file.Document.Pages.Insert(at, page);
            MarkDirty();
            RefreshPages(at);
            _pageTitle?.Focus();
        }

        void DuplicatePage()
        {
            var src = CurrentPage;
            if (src == null || src.IsFixed) return;
            var copy = new ReportPage
            {
                Kind = ReportPage.KindContent,
                Title = src.Title.Length > 0 ? src.Title + " (хуулбар)" : "",
                Blocks = src.Blocks.Select(b => new ReportBlock
                {
                    Kind = b.Kind, Level = b.Level, Text = b.Text, WidthPercent = b.WidthPercent,
                    Images = b.Images.Select(r => new ImageRef { ImageId = r.ImageId, Caption = r.Caption }).ToList(),
                }).ToList(),
            };
            int at = _pages.SelectedIndex + 1;
            _file.Document.Pages.Insert(at, copy);
            MarkDirty();
            RefreshPages(at);
        }

        void DeletePage()
        {
            var page = CurrentPage;
            if (page == null) return;
            if (page.IsFixed) { Info("Нүүр хуудас ба төслийн мэдээллийн хуудсыг устгах боломжгүй."); return; }
            if (MessageBox.Show(this, "«" + PageLabel(page) + "» хуудсыг устгах уу?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            int idx = _pages.SelectedIndex;
            _file.Document.Pages.RemoveAt(idx);
            MarkDirty();
            RefreshPages(idx - 1);
        }

        void MovePage(int delta)
        {
            int i = _pages.SelectedIndex;
            var pages = _file.Document.Pages;
            if (i < 0 || pages[i].IsFixed) return;
            int j = i + delta;
            if (j < 2 || j >= pages.Count) return; // 1, 2-р хуудас тогтмол
            var p = pages[i]; pages.RemoveAt(i); pages.Insert(j, p);
            MarkDirty();
            RefreshPages(j);
        }

        void ShowPage()
        {
            _right.SuspendLayout();
            foreach (Control c in _right.Controls.Cast<Control>().ToList()) c.Dispose();
            _right.Controls.Clear();
            _pageTitle = null;
            _blocks = null;
            var page = CurrentPage;
            if (page != null)
            {
                if (page.IsFixed) ShowFixedPage(page);
                else ShowContentPage(page);
            }
            _right.ResumeLayout();
        }

        void ShowFixedPage(ReportPage page)
        {
            var p = _file.Document.Project;
            bool cover = page.Kind == ReportPage.KindCover;
            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12) };
            var title = new Label { Text = cover ? "Нүүр хуудас" : "Төслийн мэдээлэл", Dock = DockStyle.Top, Height = 34, Font = new Font("Segoe UI", 14f, FontStyle.Bold), ForeColor = Navy };
            var hint = new Label
            {
                Dock = DockStyle.Top, Height = 48, ForeColor = Color.DimGray,
                Text = "Энэ хуудас загвараараа автоматаар гарна. Агуулгыг нь «Төслийн мэдээлэл» цонхонд бөглөнө — " +
                       "шифр, төслийн нэр, инженер зэрэг нь нүүр хуудас, 2-р хуудас, булангийн хүснэгт бүгдэд ижил гарна.",
            };
            var edit = new Button { Text = "Төслийн мэдээлэл засах…", Dock = DockStyle.Top, Height = 36, Font = new Font(Font, FontStyle.Bold) };
            edit.Click += (s, e) => EditProjectInfo();
            var preview = new TextBox
            {
                Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                Font = new Font("Consolas", 10f), BackColor = Color.White,
                Text = cover ? CoverPreview(p) : InfoPreview(p),
            };
            var gap = new Panel { Dock = DockStyle.Top, Height = 10 };
            panel.Controls.Add(preview);
            panel.Controls.Add(gap);
            panel.Controls.Add(edit);
            panel.Controls.Add(hint);
            panel.Controls.Add(title);
            _right.Controls.Add(panel);
        }

        static string CoverPreview(ProjectInfo p) => string.Join(Environment.NewLine, new[]
        {
            "[MGL E&C лого]", p.CoverLine1, p.CoverLine2, "ШИФР: " + Show(p.Shifr), "",
            p.Title.Replace("\n", Environment.NewLine), Show(p.Name), "",
            "Зураг төслийн компанийн захирал ..... " + Show(p.Director),
            "Гүйцэтгэсэн инженер ................. " + Show(p.Engineer), "",
            p.CompanyAddress.Replace("\n", Environment.NewLine), Show(p.Year) + " он",
        });

        static string InfoPreview(ProjectInfo p)
        {
            var lines = new System.Collections.Generic.List<string>
            {
                "ТӨСЛИЙН БАЙРШИЛ: " + Show(p.Location), "ТӨСЛИЙН НЭР: " + Show(p.Name), "ТӨСЛИЙН ШИФР: " + Show(p.Shifr),
                "ЗАХИАЛАГЧ: " + Show(p.Client), "ЗАХИАЛАГЧИЙН ХАЯГ: " + Show(p.ClientAddress),
                "ЗУРАГ ТӨСЛИЙН КОМПАНИ: " + Show(p.Company),
            };
            for (int i = 0; i < p.Authors.Count; i++)
                lines.Add("ЗОХИОГЧ ИНЖЕНЕР-" + (i + 1) + ": " + p.Authors[i].Name + "  /  " + p.Authors[i].Qualification);
            lines.Add("");
            lines.Add("Булангийн хүснэгт (хуудас бүрт):");
            lines.Add("  Тооцоны программ: " + Show(p.Program) + "   Лицензийн дугаар: " + Show(p.License));
            lines.Add("  Гүйцэтгэсэн: " + Show(p.Engineer) + "   Огноо: " + Show(p.Date) + "   Шифр: " + Show(p.Shifr));
            return string.Join(Environment.NewLine, lines);
        }

        static string Show(string s) => string.IsNullOrWhiteSpace(s) ? "(бөглөөгүй)" : s;

        void ShowContentPage(ReportPage page)
        {
            var head = new Panel { Dock = DockStyle.Top, Height = 84, Padding = new Padding(4) };
            var titleLabel = new Label { Text = "Хуудасны нэр (зөвхөн жагсаалтад):", AutoSize = true, Location = new Point(4, 8) };
            _pageTitle = new TextBox { Location = new Point(230, 4), Width = 380, Text = page.Title };
            _pageTitle.TextChanged += (s, e) => { page.Title = _pageTitle.Text; MarkDirty(); _pages.Invalidate(); };
            var add = new FlowLayoutPanel { Location = new Point(0, 40), AutoSize = true, WrapContents = false };
            add.Controls.Add(new Label { Text = "Нэмэх:", AutoSize = true, Margin = new Padding(4, 9, 6, 0) });
            add.Controls.Add(AddBtn("+ Гарчиг", () => AddBlock(page, new ReportBlock { Kind = ReportBlock.KindHeading, Level = 2 })));
            add.Controls.Add(AddBtn("+ Текст", () => AddBlock(page, new ReportBlock { Kind = ReportBlock.KindText })));
            add.Controls.Add(AddBtn("+ Зураг", () => AddBlock(page, new ReportBlock { Kind = ReportBlock.KindImage, Images = { new ImageRef() } })));
            add.Controls.Add(AddBtn("+ 2 зураг зэрэгцээ", () => AddBlock(page, new ReportBlock { Kind = ReportBlock.KindImage, Images = { new ImageRef(), new ImageRef() } })));
            head.Controls.Add(titleLabel);
            head.Controls.Add(_pageTitle);
            head.Controls.Add(add);

            _blocks = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false,
                BackColor = Color.FromArgb(236, 239, 243), Padding = new Padding(8),
            };
            _blocks.Resize += (s, e) => FitCards();
            _right.Controls.Add(_blocks);
            _right.Controls.Add(head);
            RenderBlocks(page);
        }

        static Button AddBtn(string text, Action click)
        {
            var b = new Button { Text = text, AutoSize = true, Height = 32, Padding = new Padding(6, 0, 6, 0) };
            b.Click += (s, e) => click();
            return b;
        }

        void AddBlock(ReportPage page, ReportBlock block)
        {
            page.Blocks.Add(block);
            MarkDirty();
            RenderBlocks(page);
            _blocks.ScrollControlIntoView(_blocks.Controls[_blocks.Controls.Count - 1]);
            _pages.Invalidate();
        }

        void RenderBlocks(ReportPage page)
        {
            _blocks.SuspendLayout();
            foreach (Control c in _blocks.Controls.Cast<Control>().ToList()) c.Dispose();
            _blocks.Controls.Clear();
            for (int i = 0; i < page.Blocks.Count; i++)
                _blocks.Controls.Add(BuildCard(page, i));
            if (page.Blocks.Count == 0)
                _blocks.Controls.Add(new Label { Text = "Хуудас хоосон байна. Дээрх «Нэмэх» товчоор гарчиг, текст, зураг нэмнэ.", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(8) });
            FitCards();
            _blocks.ResumeLayout();
        }

        void FitCards()
        {
            if (_blocks == null) return;
            int w = Math.Max(400, _blocks.ClientSize.Width - _blocks.Padding.Horizontal - SystemInformation.VerticalScrollBarWidth - 4);
            foreach (Control c in _blocks.Controls)
                if (c is Panel) c.Width = w;
        }

        // ───────────────────────────── блок карт ─────────────────────────────

        Panel BuildCard(ReportPage page, int index)
        {
            var block = page.Blocks[index];
            var card = new Panel { BackColor = Color.White, Padding = new Padding(10, 6, 10, 10), Margin = new Padding(0, 0, 0, 8), BorderStyle = BorderStyle.FixedSingle };

            var bar = new Panel { Dock = DockStyle.Top, Height = 28 };
            string kindText = block.Kind == ReportBlock.KindHeading ? "Гарчиг" : block.Kind == ReportBlock.KindText ? "Текст" : "Зураг";
            bar.Controls.Add(new Label { Text = kindText, AutoSize = true, Location = new Point(0, 5), Font = new Font(Font, FontStyle.Bold), ForeColor = Navy });
            var actions = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, WrapContents = false, FlowDirection = FlowDirection.LeftToRight };
            actions.Controls.Add(SmallBtn("▲", "Дээш", () => MoveBlock(page, index, -1)));
            actions.Controls.Add(SmallBtn("▼", "Доош", () => MoveBlock(page, index, 1)));
            actions.Controls.Add(SmallBtn("✕", "Устгах", () => RemoveBlock(page, index)));
            bar.Controls.Add(actions);

            Control body;
            if (block.Kind == ReportBlock.KindHeading) body = HeadingEditor(block);
            else if (block.Kind == ReportBlock.KindText) body = TextEditor(block);
            else body = ImageEditor(page, block);
            body.Dock = DockStyle.Top;

            card.Controls.Add(body);
            card.Controls.Add(bar);
            card.Height = bar.Height + body.Height + card.Padding.Vertical + 4;
            return card;
        }

        Button SmallBtn(string text, string tip, Action click)
        {
            var b = new Button { Text = text, Width = 30, Height = 24, Margin = new Padding(2, 0, 0, 0), FlatStyle = FlatStyle.System };
            new ToolTip().SetToolTip(b, tip);
            b.Click += (s, e) => click();
            return b;
        }

        Control HeadingEditor(ReportBlock block)
        {
            var p = new Panel { Height = 34 };
            var level = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 150, Location = new Point(0, 3) };
            level.Items.AddRange(new object[] { "1-р түвшин (бүлэг)", "2-р түвшин", "3-р түвшин" });
            level.SelectedIndex = block.Level - 1;
            level.SelectedIndexChanged += (s, e) => { block.Level = level.SelectedIndex + 1; MarkDirty(); };
            var center = CenterBox(block, new Point(158, 6));
            var tb = new TextBox { Location = new Point(222, 3), Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top, Text = block.Text, Font = new Font("Segoe UI", 11f, FontStyle.Bold) };
            tb.Width = 600;
            tb.TextChanged += (s, e) => { block.Text = tb.Text; MarkDirty(); _pages.Invalidate(); };
            p.Controls.Add(level);
            p.Controls.Add(center);
            p.Controls.Add(tb);
            p.Resize += (s, e) => tb.Width = Math.Max(200, p.Width - 227);
            return p;
        }

        CheckBox CenterBox(ReportBlock block, Point at)
        {
            var c = new CheckBox { Text = "Төвд", AutoSize = true, Location = at, Checked = block.Centered };
            c.CheckedChanged += (s, e) => { block.Align = c.Checked ? "center" : ""; MarkDirty(); };
            return c;
        }

        Control TextEditor(ReportBlock block)
        {
            var p = new Panel { Height = 178 };
            var center = CenterBox(block, new Point(0, 2));
            var tb = new TextBox
            {
                Multiline = true, AcceptsReturn = true, ScrollBars = ScrollBars.Vertical, WordWrap = true,
                Location = new Point(0, 26), Height = 150, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top,
                Text = block.Text.Replace("\n", Environment.NewLine), Font = new Font("Segoe UI", 10.5f),
            };
            tb.TextChanged += (s, e) => { block.Text = tb.Text.Replace("\r\n", "\n"); MarkDirty(); };
            p.Controls.Add(center);
            p.Controls.Add(tb);
            p.Resize += (s, e) => tb.Width = p.Width;
            return p;
        }

        Control ImageEditor(ReportPage page, ReportBlock block)
        {
            var root = new Panel { Height = 322 };
            var slots = new TableLayoutPanel { Dock = DockStyle.Top, Height = 286, ColumnCount = block.Images.Count };
            for (int i = 0; i < block.Images.Count; i++)
                slots.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / block.Images.Count));
            for (int i = 0; i < block.Images.Count; i++)
                slots.Controls.Add(ImageSlot(block.Images[i]), i, 0);

            var opts = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 32, WrapContents = false };
            var two = new CheckBox { Text = "Хоёр зураг зэрэгцүүлэх", AutoSize = true, Checked = block.Images.Count > 1, Margin = new Padding(0, 6, 16, 0) };
            two.CheckedChanged += (s, e) =>
            {
                if (two.Checked && block.Images.Count < 2) block.Images.Add(new ImageRef());
                else if (!two.Checked && block.Images.Count > 1) block.Images.RemoveRange(1, block.Images.Count - 1);
                MarkDirty();
                BeginInvoke((Action)(() => RenderBlocks(page)));
            };
            opts.Controls.Add(two);
            if (block.Images.Count == 1)
            {
                opts.Controls.Add(new Label { Text = "Өргөн (%):", AutoSize = true, Margin = new Padding(0, 7, 4, 0) });
                var width = new NumericUpDown { Minimum = 20, Maximum = 100, Increment = 5, Value = block.WidthPercent, Width = 64 };
                width.ValueChanged += (s, e) => { block.WidthPercent = (int)width.Value; MarkDirty(); };
                opts.Controls.Add(width);
            }
            root.Controls.Add(slots);
            root.Controls.Add(opts);
            return root;
        }

        Control ImageSlot(ImageRef r)
        {
            var p = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 8, 0) };
            var box = new PictureBox
            {
                Dock = DockStyle.Top, Height = 150, SizeMode = PictureBoxSizeMode.Zoom, BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(248, 249, 251), AllowDrop = true, Cursor = Cursors.Hand,
            };
            var empty = new Label
            {
                Text = "Зураг сонгоогүй\n(дарж сонгох, эсвэл файлаа энд чирж оруулах)", Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.Gray, BackColor = Color.Transparent,
            };
            box.Controls.Add(empty);
            void Refresh()
            {
                box.Image?.Dispose();
                box.Image = r.ImageId != null && _file.Images.TryGetValue(r.ImageId, out var bytes) ? ImageUtil.FromBytes(bytes) : null;
                empty.Visible = box.Image == null;
            }
            void SetBytes(byte[] bytes)
            {
                try { r.ImageId = _file.AddImage(bytes); MarkDirty(); Refresh(); }
                catch (Exception ex) { Info("Зургийг уншиж чадсангүй: " + ex.Message); }
            }
            void Pick()
            {
                using (var dlg = new OpenFileDialog { Filter = ProjectInfoForm.ImageFilter, Title = "Зураг сонгох" })
                    if (dlg.ShowDialog(this) == DialogResult.OK) SetBytes(File.ReadAllBytes(dlg.FileName));
            }
            box.Click += (s, e) => Pick();
            empty.Click += (s, e) => Pick();
            box.DragEnter += (s, e) => e.Effect = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
            box.DragDrop += (s, e) =>
            {
                var files = e.Data.GetData(DataFormats.FileDrop) as string[];
                if (files != null && files.Length > 0) SetBytes(File.ReadAllBytes(files[0]));
            };

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 32, WrapContents = false, Padding = new Padding(0, 3, 0, 0) };
            var pick = new Button { Text = "Файлаас…", AutoSize = true };
            pick.Click += (s, e) => Pick();
            var paste = new Button { Text = "Буулгах (clipboard)", AutoSize = true };
            paste.Click += (s, e) =>
            {
                if (Clipboard.ContainsImage())
                {
                    using (var img = Clipboard.GetImage())
                    {
                        r.ImageId = _file.AddImage(img);
                        MarkDirty();
                        Refresh();
                    }
                }
                else if (Clipboard.ContainsFileDropList() && Clipboard.GetFileDropList().Count > 0)
                    SetBytes(File.ReadAllBytes(Clipboard.GetFileDropList()[0]));
                else Info("Clipboard-д зураг алга. LIRA-аас зургаа хуулж (Copy / PrintScreen) аваад дахин дарна уу.");
            };
            var clear = new Button { Text = "Хасах", AutoSize = true };
            clear.Click += (s, e) => { r.ImageId = null; MarkDirty(); Refresh(); };
            buttons.Controls.AddRange(new Control[] { pick, paste, clear });

            Panel TextRow(string label, string value, Action<string> set)
            {
                var row = new Panel { Dock = DockStyle.Top, Height = 30 };
                var l = new Label { Text = label, AutoSize = true, Location = new Point(0, 7) };
                var tb = new TextBox { Location = new Point(96, 3), Text = value, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top };
                tb.TextChanged += (s, e) => { set(tb.Text); MarkDirty(); };
                row.Controls.Add(l);
                row.Controls.Add(tb);
                row.Resize += (s, e) => tb.Width = Math.Max(80, row.Width - 98);
                return row;
            }
            // Dock=Top-ыг урвуу дарааллаар нэмнэ: Дээд гарчиг → Тайлбар → Утга (баруун).
            p.Controls.Add(TextRow("Утга (баруун):", r.Note, v => r.Note = v));
            p.Controls.Add(TextRow("Тайлбар (доор):", r.Caption, v => r.Caption = v));
            p.Controls.Add(TextRow("Гарчиг (дээр):", r.Title, v => r.Title = v));
            p.Controls.Add(buttons);
            p.Controls.Add(box);
            Refresh();
            return p;
        }

        void MoveBlock(ReportPage page, int index, int delta)
        {
            int j = index + delta;
            if (j < 0 || j >= page.Blocks.Count) return;
            var b = page.Blocks[index]; page.Blocks.RemoveAt(index); page.Blocks.Insert(j, b);
            MarkDirty();
            RenderBlocks(page);
            _pages.Invalidate();
        }

        void RemoveBlock(ReportPage page, int index)
        {
            var b = page.Blocks[index];
            bool hasContent = b.Text.Trim().Length > 0 || b.Images.Any(r => r.ImageId != null);
            if (hasContent && MessageBox.Show(this, "Энэ блокийг устгах уу?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            page.Blocks.RemoveAt(index);
            MarkDirty();
            RenderBlocks(page);
            _pages.Invalidate();
        }

        // ───────────────────────────── файл ─────────────────────────────

        void NewReport(string kind, bool ask)
        {
            if (ask && !ConfirmDiscard()) return;
            var doc = ReportDocument.CreateNew(kind);
            UserDefaults.Apply(doc.Project);
            LoadFile(new ReportFile(doc));
            SetStatus(kind == ReportDocument.KindSteel ? "Металл бүтээцийн шинэ тайлан." : "Төмөр бетон бүтээцийн шинэ тайлан.");
        }

        void OpenReport()
        {
            if (!ConfirmDiscard()) return;
            using (var dlg = new OpenFileDialog { Filter = FileFilter, InitialDirectory = ReportsDir() })
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                OpenPath(dlg.FileName);
            }
        }

        public void OpenPath(string path)
        {
            try
            {
                LoadFile(ReportFile.Load(path));
                SetStatus("Нээлээ: " + path);
            }
            catch (Exception ex) { Error("Файлыг нээж чадсангүй:\n" + ex.Message); }
        }

        bool Save(bool saveAs)
        {
            string path = _file.Path;
            if (saveAs || string.IsNullOrEmpty(path))
            {
                using (var dlg = new SaveFileDialog { Filter = FileFilter, InitialDirectory = ReportsDir(), FileName = SuggestName() + ReportFile.Extension })
                {
                    if (dlg.ShowDialog(this) != DialogResult.OK) return false;
                    path = dlg.FileName;
                }
            }
            try
            {
                _file.Save(path);
                _dirty = false;
                UpdateTitle();
                SetStatus("Хадгаллаа: " + path);
                return true;
            }
            catch (Exception ex) { Error("Хадгалж чадсангүй:\n" + ex.Message); return false; }
        }

        void ExportWord()
        {
            var p = _file.Document.Project;
            if (p.Name.Length == 0 || p.Shifr.Length == 0)
            {
                if (MessageBox.Show(this, "Төслийн нэр эсвэл шифр бөглөөгүй байна. Тэгсээр Word гаргах уу?", Text,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
            }
            string dir = string.IsNullOrEmpty(_file.Path) ? ReportsDir() : Path.GetDirectoryName(_file.Path);
            using (var dlg = new SaveFileDialog { Filter = "Word баримт (*.docx)|*.docx", InitialDirectory = dir, FileName = SuggestName() + ".docx" })
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    Cursor = Cursors.WaitCursor;
                    new DocxBuilder(_file).Save(dlg.FileName);
                    Cursor = Cursors.Default;
                    SetStatus("Word гаргалаа: " + dlg.FileName);
                    if (MessageBox.Show(this, "Word баримт бэлэн боллоо:\n" + dlg.FileName + "\n\nНээх үү?", Text,
                            MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        Process.Start(dlg.FileName);
                }
                catch (IOException ex) { Cursor = Cursors.Default; Error("Файлд бичиж чадсангүй (Word дээр нээлттэй байж магадгүй):\n" + ex.Message); }
                catch (Exception ex) { Cursor = Cursors.Default; Error("Word гаргахад алдаа гарлаа:\n" + ex); }
            }
        }

        void EditProjectInfo()
        {
            using (var f = new ProjectInfoForm(_file))
            {
                if (f.ShowDialog(this) != DialogResult.OK) return;
            }
            MarkDirty();
            _pages.Invalidate();
            if (CurrentPage != null && CurrentPage.IsFixed) ShowPage();
        }

        void CreateDisplacementPage()
        {
            DisplacementPageBuilder.Spec spec;
            using (var f = new DisplacementPageForm(_lira))
            {
                if (f.ShowDialog(this) != DialogResult.OK) return;
                spec = f.Spec;
            }
            try
            {
                Cursor = Cursors.WaitCursor;
                var page = DisplacementPageBuilder.Build(_file, _lira, spec, msg => { SetStatus(msg); Application.DoEvents(); });
                int at = Math.Max(_pages.SelectedIndex + 1, 2);
                _file.Document.Pages.Insert(at, page);
                MarkDirty();
                RefreshPages(at);
                SetStatus("LIRA-аас «" + page.Title + "» хуудас үүслээ.");
            }
            catch (LiraReadException ex)
            {
                Cursor = Cursors.Default;
                if (MessageBox.Show(this, "LIRA-ийн өгөгдлийг уншиж чадсангүй:\n\n" + ex.Message +
                        "\n\nОношилгоо ажиллуулж файлыг хөгжүүлэгчид явуулах уу?", Text,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    RunDiagnostics();
            }
            catch (Exception ex) { Error("Шилжилтийн хуудас үүсгэхэд алдаа гарлаа:\n" + ex); }
            finally { Cursor = Cursors.Default; }
        }

        void RunDiagnostics()
        {
            try
            {
                Cursor = Cursors.WaitCursor;
                string path = _lira.RunDiagnostics(out string summary);
                Cursor = Cursors.Default;
                if (MessageBox.Show(this, "Оношилгоо дууслаа.\n\n" + summary + "\n\nФайл:\n" + path + "\n\nНээх үү?", Text,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    Process.Start(path);
            }
            catch (Exception ex) { Cursor = Cursors.Default; Error("Оношилгоо алдаа гаргалаа:\n" + ex); }
        }

        string SuggestName()
        {
            var p = _file.Document.Project;
            string kind = _file.Document.Kind == ReportDocument.KindSteel ? "Металл" : "Төмөр бетон";
            string baseName = (p.Shifr.Length > 0 ? p.Shifr + " " : "") + kind + " тооцооны тайлан";
            foreach (char c in Path.GetInvalidFileNameChars()) baseName = baseName.Replace(c, '-');
            return baseName;
        }

        static string ReportsDir()
        {
            string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MGL-LIRA", "Тайлан");
            Directory.CreateDirectory(d);
            return d;
        }

        bool ConfirmDiscard()
        {
            if (!_dirty) return true;
            var r = MessageBox.Show(this, "Өөрчлөлтөө хадгалах уу?", Text, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (r == DialogResult.Cancel) return false;
            if (r == DialogResult.Yes) return Save(false);
            return true;
        }

        void MarkDirty()
        {
            if (_loading || _dirty) return;
            _dirty = true;
            UpdateTitle();
        }

        void UpdateTitle()
        {
            string name = string.IsNullOrEmpty(_file?.Path) ? "Шинэ тайлан" : Path.GetFileName(_file.Path);
            Text = "MGL тооцооны тайлан — " + name + (_dirty ? " *" : "");
            _pathLabel.Text = _file?.Path ?? "Хадгалаагүй";
        }

        void SetStatus(string s) => _status.Text = s;
        void Info(string s) => MessageBox.Show(this, s, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        void Error(string s) => MessageBox.Show(this, s, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!ConfirmDiscard()) e.Cancel = true;
            base.OnFormClosing(e);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == (Keys.Control | Keys.S)) { Save(false); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        const string FileFilter = "MGL тооцооны тайлан (*.mglrep)|*.mglrep";
    }
}
