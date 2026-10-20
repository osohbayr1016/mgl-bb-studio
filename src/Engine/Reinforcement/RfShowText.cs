using System.Globalization;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Арматур харуулах» хоёр хэрэгслийн БҮХ харагдах текст (Монгол, нөөц Англи — <c>Lang.T</c>).  <c>RfText</c>-ээс тусдаа файл нь санаатай:
    /// энэ хэрэгсэл бусад «Арматур» хэрэгслийн засвартай нэг файлд зөрчилдөхгүй.
    /// </summary>
    internal static class RfShowText
    {
        private static string T(string mn, string en) { return Lang.T(mn, en); }

        private static string F(string fmt, params object[] args)
        {
            return string.Format(CultureInfo.CurrentCulture, fmt, args);
        }

        // ── Нэр ──────────────────────────────────────────────────────────
        public static string EdgesTitle { get { return T("MGL — Захын, голын арматур харуулах", "MGL — Show edge and middle bars"); } }
        public static string PickTitle { get { return T("MGL — Арматурын ширхэг харуулах", "MGL — Choose visible rebar bars"); } }

        // ── «Захын, голын арматур» цонх (2026-10-05) ──────────────────────
        public static string EdgesHeader { get { return T("Захын, голын арматур", "Edge and middle bars"); } }
        public static string EdgesApply { get { return T("Хэрэглэх", "Apply"); } }
        public static string EdgesNothingChosen { get { return T("Ядаж нэг ширхэг (эхний, сүүлийн, голын) сонгоно уу.", "Choose at least one of first, last or middle."); } }
        public static string EdgesIntro(int rebars)
        {
            return F(T("Харагдацын бүх арматурын олонлог ({0})-оос зөвхөн сонгосон ширхгийг үлдээж бусдыг нууна.  Ганц, 2 ширхэгтэй олонлогт хүрэхгүй.  Нэг Ctrl+Z-ээр буцна.",
                "Keeps only the chosen bars of every rebar set in the view ({0}) and hides the rest.  Single and 2-bar sets are left alone.  Undo with one Ctrl+Z."), rebars);
        }

        // ── Нийтлэг ─────────────────────────────────────────────────────
        public static string NoRebarInView { get { return T("Энэ харагдацад арматур алга.", "There is no rebar in this view."); } }
        public static string NoNearestBar { get { return T("дарсан цэгт ойр ширхэг тодорхойлогдсонгүй (геометр уншигдсангүй)", "could not tell which bar was clicked (geometry unreadable)"); } }

        // ── Тайлан ──────────────────────────────────────────────────────
        public static string Done { get { return T("Арматурын харагдац шинэчлэгдлээ", "Rebar presentation updated"); } }
        public static string Nothing { get { return T("Өөрчлөгдсөн зүйл алга", "Nothing changed"); } }
        public static string Ctrlz { get { return T("Нэг Ctrl+Z-ээр буцаана.", "Undo with a single Ctrl+Z."); } }

        public static string Result(RfShowReport r)
        {
            string s = r.IsReset
                ? F(T("Бүх ширхэгтэй болгосон: {0}  ·  Арматур: {1}", "Restored to all bars: {0}  ·  Rebars: {1}"), r.Changed, r.Rebars)
                : F(T("Өөрчилсөн олонлог: {0}  ·  Арматур: {1}", "Sets changed: {0}  ·  Rebars: {1}"), r.Changed, r.Rebars);
            if (r.AlreadyOk > 0) s += "\n" + F(T("Аль хэдийн ийм байсан (хөндөөгүй): {0}", "Already like this (left alone): {0}"), r.AlreadyOk);
            if (r.Small > 0) s += "\n" + F(T("Ганц эсвэл 2 ширхэгтэй (хөндөөгүй): {0}", "Single or 2-bar (left alone): {0}"), r.Small);
            if (r.CannotApply > 0) s += "\n" + F(T("Энэ харагдацад олонлогийн харагдац тохируулах боломжгүй (алгассан): {0}", "Presentation cannot be changed in this view (skipped): {0}"), r.CannotApply);
            if (r.Empty > 0) s += "\n" + F(T("Харуулах ширхэг сонгогдоогүй (алгассан): {0}", "No bar selected to show (skipped): {0}"), r.Empty);
            if (r.OffsetOutOfRange > 0) s += "\n" + F(T("«Голоос N дэх» ширхэг олонлогийн хүрээнд багтаагүй: {0}", "\"N from the middle\" fell outside the set: {0}"), r.OffsetOutOfRange);
            return s;
        }

        /// <summary>Дарж сонгох давталтын prompt-д харагдах товч дүн.</summary>
        public static string LastClick(RfShowReport r)
        {
            if (r.Changed > 0) return T("шинэчлэгдлээ", "updated");
            if (r.Small > 0) return T("ганц/2 ширхэгтэй — хөндөөгүй", "single/2-bar — left alone");
            if (r.AlreadyOk > 0) return T("аль хэдийн ийм", "already like this");
            if (r.CannotApply > 0) return T("энд тохируулах боломжгүй", "cannot be changed here");
            if (r.Empty > 0) return T("харуулах ширхэг сонгогдоогүй", "no bar selected to show");
            if (r.Failures.Count > 0) return T("алдаа", "error");
            return T("өөрчлөгдөөгүй", "unchanged");
        }

        public static string PickBarPrompt(int clicks, string last)
        {
            string head = T("Харуулах ширхэг дээр дарна (олонлогийн нэг ширхэг)", "Click the bar you want shown (one bar of a set)");
            string tail = clicks == 0 ? string.Empty : "  ·  " + F(T("Дарсан: {0}, сүүлийнх: {1}", "Clicks: {0}, last: {1}"), clicks, last);
            return head + tail + "  ·  " + T("Esc = цонх руу буцах", "Esc = back to the dialog");
        }

        public static string PickRebarsPrompt
        {
            get { return T("Тохиргоо хэрэглэх арматураа сонгоно (олныг — хүрээгээр / Ctrl), дараа нь «Finish»", "Select the rebar to apply to (many — window / Ctrl), then Finish"); }
        }

        // ── Цонх ────────────────────────────────────────────────────────
        public static string DlgHeader { get { return T("Олонлогийн (bar set) харагдах ширхэг", "Visible bars of a rebar set"); } }

        public static string DlgIntro
        {
            get
            {
                return T("Олонлог (bar set) бүрийн дотроос аль ширхгийг харуулахаа сонгоно: захын, голын, голоос хажуу тийш N дэх. Ганц болон 2 ширхэгтэй олонлогт хэзээ ч хүрэхгүй.",
                    "Choose which bars of each rebar set stay visible: the edges, the middle, the N-th from the middle. Single and 2-bar sets are never touched.");
            }
        }

        public static string ShowSection { get { return T("Харуулах ширхэг", "Bars to show"); } }
        public static string First { get { return T("Эхний ширхэг", "First bar"); } }
        public static string Last { get { return T("Сүүлийн ширхэг", "Last bar"); } }
        public static string Middle { get { return T("Голын ширхэг", "Middle bar"); } }
        public static string OffsetLabel { get { return T("Голоос хажуу тийш N дэх ширхэг:", "N-th bar sideways from the middle:"); } }
        public static string OffsetHint { get { return T("Жишээ: 2  эсвэл  1, 3  (хоосон = байхгүй). Гол заавал харагдах албагүй — энд тоо бичихэд «Голын ширхэг»-ийн чагт автоматаар арилна (хэрэгтэй бол дахин чагтлана).  Бүх ширхэг харагдаж байгаа (хөндөөгүй) олонлогт «хадгалах» чагт юу ч нэмэхгүй.", "e.g. 2  or  1, 3  (empty = none). The middle bar need not be shown — typing a number here unticks \"Middle bar\" (tick it again if needed).  On an untouched set (all bars visible) \"keep\" adds nothing."); } }
        public static string SideLabel { get { return T("Аль талд:", "Which side:"); } }
        public static string SideBoth { get { return T("Хоёр талд", "Both sides"); } }
        public static string SideStart { get { return T("Эхний ширхгийн талд", "First-bar side"); } }
        public static string SideEnd { get { return T("Сүүлийн ширхгийн талд", "Last-bar side"); } }
        public static string Keep { get { return T("Өмнө сонгосон (харагдаж буй) ширхгүүдийг хадгалах — дээр нь нэмнэ", "Keep the bars chosen earlier (add on top)"); } }

        public static string PreviewLabel { get { return T("Урьдчилан харах — ширхэгийн тоо:", "Preview — number of bars:"); } }
        public static string PreviewVisible(int n, string numbers) { return F(T("{0} ширхэгтэй олонлогт харагдах №: {1}", "In a set of {0} bars, shown bar numbers: {1}"), n, numbers); }
        public static string PreviewNothing { get { return T("Харуулах ширхэг сонгогдоогүй байна.", "No bar is selected to show."); } }
        public static string PreviewOutOfRange(string ks) { return T("Хүрээнд багтаагүй: ", "Out of range: ") + ks; }
        public static string PreviewMiddleNote { get { return T("Ширхэгийн тоо тэгш үед гол = сүүлийн талын төв ширхэг.", "With an even count, the middle is the centre bar on the last-bar side."); } }

        public static string ApplySection { get { return T("Хэрэглэх", "Apply"); } }
        public static string BtnPickRebars { get { return T("Арматур сонгож хэрэглэх…", "Select rebar and apply…"); } }
        public static string BtnPickRebarsHint { get { return T("Урьдчилан сонгосон арматур байвал шууд тэдэнд, үгүй бол сонгуулна. Бүгд нэг Ctrl+Z.", "Uses the rebar already selected; otherwise asks you to select. One Ctrl+Z."); } }
        public static string BtnClick { get { return T("Ширхэг дарж сонгох…", "Click bars one by one…"); } }
        public static string BtnClickHint { get { return T("Олонлогийн ширхэг дээр дарахад тэр ширхэг дээрх тохиргоонд нэмэгдэж харагдана. Дарах бүр тусдаа Ctrl+Z; Esc = буцах.", "Click a bar of a set to add it to the settings above. Each click is its own Ctrl+Z; Esc = back."); } }
        public static string BtnView { get { return T("Харагдацын БҮХ арматурт хэрэглэх", "Apply to ALL rebar in the view"); } }
        public static string BtnViewHint { get { return T("Идэвхтэй харагдацад харагдах бүх олонлогт. Нэг Ctrl+Z.", "To every set visible in the active view. One Ctrl+Z."); } }

        public static string ResetSection { get { return T("Буцаах", "Restore"); } }
        public static string BtnResetPicked { get { return T("Сонгосон арматурыг бүх ширхэгтэй болгох…", "Restore selected rebar to all bars…"); } }
        public static string BtnResetView { get { return T("Харагдацын бүх арматурыг бүх ширхэгтэй болгох", "Restore ALL rebar in the view to all bars"); } }

        public static string StatusLabel { get { return T("Сүүлийн үйлдэл:", "Last action:"); } }
        public static string BadOffsets { get { return T("«Голоос N дэх» талбарт 1–999 бүхэл тоо оруулна (таслал, зайгаар тусгаарлана).", "Enter whole numbers 1–999 in the \"N-th from the middle\" field (comma or space separated)."); } }
        public static string NothingChosen { get { return T("Харуулах ширхэг сонгоогүй байна — эхний, сүүлийн, голын ширхгийн аль нэгийг чагтлах, «Голоос N» оруулах, эсвэл «Одоо харагдаж буйг хадгалах»-ыг чагтална уу.", "No bar is chosen to show — tick first, last or middle, enter \"N from the middle\", or tick \"Keep the bars visible now\"."); } }
        public static string Close { get { return T("Хаах", "Close"); } }

        public static string ResetCountNote(int rebars) { return F(T("Сонгосон арматур: {0}", "Selected rebar: {0}"), rebars); }
        public static string PreselectedNote(int rebars) { return F(T("Урьдчилан сонгосон арматур: {0}", "Rebar already selected: {0}"), rebars); }
        public static string Error(string msg) { return F(T("Алдаа: {0}", "Error: {0}"), msg); }
    }
}
