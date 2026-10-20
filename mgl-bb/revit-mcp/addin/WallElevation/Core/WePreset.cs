using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Өрөөний зориулалтын (preset) түлхүүр (W09, 2026-10-16).</summary>
    public static class WePresetId
    {
        public const string Interior = "interior";
        public const string Architecture = "architecture";
        public const string Bathroom = "bathroom";
        /// <summary>«Тусгай» — хэрэглэгчийн өөрийн тохиргоо (цонхны ерөнхий утгууд).</summary>
        public const string Custom = "custom";

        public static readonly string[] All = { Interior, Architecture, Bathroom, Custom };

        public static bool IsKnown(string id) { return id != null && Array.IndexOf(All, id) >= 0; }
    }

    /// <summary>Өрөөний зориулалтыг хаанаас авсан.</summary>
    public enum WePresetSource
    {
        /// <summary>Цонхонд хэрэглэгч энэ өрөөнд сонгосон.</summary>
        Chosen = 0,
        /// <summary>Өмнө үүсгэсэн дэлгээсийн харагдац дээр хадгалсан (дахин ажиллуулах).</summary>
        Stored = 1,
        /// <summary>Нэр, агуулгаас санал болгосон (<see cref="WePresetSuggester"/>).</summary>
        Suggested = 2,
        /// <summary>Цонхны өгөгдмөл зориулалт (товчноос — «Интерьер» товч = Интерьер).</summary>
        Default = 3,
    }

    /// <summary>
    /// Өрөөний ЗОРИУЛАЛТЫН багц (W09): тэмдэглэгээний хүснэгт (ангилал тус бүр юу тавих), тод/бүдэг хэсэг, түлхүүр план / 3D / рендерийн байр, view
    /// template (ангиллын харагдах байдлыг загвар удирдана), хуудасны тогтмол мета («* Classification» …).  Өрөө тус бүрд өөр зориулалт — нэг
    /// ерөнхий хүснэгт ариун цэврийн өрөө, оффисыг ижил болгохгүй.  «Тусгай» = цонхны ерөнхий утгууд (хэрэглэгчийн өмнөх тохиргоо).
    /// </summary>
    public sealed class WePreset
    {
        public string Id;
        public string Annotations = WeAnno.DefaultSet;
        public WeFadeMode FadeMode = WeFadeMode.AboveCeiling;
        public bool KeyPlan = true;
        public bool Axon = true;
        public int Perspectives = 3;
        /// <summary>View template: <see cref="WeSettings.TemplateTypeDefault"/> (""), <see cref="WeSettings.TemplateNone"/> эсвэл загварын нэр.</summary>
        public string TemplateName = WeSettings.TemplateTypeDefault;
        /// <summary>Хуудасны тогтмол параметр (харагдах нэр → утга) — шинэ болон энэ удаагийн өрөөний хуудсанд бичигдэнэ.</summary>
        public Dictionary<string, string> SheetParams = new Dictionary<string, string>(StringComparer.Ordinal);

        public WePreset Clone()
        {
            return new WePreset
            {
                Id = Id, Annotations = Annotations, FadeMode = FadeMode, KeyPlan = KeyPlan, Axon = Axon, Perspectives = Perspectives,
                TemplateName = TemplateName, SheetParams = new Dictionary<string, string>(SheetParams ?? new Dictionary<string, string>(), StringComparer.Ordinal),
            };
        }

        /// <summary>Тохиргооны файлын нэг мөр: «annotations=…;fade=…;keyplan=1;axon=1;persp=3;template=…;sheet=нэр:утга|нэр:утга».</summary>
        public string Serialize()
        {
            var sb = new StringBuilder();
            sb.Append("annotations=").Append(WeAnno.Format(WeAnno.Parse(Annotations)).Replace(',', ' '));
            sb.Append(";fade=").Append(FadeMode.ToString());
            sb.Append(";keyplan=").Append(KeyPlan ? "1" : "0");
            sb.Append(";axon=").Append(Axon ? "1" : "0");
            sb.Append(";persp=").Append(Math.Max(0, Math.Min(4, Perspectives)).ToString(CultureInfo.InvariantCulture));
            sb.Append(";template=").Append(Clean(TemplateName));
            sb.Append(";sheet=").Append(string.Join("|", (SheetParams ?? new Dictionary<string, string>())
                .Where(kv => !string.IsNullOrWhiteSpace(kv.Key)).Select(kv => Clean(kv.Key).Replace(":", " ") + ":" + Clean(kv.Value))));
            return sb.ToString();
        }

        private static string Clean(string v)
        {
            return (v ?? string.Empty).Replace(";", " ").Replace("|", " ").Replace("\r", " ").Replace("\n", " ").Trim();
        }

        /// <summary>Хэзээ ч шидэхгүй: танихгүй / буруу утга → <paramref name="fallback"/>-ийн утга.</summary>
        public static WePreset Parse(string id, string text, WePreset fallback)
        {
            WePreset p = (fallback ?? WePresetCatalog.BuiltIn(id)).Clone();
            p.Id = id;
            if (string.IsNullOrEmpty(text)) return p;
            foreach (string part in text.Split(';'))
            {
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                string k = part.Substring(0, eq).Trim(), v = part.Substring(eq + 1);
                switch (k)
                {
                    case "annotations": p.Annotations = WeAnno.Format(WeAnno.Parse(v.Replace(' ', ','))); break;
                    case "fade":
                        WeFadeMode f;
                        if (Enum.TryParse(v.Trim(), false, out f) && Enum.IsDefined(typeof(WeFadeMode), f)) p.FadeMode = f;
                        break;
                    case "keyplan": p.KeyPlan = v.Trim() != "0"; break;
                    case "axon": p.Axon = v.Trim() != "0"; break;
                    case "persp":
                        int n;
                        if (int.TryParse(v.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out n) && n >= 0 && n <= 4) p.Perspectives = n;
                        break;
                    case "template": p.TemplateName = v.Trim(); break;
                    case "sheet":
                        p.SheetParams = new Dictionary<string, string>(StringComparer.Ordinal);
                        foreach (string pair in v.Split('|'))
                        {
                            int c = pair.IndexOf(':');
                            if (c <= 0) continue;
                            string name = pair.Substring(0, c).Trim(), val = pair.Substring(c + 1).Trim();
                            if (name.Length > 0) p.SheetParams[name] = val;
                        }
                        break;
                }
            }
            return p;
        }

        /// <summary>Хоёр багц тохиргоогоороо ижил үү (тайлан, «өгөгдмөлөөс өөрчилсөн» тэмдэг).</summary>
        public bool SameAs(WePreset o)
        {
            return o != null && Serialize() == o.Serialize();
        }
    }

    /// <summary>Суурилагдсан зориулалтууд — өмнөх хувилбаруудын бодит зан төлөвөөс (шинэ «стандарт» зохиогоогүй).</summary>
    public static class WePresetCatalog
    {
        /// <summary>
        /// Архитектурын тэмдэглэгээ = хэрэгслийн 2026-10-07-ны өгөгдмөл (интерьерийн мөрүүд — цахилгаан цэг, тавилгын шошго, өнгөлгөөний бүс —
        /// нэмэгдэхээс ӨМНӨХ, <see cref="WeAnno.PreviousDefaultSets"/>[1]).
        /// </summary>
        public const string ArchitectureAnnotations =
            "doors:spot,windows:spot,ceilings:spot,floors:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim," +
            "doors:tag,windows:tag";

        /// <summary>
        /// Ариун цэврийн өрөөний СУУРЬ (W08/W09) — интерьерийн багц + сантехникийн хэрэгслийн хэмжээс, шошго; тавилгын шошгогүй.  Компанийн
        /// ариун цэврийн өрөөний хуудасны жишээ (хавтан, ус тусгаарлалт, босгоны дүрэм, харагдацын тоо) ИРЭЭГҮЙ — хүлээгдэж байна
        /// (<see cref="PendingSample"/>); энэ нь «зөв стандарт» биш, эхлэл.
        /// </summary>
        public const string BathroomAnnotations =
            "doors:spot,windows:spot,ceilings:spot,floors:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim,plumbing:dim,electrical:dim,finishes:dim," +
            "doors:tag,windows:tag,plumbing:tag,electrical:tag,finishes:keynote";

        public static string Title(string id)
        {
            switch (id)
            {
                case WePresetId.Interior: return "Интерьер";
                case WePresetId.Architecture: return "Архитектур";
                case WePresetId.Bathroom: return "Ариун цэврийн өрөө";
                case WePresetId.Custom: return "Тусгай";
                default: return id ?? "?";
            }
        }

        public static string Description(string id)
        {
            switch (id)
            {
                case WePresetId.Interior:
                    return "Интерьерийн хуудас: цахилгаан цэг, тавилга, өнгөлгөөний бүс; тааз хүртэл тод; түлхүүр план, 3D, рендерийн байр; хуудсанд «* Classification» = Интерьер.";
                case WePresetId.Architecture:
                    return "Архитектурын дэлгээс: хана, хаалга, цонх, шал, тааз, давхар, тэнхлэг; бүдэгрүүлэхгүй; түлхүүр план, 3D; рендерийн байргүй; хуудасны ангиллыг хөндөхгүй.";
                case WePresetId.Bathroom:
                    return "Ариун цэврийн өрөө (СУУРЬ — компанийн жишээ хүлээгдэж байна): сантехникийн хэрэгслийн хэмжээс, шошго, хавтангийн бүс, цахилгаан цэг; хуудсанд Интерьер ангилал.";
                case WePresetId.Custom:
                    return "Таны өөрийн тохиргоо — доорх хүснэгт, сонголтыг шууд хэрэглэнэ.";
                default: return string.Empty;
            }
        }

        /// <summary>Компанийн жишээ ирэхийг хүлээж буй (хүлээн авалтын шалгуур БҮРЭН БИШ) зориулалт.</summary>
        public static bool PendingSample(string id) { return id == WePresetId.Bathroom; }

        public static WePreset BuiltIn(string id)
        {
            switch (id)
            {
                case WePresetId.Architecture:
                    return new WePreset { Id = id, Annotations = WeAnno.Format(WeAnno.Parse(ArchitectureAnnotations)), FadeMode = WeFadeMode.None, KeyPlan = true, Axon = true, Perspectives = 0 };
                case WePresetId.Bathroom:
                    return new WePreset { Id = id, Annotations = WeAnno.Format(WeAnno.Parse(BathroomAnnotations)), FadeMode = WeFadeMode.AboveCeiling, KeyPlan = true, Axon = true, Perspectives = 3,
                                          SheetParams = WeSheetDiscipline.Interior() };
                case WePresetId.Custom:
                    return new WePreset { Id = id };
                default:
                    return new WePreset { Id = WePresetId.Interior, Annotations = WeAnno.Format(WeAnno.Parse(WeAnno.DefaultSet)), FadeMode = WeFadeMode.AboveCeiling,
                                          KeyPlan = true, Axon = true, Perspectives = 3, SheetParams = WeSheetDiscipline.Interior() };
            }
        }
    }

    /// <summary>Өрөөний агуулгын хураангуй (санал болгоход) — Revit давхарга эсвэл төлөвлөгч тоолно.</summary>
    public sealed class WeRoomContents
    {
        public int Plumbing;
        public int Furniture;
        public int Casework;
    }

    /// <summary>
    /// Зориулалтын САНАЛ (W09) — тодорхой дүрэм (AI биш), шалтгаантай.  ⚠️ ЗОРИУД консерватив: зөвхөн ариун цэврийн өрөөг (нэр ЭСВЭЛ ≥ 2 сантехникийн
    /// хэрэгсэл, гал тогоо биш) таньж санал болгоно; бусад өрөө товчны өгөгдмөлөөр (Интерьер товч → Интерьер, ерөнхий товч → Архитектур) — интерьерийн
    /// багийн коридорын хуудас «Интерьер» ангиллаа алдах, архитекторын оффисын хуудас интерьерийн болох зэрэг гэнэтийн өөрчлөлт гаргахгүй.  Хэрэглэгч
    /// өрөө бүрт сольж болно.
    /// </summary>
    public static class WePresetSuggester
    {
        /// <summary>
        /// Үгийн ЯЗГУУР — монгол хэлэнд залгавар эгшиг гээгдүүлдэг («цэвэр» → «цэврийн», «угаалга» → «угаалгын»), тиймээс «ариун цэв», «угаалг».
        /// </summary>
        private static readonly string[] BathWords =
        {
            "ариун цэв", "угаалг", "шүршүүр", "ванн", "душ", "бие засах", "жорлон", "санузел", "санитар",
            "wc", "w.c", "toilet", "bath", "shower", "restroom", "lavatory", "sanitary", "washroom",
        };

        private static readonly string[] KitchenWords = { "гал тогоо", "тогоо", "цайны", "kitchen", "pantry", "cafe", "кафе" };

        /// <summary>Санал: <paramref name="reason"/> = богино тайлбар (нэрэнд «WC» байна / 2 сантехникийн хэрэгсэл).  Санал байхгүй бол null.</summary>
        public static string Suggest(string roomName, string roomNumber, WeRoomContents contents, out string reason)
        {
            reason = null;
            string name = ((roomName ?? string.Empty) + " " + (roomNumber ?? string.Empty)).ToLowerInvariant();
            foreach (string w in BathWords)
            {
                int at = Find(name, w);
                if (at < 0) continue;
                // Шалтгаанд нэрэн доторх БҮТЭН үгийг («ариун цэврийн»), язгуурыг биш.
                int end = at + w.Length;
                while (end < name.Length && char.IsLetter(name[end])) end++;
                reason = "нэрэнд «" + name.Substring(at, end - at) + "» байна";
                return WePresetId.Bathroom;
            }
            bool kitchen = KitchenWords.Any(w => Find(name, w) >= 0);
            if (contents != null && contents.Plumbing >= 2 && !kitchen)
            {
                reason = contents.Plumbing.ToString(CultureInfo.InvariantCulture) + " сантехникийн хэрэгсэл";
                return WePresetId.Bathroom;
            }
            return null;
        }

        /// <summary>Үгийн ЭХЭНД (өмнө нь үсэг биш) — «bath» нь «bathroom»-д, «wc» нь «wc-1»-д таарна, «towel»-д биш.  −1 = алга.</summary>
        private static int Find(string text, string word)
        {
            int i = text.IndexOf(word, StringComparison.Ordinal);
            while (i >= 0)
            {
                if (i == 0 || !char.IsLetter(text[i - 1])) return i;
                i = text.IndexOf(word, i + 1, StringComparison.Ordinal);
            }
            return -1;
        }
    }
}
