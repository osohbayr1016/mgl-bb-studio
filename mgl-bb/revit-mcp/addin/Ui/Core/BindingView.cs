using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  «Ажилтай холбох» цонхны ЦЭВЭР төлөв (Revit/WPF-гүй, `tests/MglUi.Tests`-д тестлэгдэнэ).
    //
    //  Яагаад: хуучин «Бүгдийг батлах» товч ЗААВАЛ БИШ мөрийг «алгассан» гэж чимээгүй хадгалдаг байсан
    //  (чагтлаагүй = «алгассан» гэж хадгална), тоолуур нь «N / M холбогдохоор бэлэн» гэж ЗӨВХӨН нэг тоо харуулдаг, харин алгасахыг
    //  хаана ч хэлдэггүй байв.  Одоо хадгалахаас ӨМНӨ гурван тоо (холбогдох · алгасах · таскгүй) ил, хайлт/шүүлт бий.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>Нэг мөрийн төлөв — WPF-ийн `BindingRow`-оос хуулсан агшин.</summary>
    public struct BindingRowState
    {
        public bool IsChecked;
        public bool HasTask;
        /// <summary>Өмнө нь «ignored» гэж хадгалагдсан мөр.</summary>
        public bool WasIgnored;
        /// <summary>Өмнө нь «confirmed» гэж хадгалагдсан мөр.</summary>
        public bool WasConfirmed;
        public string SheetNumber;
        public string SheetName;
    }

    public struct BindingCounts
    {
        public int Total;
        /// <summary>Чагтлагдсан ба таск сонгосон — «холбогдоно».</summary>
        public int ToLink;
        /// <summary>Чагтлаагүй — «алгассан» гэж хадгалагдана.</summary>
        public int ToIgnore;
        /// <summary>Чагтлагдсан боловч таск сонгоогүй — хадгалахыг хориглоно.</summary>
        public int CheckedNoTask;
        public int PreviouslyIgnored;
        public int PreviouslyConfirmed;

        public bool CanSave { get { return ToLink > 0 && CheckedNoTask == 0; } }
    }

    public enum BindingFilter
    {
        All = 0,
        ToLink = 1,
        ToIgnore = 2,
        NoTask = 3,
        PreviouslyIgnored = 4,
    }

    public static class BindingView
    {
        public static BindingCounts Count(IEnumerable<BindingRowState> rows)
        {
            var c = new BindingCounts();
            if (rows == null) return c;
            foreach (BindingRowState r in rows)
            {
                c.Total++;
                if (r.IsChecked && r.HasTask) c.ToLink++;
                else if (r.IsChecked && !r.HasTask) c.CheckedNoTask++;
                if (!r.IsChecked) c.ToIgnore++;
                if (r.WasIgnored) c.PreviouslyIgnored++;
                if (r.WasConfirmed) c.PreviouslyConfirmed++;
            }
            return c;
        }

        /// <summary>Шүүлт + хайлт.  Хайлт хуудасны дугаар, нэрийг кирилл↔латин үл ялгаж (`TextFold`) хайна.</summary>
        public static bool Matches(BindingRowState r, BindingFilter filter, string query)
        {
            switch (filter)
            {
                case BindingFilter.ToLink: if (!(r.IsChecked && r.HasTask)) return false; break;
                case BindingFilter.ToIgnore: if (r.IsChecked) return false; break;
                case BindingFilter.NoTask: if (r.HasTask) return false; break;
                case BindingFilter.PreviouslyIgnored: if (!r.WasIgnored) return false; break;
            }
            if (string.IsNullOrWhiteSpace(query)) return true;

            string hay = TextFold.Fold((r.SheetNumber ?? string.Empty) + " " + (r.SheetName ?? string.Empty));
            foreach (string token in TextFold.Fold(query).Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                if (hay.IndexOf(token, StringComparison.Ordinal) < 0) return false;
            return true;
        }

        /// <summary>Тоолуурын мөр: гурван тоо ХАМТ — «алгасна» гэдэг нь үл мэдэгдэх биш ил.</summary>
        public static string SummaryText(BindingCounts c)
        {
            return c.ToLink + " хуудас холбогдоно  ·  " + c.ToIgnore + " алгасна  ·  нийт " + c.Total;
        }

        /// <summary>Хадгалах товчны доорх тайлбар / хориглосон шалтгаан (хоосон = асуудалгүй).</summary>
        public static string SaveHint(BindingCounts c)
        {
            if (c.CheckedNoTask > 0)
                return c.CheckedNoTask + " мөр чагтлагдсан боловч ERP таск сонгоогүй байна — таскаа сонгох эсвэл чагтыг авна уу.";
            if (c.ToLink == 0)
                return "Холбох мөр чагтлаагүй байна — хамгийн багадаа нэг хуудсыг чагтална уу.";
            return string.Empty;
        }

        /// <summary>«Холбоос хадгалах» дарахад гарах баталгааны мөр (хадгалахаас ӨМНӨ — алгассан хэдийг ил хэлнэ).</summary>
        public static string SaveConfirmText(BindingCounts c)
        {
            return c.ToLink + " хуудас ERP-ийн ажилтай холбогдоно.\n"
                 + c.ToIgnore + " хуудас «алгассан» гэж хадгалагдана — дараагийн удаа санал болгохгүй (жагсаалтад саарал харагдана, хүссэн үедээ дахин чагталж болно).";
        }

        /// <summary>Хадгалсны ДАРАА: сервер юу бичсэнийг (saved/ignored) тайлагнана — дэд жагсаалтын өгүүлбэрийг нөхцөлтэй.</summary>
        public static string SavedText(int saved, int ignored, bool checklistRequested)
        {
            string s = saved + " хуудас холбогдлоо; " + ignored + " хуудас «алгассан» гэж хадгаллаа.";
            if (checklistRequested && saved > 0)
                s += "\n\nДэд жагсаалтыг «AI туслах» самбараас харна; өдрийн явцаа тэндээс илгээнэ (аль хэдийн байгаа мөрийг сервер дахин нэмдэггүй).";
            return s;
        }

        /// <summary>Мөрийн төлөвийн бичвэр — өнгөөр ГАНЦААРАА биш (өмнө нь алгассан мөр зөвхөн саарал байв).</summary>
        public static string StatusLabel(bool wasConfirmed, bool wasIgnored)
        {
            if (wasConfirmed) return "Холбогдсон";
            if (wasIgnored) return "Алгассан";
            return "Шинэ санал";
        }

        public static string FilterLabel(BindingFilter f)
        {
            switch (f)
            {
                case BindingFilter.ToLink: return "Холбогдохоор";
                case BindingFilter.ToIgnore: return "Алгасахаар";
                case BindingFilter.NoTask: return "ERP таскгүй";
                case BindingFilter.PreviouslyIgnored: return "Өмнө алгассан";
                default: return "Бүх хуудас";
            }
        }
    }
}
