using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Шалгах самбарын нэг мөр = нэг хуудас (нэг өрөөний хуудас; өрөө олон хуудастай бол «1/2», «2/2»).</summary>
    public sealed class WeReviewItem
    {
        public long SheetId;
        public string SheetNumber;
        public string SheetName;
        public string RoomUid;
        public string RoomLabel;
        public int Page = 1, Pages = 1;
        public bool Checked;

        public string Title
        {
            get { return (SheetNumber ?? "?") + "  ·  " + (RoomLabel ?? SheetName ?? string.Empty) + (Pages > 1 ? "  (" + Page + "/" + Pages + ")" : string.Empty); }
        }
    }

    /// <summary>
    /// Олон өрөөний дэлгээс үүсгэсний дараа хуудсуудыг НЭГ НЭГЭЭР шалгах (2026-10-14, эзэн: «олныг үүсгэвэл тухайн хуудаснуудыг 1 товч дараад
    /// шууд шалгаад шалгаад явдаг байвал гоё»).  Revit-гүй төлөв: одоогийн мөр, шалгасан тэмдэг, «Дараах» = энэ хуудсыг шалгасан болгоод
    /// дараагийн ШАЛГААГҮЙ хуудас руу.
    /// </summary>
    public sealed class WeReviewState
    {
        public readonly List<WeReviewItem> Items;
        public int Current { get; private set; }

        public WeReviewState(IEnumerable<WeReviewItem> items)
        {
            Items = (items ?? Enumerable.Empty<WeReviewItem>()).ToList();
            // Нэг өрөөний хуудсууд — «1/2», «2/2».
            foreach (IGrouping<string, WeReviewItem> g in Items.Where(i => !string.IsNullOrEmpty(i.RoomUid)).GroupBy(i => i.RoomUid))
            {
                int k = 1, n = g.Count();
                foreach (WeReviewItem i in g) { i.Page = k++; i.Pages = n; }
            }
            Current = 0;
        }

        public WeReviewItem Item { get { return Current >= 0 && Current < Items.Count ? Items[Current] : null; } }
        public int CheckedCount { get { return Items.Count(i => i.Checked); } }
        public bool AllChecked { get { return Items.Count > 0 && Items.All(i => i.Checked); } }

        public void Select(int index)
        {
            if (Items.Count == 0) return;
            Current = Math.Max(0, Math.Min(Items.Count - 1, index));
        }

        /// <summary>Одоогийнхыг шалгасан болгоод дараагийн шалгаагүй руу (төгсгөлөөс эхэнд эргэнэ).  Бүгд шалгасан бол false.</summary>
        public bool Next()
        {
            if (Items.Count == 0) return false;
            if (Item != null) Item.Checked = true;
            for (int k = 1; k <= Items.Count; k++)
            {
                int i = (Current + k) % Items.Count;
                if (!Items[i].Checked) { Current = i; return true; }
            }
            return false;
        }

        public void Previous() { Select(Current - 1); }

        public string Summary
        {
            get
            {
                if (Items.Count == 0) return "Шалгах хуудас алга";
                return (Current + 1) + " / " + Items.Count + " хуудас  ·  шалгасан " + CheckedCount + (AllChecked ? "  ✓ бүгд" : string.Empty);
            }
        }
    }
}
