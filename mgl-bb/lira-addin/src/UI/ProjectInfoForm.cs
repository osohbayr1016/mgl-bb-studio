using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using MglLiraReport.Model;

namespace MglLiraReport.UI
{
    /// <summary>
    /// «Төслийн мэдээлэл» — нүүр хуудас, 2-р хуудас, булангийн хүснэгт бүгд ЭНД бөглөсөн
    /// нэг утгыг хэрэглэнэ (шифр, төслийн нэр, инженер г.м. нэг удаа бичигдэнэ).
    /// </summary>
    public class ProjectInfoForm : Form
    {
        readonly ReportFile _file;
        readonly ProjectInfo _p;
        string _signatureId;

        TextBox _title, _name, _location, _shifr, _client, _clientAddress;
        TextBox _company, _director, _engineer, _program, _license, _date, _year;
        TextBox _cover1, _cover2, _address;
        DataGridView _authors;
        PictureBox _sigBox;

        public ProjectInfoForm(ReportFile file)
        {
            _file = file;
            _p = file.Document.Project;
            _signatureId = _p.EngineerSignatureImage;

            Text = "Төслийн мэдээлэл";
            Font = new Font("Segoe UI", 9.5f);
            StartPosition = FormStartPosition.CenterParent;
            Size = new Size(760, 820);
            MinimumSize = new Size(620, 500);
            ShowIcon = false;
            MinimizeBox = false;

            var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(12, 8, 12, 8) };
            var grid = new TableLayoutPanel
            {
                Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 210));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            scroll.Controls.Add(grid);

            Section(grid, "Төсөл");
            _title = Field(grid, "Тайлангийн гарчиг (нүүр)", _p.Title, 2);
            _name = Field(grid, "Төслийн нэр", _p.Name, 2);
            _location = Field(grid, "Төслийн байршил", _p.Location);
            _shifr = Field(grid, "Төслийн шифр", _p.Shifr);
            _client = Field(grid, "Захиалагч", _p.Client);
            _clientAddress = Field(grid, "Захиалагчийн хаяг", _p.ClientAddress);

            Section(grid, "Гүйцэтгэгч");
            _company = Field(grid, "Зураг төслийн компани", _p.Company);
            _director = Field(grid, "Компанийн захирал", _p.Director);
            _engineer = Field(grid, "Гүйцэтгэсэн инженер", _p.Engineer);
            SignatureRow(grid);
            AuthorsRow(grid);

            Section(grid, "Тооцоо (булангийн хүснэгт)");
            _program = Field(grid, "Тооцооны программ", _p.Program);
            _license = Field(grid, "Лицензийн дугаар", _p.License);
            _date = Field(grid, "Огноо", string.IsNullOrEmpty(_p.Date) ? DateTime.Today.ToString("yyyy.MM.dd") : _p.Date);
            _year = Field(grid, "Он (нүүр хуудас)", string.IsNullOrEmpty(_p.Year) ? DateTime.Today.Year.ToString() : _p.Year);

            Section(grid, "Компани (нүүр хуудас)");
            _cover1 = Field(grid, "Нүүрний 1-р мөр", _p.CoverLine1);
            _cover2 = Field(grid, "Нүүрний 2-р мөр", _p.CoverLine2);
            _address = Field(grid, "Хаяг, утас (мөр мөрөөр)", _p.CompanyAddress, 4);

            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, Height = 48, Padding = new Padding(8),
            };
            var ok = new Button { Text = "Хадгалах", Width = 110, Height = 30, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "Болих", Width = 90, Height = 30, DialogResult = DialogResult.Cancel };
            ok.Click += (s, e) => ApplyChanges();
            buttons.Controls.Add(ok);
            buttons.Controls.Add(cancel);
            AcceptButton = null; // олон мөрт талбарт Enter мөр шилжүүлнэ
            CancelButton = cancel;

            Controls.Add(scroll);
            Controls.Add(buttons);
        }

        static void Section(TableLayoutPanel grid, string text)
        {
            var l = new Label
            {
                Text = text, AutoSize = true, Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(41, 60, 87), Margin = new Padding(0, 14, 0, 4),
            };
            grid.Controls.Add(l);
            grid.SetColumnSpan(l, 2);
        }

        static TextBox Field(TableLayoutPanel grid, string label, string value, int lines = 1)
        {
            grid.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
            var tb = new TextBox
            {
                Text = (value ?? "").Replace("\r\n", "\n").Replace("\n", Environment.NewLine),
                Anchor = AnchorStyles.Left | AnchorStyles.Right, Multiline = lines > 1, Margin = new Padding(0, 3, 0, 3),
            };
            if (lines > 1) { tb.Height = 8 + lines * 20; tb.ScrollBars = ScrollBars.Vertical; tb.AcceptsReturn = true; }
            grid.Controls.Add(tb);
            return tb;
        }

        void SignatureRow(TableLayoutPanel grid)
        {
            grid.Controls.Add(new Label { Text = "Гарын үсэг (булангийн хүснэгтэд)", AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
            var row = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0) };
            _sigBox = new PictureBox { Width = 110, Height = 50, SizeMode = PictureBoxSizeMode.Zoom, BorderStyle = BorderStyle.FixedSingle };
            var pick = new Button { Text = "Зураг сонгох…", AutoSize = true };
            var clear = new Button { Text = "Арилгах", AutoSize = true };
            pick.Click += (s, e) =>
            {
                using (var dlg = new OpenFileDialog { Filter = ImageFilter, Title = "Гарын үсгийн зураг" })
                    if (dlg.ShowDialog(this) == DialogResult.OK)
                    {
                        _signatureId = _file.AddImage(File.ReadAllBytes(dlg.FileName));
                        ShowSignature();
                    }
            };
            clear.Click += (s, e) => { _signatureId = null; ShowSignature(); };
            row.Controls.Add(_sigBox);
            row.Controls.Add(pick);
            row.Controls.Add(clear);
            grid.Controls.Add(row);
            ShowSignature();
        }

        void ShowSignature()
        {
            _sigBox.Image?.Dispose();
            _sigBox.Image = null;
            if (_signatureId != null && _file.Images.TryGetValue(_signatureId, out var bytes))
                _sigBox.Image = ImageUtil.FromBytes(bytes);
        }

        void AuthorsRow(TableLayoutPanel grid)
        {
            grid.Controls.Add(new Label { Text = "Зохиогч инженерүүд\n(2-р хуудас)", AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
            _authors = new DataGridView
            {
                Anchor = AnchorStyles.Left | AnchorStyles.Right, Height = 130, AllowUserToAddRows = true, AllowUserToDeleteRows = true,
                RowHeadersWidth = 28, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                BackgroundColor = SystemColors.Window, Margin = new Padding(0, 3, 0, 3),
            };
            _authors.Columns.Add("name", "Нэр (Л.Сайнбаяр)");
            _authors.Columns.Add("qual", "Мэргэшлийн зэрэг, дугаар");
            _authors.Columns[0].FillWeight = 40;
            _authors.Columns[1].FillWeight = 60;
            foreach (var a in _p.Authors) _authors.Rows.Add(a.Name, a.Qualification);
            grid.Controls.Add(_authors);
        }

        void ApplyChanges()
        {
            _authors.EndEdit();
            _p.Title = Norm(_title.Text);
            _p.Name = Norm(_name.Text).Replace("\n", " ");
            _p.Location = Norm(_location.Text);
            _p.Shifr = Norm(_shifr.Text);
            _p.Client = Norm(_client.Text);
            _p.ClientAddress = Norm(_clientAddress.Text);
            _p.Company = Norm(_company.Text);
            _p.Director = Norm(_director.Text);
            _p.Engineer = Norm(_engineer.Text);
            _p.EngineerSignatureImage = _signatureId;
            _p.Program = Norm(_program.Text);
            _p.License = Norm(_license.Text);
            _p.Date = Norm(_date.Text);
            _p.Year = Norm(_year.Text);
            _p.CoverLine1 = Norm(_cover1.Text);
            _p.CoverLine2 = Norm(_cover2.Text);
            _p.CompanyAddress = Norm(_address.Text);
            _p.Authors = _authors.Rows.Cast<DataGridViewRow>()
                .Where(r => !r.IsNewRow)
                .Select(r => new AuthorInfo
                {
                    Name = Norm(Convert.ToString(r.Cells[0].Value)),
                    Qualification = Norm(Convert.ToString(r.Cells[1].Value)),
                })
                .Where(a => a.Name.Length > 0 || a.Qualification.Length > 0)
                .ToList();
            UserDefaults.Remember(_p);
        }

        static string Norm(string s) => (s ?? "").Replace("\r\n", "\n").Trim();

        public const string ImageFilter = "Зураг (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif";
    }
}
