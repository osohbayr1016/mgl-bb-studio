using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Нэг товшилтын цэгт олдсон өрөө / хана.  Revit-гүй — цэгт юу байгааг Revit тал (<c>WeRoomPicker</c>) уншина, аль нь хожихыг энд.
    /// </summary>
    public sealed class WePickCandidate
    {
        /// <summary>Тогтвортой түлхүүр: host өрөө/хана = UniqueId, link-ийн өрөө = «link|inst|elem».</summary>
        public string Key;
        /// <summary>Хүнд харагдах: «101 ХУРЛЫН ӨРӨӨ», «хана W-12».</summary>
        public string Label;
        public bool IsRoom;
        /// <summary>Өрөө host загварт (link биш).</summary>
        public bool IsHost;
        /// <summary>Идэвхтэй планд энэ өрөөг заасан host-ын tag бий (link-ийн өрөөнд хэрэглэгч ЭНЭ өрөөг харж байгаагийн нотолгоо).</summary>
        public bool TaggedInView;
        /// <summary>Талбай (дотоод нэгж) — давхцсан хоёр link-ийн өрөөнөөс нарийвчилсан нь (жижиг) хожно.</summary>
        public double Area;
        /// <summary>Олдсон дараалал (link-ийн дараалал) — бусад бүх шинж тэнцүү үед тогтвортой.</summary>
        public int Order;
    }

    /// <summary>
    /// «Өрөөн дотор дарж сонгох» дүрэм.  ХЭМЖСЭН (live gate, Revit 2024, 2026-10-13): <c>PickObjects(ObjectType.Element)</c> нь зөвхөн HOST
    /// элемент сонгодог тул интерьерийн файлд (өрөө архитектурын LINK-д) өрөөний хоосон хэсэг ч, Room Reference X ч сонгогддоггүй байв
    /// (WE-BUG-002); host өрөө ч interior fill / reference харагдахгүй бол дотроос нь дарахад сонгогдохгүй.  Тиймээс товшилт = ЦЭГ, цэгт
    /// байгаа өрөөг (host эсвэл link) хэрэгсэл өөрөө олно.
    /// </summary>
    public static class WePickRules
    {
        /// <summary>
        /// Нэг цэгт хэд хэдэн өрөө (давхцсан хоёр link, host + link) — аль нь сонгогдох:
        /// өрөө ханаас түрүүлнэ → host өрөө → идэвхтэй планд tag-тай → жижиг талбай → олдсон дараалал.
        /// </summary>
        public static WePickCandidate Choose(IEnumerable<WePickCandidate> candidates)
        {
            if (candidates == null) return null;
            return candidates.Where(c => c != null && !string.IsNullOrEmpty(c.Key))
                .OrderByDescending(c => c.IsRoom)
                .ThenByDescending(c => c.IsHost)
                .ThenByDescending(c => c.TaggedInView)
                .ThenBy(c => c.Area > 0 ? c.Area : double.MaxValue)
                .ThenBy(c => c.Order)
                .FirstOrDefault();
        }

        public const string PromptBase = "Ханын дэлгээс: өрөөн дотор дарна уу (хоосон хэсэг, X, tag — аль нь ч болно; дахин дарвал хасна)";
        public const string PromptFinish = "Esc = дуусгах";

        /// <summary>
        /// НЭГ товшилтын горим (өгөгдмөл, эзний хүсэлт 2026-10-13: «өрөөн дээр дармагц автоматаар таниад шууд дэлгээс гаргадаг болго»).
        /// Шошго хэрэггүй; дармагц урьдчилсан дүн руу шууд.  Esc = олон өрөө / бусад сонголтын цонх.
        /// </summary>
        public const string PromptOneBase = "Ханын дэлгээс: өрөөн ДОТОР нэг дарна уу — шошго хэрэггүй, дармагц шууд үргэлжилнэ";
        public const string PromptOneEsc = "Esc = олон өрөө / бусад сонголт";
        /// <summary>2026-10-14 (интерьерийн баг: «олон өрөө сонгоход 1 л гардаг»): Ctrl/Shift дарж байгаад дарвал олон өрөөний горим.</summary>
        public const string PromptOneMulti = "Ctrl+дарж олон өрөө";

        public static string PromptOne(string note)
        {
            return (string.IsNullOrEmpty(note) ? string.Empty : "⚠ " + note + " · ") + PromptOneBase + " · " + PromptOneMulti + " · " + PromptOneEsc;
        }

        public const string PromptAddBase = "Ханын дэлгээс: Ctrl+дарж өрөө нэмэх/хасах";
        public const string PromptAddFinish = "Ctrl-гүй дарах эсвэл Esc = дуусгах";

        /// <summary>
        /// Нэг товшилтын горимоос Ctrl/Shift-ээр орсон олон өрөөний мөр: Ctrl+дарах = нэмэх/хасах, энгийн дарах = (тэр өрөөг нэмээд) дуусгах.
        /// </summary>
        public static string PromptAdd(WePickSet set, string note)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(note)) parts.Add("⚠ " + note);
            parts.Add(PromptAddBase);
            if (set != null && set.Count > 0)
            {
                IList<string> labels = set.Labels;
                string shown = string.Join(", ", labels.Take(6));
                if (labels.Count > 6) shown += " … (+" + (labels.Count - 6) + ")";
                parts.Add("Сонгосон " + labels.Count + ": " + shown);
            }
            parts.Add(PromptAddFinish);
            return string.Join(" · ", parts);
        }

        /// <summary>Олон өрөөний горимын төлөвийн мөр: юу сонгогдсон, сүүлийн товшилтод юу олдсонгүй, хэрхэн дуусгах.</summary>
        public static string Prompt(WePickSet set, string note)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(note)) parts.Add("⚠ " + note);
            parts.Add(PromptBase);
            if (set != null && set.Count > 0)
            {
                IList<string> labels = set.Labels;
                string shown = string.Join(", ", labels.Take(6));
                if (labels.Count > 6) shown += " … (+" + (labels.Count - 6) + ")";
                parts.Add("Сонгосон " + labels.Count + ": " + shown);
            }
            parts.Add(set != null && set.Count > 0 ? PromptFinish : "Esc = болих");
            return string.Join(" · ", parts);
        }
    }

    /// <summary>
    /// Link-ийн аль давхар нь идэвхтэй планы давхартай таарах вэ — link-ийн давхрын өндрийг host-ын координат руу шилжүүлсний ДАРАА
    /// хамгийн ойрыг (хүлцэл дотор).  Өрөөний tag-гүй link-ийн өрөөг «энэ давхрынх» гэж танихад (tag нь өмнө нь цорын ганц нотолгоо байв).
    /// </summary>
    public static class WeLevelMatch
    {
        /// <param name="levels">(түлхүүр, host-ын координат дахь өндөр) — дотоод нэгж.</param>
        /// <returns>Хамгийн ойр давхрын түлхүүр; хүлцэлд багтахгүй бол null.  Тэнцвэл эхнийх.</returns>
        public static string Nearest(IEnumerable<KeyValuePair<string, double>> levels, double z, double tolerance)
        {
            if (levels == null) return null;
            string best = null;
            double bestD = double.MaxValue;
            foreach (KeyValuePair<string, double> l in levels)
            {
                double d = Math.Abs(l.Value - z);
                if (d > tolerance || d >= bestD) continue;
                best = l.Key;
                bestD = d;
            }
            return best;
        }
    }

    /// <summary>Сонгосон өрөө/ханын дараалал хадгалсан багц — дахин дарвал хасна.</summary>
    public sealed class WePickSet
    {
        private readonly List<WePickCandidate> _items = new List<WePickCandidate>();

        public int Count { get { return _items.Count; } }
        public IList<string> Labels { get { return _items.Select(i => i.Label).ToList(); } }
        public IList<WePickCandidate> Items { get { return _items.ToList(); } }

        public bool Contains(WePickCandidate c)
        {
            return c != null && _items.Any(x => string.Equals(x.Key, c.Key, StringComparison.Ordinal));
        }

        /// <returns>true = нэмсэн, false = хассан (өмнө нь сонгогдсон байсан).</returns>
        public bool Toggle(WePickCandidate c)
        {
            if (c == null || string.IsNullOrEmpty(c.Key)) throw new ArgumentException("түлхүүргүй сонголт", "c");
            int i = _items.FindIndex(x => string.Equals(x.Key, c.Key, StringComparison.Ordinal));
            if (i >= 0) { _items.RemoveAt(i); return false; }
            _items.Add(c);
            return true;
        }
    }
}
