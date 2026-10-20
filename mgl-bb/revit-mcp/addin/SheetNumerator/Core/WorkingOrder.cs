using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Нэг бүлгийн хоёр дараалал: <see cref="Original"/> (Revit-ээс уншсан Browser-ийн дараалал) ба
    /// <see cref="Working"/> (хэрэглэгч зөөсөн дараалал).
    ///
    /// ⚠️ Зөөх нь Revit-ийн document-ийг ХЭЗЭЭ Ч ӨӨРЧИЛЖ БОЛОХГҮЙ — зөвхөн энэ жагсаалт өөрчлөгдөнө.  Revit руу
    /// зөвхөн «Хэрэгжүүлэх»-ээр л бичигдэнэ.  Бүх зөөх үйлдэл хэсэг сонгосон мөрүүдийн ХАРИЛЦАА ДАРААЛЛЫГ хадгална
    /// (олон мөр зөөхөд).
    /// </summary>
    public sealed class WorkingOrderState
    {
        private readonly List<SheetSnapshot> _working;

        public WorkingOrderState(SheetGroup group)
        {
            Group = group;
            Original = group.Sheets;
            _working = new List<SheetSnapshot>(group.Sheets);
        }

        public SheetGroup Group { get; }
        public IReadOnlyList<SheetSnapshot> Original { get; }
        public IReadOnlyList<SheetSnapshot> Working => _working;

        /// <summary>Working нь Original-аас ялгаатай.</summary>
        public bool IsDirty => NumberingEngine.OrderDiffers(Original, _working);

        public void Reset()
        {
            _working.Clear();
            _working.AddRange(Original);
        }

        /// <summary>
        /// Сонгосон мөрүүдийг <paramref name="insertIndex"/> (ЗӨӨХӨӨС ӨМНӨХ жагсаалтын координат, 0..Count) байрлалд
        /// блокоор нь зөөнө.  Сонгосон мөрүүд хоорондоо одоогийн дарааллаараа үлдэнэ.
        /// </summary>
        public bool MoveSelectedTo(ISet<long> selectedIds, int insertIndex)
        {
            if (selectedIds == null || selectedIds.Count == 0)
                return false;
            if (insertIndex < 0)
                insertIndex = 0;
            if (insertIndex > _working.Count)
                insertIndex = _working.Count;

            var moving = new List<SheetSnapshot>();
            var staying = new List<SheetSnapshot>();
            int removedBefore = 0;
            for (int i = 0; i < _working.Count; i++)
            {
                SheetSnapshot s = _working[i];
                if (selectedIds.Contains(s.SheetId))
                {
                    moving.Add(s);
                    if (i < insertIndex)
                        removedBefore++;
                }
                else
                {
                    staying.Add(s);
                }
            }
            if (moving.Count == 0)
                return false;

            int at = insertIndex - removedBefore;
            if (at < 0)
                at = 0;
            if (at > staying.Count)
                at = staying.Count;

            var result = new List<SheetSnapshot>(_working.Count);
            result.AddRange(staying.Take(at));
            result.AddRange(moving);
            result.AddRange(staying.Skip(at));

            bool changed = !SameOrder(result);
            if (changed)
            {
                _working.Clear();
                _working.AddRange(result);
            }
            return changed;
        }

        public bool MoveToTop(ISet<long> selectedIds)
        {
            return MoveSelectedTo(selectedIds, 0);
        }

        public bool MoveToBottom(ISet<long> selectedIds)
        {
            return MoveSelectedTo(selectedIds, _working.Count);
        }

        /// <summary>Сонгосон мөр бүрийг нэг байраар дээш (өмнөх нь сонгосон бол блок хэвээр).</summary>
        public bool MoveUp(ISet<long> selectedIds)
        {
            if (selectedIds == null || selectedIds.Count == 0)
                return false;
            bool changed = false;
            for (int i = 1; i < _working.Count; i++)
            {
                if (selectedIds.Contains(_working[i].SheetId) && !selectedIds.Contains(_working[i - 1].SheetId))
                {
                    SheetSnapshot t = _working[i - 1];
                    _working[i - 1] = _working[i];
                    _working[i] = t;
                    changed = true;
                }
            }
            return changed;
        }

        public bool MoveDown(ISet<long> selectedIds)
        {
            if (selectedIds == null || selectedIds.Count == 0)
                return false;
            bool changed = false;
            for (int i = _working.Count - 2; i >= 0; i--)
            {
                if (selectedIds.Contains(_working[i].SheetId) && !selectedIds.Contains(_working[i + 1].SheetId))
                {
                    SheetSnapshot t = _working[i + 1];
                    _working[i + 1] = _working[i];
                    _working[i] = t;
                    changed = true;
                }
            }
            return changed;
        }

        /// <summary>
        /// Шинэ (дахин уншсан) бүлэг дээр ажлын дарааллыг ХАДГАЛЖ сэргээнэ: өмнөх дарааллаас ХЭВЭЭР байгаа хуудсуудыг
        /// өөрийн дарааллаар нь, шинээр гарсныг төгсгөлд.  Устсан хуудсыг хасна.
        /// </summary>
        public static WorkingOrderState Rebase(WorkingOrderState previous, SheetGroup fresh)
        {
            var state = new WorkingOrderState(fresh);
            if (previous == null || !previous.IsDirty)
                return state;

            var byId = fresh.Sheets.ToDictionary(s => s.SheetId);
            var result = new List<SheetSnapshot>(fresh.Sheets.Count);
            var used = new HashSet<long>();
            foreach (SheetSnapshot old in previous.Working)
            {
                SheetSnapshot cur;
                if (byId.TryGetValue(old.SheetId, out cur) && used.Add(cur.SheetId))
                    result.Add(cur);
            }
            foreach (SheetSnapshot s in fresh.Sheets)
            {
                if (used.Add(s.SheetId))
                    result.Add(s);
            }
            state._working.Clear();
            state._working.AddRange(result);
            return state;
        }

        private bool SameOrder(List<SheetSnapshot> other)
        {
            if (other.Count != _working.Count)
                return false;
            for (int i = 0; i < other.Count; i++)
            {
                if (other[i].SheetId != _working[i].SheetId)
                    return false;
            }
            return true;
        }
    }
}
