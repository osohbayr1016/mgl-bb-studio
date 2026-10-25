using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>«Шугамаар хэмжээс»-ийн каталогийн нэг ангилал: BuiltInCategory-ийн нэр, харуулах нэр, салбар, ямар сонголттой.</summary>
    public sealed class BbDimCatInfo
    {
        public string Key, Name;
        public string[] Disciplines;
        /// <summary>«Зөвхөн захын нүүр» / «Төвөөр» сонголт байх эсэх (тэнхлэг, түвшин, шугам — нэг лавлагаатай тул үгүй).</summary>
        public bool HasEdges, HasCenter;
    }

    /// <summary>Тохиргоонд сонгосон ангилал.  Edges = элемент бүрийн зөвхөн хоёр захын нүүр; Center = төвийн лавлагаа; аль нь ч үгүй = огтолсон бүх нүүр.</summary>
    public sealed class BbDimCat
    {
        public string Key = "";
        public bool Edges, Center;
    }

    /// <summary>Хэрэглэгчийн нэрлэсэн тохиргоо (ModPlus-ийн «Configuration»): аль ангиллын элементүүдийг ямар байдлаар хэмжих.</summary>
    public sealed class BbDimConfig
    {
        public string Name = "";
        public List<BbDimCat> Cats = new List<BbDimCat>();

        public BbDimCat Find(string key) { return Cats.FirstOrDefault(c => c.Key == key); }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["name"] = Name,
                ["cats"] = Cats.Select(c => (object)new Dictionary<string, object> { ["key"] = c.Key, ["edges"] = c.Edges, ["center"] = c.Center }).ToList(),
            };
        }

        public static BbDimConfig FromJson(object o)
        {
            var c = new BbDimConfig { Name = BbJson.Str(o, "name", "") };
            foreach (object x in BbJson.Arr(o, "cats") ?? new List<object>())
            {
                string key = BbJson.Str(x, "key", "");
                BbDimCatInfo info = BbDimLines.Info(key);
                if (info == null || c.Find(key) != null) continue;
                c.Cats.Add(new BbDimCat { Key = key, Edges = info.HasEdges && BbJson.Bool(x, "edges", false), Center = info.HasCenter && BbJson.Bool(x, "center", false) });
            }
            return c;
        }
    }

    /// <summary>Шугам дээрх нэг лавлагааны нэр дэвшигч: эзэн элемент, ангилал, төрөл, шугамын дагуух байрлал (фут).  <see cref="Ref"/> = Revit-ийн Reference.</summary>
    public sealed class BbDimCand
    {
        public const int Face = 0, Center = 1, Single = 2;
        public string Owner = "", Cat = "";
        public int Kind;
        public double At;
        public object Ref;
    }

    /// <summary>
    /// «Шугамаар хэмжээс» (ModPlus-ийн Dimensions by line): тохиргоонууд + үндсэн цонхны сонголтууд (бүх төсөлд — %APPDATA%\MGL\BbStudio\dimlines.json)
    /// ба лавлагааг сонгох цэвэр логик.
    /// </summary>
    public sealed class BbDimLines
    {
        public const string Arch = "Architecture", Struct = "Structure", Mech = "Mechanical", Elec = "Electrical", Pipe = "Piping";
        public static readonly string[] Disciplines = { Arch, Struct, Mech, Elec, Pipe };
        private static readonly string[] All = Disciplines;

        public static readonly BbDimCatInfo[] Catalog =
        {
            C("OST_DuctTerminal", "Агаарын сараалж (Air Terminals)", true, true, Mech),
            C("OST_CableTray", "Кабелийн тавиур (Cable Trays)", true, true, Elec),
            C("OST_Casework", "Тавилга, шүүгээ (Casework)", true, true, Arch),
            C("OST_Ceilings", "Тааз (Ceilings)", true, false, Arch),
            C("OST_Columns", "Багана (Columns)", true, true, Arch, Struct),
            C("OST_Conduit", "Кабелийн хоолой (Conduits)", true, true, Elec),
            C("OST_CurtainWallPanels", "Хөшиг ханын хавтан (Curtain Panels)", true, true, Arch),
            C("OST_CurtainWallMullions", "Хөшиг ханын хүрээ (Curtain Wall Mullions)", true, true, Arch),
            C("OST_Lines", "Шугам (Detail lines)", false, false, All),
            C("OST_Doors", "Хаалга (Doors)", true, true, Arch),
            C("OST_DuctCurves", "Агаарын суваг (Ducts)", true, true, Mech),
            C("OST_ElectricalEquipment", "Цахилгааны тоног (Electrical Equipment)", true, true, Elec),
            C("OST_Floors", "Шал, хучилт (Floors)", true, false, Arch, Struct),
            C("OST_GenericModel", "Ерөнхий загвар (Generic Models)", true, true, All),
            C("OST_Grids", "Тэнхлэг (Grids)", false, false, All),
            C("OST_Levels", "Түвшин (Levels) — огтлол/дэлгээсэд", false, false, All),
            C("OST_MechanicalEquipment", "Механик тоног (Mechanical Equipment)", true, true, Mech, Pipe),
            C("OST_PipeCurves", "Хоолой (Pipes)", true, true, Pipe),
            C("OST_PlumbingFixtures", "Ариун цэврийн хэрэгсэл (Plumbing Fixtures)", true, true, Pipe),
            C("OST_CLines", "Лавлах хавтгай (Reference planes)", false, false, All),
            C("OST_Roofs", "Дээвэр (Roofs)", true, false, Arch),
            C("OST_Stairs", "Шат (Stairs)", true, false, Arch, Struct),
            C("OST_StructuralColumns", "Бүтээцийн багана (Structural Columns)", true, true, Struct),
            C("OST_StructuralFoundation", "Суурь (Structural Foundations)", true, true, Struct),
            C("OST_StructuralFraming", "Дамнуруу (Structural Framing)", true, true, Struct),
            C("OST_Walls", "Хана (Walls)", true, false, Arch, Struct),
            C("OST_Windows", "Цонх (Windows)", true, true, Arch),
        };

        private static BbDimCatInfo C(string key, string name, bool edges, bool center, params string[] disc)
        {
            return new BbDimCatInfo { Key = key, Name = name, HasEdges = edges, HasCenter = center, Disciplines = disc };
        }

        public static BbDimCatInfo Info(string key) { return Catalog.FirstOrDefault(c => c.Key == key); }

        // ── Хадгалах өгөгдөл ─────────────────────────────────────────────

        public readonly List<BbDimConfig> Configs = new List<BbDimConfig>();
        public string Current = "";
        public bool WorkCycle = true, Snap = true, PickLocation = true, Linked = true, Preview;
        /// <summary>Хэмжээсийн төрлийн нэр («» = харагдацын өгөгдмөл).</summary>
        public string DimType = "";

        /// <summary>Шинэ хэрэглэгчийн өгөгдмөл: «Багана» (баганын захын нүүр) ба «Тэнхлэг + багана» (тэнхлэг, баганын нүүр | төв | нүүр).</summary>
        public static BbDimLines Default()
        {
            var b = new BbDimLines();
            b.Configs.Add(new BbDimConfig
            {
                Name = "Багана",
                Cats = { new BbDimCat { Key = "OST_StructuralColumns", Edges = true }, new BbDimCat { Key = "OST_Columns", Edges = true } },
            });
            b.Configs.Add(new BbDimConfig
            {
                Name = "Тэнхлэг + багана",
                Cats = { new BbDimCat { Key = "OST_Grids" }, new BbDimCat { Key = "OST_StructuralColumns", Edges = true, Center = true } },
            });
            b.Current = "Багана";
            return b;
        }

        public BbDimConfig Find(string name)
        {
            return string.IsNullOrWhiteSpace(name) ? null : Configs.FirstOrDefault(c => string.Equals(c.Name, name.Trim(), StringComparison.CurrentCultureIgnoreCase));
        }

        /// <summary>Нэр зөв эсэх: хоосон биш, давхардахгүй (<paramref name="self"/>-ээс бусадтай).  Буруу бол шалтгаан.</summary>
        public string NameProblem(string name, BbDimConfig self = null)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Тохиргооны нэр хоосон байна.";
            BbDimConfig other = Find(name);
            if (other != null && !ReferenceEquals(other, self)) return "«" + name.Trim() + "» нэртэй тохиргоо аль хэдийн бий.";
            return null;
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["version"] = 1.0,
                ["current"] = Current ?? "",
                ["workCycle"] = WorkCycle, ["snap"] = Snap, ["pickLocation"] = PickLocation, ["linked"] = Linked, ["preview"] = Preview,
                ["dimType"] = DimType ?? "",
                ["configs"] = Configs.Select(c => (object)c.ToJson()).ToList(),
            };
        }

        public static BbDimLines FromJson(object o)
        {
            var b = new BbDimLines
            {
                Current = BbJson.Str(o, "current", ""),
                WorkCycle = BbJson.Bool(o, "workCycle", true),
                Snap = BbJson.Bool(o, "snap", true),
                PickLocation = BbJson.Bool(o, "pickLocation", true),
                Linked = BbJson.Bool(o, "linked", true),
                Preview = BbJson.Bool(o, "preview", false),
                DimType = BbJson.Str(o, "dimType", ""),
            };
            foreach (object x in BbJson.Arr(o, "configs") ?? new List<object>())
            {
                BbDimConfig c = BbDimConfig.FromJson(x);
                if (b.NameProblem(c.Name) == null) b.Configs.Add(c);
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

        public static BbDimLines Load(string path)
        {
            return File.Exists(path) ? FromJson(BbJson.Parse(File.ReadAllText(path))) : Default();
        }

        // ── Лавлагаа сонгох ──────────────────────────────────────────────

        /// <summary>
        /// Шугамыг огтолсон лавлагаанаас хэмжээсийн гинжийг сонгоно (байрлалаар эрэмбэлсэн, <paramref name="tol"/>-оос ойрхоныг нэг болгосон).
        /// Элемент бүрт: «Захын нүүр» = нүүрнүүдийн хамгийн бага, их хоёр; «Төвөөр» = төвийн лавлагаа (олдоогүй бол захын хоёр нүүр);
        /// хоёулаа = нүүр | төв | нүүр; аль нь ч үгүй = огтолсон бүх нүүр.  Тэнхлэг, түвшин, шугам (<see cref="BbDimCand.Single"/>) үргэлж орно.
        /// </summary>
        public static List<BbDimCand> Pick(IEnumerable<BbDimCand> cands, BbDimConfig cfg, double tol)
        {
            var chosen = new List<BbDimCand>();
            foreach (var g in cands.GroupBy(c => c.Owner))
            {
                List<BbDimCand> faces = g.Where(c => c.Kind == BbDimCand.Face).OrderBy(c => c.At).ToList();
                List<BbDimCand> centers = g.Where(c => c.Kind == BbDimCand.Center).ToList();
                chosen.AddRange(g.Where(c => c.Kind == BbDimCand.Single));
                BbDimCat cat = cfg?.Find(g.First().Cat) ?? new BbDimCat();
                bool center = cat.Center && centers.Count > 0;
                if (center) chosen.AddRange(centers);
                if (faces.Count == 0) continue;
                if (cat.Edges || (cat.Center && !center)) { chosen.Add(faces[0]); if (faces.Count > 1) chosen.Add(faces[faces.Count - 1]); }
                else if (!cat.Center) chosen.AddRange(faces);
            }
            var res = new List<BbDimCand>();
            // Ижил байрлалд: тэнхлэг/шугам > төв > нүүр (Revit тэг урттай хэсэг үүсгэхгүй — нэгийг нь л авна).
            foreach (BbDimCand c in chosen.OrderBy(c => c.At).ThenByDescending(c => c.Kind))
            {
                if (res.Count > 0 && c.At - res[res.Count - 1].At <= tol)
                {
                    if (c.Kind > res[res.Count - 1].Kind) res[res.Count - 1] = c;
                    continue;
                }
                res.Add(c);
            }
            return res;
        }
    }
}
