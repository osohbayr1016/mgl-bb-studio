using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using MglLiraReport.Results;

namespace MglLiraReport.UI
{
    /// <summary>
    /// «LIRA → Шилжилтийн хуудас үүсгэх».  Хослол, бүрэлдэхүүн, харагдацыг сонгоход хуудсыг
    /// DisplacementPageBuilder автоматаар (зураг + min/max) үүсгэнэ — хэрэглэгч зураг хуулах, тоо бичих хэрэггүй.
    /// </summary>
    public class DisplacementPageForm : Form
    {
        readonly ILiraSource _src;
        TextBox _heading, _desc;
        ComboBox _source, _unit;
        NumericUpDown _width;
        TableLayoutPanel _rows;
        readonly List<RowControls> _rowControls = new List<RowControls>();
        List<LiraCase> _cases = new List<LiraCase>();

        sealed class RowControls
        {
            public CheckBox Include; public TextBox Title; public ComboBox Case, Component, View;
        }

        public DisplacementPageBuilder.Spec Spec { get; private set; }

        static readonly string[] ComponentNames = { "X", "Y", "Z", "XY нийлбэр √(X²+Y²)" };
        static readonly string[] ViewNames = { "Фасад (X тэнхлэг хэвтээ)", "Фасад (Y тэнхлэг хэвтээ)", "План (дээрээс)" };

        public DisplacementPageForm(ILiraSource src)
        {
            _src = src;
            Text = "LIRA — шилжилтийн хуудас үүсгэх";
            Font = new Font("Segoe UI", 9.5f);
            Size = new Size(1080, 560);
            MinimumSize = new Size(900, 480);
            StartPosition = FormStartPosition.CenterParent;
            ShowIcon = false; MinimizeBox = false;

            var top = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, Padding = new Padding(12, 10, 12, 4) };
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));

            _heading = new TextBox { Text = "5.2. ГАЗАР ЧИЧИРХИЙЛЛИЙН АЧААЛЛЫН ХЭВТЭЭ ШИЛЖИЛТҮҮД", Anchor = AnchorStyles.Left | AnchorStyles.Right };
            string model = string.IsNullOrEmpty(src.ModelName) ? "ЗАГВАРЫН НЭР" : src.ModelName.ToUpperInvariant();
            _desc = new TextBox { Text = "Тооцооны модел БНБД 22-01-21-ИЙН ХАРИУ СПЕКТРИЙН АРГААР ТООЦОХ (" + model + ")", Anchor = AnchorStyles.Left | AnchorStyles.Right };
            _source = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Anchor = AnchorStyles.Left | AnchorStyles.Right };
            _source.Items.AddRange(new object[] { "РСН — тооцооны", "РСН — нормын", "Ачаалал" });
            _unit = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160 };
            _unit.Items.AddRange(new object[] { "LIRA-ийн утга мм-ээр", "LIRA-ийн утга см-ээр", "LIRA-ийн утга м-ээр" });
            _unit.SelectedIndex = 0;
            _width = new NumericUpDown { Minimum = 40, Maximum = 100, Value = 85, Increment = 5, Width = 70 };

            AddRow(top, "Гарчиг", _heading, null, null);
            AddRow(top, "Тайлбар мөр", _desc, null, null);
            AddRow(top, "Үр дүн", _source, new Label { Text = "Нэгж:", AutoSize = true, Anchor = AnchorStyles.Right }, _unit);
            AddRow(top, "Зургийн өргөн %", _width, null, null);

            var header = new TableLayoutPanel { Dock = DockStyle.Top, Height = 26, ColumnCount = 5, Padding = new Padding(12, 6, 12, 0) };
            SetCols(header);
            foreach (var h in new[] { "", "Зургийн гарчиг", "Хослол / ачаалал", "Бүрэлдэхүүн", "Харагдац" })
                header.Controls.Add(new Label { Text = h, AutoSize = true, Font = new Font(Font, FontStyle.Bold) });

            _rows = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 5, AutoScroll = true, Padding = new Padding(12, 0, 12, 0) };
            SetCols(_rows);

            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 50, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(10) };
            var ok = new Button { Text = "Хуудас үүсгэх", Width = 140, Height = 30 };
            var cancel = new Button { Text = "Болих", Width = 90, Height = 30, DialogResult = DialogResult.Cancel };
            var add = new Button { Text = "+ Мөр нэмэх", Width = 120, Height = 30 };
            ok.Click += (s, e) => Accept();
            add.Click += (s, e) => AddCaseRow("", MoveComponent.X, ViewKind.ElevationX, null, true);
            bottom.Controls.AddRange(new Control[] { ok, cancel, add });
            CancelButton = cancel;

            Controls.Add(_rows);
            Controls.Add(header);
            Controls.Add(top);
            Controls.Add(bottom);

            _source.SelectedIndexChanged += (s, e) => LoadCases();
            Shown += (s, e) =>
            {
                _source.SelectedIndex = 0;
                if (_cases.Count == 0) _source.SelectedIndex = 2; // РСН байхгүй бол ачаалал
            };
        }

        static void AddRow(TableLayoutPanel t, string label, Control c, Control c3, Control c4)
        {
            t.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 6, 0) });
            t.Controls.Add(c);
            t.Controls.Add(c3 ?? new Label());
            t.Controls.Add(c4 ?? new Label());
        }

        static void SetCols(TableLayoutPanel t)
        {
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 30));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220));
        }

        void LoadCases()
        {
            var source = _source.SelectedIndex == 1 ? CaseSource.RsnNorm : _source.SelectedIndex == 2 ? CaseSource.Loading : CaseSource.RsnCalc;
            try
            {
                Cursor = Cursors.WaitCursor;
                _cases = _src.ListCases(source);
            }
            catch (Exception ex)
            {
                _cases = new List<LiraCase>();
                MessageBox.Show(this, "Хослолын жагсаалтыг уншиж чадсангүй:\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally { Cursor = Cursors.Default; }

            _rows.SuspendLayout();
            foreach (Control c in _rows.Controls.Cast<Control>().ToList()) c.Dispose();
            _rows.Controls.Clear();
            _rowControls.Clear();
            // Жишээ тайлан шиг 3 мөр: +X хослол → фасад X, +Y → фасад Y, XY → план.  Нэрээр нь таамаглана.
            AddCaseRow("X чиглэлд", MoveComponent.X, ViewKind.ElevationX, Guess("+X", "X)", "-X"), true);
            AddCaseRow("Y чиглэлд", MoveComponent.Y, ViewKind.ElevationY, Guess("+Y", "Y)", "-Y"), true);
            AddCaseRow("XY чиглэлд", MoveComponent.XY, ViewKind.Plan, Guess("XY"), Guess("XY") != null);
            _rows.ResumeLayout();
        }

        LiraCase Guess(params string[] needles)
        {
            foreach (var n in needles)
            {
                var c = _cases.FirstOrDefault(k => k.Label.IndexOf(n, StringComparison.OrdinalIgnoreCase) >= 0);
                if (c != null) return c;
            }
            return null;
        }

        void AddCaseRow(string title, MoveComponent comp, ViewKind view, LiraCase c, bool include)
        {
            var rc = new RowControls
            {
                Include = new CheckBox { Checked = include, AutoSize = true, Margin = new Padding(6, 8, 0, 0) },
                Title = new TextBox { Text = title, Width = 160 },
                // Top заавал: TableLayoutPanel-ийн сүүлийн мөр үлдсэн өндрийг бүхэлд нь авдаг тул эс бөгөөс доош унана.
                Case = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top },
                Component = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 },
                View = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 210 },
            };
            rc.Case.Items.AddRange(_cases.Cast<object>().ToArray());
            if (c != null) rc.Case.SelectedItem = c;
            else if (_cases.Count > 0) rc.Case.SelectedIndex = 0;
            rc.Component.Items.AddRange(ComponentNames);
            rc.Component.SelectedIndex = (int)comp;
            rc.View.Items.AddRange(ViewNames);
            rc.View.SelectedIndex = (int)view;
            _rows.Controls.Add(rc.Include);
            _rows.Controls.Add(rc.Title);
            _rows.Controls.Add(rc.Case);
            _rows.Controls.Add(rc.Component);
            _rows.Controls.Add(rc.View);
            _rowControls.Add(rc);
        }

        void Accept()
        {
            var spec = new DisplacementPageBuilder.Spec
            {
                Heading = _heading.Text.Trim(),
                Description = _desc.Text.Trim(),
                ToMm = _unit.SelectedIndex == 1 ? 10 : _unit.SelectedIndex == 2 ? 1000 : 1,
                WidthPercent = (int)_width.Value,
            };
            foreach (var rc in _rowControls)
            {
                if (!rc.Include.Checked) continue;
                if (!(rc.Case.SelectedItem is LiraCase c))
                {
                    MessageBox.Show(this, "«" + rc.Title.Text + "» мөрөнд хослол сонгоогүй байна.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                spec.Rows.Add(new DisplacementPageBuilder.Row
                {
                    Include = true, Title = rc.Title.Text.Trim(), Case = c,
                    Component = (MoveComponent)rc.Component.SelectedIndex, View = (ViewKind)rc.View.SelectedIndex,
                });
            }
            if (spec.Rows.Count == 0)
            {
                MessageBox.Show(this, "Ядаж нэг мөр сонгоно уу.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Spec = spec;
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
