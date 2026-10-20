using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Байрлал» блок — хэрэгслийн БҮХ хэмжээсийн НЭГ байрлал (2026-10-12, эзний t1.pdf: «эхний гинж» зай бүх хэмжээсэд нөлөөлдөг, «баруун ба доод» арматурын
    /// хэмжээсэд ч):
    ///   ○ 4 талд   ○ Зөвхөн зүүн ба доод талд   ○ Зөвхөн баруун ба доод талд
    ///   «…»-аас эхний гинж: [ ] мм,  гинж хооронд: [ ] мм (цаас)
    /// Цонхонд гурван газар харагдана (ерөнхий хэмжээс, огтлолын хомутын гинж, хана-хучилт) — <see cref="Link"/>-ээр холбогдсон тул аль нэгийг засахад
    /// бусад нь ДАГАЖ өөрчлөгдөнө (нэг утга, олон харагдац).  Утгын эх сурвалж = <see cref="AaOptions"/>-ийн ерөнхий байрлал (<see cref="AaOptions.ApplyPlacement"/>).
    /// </summary>
    internal sealed class AaPlacementBlock
    {
        public readonly StackPanel Panel = new StackPanel();
        public readonly RadioButton AllSides, TwoSides, RightSides;
        public readonly TextBox First, Step;

        private AaPlacementBlock[] _peers = new AaPlacementBlock[0];

        /// <summary>Нэг блокийн өөрчлөлтийг бусад руу хуулж байх үед (дахин эргэж дуудагдахаас сэргийлнэ) — зөвхөн UI thread.</summary>
        private static bool _syncing;

        /// <param name="fromWord">«Ханаас» / «Элементээс» — эхний гинжийн зай юунаас хэмжигдэхийг хэлнэ.</param>
        /// <param name="allSidesLabel">«Барилгын 4 талд» / «4 талд».</param>
        /// <param name="group">Нэг цонхонд хэд хэдэн блок байх тул RadioButton-ы GroupName (давхардахгүй).</param>
        /// <param name="rightSide">4 талд биш үед босоо гинж баруун талд («Зөвхөн баруун ба доод талд»).</param>
        public AaPlacementBlock(string group, string allSidesLabel, string fromWord, bool allSides, bool rightSide, double firstMm, double stepMm, string tip)
        {
            Panel.Children.Add(new TextBlock { Text = "Байрлал", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 2) });
            AllSides = new RadioButton { Content = allSidesLabel, GroupName = group, IsChecked = allSides, Margin = new Thickness(0, 2, 0, 2) };
            TwoSides = new RadioButton { Content = "Зөвхөн зүүн ба доод талд", GroupName = group, IsChecked = !allSides && !rightSide, Margin = new Thickness(0, 2, 0, 2) };
            RightSides = new RadioButton { Content = "Зөвхөн баруун ба доод талд", GroupName = group, IsChecked = !allSides && rightSide, Margin = new Thickness(0, 2, 0, 2) };
            Panel.Children.Add(AllSides);
            Panel.Children.Add(TwoSides);
            Panel.Children.Add(RightSides);

            var gap = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 2) };
            gap.Children.Add(new TextBlock { Text = fromWord + " эхний гинж:", VerticalAlignment = VerticalAlignment.Center });
            First = new TextBox { Width = 52, TextAlignment = TextAlignment.Right, Margin = new Thickness(6, 0, 4, 0), Text = Fmt(firstMm) };
            gap.Children.Add(First);
            gap.Children.Add(new TextBlock { Text = "мм,  гинж хооронд:", VerticalAlignment = VerticalAlignment.Center });
            Step = new TextBox { Width = 52, TextAlignment = TextAlignment.Right, Margin = new Thickness(6, 0, 4, 0), Text = Fmt(stepMm) };
            gap.Children.Add(Step);
            gap.Children.Add(new TextBlock { Text = "мм (цаас)", VerticalAlignment = VerticalAlignment.Center });
            Panel.Children.Add(gap);

            var note = new TextBlock
            {
                Text = "Энэ байрлал ба зай хэрэгслийн БҮХ хэмжээсэд нэг (ерөнхий, арматурын огтлол/дэлгээс, хана-хучилт) — аль ч табаас засахад бусад нь дагана.",
                TextWrapping = TextWrapping.Wrap,
                FontSize = 12,
                Margin = new Thickness(0, 2, 0, 2),
            };
            note.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            Panel.Children.Add(note);
            if (!string.IsNullOrEmpty(tip)) Panel.ToolTip = tip;
        }

        public bool IsAllSides { get { return AllSides.IsChecked == true; } }
        public bool IsRightSide { get { return RightSides.IsChecked == true; } }

        /// <summary>Блокуудыг холбоно: аль нэгийнх нь тал/зай өөрчлөгдөхөд бусдад нь ижил утга бичигдэнэ.  null-ийг алгасна.</summary>
        public static void Link(params AaPlacementBlock[] blocks)
        {
            AaPlacementBlock[] all = blocks.Where(b => b != null).Distinct().ToArray();
            if (all.Length < 2) return;
            foreach (AaPlacementBlock b in all)
            {
                b._peers = all.Where(x => !ReferenceEquals(x, b)).ToArray();
                AaPlacementBlock self = b;
                foreach (RadioButton r in new[] { b.AllSides, b.TwoSides, b.RightSides })
                    r.Checked += (s, e) => self.Push();
                b.First.TextChanged += (s, e) => self.Push();
                b.Step.TextChanged += (s, e) => self.Push();
            }
        }

        private void Push()
        {
            if (_syncing) return;
            _syncing = true;
            try
            {
                foreach (AaPlacementBlock p in _peers)
                {
                    if (IsAllSides) p.AllSides.IsChecked = true;
                    else if (IsRightSide) p.RightSides.IsChecked = true;
                    else if (TwoSides.IsChecked == true) p.TwoSides.IsChecked = true;
                    if (p.First.Text != First.Text) p.First.Text = First.Text;
                    if (p.Step.Text != Step.Text) p.Step.Text = Step.Text;
                }
            }
            finally
            {
                _syncing = false;
            }
        }

        private static string Fmt(double v) { return v.ToString("0.#", CultureInfo.InvariantCulture); }
    }
}
