using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Устгасан нэг элементийн устгахаас ӨМНӨ авсан мэдээлэл (устгасны дараа Revit-ээс уншиж болохгүй).</summary>
    public sealed class BbDeletedItem
    {
        public long Id;
        public string UniqueId = "";
        public string Category = "";
        public string Name = "";
        public string Mark = "";
        public string Level = "";
        /// <summary>Worksharing-ийн «үүсгэсэн» хэрэглэгч (workshared биш бол хоосон).</summary>
        public string Creator = "";

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["id"] = Id, ["uid"] = UniqueId, ["cat"] = Category, ["name"] = Name,
                ["mark"] = Mark, ["level"] = Level, ["creator"] = Creator,
            };
        }

        public static BbDeletedItem FromJson(object o)
        {
            return new BbDeletedItem
            {
                Id = (long)BbJson.Num(o, "id", 0),
                UniqueId = BbJson.Str(o, "uid", ""),
                Category = BbJson.Str(o, "cat", ""),
                Name = BbJson.Str(o, "name", ""),
                Mark = BbJson.Str(o, "mark", ""),
                Level = BbJson.Str(o, "level", ""),
                Creator = BbJson.Str(o, "creator", ""),
            };
        }
    }

    /// <summary>Нэг устгалт (нэг гүйлгээ): хэн, хэзээ, аль харагдацад, юуг.  Загварт DataStorage нэг элемент болж хадгалагдана.</summary>
    public sealed class BbDeleteBatch
    {
        public string Key = "";
        /// <summary>UTC, ISO 8601 ("o").</summary>
        public string WhenUtc = "";
        public string User = "";
        public string View = "";
        public readonly List<BbDeletedItem> Items = new List<BbDeletedItem>();
        /// <summary>Хамт устсан хамаарал (шошго, хэмжээс, суурилсан элемент …) — нэрээр нь жагсаахгүй.</summary>
        public int Dependents;
        /// <summary><see cref="BbDeleteLog.MaxItems"/>-аас давсан тул нэрээр хадгалаагүй сонгосон элементийн тоо.</summary>
        public int Truncated;

        public DateTime When
        {
            get
            {
                DateTime t;
                return DateTime.TryParse(WhenUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out t) ? t.ToUniversalTime() : DateTime.MinValue;
            }
        }

        public int Count { get { return Items.Count + Truncated; } }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["version"] = 1.0, ["key"] = Key, ["when"] = WhenUtc, ["user"] = User, ["view"] = View,
                ["dependents"] = Dependents, ["truncated"] = Truncated,
                ["items"] = Items.Select(i => (object)i.ToJson()).ToList(),
            };
        }

        public static BbDeleteBatch FromJson(object o)
        {
            var b = new BbDeleteBatch
            {
                Key = BbJson.Str(o, "key", ""),
                WhenUtc = BbJson.Str(o, "when", ""),
                User = BbJson.Str(o, "user", ""),
                View = BbJson.Str(o, "view", ""),
                Dependents = (int)BbJson.Num(o, "dependents", 0),
                Truncated = (int)BbJson.Num(o, "truncated", 0),
            };
            foreach (object x in BbJson.Arr(o, "items") ?? new List<object>()) b.Items.Add(BbDeletedItem.FromJson(x));
            return b;
        }

        /// <summary>Загварын DataStorage-ийн бичвэрээс; эвдэрсэн бол null.</summary>
        public static BbDeleteBatch Parse(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try
            {
                BbDeleteBatch b = FromJson(BbJson.Parse(json));
                return string.IsNullOrEmpty(b.Key) ? null : b;
            }
            catch (FormatException) { return null; }
        }
    }

    /// <summary>«Ийм элементийг тэр хэрэглэгч устгалаа» — бичвэр ба «шинэ (харж амжаагүй)» устгалтыг ялгах.</summary>
    public static class BbDeleteLog
    {
        /// <summary>Нэг устгалтад нэрээр нь хадгалах дээд тоо (үлдсэнийг <see cref="BbDeleteBatch.Truncated"/>-д тоолно).</summary>
        public const int MaxItems = 1000;

        /// <summary>«Багана: M_Concrete 400x400 · К-1 · 1 давхар · id 12345».</summary>
        public static string Describe(BbDeletedItem it)
        {
            var parts = new List<string>();
            string head = string.IsNullOrEmpty(it.Category) ? "Элемент" : it.Category;
            if (!string.IsNullOrEmpty(it.Name) && !string.Equals(it.Name, it.Category, StringComparison.CurrentCultureIgnoreCase)) head += ": " + it.Name;
            parts.Add(head);
            if (!string.IsNullOrEmpty(it.Mark)) parts.Add(it.Mark);
            if (!string.IsNullOrEmpty(it.Level)) parts.Add(it.Level);
            parts.Add("id " + it.Id.ToString(CultureInfo.InvariantCulture));
            return string.Join(" · ", parts);
        }

        /// <summary>«…» элементийг Бат устгалаа (үүсгэсэн: Дорж).</summary>
        public static string Sentence(BbDeleteBatch b, BbDeletedItem it)
        {
            string s = "«" + Describe(it) + "» элементийг " + Who(b.User) + " устгалаа";
            if (!string.IsNullOrEmpty(it.Creator) && !SameUser(it.Creator, b.User)) s += " (үүсгэсэн: " + it.Creator + ")";
            return s;
        }

        public static string Headline(BbDeleteBatch b, DateTime localTime)
        {
            string s = localTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " — " + Who(b.User) + " " + b.Count + " элемент устгалаа";
            if (b.Dependents > 0) s += " (+" + b.Dependents + " хамаарал)";
            if (!string.IsNullOrEmpty(b.View)) s += " · харагдац «" + b.View + "»";
            return s;
        }

        /// <summary>Мэдэгдлийн мөрүүд: устгалт бүрийн гарчиг + элемент бүрийн өгүүлбэр (нийт <paramref name="maxLines"/> хүртэл).</summary>
        public static List<string> Lines(IEnumerable<BbDeleteBatch> batches, Func<DateTime, DateTime> toLocal, int maxLines)
        {
            var lines = new List<string>();
            int hidden = 0;
            foreach (BbDeleteBatch b in batches)
            {
                if (lines.Count >= maxLines) { hidden += b.Count; continue; }
                lines.Add(Headline(b, toLocal(b.When)));
                foreach (BbDeletedItem it in b.Items)
                {
                    if (lines.Count >= maxLines) { hidden++; continue; }
                    lines.Add("   " + Sentence(b, it));
                }
                hidden += b.Truncated;
            }
            if (hidden > 0) lines.Add("… өөр " + hidden + " элемент («Устгалтын түүх»-ээс харна уу)");
            return lines;
        }

        /// <summary>Өөр хүний хийсэн, энэ хэрэглэгчийн хараахан хараагүй устгалтууд (эртнээс шинэ рүү).</summary>
        public static List<BbDeleteBatch> Unseen(IEnumerable<BbDeleteBatch> all, Func<string, bool> seen, string me)
        {
            return all.Where(b => b != null && !SameUser(b.User, me) && !seen(b.Key)).OrderBy(b => b.When).ToList();
        }

        public static bool SameUser(string a, string b) { return string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase); }

        private static string Who(string user) { return string.IsNullOrEmpty(user) ? "(нэргүй хэрэглэгч)" : user; }
    }

    /// <summary>
    /// Энэ компьютерийн хэрэглэгчийн төлөв (%APPDATA%\MGL\BbStudio\delete-watch.json): устгахын өмнө анхааруулах эсэх, төсөл бүрт аль устгалтыг
    /// аль хэдийн мэдэгдсэн.  Огноогоор биш ТҮЛХҮҮРЭЭР — өөр хүний цаг зөрүүтэй, эсвэл хожуу синк хийсэн устгалт алдагдахгүй.
    /// </summary>
    public sealed class BbDeleteWatchState
    {
        /// <summary>Төсөл бүрт санах түлхүүрийн дээд тоо (хуучныг нь хаяна).</summary>
        public const int MaxSeenPerProject = 5000;

        public bool WarnBeforeDelete = true;
        private readonly Dictionary<string, List<string>> _seen = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        public bool Knows(string project) { return _seen.ContainsKey(project ?? ""); }

        public bool Seen(string project, string key)
        {
            List<string> l;
            return _seen.TryGetValue(project ?? "", out l) && l.Contains(key);
        }

        public void MarkSeen(string project, IEnumerable<string> keys)
        {
            List<string> l;
            if (!_seen.TryGetValue(project ?? "", out l)) _seen[project ?? ""] = l = new List<string>();
            foreach (string k in keys) if (!string.IsNullOrEmpty(k) && !l.Contains(k)) l.Add(k);
            if (l.Count > MaxSeenPerProject) l.RemoveRange(0, l.Count - MaxSeenPerProject);
        }

        public Dictionary<string, object> ToJson()
        {
            var seen = new Dictionary<string, object>();
            foreach (KeyValuePair<string, List<string>> kv in _seen) seen[kv.Key] = kv.Value.Cast<object>().ToList();
            return new Dictionary<string, object> { ["version"] = 1.0, ["warnBeforeDelete"] = WarnBeforeDelete, ["seen"] = seen };
        }

        public static BbDeleteWatchState FromJson(object o)
        {
            var s = new BbDeleteWatchState { WarnBeforeDelete = BbJson.Bool(o, "warnBeforeDelete", true) };
            Dictionary<string, object> seen = BbJson.Obj(o, "seen");
            if (seen != null)
                foreach (KeyValuePair<string, object> kv in seen)
                    s.MarkSeen(kv.Key, (kv.Value as List<object> ?? new List<object>()).OfType<string>());
            return s;
        }

        public void Save(string path)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, BbJson.Write(ToJson()), new System.Text.UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        public static BbDeleteWatchState Load(string path)
        {
            return File.Exists(path) ? FromJson(BbJson.Parse(File.ReadAllText(path))) : new BbDeleteWatchState();
        }
    }
}
