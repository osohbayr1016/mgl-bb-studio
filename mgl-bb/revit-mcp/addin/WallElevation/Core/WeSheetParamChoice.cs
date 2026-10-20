using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Цонхноос СОНГОХ хуудасны параметр (2026-10-14, интерьерийн баг 3-р тойрог: «* Type Designator»).  Утгын жагсаалт = төслийн хуудсуудад аль
    /// хэдийн бичигдсэн утгууд (олон хэрэглэгдсэн нь эхэнд); анхны сонголт = энэ хэрэгслийн өмнөх хуудсуудынх, эс бөгөөс (интерьерийн хэрэгсэлд)
    /// интерьерийн хуудсуудынх, эс бөгөөс хоосон — «бичихгүй» (буруу утга таамаглахгүй).
    /// </summary>
    public sealed class WeSheetParamChoice
    {
        /// <summary>Төсөл дэх бодит нэр («* Type Designator»).</summary>
        public string ParamName;
        /// <summary>Хуудасны ангилалд холбогдсон (эсвэл хуудсанд байгаа) параметр.</summary>
        public bool Exists;
        /// <summary>Бичвэр (string), зөвхөн уншигдах биш.</summary>
        public bool Writable;
        /// <summary>Хуудсуудад бичигдсэн утгууд — олон хэрэглэгдсэн нь эхэнд.</summary>
        public List<string> Values = new List<string>();
        /// <summary>Анхны сонголт ("" = бичихгүй).</summary>
        public string Default = string.Empty;
        /// <summary>Анхны утга хаанаас («энэ хэрэгслийн өмнөх хуудас» …).</summary>
        public string DefaultSource;
        /// <summary>Сонгох боломжгүй шалтгаан (алга, зөвхөн уншигдах …).</summary>
        public string Problem;

        public bool Selectable { get { return Exists && Writable && string.IsNullOrEmpty(Problem); } }

        /// <summary>Утга → тоо: олон хэрэглэгдсэн нь эхэнд, тэнцвэл үсгийн дарааллаар.</summary>
        public static List<string> Rank(IDictionary<string, int> counts)
        {
            if (counts == null) return new List<string>();
            return counts.Where(kv => !string.IsNullOrWhiteSpace(kv.Key))
                         .OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal)
                         .Select(kv => kv.Key.Trim()).Distinct(StringComparer.Ordinal).ToList();
        }

        /// <summary>Анхны утга: өмнөх (энэ хэрэгслийн) хуудсуудын хамгийн түгээмэл, эс бөгөөс илүүд үзэх бүлгийнх, эс бөгөөс "".</summary>
        public static string PickDefault(IDictionary<string, int> ours, IDictionary<string, int> preferred, out string source)
        {
            source = null;
            string o = Rank(ours).FirstOrDefault();
            if (!string.IsNullOrEmpty(o)) { source = "энэ хэрэгслийн өмнө үүсгэсэн хуудас"; return o; }
            string p = Rank(preferred).FirstOrDefault();
            if (!string.IsNullOrEmpty(p)) { source = "төслийн интерьерийн хуудас"; return p; }
            return string.Empty;
        }
    }
}
