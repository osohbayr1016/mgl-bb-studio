using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>«MGL Smart»-ын ГЛОБАЛ хэрэглэгчийн тохиргоо (`settings.json`).</summary>
    public sealed class SmartSettingsFile
    {
        /// <summary>Өөрчлөлтийн нөлөөллийн бүртгэл (DocumentChanged) идэвхтэй эсэх.</summary>
        public bool ImpactTracking { get; set; } = true;
        /// <summary>
        /// Бүртгэл унтраалттай байсан хугацааны ТӨГСГӨЛ — дахин асаасан мөчийн өөрчлөлтийн дугаар.  Үүнээс ӨМНӨХ өөрчлөлтүүдийн зарим нь
        /// бүртгэгдээгүй; шинжилгээ энэ дугаараас өмнө эхэлсэн бол «бүрэн БИШ» гэж тэмдэглэгдэнэ.  0 = хэзээ ч унтраагаагүй.
        /// </summary>
        public long TrackingGapThroughSeq { get; set; }

        /// <summary>
        /// БАРИМТ тутмын цоорхойн хаалт (`DocumentKey.Id` → дугаар): тэр баримтын бүртгэлийг (хаалтын үед) хадгалж чадаагүй, эсвэл хадгалагдаагүй өөрчлөлт
        /// алдагдсан.  Бүртгэлийн файл өөрөө уншигдахгүй/бичигдэхгүй байхад ч энэ тусдаа файл (settings.json) бичигдэж болно.  Дээд тал нь
        /// `SmartSettings.MaxDocGaps` мөр (хамгийн хуучин дугаартай нь хасагдана).
        /// </summary>
        public Dictionary<string, long> DocGapThroughSeq { get; set; } = new Dictionary<string, long>(StringComparer.Ordinal);

        /// <summary>
        /// ЗӨВХӨН санах ойд (диск рүү бичигдэхгүй): файл ачаалахад УНШИГДААГҮЙ (түгжигдсэн/эрхгүй) эсвэл шинэ хувилбарын add-in-ийнх байсан тул
        /// эдгээр утга нь анхдагч — диск дэх бодит тохиргоо (бүртгэл унтраасан эсэх, хоосон зайн дугаар) ТОДОРХОЙГҮЙ.  Хэрэглэгч «цоорхой байхгүй» гэж
        /// найдах ёсгүй: нөлөөллийн шинжилгээ үүнийг ИЛ тэмдэглэнэ.
        /// </summary>
        [JsonIgnore]
        public bool Unreadable { get; set; }
    }

    public static class SmartSettings
    {
        public const int Schema = 1;
        public const string FileName = "settings.json";
        private static readonly object Gate = new object();
        private static SmartSettingsFile _cached;

        public static SmartSettingsFile Load(SmartStore store = null)
        {
            lock (Gate)
            {
                if (_cached != null && store == null) return _cached;
                SmartStore s = store ?? SmartStore.Default;
                LoadResult<SmartSettingsFile> r = s.Load<SmartSettingsFile>(FileName, Schema, () => new SmartSettingsFile());
                SmartSettingsFile f = r.Value ?? new SmartSettingsFile();
                f.Unreadable = r.Status == LoadStatus.Unreadable || r.Status == LoadStatus.NewerSchema;
                // Файл түр уншигдаагүй (түгжигдсэн) бол анхдагчийг session турш кэшлэхгүй — дараагийн дуудлага дахин оролдоно.
                if (store == null && r.Status != LoadStatus.Unreadable) _cached = f;
                return f;
            }
        }

        /// <summary>
        /// Хадгална.  ⚠️ Кэшийг ЗӨВХӨН амжилттай хадгалсны ДАРАА шинэчилнэ — хадгалагдаагүй утгыг (жишээ нь «бүртгэл унтраасан») кэшлээд, дараагийн
        /// дуудагч диск дээр байхгүй тохиргоог бодит гэж үзэхээс сэргийлнэ.
        /// </summary>
        public static bool Save(SmartSettingsFile f, SmartStore store = null)
        {
            lock (Gate)
            {
                SmartStore s = store ?? SmartStore.Default;
                bool ok = s.Save(FileName, Schema, f);
                if (ok)
                {
                    f.Unreadable = false;
                    if (store == null) _cached = f;
                }
                return ok;
            }
        }

        public const int MaxDocGaps = 200;

        /// <summary>
        /// Тухайн баримтын бүртгэлд цоорхой (`seq` хүртэл) үүссэнийг ТЭМДЭГЛЭНЭ (хаалтын үеийн хадгалалт амжилтгүй гэх мэт).  Бусад баримтад
        /// нөлөөлөхгүй (глобал `TrackingGapThroughSeq`-ээс ялгаатай).  Буцаах: settings.json-д хадгалагдсан эсэх.
        /// </summary>
        public static bool RecordDocGap(string docId, long seq, SmartStore store = null)
        {
            if (string.IsNullOrEmpty(docId) || seq <= 0) return false;
            lock (Gate)
            {
                SmartSettingsFile f = Load(store);
                if (f.Unreadable) return false;           // уншигдаагүй файлыг дарахгүй
                if (f.DocGapThroughSeq == null) f.DocGapThroughSeq = new Dictionary<string, long>(StringComparer.Ordinal);
                long cur;
                if (f.DocGapThroughSeq.TryGetValue(docId, out cur) && cur >= seq) return true;
                f.DocGapThroughSeq[docId] = seq;
                if (f.DocGapThroughSeq.Count > MaxDocGaps)
                {
                    foreach (string k in f.DocGapThroughSeq.OrderBy(kv => kv.Value).Take(f.DocGapThroughSeq.Count - MaxDocGaps).Select(kv => kv.Key).ToList())
                        f.DocGapThroughSeq.Remove(k);
                }
                return Save(f, store);
            }
        }

        /// <summary>
        /// Тухайн баримтын тэмдэглэсэн цоорхойн хаалт (байхгүй бол 0).
        /// ⚠️ `Load()` нь КЭШЛЭГДСЭН нэг объект буцаадаг, `RecordDocGap` (арын flush thread / хаалт) тэр толийг ӨӨРЧИЛДӨГ — уншилт мөн `Gate` дотор
        /// (эс бөгөөс «Collection was modified» үндсэн thread дээр шидэгдэнэ).
        /// </summary>
        public static long DocGapFor(SmartSettingsFile f, string docId)
        {
            if (f == null || string.IsNullOrEmpty(docId)) return 0;
            lock (Gate)
            {
                long v;
                return f.DocGapThroughSeq != null && f.DocGapThroughSeq.TryGetValue(docId, out v) ? v : 0;
            }
        }

        /// <summary>Тестэд л.</summary>
        internal static void ResetCache()
        {
            lock (Gate) { _cached = null; }
        }
    }
}
