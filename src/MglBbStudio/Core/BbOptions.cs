using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Нэг гишүүний (дамнуруу / туслах дамнуруу / багана) шошго, MRA-ийн төрөл.  Хоосон = үндсэн (сурсан) утга.</summary>
    public sealed class BbTagSet
    {
        public string BarTagType = "";       // «family : type»
        public string StirrupTagType = "";   // «family : type»
        public string MraType = "";          // MRA төрлийн нэр

        public static BbTagSet From(BbMemberStandard ms)
        {
            return new BbTagSet { BarTagType = ms?.BarTagType ?? "", StirrupTagType = ms?.StirrupTagType ?? "", MraType = ms?.MraType ?? "" };
        }

        public void ApplyTo(BbMemberStandard ms)
        {
            if (ms == null) return;
            if (!string.IsNullOrWhiteSpace(BarTagType)) ms.BarTagType = BarTagType;
            if (!string.IsNullOrWhiteSpace(StirrupTagType)) ms.StirrupTagType = StirrupTagType;
            if (!string.IsNullOrWhiteSpace(MraType)) ms.MraType = MraType;
        }
    }

    /// <summary>
    /// Огтлолын ажлын арматурын шошгоны байрлал (үндсэн plugin-ий «Хэмжээ, тэмдэглэгээ»-ийн хэсэг) — дамнуруу, туслах дамнуруу, баганад нэгэн
    /// адил.  null = тухайн гишүүний СУРСАН утга.
    /// </summary>
    public sealed class BbTagLayout
    {
        public bool? SingleTagPerSet, MultiLeaderPerSet, MergeLeaders, GroupTags;
        /// <summary>Цаасан мм: гишүүнээс шошго хүртэл, шошго хоорондын зай, leader 3→2 (шошгоноос хугарал), 2→1 (хугарлаас арматур; 0 = автомат).</summary>
        public double? TagOutMm, TagGapMm, LeaderLandingMm, LeaderRunMm;
        /// <summary>Дэлгээс дээрх огтлолын тэмдгийн толгой гишүүний гадна ирмэгээс (дэлгээсийн цаасан мм).</summary>
        public double? SecMarkGapMm;

        public static BbTagLayout From(BbMemberStandard ms)
        {
            if (ms == null) return new BbTagLayout();
            return new BbTagLayout
            {
                SingleTagPerSet = ms.SingleTagPerSet, MultiLeaderPerSet = ms.MultiLeaderPerSet, MergeLeaders = ms.SecMergeLeaders, GroupTags = ms.SecGroupTags,
                TagOutMm = ms.SecTagOutPaperMm, TagGapMm = ms.TagGapPaperMm, LeaderLandingMm = ms.SecLeaderLandingPaperMm, LeaderRunMm = ms.SecLeaderRunPaperMm,
                SecMarkGapMm = ms.SecMarkGapPaperMm,
            };
        }

        public void ApplyTo(BbMemberStandard ms)
        {
            if (ms == null) return;
            if (SingleTagPerSet.HasValue) ms.SingleTagPerSet = SingleTagPerSet.Value;
            if (MultiLeaderPerSet.HasValue) ms.MultiLeaderPerSet = MultiLeaderPerSet.Value;
            if (MergeLeaders.HasValue) ms.SecMergeLeaders = MergeLeaders.Value;
            if (GroupTags.HasValue) ms.SecGroupTags = GroupTags.Value;
            if (TagOutMm.HasValue) ms.SecTagOutPaperMm = Math.Max(0, TagOutMm.Value);
            if (TagGapMm.HasValue) ms.TagGapPaperMm = Math.Max(0, TagGapMm.Value);
            if (LeaderLandingMm.HasValue) ms.SecLeaderLandingPaperMm = Math.Max(0, LeaderLandingMm.Value);
            if (LeaderRunMm.HasValue) ms.SecLeaderRunPaperMm = Math.Max(0, LeaderRunMm.Value);
            if (SecMarkGapMm.HasValue) ms.SecMarkGapPaperMm = Math.Max(0, SecMarkGapMm.Value);
        }
    }

    /// <summary>
    /// «Тохиргоо»-ны нэг option: ажлын зураг ба «Стандартаар тэмдэглэх»-ийн арматурын шошго / хомутын шошго / MRA-ийн төрөл.  Сурсан стандарт дээр
    /// давхарлана (хоосон талбар = сурсан утга хэвээр) — стандартын бусад утга (масштаб, зай …) хөндөгдөхгүй.
    /// </summary>
    public sealed class BbOption
    {
        public string Name = "";
        public BbTagSet Beam = new BbTagSet(), BeamAux = new BbTagSet(), Column = new BbTagSet();
        public string WallMraType = "", SlabMraType = "";
        public BbTagLayout SecTags = new BbTagLayout();

        public BbTagSet For(BbMemberKind k)
        {
            switch (k)
            {
                case BbMemberKind.Column: return Column;
                case BbMemberKind.BeamAux: return BeamAux;
                default: return Beam;
            }
        }

        /// <summary>Стандартын одоогийн утгуудаар бөглөсөн option (шинэ option = «Үндсэн»-ий хуулбар).</summary>
        public static BbOption FromStandard(string name, BbStandard std)
        {
            return new BbOption
            {
                Name = name ?? "",
                Beam = BbTagSet.From(std?.Beam),
                BeamAux = BbTagSet.From(std?.BeamAux),
                Column = BbTagSet.From(std?.Column),
                WallMraType = std?.Plate?.WallMraType ?? "",
                SlabMraType = std?.Plate?.SlabMraType ?? "",
                SecTags = new BbTagLayout(),   // хоосон = гишүүн бүрийн сурсан утга (баганын зайг дамнуруугаар дарахгүй)
            };
        }

        public BbStandard ApplyTo(BbStandard std)
        {
            if (std == null) return null;
            Beam.ApplyTo(std.Beam);
            BeamAux.ApplyTo(std.BeamAux);
            Column.ApplyTo(std.Column);
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux, std.Column }) SecTags?.ApplyTo(ms);
            if (std.Plate != null)
            {
                if (!string.IsNullOrWhiteSpace(WallMraType)) std.Plate.WallMraType = WallMraType;
                if (!string.IsNullOrWhiteSpace(SlabMraType)) std.Plate.SlabMraType = SlabMraType;
            }
            return std;
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["name"] = Name,
                ["beam"] = BbFieldJson.ToJson(Beam),
                ["beamAux"] = BbFieldJson.ToJson(BeamAux),
                ["column"] = BbFieldJson.ToJson(Column),
                ["wallMraType"] = WallMraType,
                ["slabMraType"] = SlabMraType,
                ["secTags"] = BbFieldJson.ToJson(SecTags ?? new BbTagLayout()),
            };
        }

        public static BbOption FromJson(object o)
        {
            return new BbOption
            {
                Name = BbJson.Str(o, "name", ""),
                Beam = BbFieldJson.FromJson(BbJson.Obj(o, "beam"), new BbTagSet()),
                BeamAux = BbFieldJson.FromJson(BbJson.Obj(o, "beamAux"), new BbTagSet()),
                Column = BbFieldJson.FromJson(BbJson.Obj(o, "column"), new BbTagSet()),
                WallMraType = BbJson.Str(o, "wallMraType", ""),
                SlabMraType = BbJson.Str(o, "slabMraType", ""),
                SecTags = BbFieldJson.FromJson(BbJson.Obj(o, "secTags"), new BbTagLayout()),
            };
        }
    }

    /// <summary>
    /// Хэрэглэгчийн option-ууд (бүх төсөлд хуваалцана) + төсөл бүрт идэвхтэй option (төслийн түлхүүр → нэр).  «Үндсэн» (<see cref="BaseName"/>)
    /// = сурсан стандарт өөрөө — жагсаалтад хадгалагдахгүй, засагдахгүй, устахгүй.
    /// </summary>
    public sealed class BbOptionBook
    {
        public const string BaseName = "Үндсэн (сурсан стандарт)";

        public readonly List<BbOption> Options = new List<BbOption>();
        public readonly Dictionary<string, string> ActiveByProject = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static bool IsBase(string name)
        {
            return string.IsNullOrWhiteSpace(name) || string.Equals(name.Trim(), BaseName, StringComparison.OrdinalIgnoreCase);
        }

        public BbOption Find(string name)
        {
            if (IsBase(name)) return null;
            return Options.FirstOrDefault(o => string.Equals(o.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Тухайн төсөлд идэвхтэй option-ийн нэр — тохируулаагүй эсвэл устсан бол <see cref="BaseName"/>.</summary>
        public string ActiveFor(string projectKey)
        {
            if (!string.IsNullOrEmpty(projectKey) && ActiveByProject.TryGetValue(projectKey, out string n) && Find(n) != null) return Find(n).Name;
            return BaseName;
        }

        public void SetActive(string projectKey, string name)
        {
            if (string.IsNullOrEmpty(projectKey)) return;
            if (Find(name) == null) ActiveByProject.Remove(projectKey);
            else ActiveByProject[projectKey] = Find(name).Name;
        }

        /// <summary>Шинэ нэр зөв эсэх: хоосон биш, «Үндсэн» биш, давхардахгүй.  Буруу бол шалтгаан, зөв бол null.</summary>
        public string NameProblem(string name, BbOption self = null)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Нэр хоосон байна.";
            if (IsBase(name)) return "«" + BaseName + "» нэр нөөцлөгдсөн.";
            BbOption other = Find(name);
            if (other != null && !ReferenceEquals(other, self)) return "«" + name.Trim() + "» нэртэй option аль хэдийн бий.";
            return null;
        }

        /// <summary>Шинэ option-г (нэрийг шалгаж) нэмнэ.</summary>
        public BbOption Add(BbOption o)
        {
            string p = NameProblem(o?.Name);
            if (p != null) throw new ArgumentException(p);
            o.Name = o.Name.Trim();
            Options.Add(o);
            return o;
        }

        /// <summary>Устгана; энэ option идэвхтэй байсан төслүүд «Үндсэн» рүү буцна.</summary>
        public bool Remove(string name)
        {
            BbOption o = Find(name);
            if (o == null) return false;
            Options.Remove(o);
            foreach (string k in ActiveByProject.Where(kv => string.Equals(kv.Value, o.Name, StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Key).ToList())
                ActiveByProject.Remove(k);
            return true;
        }

        /// <summary>Тухайн төслийн стандарт: сурсан стандарт + идэвхтэй option.  <paramref name="optionName"/> = хэрэглэсэн option-ий нэр.</summary>
        public BbStandard Apply(BbStandard std, string projectKey, out string optionName)
        {
            optionName = ActiveFor(projectKey);
            BbOption o = Find(optionName);
            return o == null ? std : o.ApplyTo(std);
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["version"] = 1.0,
                ["options"] = Options.Select(o => (object)o.ToJson()).ToList(),
                ["activeByProject"] = ActiveByProject.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => (object)kv.Value),
            };
        }

        public static BbOptionBook FromJson(object o)
        {
            var b = new BbOptionBook();
            if (o is Dictionary<string, object> d)
            {
                if (d.TryGetValue("options", out object arr) && arr is List<object> list)
                    foreach (object x in list)
                    {
                        BbOption opt = BbOption.FromJson(x);
                        if (b.NameProblem(opt.Name) == null) b.Add(opt);
                    }
                Dictionary<string, object> act = BbJson.Obj(o, "activeByProject");
                if (act != null) foreach (var kv in act) if (kv.Value is string s) b.ActiveByProject[kv.Key] = s;
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

        public static BbOptionBook Load(string path)
        {
            return File.Exists(path) ? FromJson(BbJson.Parse(File.ReadAllText(path))) : new BbOptionBook();
        }
    }
}
