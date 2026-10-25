using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>
    /// Хэрэглэгчийн хадгалсан шүүлтүүр («Параметрээр шүүх»): нэр, ангиллууд (BuiltInCategory-ийн нэр — файл/хувилбар бүрд тогтвортой), ≤ 3 нөхцөл (БА),
    /// ашиглах харагдацын төрлүүд (<see cref="BbFilterBook.Plan"/> / <see cref="BbFilterBook.Section"/> / <see cref="BbFilterBook.ThreeD"/>; хоосон = бүх).
    /// </summary>
    public sealed class BbSavedFilter
    {
        public string Name = "";
        public List<string> Categories = new List<string>();
        public List<BbParamRule> Rules = new List<BbParamRule>();
        public List<string> ViewKinds = new List<string>();

        /// <summary>Энэ төрлийн харагдацад ажиллах эсэх (<paramref name="kind"/> null = загварын бус харагдац — ажиллахгүй).</summary>
        public bool AppliesTo(string kind)
        {
            if (string.IsNullOrEmpty(kind)) return false;
            return ViewKinds.Count == 0 || ViewKinds.Contains(kind, StringComparer.OrdinalIgnoreCase);
        }

        public BbSavedFilter Copy(string name)
        {
            return new BbSavedFilter
            {
                Name = name ?? Name,
                Categories = Categories.ToList(),
                Rules = Rules.Select(r => new BbParamRule { Param = r.Param, Op = r.Op, Value = r.Value }).ToList(),
                ViewKinds = ViewKinds.ToList(),
            };
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["name"] = Name,
                ["categories"] = Categories.Cast<object>().ToList(),
                ["viewKinds"] = ViewKinds.Cast<object>().ToList(),
                ["rules"] = Rules.Where(r => !string.IsNullOrWhiteSpace(r.Param))
                    .Select(r => (object)new Dictionary<string, object> { ["param"] = r.Param, ["op"] = r.Op, ["value"] = r.Value ?? "" }).ToList(),
            };
        }

        public static BbSavedFilter FromJson(object o)
        {
            var f = new BbSavedFilter { Name = BbJson.Str(o, "name", "") };
            foreach (object c in BbJson.Arr(o, "categories") ?? new List<object>()) if (c is string s && s.Length > 0) f.Categories.Add(s);
            foreach (object c in BbJson.Arr(o, "viewKinds") ?? new List<object>()) if (c is string s && s.Length > 0) f.ViewKinds.Add(s);
            foreach (object r in BbJson.Arr(o, "rules") ?? new List<object>())
            {
                string op = BbJson.Str(r, "op", BbParamFilter.Eq);
                f.Rules.Add(new BbParamRule { Param = BbJson.Str(r, "param", ""), Op = BbParamFilter.Ops.Contains(op) ? op : BbParamFilter.Eq, Value = BbJson.Str(r, "value", "") });
            }
            return f;
        }
    }

    /// <summary>Хадгалсан шүүлтүүрүүд (бүх төсөлд хуваалцана — %APPDATA%\MGL\BbStudio\filters.json).</summary>
    public sealed class BbFilterBook
    {
        /// <summary>Харагдацын төрөл: төлөвлөгөө, огтлол/дэлгээс/detail, 3D.</summary>
        public const string Plan = "plan", Section = "section", ThreeD = "3d";

        public readonly List<BbSavedFilter> Filters = new List<BbSavedFilter>();

        public BbSavedFilter Find(string name)
        {
            return string.IsNullOrWhiteSpace(name) ? null : Filters.FirstOrDefault(f => string.Equals(f.Name, name.Trim(), StringComparison.CurrentCultureIgnoreCase));
        }

        /// <summary>Нэр зөв эсэх: хоосон биш, давхардахгүй (<paramref name="self"/>-ээс бусадтай).  Буруу бол шалтгаан.</summary>
        public string NameProblem(string name, BbSavedFilter self = null)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Шүүлтүүрийн нэр хоосон байна.";
            BbSavedFilter other = Find(name);
            if (other != null && !ReferenceEquals(other, self)) return "«" + name.Trim() + "» нэртэй шүүлтүүр аль хэдийн бий.";
            return null;
        }

        /// <summary>Давхардахгүй шинэ нэр: «Шүүлтүүр 1», «Шүүлтүүр 2» …</summary>
        public string FreeName(string stem)
        {
            for (int i = 1; i < 1000; i++)
            {
                string n = stem + " " + i;
                if (Find(n) == null) return n;
            }
            return stem + " " + Guid.NewGuid().ToString("N").Substring(0, 4);
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object> { ["version"] = 1.0, ["filters"] = Filters.Select(f => (object)f.ToJson()).ToList() };
        }

        public static BbFilterBook FromJson(object o)
        {
            var b = new BbFilterBook();
            foreach (object x in BbJson.Arr(o, "filters") ?? new List<object>())
            {
                BbSavedFilter f = BbSavedFilter.FromJson(x);
                if (b.NameProblem(f.Name) == null) b.Filters.Add(f);
            }
            return b;
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

        public static BbFilterBook Load(string path)
        {
            return File.Exists(path) ? FromJson(BbJson.Parse(File.ReadAllText(path))) : new BbFilterBook();
        }
    }
}
