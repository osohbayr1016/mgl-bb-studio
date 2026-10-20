using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Ui;

namespace RevitMcpAddin.SheetNumerator.UiSmoke
{
    /// <summary>Нэг шалгалтын орчин: хуурамч «Revit» + бодит ViewModel + бодит цонх (дэлгэцийн гадна).</summary>
    internal sealed class Harness : IDisposable
    {
        public FakeGateway Gateway;
        public FakePrompts Prompts;
        public SheetNumeratorViewModel Vm;
        public SheetNumeratorWindow Window;
        public readonly List<string> Logged = new List<string>();

        public static Harness Open(DocumentSnapshot doc = null, SheetNumeratorPrefs prefs = null, bool offscreen = true)
        {
            var h = new Harness
            {
                Gateway = new FakeGateway { Doc = doc ?? Docs.Typical() },
                Prompts = new FakePrompts(),
            };
            h.Vm = new SheetNumeratorViewModel(h.Gateway, h.Prompts, prefs ?? new SheetNumeratorPrefs());
            h.Vm.ErrorLogger = (op, ex) => h.Logged.Add(op + ": " + ex.GetType().Name + ": " + ex.Message);
            h.Window = new SheetNumeratorWindow(h.Vm);
            if (offscreen)
            {
                h.Window.WindowStartupLocation = WindowStartupLocation.Manual;
                h.Window.Left = -20000;
                h.Window.Top = -20000;
                h.Window.ShowActivated = false;
            }
            h.Window.Show();
            Ui.Wait(h.Vm.InitializeAsync());
            Ui.Pump(80);
            return h;
        }

        public ListView List { get { return Ui.Find<ListView>(Window, "SheetList"); } }

        public GroupNodeViewModel Node(string titleStart)
        {
            GroupNodeViewModel n = Vm.TreeRoots.SelectMany(r => r.Flatten())
                .FirstOrDefault(x => x.HasGroup && x.Title.StartsWith(titleStart, StringComparison.Ordinal));
            if (n == null)
                throw new SmokeFailed("Бүлгийн зангилаа олдсонгүй: " + titleStart + "  (байгаа: " + string.Join(", ", Vm.TreeRoots.SelectMany(r => r.Flatten()).Select(x => x.Title)) + ")");
            return n;
        }

        public void SelectGroup(string titleStart)
        {
            Node(titleStart).IsSelected = true;
            Ui.Pump(60);
        }

        public string[] Numbers()
        {
            return Vm.Rows.Select(r => r.Sheet.Number).ToArray();
        }

        public string[] NewNumbers()
        {
            return Vm.Rows.Select(r => r.NumberWillChange ? r.NewNumberDisplay : r.CurrentNumber).ToArray();
        }

        public void Settle()
        {
            Ui.Pump(300);   // debounce (120 мс) + render
        }

        public void Dispose()
        {
            try { Window.Close(); } catch (Exception) { }
            Ui.Pump(20);
        }
    }

    public static class WindowSmoke
    {
        // ─────────────────────────────────────────────────────────────
        public static void Opens_AutoSelectsActiveSheet_AndShowsTree()
        {
            using (Harness h = Harness.Open())
            {
                long active = h.Gateway.Doc.ActiveSheetId;
                Ui.Check(h.Vm.HasDocument, "document ачаалагдаагүй");
                Ui.Check(h.Vm.CurrentGroup != null && h.Vm.CurrentGroup.Title.StartsWith("КОН", StringComparison.Ordinal),
                    "идэвхтэй хуудас (K-002) байгаа бүлэг сонгогдоогүй: " + (h.Vm.CurrentGroup != null ? h.Vm.CurrentGroup.Title : "null"));
                Ui.Check(h.Vm.SelectedIds.Contains(active), "идэвхтэй хуудас VM-д сонгогдоогүй");
                ListView list = h.List;
                Ui.Eq(1, list.SelectedItems.Count, "жагсаалтад сонгогдсон мөр");
                Ui.Eq(active, ((SheetRowViewModel)list.SelectedItem).SheetId, "сонгогдсон мөрийн id");
                Ui.Check(h.Vm.ShowTree, "мод харагдах ёстой (олон бүлэг)");
                Ui.Eq(1, h.Gateway.LoadCount, "Revit-ээс уншсан тоо (нэг л удаа)");

                // Нуугдсан (шүүлтэнд таарахгүй) хуудас жагсаалтад байхгүй.
                SheetSnapshot hidden = h.Gateway.Doc.Sheets.First(s => !s.SatisfiesBrowserFilter);
                Ui.Check(!h.Vm.TreeRoots.SelectMany(r => r.Flatten()).Where(n => n.HasGroup).SelectMany(n => n.Group.Sheets).Any(s => s.SheetId == hidden.SheetId),
                    "шүүлтээр нуугдсан хуудас жагсаалтад орсон");

                Ui.Render(h.Window, "01-open");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void SimplePreview_ThenApply_WritesOnce_AndReloads()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.SimplePrefix = "K-";
                h.Vm.SimpleStartText = "10";
                h.Vm.SimpleWidthText = "3";
                h.Settle();

                Ui.Eq("K-010,K-011,K-012,K-013", string.Join(",", h.NewNumbers()), "урьдчилсан дугаарууд");
                Ui.Check(h.Vm.CanApply, "Хэрэгжүүлэх идэвхтэй байх ёстой: " + h.Vm.StatusText);
                Ui.Eq(0, h.Gateway.ApplyCount, "preview үед Revit руу бичихгүй");
                Ui.Eq("K-001,K-002,K-003,K-004", string.Join(",", h.Gateway.Doc.Sheets.Where(s => s.SheetId >= 201 && s.SheetId <= 204).Select(s => s.Number)), "модель хөндөгдөөгүй");
                Ui.Render(h.Window, "02-preview");

                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Eq(1, h.Gateway.ApplyCount, "Apply-ийн дуудлага");
                Ui.Eq(4, h.Gateway.LastApply.Items.Count, "Apply-д өөрчлөгдөх мөр");
                Ui.Eq("K-010,K-011,K-012,K-013", string.Join(",", h.Gateway.Doc.Sheets.Where(s => s.SheetId >= 201 && s.SheetId <= 204).Select(s => s.Number)), "модель шинэчлэгдсэн");
                Ui.Eq(2, h.Gateway.LoadCount, "Apply-ийн дараа дахин уншсан");
                Ui.Contains(h.Vm.StatusText, "4", "амжилтын мессеж");
                Ui.Render(h.Window, "03-applied");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Duplicate_AcrossGroups_BlocksApply()
        {
            using (Harness h = Harness.Open())
            {
                h.SelectGroup("АРХ");
                // АРХ → «K-001…» болгоход КОН бүлгийн K-001..K-004-тэй (ЦУГЛУУЛГАГҮЙ ижил хүрээнд) мөргөлдөнө.
                h.Vm.SimplePrefix = "K-";
                h.Vm.SimpleStartText = "1";
                h.Vm.SimpleWidthText = "3";
                h.Settle();

                Ui.Check(!h.Vm.CanApply, "давхардал байхад Хэрэгжүүлэх идэвхтэй байна");
                SheetRowViewModel first = h.Vm.Rows[0];
                Ui.Eq(RowState.Error, first.State, "эхний мөрийн төлөв");
                Ui.Contains(first.Tooltip, "Дугаар давхардсан байна.", "Revit-ийн давхардлын мессеж");
                Ui.Contains(first.Tooltip, "K-001", "давхардсан дугаар");
                Ui.Render(h.Window, "04-duplicate");

                // Цуглуулга ӨӨР хүрээ (Revit 2025+): «2-р шат»-ын хуудсыг S-02 болгоход «1-р шат»-ын S-02-той
                // мөргөлдөхгүй — ЗӨВШӨӨРӨГДӨНӨ (цуглуулга бүр тусдаа хүрээ).
                h.SelectGroup("Цуглуулга: 2-р шат");
                h.Vm.SimplePrefix = "S-";
                h.Vm.SimpleStartText = "2";
                h.Vm.SimpleWidthText = "2";
                h.Settle();
                Ui.Eq("S-02", h.Vm.Rows[0].NewNumberDisplay, "цуглуулгын шинэ дугаар");
                Ui.Check(h.Vm.Rows[0].State != RowState.Error, "өөр цуглуулгын дугаартай мөргөлдөж байна: " + h.Vm.Rows[0].Tooltip);
                Ui.Check(h.Vm.CanApply, "цуглуулга хоорондын давхцал Apply-г хаасан: " + h.Vm.StatusText);
                Ui.Render(h.Window, "04b-collection-scope-ok");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void KeyboardMoves_MarkDirty_AndReset()
        {
            using (Harness h = Harness.Open())
            {
                // K-002 сонгогдсон.  Дээш → K-002 эхэнд ойртоно; доод руу.
                string[] before = h.Numbers();
                h.Vm.MoveUpCommand.Execute(null);
                Ui.Pump(60);
                string[] afterUp = h.Numbers();
                Ui.Eq("K-002,K-001,K-003,K-004", string.Join(",", afterUp), "дээш зөөсний дараа");
                Ui.Check(h.Vm.IsOrderDirty, "дараалал бохирдсон гэж тэмдэглэгдээгүй");
                Ui.Check(h.Node("КОН").IsDirty, "модонд ● тэмдэг гараагүй");
                Ui.Eq(1, h.List.SelectedItems.Count, "зөөсний дараа сонголт хадгалагдсан");

                h.Vm.MoveBottomCommand.Execute(null);
                Ui.Eq("K-001,K-003,K-004,K-002", string.Join(",", h.Numbers()), "доод руу");
                h.Vm.MoveTopCommand.Execute(null);
                Ui.Eq("K-002,K-001,K-003,K-004", string.Join(",", h.Numbers()), "эхэнд");
                h.Vm.MoveDownCommand.Execute(null);
                Ui.Eq("K-001,K-002,K-003,K-004", string.Join(",", h.Numbers()), "доош");
                Ui.Check(!h.Vm.IsOrderDirty, "анхны дараалалд буцахад «бохир» үлдсэн");

                h.Vm.MoveDownCommand.Execute(null);
                Ui.Check(h.Vm.IsOrderDirty, "дахин бохирдсон байх ёстой");
                Ui.Render(h.Window, "05-moved");
                h.Vm.ResetOrderCommand.Execute(null);
                Ui.Eq(string.Join(",", before), string.Join(",", h.Numbers()), "Reset");
                Ui.Check(!h.Vm.IsOrderDirty, "Reset-ийн дараа бохир");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Drop_SameGroup_Reorders_CrossGroup_Rejected()
        {
            using (Harness h = Harness.Open())
            {
                long k1 = 201, k4 = 204, a1 = 101;
                // Бүлэг доторх зөөлт: K-004-ийг эхэнд.
                bool moved = h.Vm.DropRows(new[] { k4 }, 0);
                Ui.Check(moved, "бүлэг доторх зөөлт татгалзагдсан");
                Ui.Eq("K-004,K-001,K-002,K-003", string.Join(",", h.Numbers()), "K-004 эхэнд");

                // Олон мөр нэг дор, харилцан дараалал хадгална: {K-001, K-003}-ыг төгсгөлд.
                moved = h.Vm.DropRows(new[] { k1, 203L }, h.Vm.Rows.Count);
                Ui.Check(moved, "олон мөрийн зөөлт");
                Ui.Eq("K-004,K-002,K-001,K-003", string.Join(",", h.Numbers()), "олон мөр төгсгөлд (харилцан дараалал)");

                // Бүлэг хоорондын зөөлт: АРХ-ийн хуудсыг КОН-д буулгах → татгалз, жагсаалт ӨӨРЧЛӨГДӨХГҮЙ.
                string before = string.Join(",", h.Numbers());
                Ui.Check(!h.Vm.IsInCurrentGroup(a1), "АРХ-ийн хуудас КОН бүлэгт тооцогдож байна");
                bool crossMoved = h.Vm.DropRows(new[] { a1 }, 1);
                Ui.Check(!crossMoved, "бүлэг хоорондын зөөлт зөвшөөрөгдсөн");
                Ui.Eq(before, string.Join(",", h.Numbers()), "бүлэг хоорондын зөөлт жагсаалтыг өөрчилсөн");

                // Модны зангилаа дээр буулгах: БАЙХ ёстой «хориотой» тайлбар.
                GroupNodeViewModel arch = h.Node("АРХ");
                Ui.Check(!h.Vm.BelongsToCurrentGroup(arch), "АРХ зангилаа одоогийн бүлэг гэж тооцогдож байна");
                h.Vm.ReportInvalidDrop();
                Ui.Eq(Msg.InvalidDrop, h.Vm.StatusText, "хориотой чирэлтийн тайлбар");
                Ui.Render(h.Window, "06-drop-rejected");
            }
        }

        // ─────────────────────────────────────────────────────────────
        /// <summary>
        /// Чирж зөөхийн WPF давхарга: бодит visual tree дээр hit-test хийж, `DragEventArgs`-гүйгээр ижил логикийг дууддаг
        /// (хулгана зөөхгүй).  Үлдэх хэсэг — бодит `DoDragDrop`-ийн гогцоо — гараар шалгагдана.
        /// </summary>
        public static void WpfDragDrop_InsertionIndex_SameGroupMoves_CrossGroupRejected()
        {
            using (Harness h = Harness.Open())
            {
                ListView list = h.List;
                Func<int, ListViewItem> row = i => (ListViewItem)list.ItemContainerGenerator.ContainerFromIndex(i);
                Func<ListViewItem, double, Func<IInputElement, Point>> at = (item, frac) =>
                    rel => item.TranslatePoint(new Point(12, item.ActualHeight * frac), (UIElement)rel);
                IDataObject ours = new DataObject(SheetNumeratorWindow.DragFormat, new long[] { 204 });

                // Оруулах индекс: мөрийн дээд талд → мөрийн өмнө, доод талд → мөрийн дараа.
                Ui.Check(row(0) != null && row(0).ActualHeight > 0, "мөр visual үүсээгүй");
                Ui.Eq(0, h.Window.InsertionIndexAt(row(0), at(row(0), 0.25)), "1-р мөрийн дээд тал");
                Ui.Eq(1, h.Window.InsertionIndexAt(row(0), at(row(0), 0.75)), "1-р мөрийн доод тал");
                Ui.Eq(2, h.Window.InsertionIndexAt(row(2), at(row(2), 0.25)), "3-р мөрийн дээд тал");
                Ui.Eq(3, h.Window.InsertionIndexAt(row(2), at(row(2), 0.75)), "3-р мөрийн доод тал");
                // Жагсаалтын хоосон хэсэг: толгойн ойролцоо → эхэнд, доор → төгсгөлд.
                Ui.Eq(0, h.Window.InsertionIndexAt(list, rel => new Point(50, 10)), "хоосон хэсэг, толгой");
                Ui.Eq(h.Vm.Rows.Count, h.Window.InsertionIndexAt(list, rel => new Point(50, 400)), "хоосон хэсэг, доод тал");

                // Өөрийн бүлгийн мөр дээр чирэхэд Move; гаднаас (файл, текст) None.
                Ui.Eq(DragDropEffects.Move, h.Window.ComputeListDragEffect(ours, row(1), at(row(1), 0.5)), "өөрийн бүлэг");
                IDataObject foreign = new DataObject(DataFormats.Text, "ямар нэг текст");
                Ui.Eq(DragDropEffects.None, h.Window.ComputeListDragEffect(foreign, row(1), at(row(1), 0.5)), "гаднаас текст");
                IDataObject otherGroup = new DataObject(SheetNumeratorWindow.DragFormat, new long[] { 101 });   // АРХ-ийн хуудас
                Ui.Eq(DragDropEffects.None, h.Window.ComputeListDragEffect(otherGroup, row(1), at(row(1), 0.5)), "өөр бүлгийн хуудас");

                // Буулгах: K-004-ийг 1-р мөрийн ӨМНӨ → эхэнд.
                Ui.Eq(SheetNumeratorWindow.DropOutcome.Moved, h.Window.HandleListDrop(ours, row(0), at(row(0), 0.25)), "буулгалт");
                Ui.Eq("K-004,K-001,K-002,K-003", string.Join(",", h.Numbers()), "K-004 эхэнд");
                Ui.Check(h.Vm.IsOrderDirty, "буулгалтын дараа бохирдоогүй");
                Ui.Pump(120);   // мөрүүд дахин байгуулагдсан — ListViewItem контейнер үүсэх хүртэл layout
                Ui.Eq(1, h.List.SelectedItems.Count, "буулгасны дараа сонголт сэргэсэн");
                Ui.Eq(204L, ((SheetRowViewModel)h.List.SelectedItem).SheetId, "сонгогдсон мөр = зөөсөн хуудас");
                // Ижил байрлал → өөрчлөлтгүй.
                Ui.Eq(SheetNumeratorWindow.DropOutcome.Unchanged, h.Window.HandleListDrop(ours, row(0), at(row(0), 0.25)), "ижил байрлал");
                // Гаднаас → үл тооно.
                Ui.Eq(SheetNumeratorWindow.DropOutcome.NotOurData, h.Window.HandleListDrop(foreign, row(0), at(row(0), 0.25)), "гаднаас буулгах");

                // Өөр бүлгийн хуудсыг жагсаалтад буулгах → ХОРИОТОЙ, жагсаалт өөрчлөгдөхгүй, тайлбар гарна.
                string before = string.Join(",", h.Numbers());
                Ui.Eq(SheetNumeratorWindow.DropOutcome.Rejected, h.Window.HandleListDrop(otherGroup, row(1), at(row(1), 0.25)), "өөр бүлгийг жагсаалтад");
                Ui.Eq(before, string.Join(",", h.Numbers()), "жагсаалт хөндөгдсөн");
                Ui.Eq(Msg.InvalidDrop, h.Vm.StatusText, "хориотой тайлбар (жагсаалт)");

                // Мод: өөр бүлгийн зангилаа дээр → улаан тодруулга + ХОРИОТОЙ; одоогийн бүлэг дээр тодруулгагүй.
                TreeViewItem arch = Ui.Descendants<TreeViewItem>(h.Window).First(t => t.DataContext is GroupNodeViewModel n && n.Title.StartsWith("АРХ", StringComparison.Ordinal));
                TreeViewItem kon = Ui.Descendants<TreeViewItem>(h.Window).First(t => t.DataContext is GroupNodeViewModel n && n.Title.StartsWith("КОН", StringComparison.Ordinal));
                Ui.Check(ReferenceEquals(arch, h.Window.ComputeTreeDragEffect(ours, arch)), "өөр бүлгийн зангилаа тодрохгүй байна");
                var tint = arch.Background as SolidColorBrush;
                Ui.Check(tint != null && tint.Color.A == 0x40 && tint.Color.R > tint.Color.G, "өөр бүлгийн зангилаа улаанаар тодроогүй");
                Ui.Check(h.Window.ComputeTreeDragEffect(ours, kon) == null, "одоогийн бүлэг тодорсон");
                Ui.Check(!(arch.Background is SolidColorBrush b2 && b2.Color.A == 0x40), "тодруулга арилаагүй");
                h.Vm.ReportInvalidDrop();   // статусыг цэвэрлэж болохгүй тул шууд дахин шалгана
                Ui.Check(h.Window.HandleTreeDrop(ours, arch), "модны буулгалт боловсруулагдаагүй");
                Ui.Eq(Msg.InvalidDrop, h.Vm.StatusText, "хориотой тайлбар (мод)");
                Ui.Eq(before, string.Join(",", h.Numbers()), "модны буулгалт жагсаалтыг өөрчилсөн");
                Ui.Check(!h.Window.HandleTreeDrop(foreign, arch), "гаднаас модны буулгалт боловсруулагдсан");
                Ui.Render(h.Window, "06b-wpf-drop");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void MoveRenumber_FollowsOriginalSequence()
        {
            using (Harness h = Harness.Open())
            {
                // «Зөөхөд дугаарыг дагуулж шинэчлэх» — унтраалттай үед чирсэн дараалал дугаар өөрчлөхгүй.
                h.Vm.DropRows(new[] { 204L }, 0);
                h.Settle();
                Ui.Check(!h.Vm.CanApply || !h.Vm.Plan.HasChanges || h.Vm.Settings.EffectiveMode != EffectiveMode.Move, "Move горим өөрөө асах ёсгүй");

                // Дараалал бохирдсон үед горимыг АСААХ боломжгүй (эзний дүрэм).
                Ui.Check(!h.Vm.CanToggleMoveRenumber, "бохир дараалалд Move-ийг асаах боломжтой болсон");
                h.Vm.MoveRenumber = true;
                Ui.Check(!h.Vm.MoveRenumber, "бохир дараалалд Move асчихлаа");

                // Reset-ээр цэвэрлээд асаана.
                h.Vm.ResetOrderCommand.Execute(null);
                Ui.Check(h.Vm.CanToggleMoveRenumber, "цэвэр дараалалд Move-ийг асаах боломжгүй");
                h.Vm.MoveRenumber = true;
                Ui.Check(h.Vm.MoveRenumber, "Move асаагүй");

                // Одоо чирэхэд дугааруудын АНХНЫ дараалал байрлалд нь үлдэнэ: 204-ийг эхэнд → K-004 нь K-001-ийн дугаарыг авна.
                h.Vm.DropRows(new[] { 204L }, 0);
                h.Settle();
                Ui.Eq("K-001,K-002,K-003,K-004", string.Join(",", h.Vm.Plan.Rows.Select(r => r.NewNumber)), "байрлалын дугаарууд (энэ нь жагсаалтын дарааллаар)");
                Ui.Eq(204L, h.Vm.Plan.Rows[0].Sheet.SheetId, "эхний мөр = K-004 хуудас");
                Ui.Eq("K-001", h.Vm.Plan.Rows[0].NewNumber, "K-004 хуудас K-001 дугаарыг авсан");
                Ui.Check(h.Vm.CanApply, "Хэрэгжүүлэх боломжтой байх ёстой: " + h.Vm.StatusText);
                Ui.Check(!h.Vm.NumberingControlsEnabled, "Move үед энгийн дугаарлалтын талбарууд идэвхтэй байна");
                Ui.Render(h.Window, "07-move-renumber");

                // Apply — ЦИКЛ ШИЛЖИЛТ (swap) тул түр дугаар хэрэгтэй, гэхдээ gateway-д НЭГ хүсэлт.
                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Eq(1, h.Gateway.ApplyCount, "нэг Apply");
                SheetSnapshot s204 = h.Gateway.Doc.FindSheet(204);
                SheetSnapshot s201 = h.Gateway.Doc.FindSheet(201);
                Ui.Eq("K-001", s204.Number, "K-004 хуудас шинэ дугаар");
                Ui.Eq("K-002", s201.Number, "K-001 хуудас шинэ дугаар");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void ApplyFailures_AreShownVerbatim_AndKeepOrder()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.SimplePrefix = "Z-";
                h.Settle();
                Ui.Check(h.Vm.CanApply, "Apply идэвхтэй байх ёстой");

                h.Gateway.ForcedApply = new ApplyResult
                {
                    Outcome = ApplyOutcome.RolledBack,
                    Message = Msg.ApplyRolledBack("Зарим хуудас өөрчлөгдөөгүй"),
                    RollbackVerified = true,
                };
                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Eq(1, h.Prompts.Errors.Count, "алдааны цонх гарах ёстой");
                Ui.Contains(h.Prompts.Errors[0], "Зарим хуудас өөрчлөгдөөгүй", "буцаалтын шалтгаан");
                Ui.Eq(1, h.Gateway.LoadCount, "RolledBack үед жагсаалт дахин ачаалахгүй (төлөв нь анхных)");
                Ui.Eq(RowState.Error, h.Vm.StatusState, "төлөвийн мөр");

                h.Gateway.ForcedApply = new ApplyResult { Outcome = ApplyOutcome.Blocked, Message = Msg.WorksharingBlocked };
                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Eq(2, h.Prompts.Errors.Count, "worksharing алдаа");
                Ui.Contains(h.Prompts.Errors[1], "Зарим хуудсыг өөрчлөх боломжгүй байна", "worksharing мессеж");

                // Буцаалтыг баталгаажуулж чадаагүй: ХЭЗЭЭ Ч «юу ч хадгалагдсангүй» гэж хэлэхгүй, бодит төлөвийг дахин уншина.
                h.Gateway.ForcedApply = new ApplyResult { Outcome = ApplyOutcome.RollbackUnverified, Message = Msg.RollbackUnverified };
                int loads = h.Gateway.LoadCount;
                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Eq(3, h.Prompts.Errors.Count, "RollbackUnverified алдаа");
                Ui.Check(!h.Prompts.Errors[2].Contains("юу ч хадгалагдсангүй") || h.Prompts.Errors[2].Contains("шалга"), "буцаалт баталгаажаагүй мессеж");
                Ui.Eq(loads + 1, h.Gateway.LoadCount, "бодит төлвийг дахин уншсан");
                Ui.Render(h.Window, "08-apply-failed");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Stale_Banner_DisablesApply_UntilRefresh()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.SimplePrefix = "Z-";
                h.Settle();
                Ui.Check(h.Vm.CanApply, "Apply идэвхтэй байх ёстой");

                // Гаднаас (өөр хүн / Revit-ийн Project Browser) нэг хуудасны дугаар солигдов.
                h.Gateway.Doc.FindSheet(203).Number = "K-003-REV";
                Ui.Wait(h.Vm.CheckFreshnessAsync());
                Ui.Check(h.Vm.IsStale, "хуучирсан гэж илрээгүй");
                Ui.Check(h.Vm.HasBanner, "баннер гараагүй");
                Ui.Contains(h.Vm.BannerText, "өөрчлөгдсөн байна", "баннер");
                Ui.Check(!h.Vm.CanApply, "хуучирсан үед Apply идэвхтэй");
                Ui.Render(h.Window, "09-stale");

                // Шинэчилбэл (дараалал бохирдоогүй тул асуулгагүй) баннер арилна.
                h.Vm.RefreshCommand.Execute(null);
                Ui.PumpUntil(() => !h.Vm.IsBusy, 3000, "refresh");
                Ui.Pump(100);
                Ui.Check(!h.Vm.IsStale && !h.Vm.HasBanner, "шинэчилсний дараа баннер үлдсэн");
                Ui.Check(h.Numbers().Contains("K-003-REV"), "шинэ дугаар ачаалагдаагүй");

                // Хуудас гаднаас устсан → Apply-ийн мөр алдаатай (Stale outcome) → баннер.
                h.Vm.SimplePrefix = "Y-";
                h.Settle();
                h.Gateway.Doc.Sheets = h.Gateway.Doc.Sheets.Where(s => s.SheetId != 201).ToList();
                Ui.Wait(h.Vm.ApplyAsync());
                Ui.Check(h.Vm.IsStale, "устсан хуудас Stale болгоогүй");
                Ui.Eq(0, h.Gateway.Doc.Sheets.Count(s => s.Number.StartsWith("Y-", StringComparison.Ordinal)), "Stale үед юу ч бичигдсэнгүй");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void AdvancedTab_ThreeParts_Preview()
        {
            using (Harness h = Harness.Open())
            {
                h.SelectGroup("АРХ");
                h.Vm.NumberingTabIndex = 1;
                h.Vm.Part1.Enabled = true;
                h.Vm.Part1.Prefix = "AR";
                h.Vm.Part1.ValueMode = h.Vm.Part1.ValueModes.First(m => m.Value == PartValueMode.Fixed);
                h.Vm.Part1.StartText = "1";
                h.Vm.Part1.WidthText = "2";
                h.Vm.Part2.Enabled = true;
                h.Vm.Part2.ValueMode = h.Vm.Part2.ValueModes.First(m => m.Value == PartValueMode.Increment);
                h.Vm.Part2.StartText = "1";
                h.Vm.Part2.WidthText = "2";
                h.Vm.Part2.LimitText = "3";
                h.Vm.Part2.Wrap = false;
                h.Vm.Separator1 = ".";
                h.Settle();

                // 6 хуудас, хязгаар 3, wrap=false → 4-р мөрөөс АЛДАА (чимээгүй таслахгүй).
                Ui.Eq("AR01.01", h.Vm.Rows[0].NewNumberDisplay, "эхний мөр");
                Ui.Eq("AR01.03", h.Vm.Rows[2].NewNumberDisplay, "3-р мөр");
                Ui.Eq(RowState.Error, h.Vm.Rows[3].State, "хязгаар давсан мөр");
                Ui.Check(!h.Vm.CanApply, "хязгаар давсан үед Apply идэвхтэй");
                Ui.Render(h.Window, "10-advanced-limit");

                h.Vm.Part2.Wrap = true;
                h.Vm.Part1.ValueMode = h.Vm.Part1.ValueModes.First(m => m.Value == PartValueMode.Increment);
                h.Settle();
                Ui.Eq("AR01.01", h.Vm.Rows[0].NewNumberDisplay, "wrap 1");
                Ui.Eq("AR02.01", h.Vm.Rows[3].NewNumberDisplay, "wrap — өмнөх хэсэг нэмэгдэнэ");
                Ui.Render(h.Window, "11-advanced-wrap");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void ShiftNumericPart_IncreaseDecrease()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.ShiftValueText = "2";
                h.Vm.ShiftIncreaseOn = true;
                h.Settle();
                Ui.Eq("K-003,K-004,K-005,K-006", string.Join(",", h.NewNumbers()), "+2");
                Ui.Check(h.Vm.HasModeHint, "горимын тайлбар гарах ёстой");
                Ui.Render(h.Window, "12-shift");

                h.Vm.ShiftValueText = "5";
                h.Vm.ShiftDecreaseOn = true;   // Өсгөх автоматаар унтрана
                h.Settle();
                Ui.Check(!h.Vm.ShiftIncreaseOn, "Өсгөх-ийг унтраагаагүй");
                // K-001 − 5 → K--004 (сөрөг тоо), нөхцөл шалгалтаар АНХААРУУЛГА/АЛДАА байж болно — зөвхөн гаралтыг шалгана.
                Ui.Check(h.Vm.Rows[0].NumberWillChange, "−5 нь дугаарыг өөрчлөөгүй");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void AllInOneMode_ShowsEverySheet_AndSortsByName()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.IsAllInOneMode = true;
                Ui.Pump(80);
                Ui.Check(!h.Vm.ShowTree, "нэг бүлэгт мод харагдаж байна");
                int visible = h.Vm.Rows.Count;
                Ui.Eq(h.Gateway.Doc.Sheets.Count, visible, "«Бүгдийг нэг бүлэгт» бүх хуудас (нуугдсан, assembly, placeholder-тай)");
                Ui.Check(h.Vm.CanSortByName, "нэрээр эрэмбэлэх идэвхжээгүй");

                h.Vm.SortByName = true;
                Ui.Pump(80);
                string[] names = h.Vm.Rows.Select(r => r.Sheet.Name).ToArray();
                string[] sorted = names.OrderBy(n => n, new NaturalComparer()).ToArray();
                Ui.Eq(string.Join("|", sorted), string.Join("|", names), "нэрээр эрэмбэлсэн дараалал");
                Ui.Render(h.Window, "13-all-in-one");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void ContextActions_Rename_And_Delete()
        {
            using (Harness h = Harness.Open())
            {
                SheetRowViewModel row = h.Vm.Rows.First(r => r.SheetId == 203);
                h.Prompts.TextAnswer = "Хөндлөвчний схем (шинэчилсэн)";
                Ui.Wait(h.Vm.RenameAsync(row));
                Ui.Eq(1, h.Gateway.RenameCount, "нэр өөрчлөх дуудлага");
                Ui.Eq("Хөндлөвчний схем (шинэчилсэн)", h.Gateway.Doc.FindSheet(203).Name, "модель дахь нэр");
                Ui.Eq("Хөндлөвчний схем (шинэчилсэн)", h.Vm.Rows.First(r => r.SheetId == 203).Sheet.Name, "жагсаалт шинэчлэгдсэн");

                row = h.Vm.Rows.First(r => r.SheetId == 204);
                h.Prompts.ConfirmAnswer = false;
                Ui.Wait(h.Vm.DeleteAsync(row));
                Ui.Eq(0, h.Gateway.DeleteCount, "баталгаагүй устгал хийгдсэн");
                Ui.Contains(h.Prompts.Confirms.Last(), "K-004", "устгах баталгаанд дугаар");
                Ui.Contains(h.Prompts.Confirms.Last(), "Арматурын задлал", "устгах баталгаанд нэр");

                h.Prompts.ConfirmAnswer = true;
                Ui.Wait(h.Vm.DeleteAsync(row));
                Ui.Eq(1, h.Gateway.DeleteCount, "устгал");
                Ui.Check(h.Gateway.Doc.FindSheet(204) == null, "хуудас устаагүй");
                Ui.Check(h.Vm.Rows.All(r => r.SheetId != 204), "жагсаалтад устсан хуудас үлдсэн");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Delete_WithPendingOrder_WarnsInConfirmation_AndKeepsTheOrder()
        {
            using (Harness h = Harness.Open())
            {
                // 1) Дараалал «цэвэр» үед баталгаанд нэмэлт сануулга ГАРАХГҮЙ.
                Ui.Check(!h.Vm.IsOrderDirty, "эхлэхэд дараалал цэвэр байх ёстой");
                h.Prompts.ConfirmAnswer = false;
                Ui.Wait(h.Vm.DeleteAsync(h.Vm.Rows.Last()));
                Ui.Check(!h.Prompts.Confirms.Last().Contains("хэвээр үлдэнэ"), "цэвэр дараалалтай үед хуурамч сануулга гарсан");

                // 2) Дараалал «бохир» болмогц сануулга гарна; татгалзвал юу ч өөрчлөгдөхгүй.
                h.Vm.MoveUpCommand.Execute(null);   // идэвхтэй хуудас (K-002) дээш
                Ui.Check(h.Vm.IsOrderDirty, "дараалал бохирдсон байх ёстой");
                long moved = h.Vm.SelectedIds.First();
                string[] orderBefore = h.Vm.Rows.Select(r => r.Sheet.Number).ToArray();
                SheetRowViewModel victim = h.Vm.Rows.Last(r => r.SheetId != moved);

                Ui.Wait(h.Vm.DeleteAsync(victim));
                Ui.Contains(h.Prompts.Confirms.Last(), victim.Sheet.Number, "устгах баталгаанд дугаар");
                Ui.Contains(h.Prompts.Confirms.Last(), "хэвээр үлдэнэ", "бохир дараалалтай үед баталгаанд сануулга байх ёстой");
                Ui.Eq(0, h.Gateway.DeleteCount, "баталгаагүй устгал хийгдсэн");
                Ui.Eq(string.Join(",", orderBefore), string.Join(",", h.Vm.Rows.Select(r => r.Sheet.Number)), "татгалзсаны дараа дараалал");

                // 3) Зөвшөөрвөл: устсан хуудас л хасагдаж, зөөсөн дараалал ХЭВЭЭР (чимээгүй устгагдаж/дахин суурилагдаагүй).
                h.Prompts.ConfirmAnswer = true;
                Ui.Wait(h.Vm.DeleteAsync(victim));
                Ui.Eq(1, h.Gateway.DeleteCount, "устгал");
                Ui.Eq(string.Join(",", orderBefore.Where(n => n != victim.Sheet.Number)), string.Join(",", h.Vm.Rows.Select(r => r.Sheet.Number)),
                    "устгасны дараах дараалал (зөөсөн байрлал хэвээр)");
                Ui.Check(h.Vm.IsOrderDirty, "устгасны дараа ч дараалал «бохир» хэвээр байх ёстой");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void CloseWhenDirty_AsksConfirmation()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.MoveUpCommand.Execute(null);
                Ui.Check(h.Vm.IsOrderDirty, "дараалал бохирдсон байх ёстой");

                h.Prompts.ConfirmAnswer = false;
                h.Window.Close();
                Ui.Pump(80);
                Ui.Check(h.Window.IsVisible, "баталгаагүй хаагдсан");
                Ui.Contains(h.Prompts.Confirms.Last(), "хадгалагдаагүй", "хаалтын баталгаа");

                h.Prompts.ConfirmAnswer = true;
                h.Window.Close();
                Ui.Pump(80);
                Ui.Check(!h.Window.IsVisible, "баталгаатай ч хаагдсангүй");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void HidePreview_TogglesLabel_AndClearsNewColumn()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.SimplePrefix = "K-";
                h.Vm.SimpleStartText = "20";
                h.Settle();
                Ui.Eq("Урьдчилсан өөрчлөлтийг нуух", h.Vm.HidePreviewLabel, "шошго (идэвхтэй)");
                Ui.Check(h.Vm.Rows[0].NumberWillChange, "урьдчилсан өөрчлөлт харагдах ёстой");

                h.Vm.HidePreview = true;
                Ui.Eq("Урьдчилсан өөрчлөлтийг харуулах", h.Vm.HidePreviewLabel, "шошго (нуусан)");
                Ui.Check(!h.Vm.Rows[0].NumberWillChange, "нуусан үед шинэ дугаар үлдсэн");
                Ui.Check(h.Vm.CanApply, "нуух нь Apply-г хаахгүй (зөвхөн харагдац)");
                Ui.Render(h.Window, "14-preview-hidden");
                h.Vm.HidePreview = false;
                Ui.Check(h.Vm.Rows[0].NumberWillChange, "дахин харуулахад буцаж гарна");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void UnicodeMarkers_FirstUseWarning_ProbeAndEscapedDisplay()
        {
            var doc = Docs.Typical();
            // К хавтсанд ИЖИЛ дугаартай хоёр хуудас (давхардал) — тэмдэг ашиглан ялгана.
            using (Harness h = Harness.Open(doc))
            {
                h.Gateway.Markers = new MarkerCapabilities { IsProbed = true };
                h.Gateway.Markers.Accept('\u200B');
                h.Gateway.Markers.Accept('\u2060');

                // Анх удаа: анхааруулга → зөвшөөрвөл probe.
                h.Prompts.ConfirmAnswer = true;
                h.Vm.UseMarkers = true;
                Ui.PumpUntil(() => h.Vm.UseMarkers, 3000, "marker probe");
                Ui.Eq(1, h.Gateway.ProbeCount, "probe нэг л удаа");
                Ui.Contains(h.Prompts.Confirms.Last(), "Unicode", "анхны анхааруулга");
                Ui.Check(h.Vm.Prefs.UnicodeWarningAccepted, "анхааруулга зөвшөөрөгдсөн гэж хадгалагдаагүй");
                Ui.Check(h.Vm.MarkerOptions.Count >= 2, "хүлээн авсан тэмдгүүд жагсаалтад гараагүй");

                // Дахин асаахад анхааруулга ДАХИН гарахгүй.
                h.Vm.UseMarkers = false;
                int confirms = h.Prompts.Confirms.Count;
                h.Vm.UseMarkers = true;
                Ui.PumpUntil(() => h.Vm.UseMarkers, 3000, "marker re-enable");
                Ui.Eq(confirms, h.Prompts.Confirms.Count, "анхааруулга дахин гарсан");
                Ui.Eq(1, h.Gateway.ProbeCount, "probe дахин хийгдсэн");

                // Үл үзэгдэх тэмдэг агуулсан дугаар хэрэглэгчид escape хэлбэрээр харагдана.
                var row = new SheetRowViewModel(new SheetSnapshot { SheetId = 1, UniqueId = "u", Number = "A-01\u200B\u200B", Name = "x", BrowserPath = new FolderSegment[0] });
                Ui.Contains(row.CurrentNumber, "U+200B", "escape хэлбэр");
                Ui.Check(row.CurrentNumber.IndexOf('\u200B') < 0, "түүхий үл үзэгдэх тэмдэг дэлгэцэнд гарсан");
                Ui.Render(h.Window, "15-markers");

                // Сонгосон тэмдэг ComboBox-д ХАРАГДАХ ёстой (хоосон байж болохгүй) — жагсаалт probe, дахин идэвхжүүлэлтээр
                // хоёр удаа дахин байгуулагдсаны дараа ч.
                CheckShown(h, h.Vm.MarkerOptions, "U+200B  ZERO WIDTH SPACE", "тэмдгийн ComboBox", 0);

                // Өөр тэмдэг сонгоход Settings руу орно, жагсаалтыг дахин байгуулахад сонголт хэвээр.
                h.Vm.MarkerChar = '⁠';
                h.Vm.UseMarkers = false;
                h.Vm.UseMarkers = true;
                Ui.PumpUntil(() => h.Vm.UseMarkers, 3000, "marker re-enable 2");
                Ui.Pump(80);
                Ui.Eq('⁠', h.Vm.Settings.MarkerChar, "сонгосон тэмдэг хадгалагдсан");
                CheckShown(h, h.Vm.MarkerOptions, "U+2060  WORD JOINER", "тэмдгийн ComboBox (2-р сонголт)", 0);

                // Баруун самбарын ДООД хэсэг (нэр, Unicode, сануулга) — гүйлгээд харуулна.
                ScrollViewer right = Ui.Descendants<ScrollViewer>(h.Window).First(s => Grid.GetColumn(s) == 2);
                right.ScrollToEnd();
                Ui.Pump(100);
                Ui.Render(h.Window, "15b-right-bottom");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Large_600Sheets_PreviewStaysResponsive()
        {
            using (Harness h = Harness.Open(Docs.Large(600)))
            {
                Ui.Eq(600, h.Vm.Rows.Count, "ачаалсан мөр");
                h.Vm.SimplePrefix = "P-";
                h.Vm.SimpleWidthText = "4";
                h.Vm.RequestRecompute(true);

                var sw = Stopwatch.StartNew();
                const int runs = 20;
                for (int i = 0; i < runs; i++)
                {
                    h.Vm.SimpleStartText = (100 + i).ToString();
                    h.Vm.Recompute();
                }
                sw.Stop();
                double per = sw.Elapsed.TotalMilliseconds / runs;
                Console.WriteLine("       600 хуудас: нэг preview ≈ " + per.ToString("0.0") + " мс");
                Ui.Check(per < 250, "preview удаан: " + per + " мс");
                Ui.Check(h.Vm.CanApply, "600 хуудас дээр Apply идэвхгүй: " + h.Vm.StatusText);

                // Жагсаалт виртуалчлагдсан эсэх (600 мөр бүгд visual үүсгэхгүй).
                int containers = Ui.Descendants<ListViewItem>(h.List).Count();
                Console.WriteLine("       ListViewItem visual: " + containers + " / 600");
                Ui.Check(containers < 200, "жагсаалт виртуалчлагдаагүй: " + containers);
                Ui.Render(h.Window, "16-large");
            }
        }

        // ─────────────────────────────────────────────────────────────
        public static void Busy_BlocksReentrantApply_AndShowsProgress()
        {
            using (Harness h = Harness.Open())
            {
                h.Vm.SimplePrefix = "B-";
                h.Settle();
                Ui.Check(h.Vm.CanApply, "Apply идэвхтэй байх ёстой: " + h.Vm.StatusText);

                h.Gateway.DelayMs = 200;
                System.Threading.Tasks.Task first = h.Vm.ApplyAsync();
                Ui.Pump(40);
                Ui.Check(h.Vm.IsBusy, "Apply явж байхад IsBusy false");
                Ui.Check(!h.Vm.CanApply, "Apply явж байхад дахин дарах боломжтой");
                Ui.Check(!h.Vm.NumberingControlsEnabled, "Apply явж байхад талбарууд идэвхтэй");
                Ui.Check(!string.IsNullOrEmpty(h.Vm.BusyText), "явцын текст алга");
                Ui.Render(h.Window, "14b-busy");

                // Давхар дарсан (эсвэл гараар дуудсан) Apply юу ч хийхгүй.
                System.Threading.Tasks.Task second = h.Vm.ApplyAsync();
                Ui.Wait(second);
                Ui.Wait(first);
                Ui.Eq(1, h.Gateway.ApplyCount, "давхар Apply хийгдсэн");
                Ui.Check(!h.Vm.IsBusy, "дууссаны дараа IsBusy үлдсэн");
            }
        }

        // ─────────────────────────────────────────────────────────────
        /// <summary>
        /// ComboBox-ийн сонголт жагсаалтыг дахин байгуулсны дараа ХООСОН харагдах ёсгүй (SelectedItem-ийг хуучин жагсаалтын
        /// объект барьсан хэвээр SelectedIndex = -1 болдог WPF-ийн тохиолдол).  Параметрийн жагсаалт document-ийг дахин
        /// уншихад, эх сурвалжийн жагсаалт горим солиход, тэмдгийн жагсаалт probe хийхэд дахин байгуулагдана.
        /// </summary>
        public static void Combos_StayVisiblySelected_AfterRebuilds()
        {
            using (Harness h = Harness.Open())
            {
                ParameterOption issue = h.Vm.SourceParameterOptions.First(o => o.Info != null && o.Info.DisplayName == "Issue Code");
                ParameterOption count = h.Vm.TargetParameterOptions.First(o => o.Info != null && o.Info.DisplayName == "Group Count");

                h.Vm.UseParameterPrefix = true;
                h.Vm.PrefixParameter = issue;
                h.Vm.WriteResult = true;
                h.Vm.ResultParameter = h.Vm.TargetParameterOptions.First(o => o.Info != null && o.Info.DisplayName == "Issue Code");
                h.Vm.WriteGroupCount = true;
                h.Vm.CountParameter = count;
                h.Settle();

                CheckShown(h, h.Vm.SourceParameterOptions, "Issue Code", "угтвар параметр (эхний)", 0);
                CheckShown(h, h.Vm.TargetParameterOptions, "Issue Code", "үр дүнгийн параметр (эхний)", 0);

                // 1) document-ийг дахин уншина → параметрийн жагсаалт ШИНЭ объектоор дахин байгуулагдана.
                Ui.Wait(h.Vm.RefreshAsync());
                Ui.Pump(120);
                CheckShown(h, h.Vm.SourceParameterOptions, "Issue Code", "угтвар параметр (шинэчилсний дараа)", 0);
                CheckShown(h, h.Vm.TargetParameterOptions, "Issue Code", "үр дүнгийн параметр (шинэчилсний дараа)", 0);
                CheckShown(h, h.Vm.TargetParameterOptions, "Group Count", "тооны параметр (шинэчилсний дараа)", 1);

                // 2) Нарийвчилсан горим → эх сурвалжийн жагсаалт өргөснө (Хэсэг 2, 3 нэмэгдэнэ); Part2Full сонгоно.
                h.Vm.NumberingTabIndex = 1;
                Ui.Pump(80);
                h.Vm.ResultSource = h.Vm.SourceOptions.First(o => o.Value == GeneratedValueSource.Part2Full);
                h.Settle();
                CheckShown(h, h.Vm.SourceOptions, "Хэсэг 2 (бүтэн)", "эх сурвалж (нарийвчилсан)", 0);

                // 3) Энгийн рүү буцахад Хэсэг 2 эх сурвалж хасагдаж (Энгийн = зөвхөн Бүтэн / Хэсэг 1), «Бүтэн дугаар» руу буцна.
                h.Vm.NumberingTabIndex = 0;
                Ui.Pump(120);
                CheckShown(h, h.Vm.SourceOptions, "Бүтэн дугаар", "эх сурвалж (энгийн рүү буцсан)", 0);

                // 4) Энгийн дотор Хэсэг 1-ийг сонгоод Нарийвчилсан руу, буцаад — Хэсэг 1 хоёуланд хүчинтэй тул ХЭВЭЭР.
                h.Vm.ResultSource = h.Vm.SourceOptions.First(o => o.Value == GeneratedValueSource.Part1Full);
                h.Vm.NumberingTabIndex = 1;
                Ui.Pump(80);
                h.Vm.NumberingTabIndex = 0;
                Ui.Pump(80);
                CheckShown(h, h.Vm.SourceOptions, "Хэсэг 1 (бүтэн)", "эх сурвалж (Хэсэг 1 хоёр горимд хүчинтэй)", 0);

                Ui.Render(h.Window, "18-combos-after-rebuilds");
            }
        }

        private static void CheckShown<T>(Harness h, IReadOnlyList<T> source, string expectedText, string what, int which)
        {
            List<ComboBox> combos = Ui.Descendants<ComboBox>(h.Window).Where(c => ReferenceEquals(c.ItemsSource, source)).ToList();
            Ui.Check(combos.Count > which, what + ": ComboBox олдсонгүй (" + combos.Count + ")");
            ComboBox cb = combos[which];
            string diag = " [items=" + cb.Items.Count + " idx=" + cb.SelectedIndex + " selected=«" + cb.SelectedItem + "» box=«" + cb.SelectionBoxItem
                + "» vmResult=«" + h.Vm.ResultSource + "» vmName=«" + h.Vm.NameSource + "»]";
            Ui.Check(cb.SelectedIndex >= 0, what + ": SelectedIndex = " + cb.SelectedIndex + " (хоосон харагдана)" + diag);
            Ui.Eq(expectedText, Convert.ToString(cb.SelectionBoxItem) ?? string.Empty, what + ": харагдаж буй текст" + diag);
        }

        // ─────────────────────────────────────────────────────────────
        public static void ParameterTargets_OnlyCompatibleOnesOffered()
        {
            using (Harness h = Harness.Open())
            {
                // Read-only «Sheet Issue Date» зорилтод САНАЛ БОЛГОХГҮЙ; текст/бүхэл тоо л.
                IEnumerable<string> targets = h.Vm.TargetParameterOptions.Where(o => o.Info != null).Select(o => o.Info.DisplayName);
                Ui.Check(!targets.Contains("Sheet Issue Date"), "read-only параметр зорилтод санал болгогдсон");
                Ui.Check(targets.Contains("Issue Code") && targets.Contains("Group Count"), "тохирох параметр жагсаалтад алга: " + string.Join(",", targets));

                // Параметрээс угтвар: Issue Code-той хуудас.
                h.SelectGroup("АРХ");
                h.Vm.UseParameterPrefix = true;
                h.Vm.PrefixParameter = h.Vm.SourceParameterOptions.First(o => o.Info != null && o.Info.DisplayName == "Issue Code");
                h.Vm.SimpleStartText = "1";
                h.Settle();
                // Issue Code хоосон хуудсууд АНХААРУУЛГА (алдаа биш) — Apply блоклохгүй.
                SheetRowViewModel noIssue = h.Vm.Rows.First(r => r.SheetId == 104);
                Ui.Check(noIssue.State == RowState.Warning || noIssue.State == RowState.Changed, "хоосон параметр алдаа болсон: " + noIssue.State);
                Ui.Eq("IFC-11", h.Vm.Rows[0].NewNumberDisplay, "параметрийн угтвар + дугаар");
                Ui.Render(h.Window, "17-parameter-prefix");
            }
        }
    }
}
