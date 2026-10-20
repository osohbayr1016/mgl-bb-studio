using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  «Ханын дэлгээс»-ийн ТЭМДЭГЛЭГЭЭ (spot level, гинжин хэмжээс, шошго, keynote).
    //  Revit давхарга загвараас нэг удаа уншаад (`WeAnnoSources`) цөмд өгнө; ЮУГ, ХААНА тэмдэглэх нь цөмд (Revit-гүй,
    //  тесттэй) шийдэгдэнэ (`WeAnnotationPlanner`); Revit давхарга зөвхөн лавлагаа олж элемент үүсгэнэ.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Хэрэглэгч «ямар элемент дээр, юу тавих»-ыг сонгох хүснэгт: мөр = элемент, багана = тэмдэглэгээний төрөл.
    /// Сонголт тохиргоонд «мөр:багана» жагсаалтаар хадгалагдана (`walls:dim,doors:spot` …).
    /// </summary>
    public static class WeAnno
    {
        public const string Spot = "spot";
        public const string Dim = "dim";
        public const string Tag = "tag";
        public const string Keynote = "keynote";

        public const string Walls = "walls";
        public const string Doors = "doors";
        public const string Windows = "windows";
        public const string Ceilings = "ceilings";
        public const string Floors = "floors";
        public const string Levels = "levels";
        public const string Grids = "grids";
        /// <summary>
        /// Интерьерийн жишээ (205A-F, 205G-N, 206A-G): розетк «Роз-1», унтраалга, хананы гэрэл «WL-1» — шошго + байрлалын хэмжээс
        /// (шалнаас төв хүртэлх өндөр, ханын захаас төв хүртэлх зай).  Revit: цахилгааны тоноглол, гэрэлтүүлгийн төхөөрөмж, мэдээлэл,
        /// холбоо, хамгаалалт … + хананд суусан гэрэлтүүлэг.
        /// </summary>
        public const string Electrical = "electrical";
        /// <summary>
        /// Ханын ӨНГӨЛГӨӨНИЙ бүс — шалны хүрээ (wall sweep), гоёлын хавтан/ханын доод бүс (харах гадаргуун өмнөх нимгэн хана, хананд
        /// наалдсан хавтан).  Жишээ хуудасны баруун талын нарийн гинж: 100 (шалны хүрээ) · 800 (хавтан) · … · тааз.
        /// </summary>
        public const string Finishes = "finishes";

        public sealed class Row
        {
            public string Key;
            public string Label;
            /// <summary>Spot level-ийн тайлбар (null = энэ мөрөнд spot level байхгүй).</summary>
            public string SpotHint;
            /// <summary>Хэмжээсийн тайлбар (null = хэмжээсгүй).</summary>
            public string DimHint;
            public bool CanTag;
            /// <summary>Зөвхөн keynote (шошгогүй) — өнгөлгөөний бүс: материалын тэмдэглэл нь элементийн төрлийн Keynote.</summary>
            public bool KeynoteOnly;
            /// <summary>
            /// W09: Revit-ийн англи ангиллын нэр (хэрэглэгч Revit-д танина) — «Plumbing Fixtures».  Хэд хэдэн ангиллыг нэгтгэсэн мөрөнд «Group: …»
            /// (нэг Revit ангилал мэт харуулахгүй).
            /// </summary>
            public string English;
            /// <summary>Яг аль Revit ангилал(ууд) — tooltip.</summary>
            public string Categories;
        }

        public static readonly Row[] Rows =
        {
            new Row { Key = Walls, Label = "Хана", DimHint = "Хэвтээ гинж: харах ханын хоёр зах ба өмнөх хананууд (хаалт, тусгаарлах хана)", CanTag = true,
                      English = "Walls", Categories = "Revit: Walls — харах гадаргуугийн хана ба түүний өмнөх хананууд" },
            new Row { Key = Doors, Label = "Хаалга", SpotHint = "Хаалганы дээд ирмэг", DimHint = "Хэвтээ гинж: хаалганы хоёр ирмэг", CanTag = true,
                      English = "Doors", Categories = "Revit: Doors (энэ талын хананд суусан)" },
            new Row { Key = Windows, Label = "Цонх", SpotHint = "Цонхны доод ба дээд ирмэг", DimHint = "Хэвтээ гинж: цонхны хоёр ирмэг", CanTag = true,
                      English = "Windows", Categories = "Revit: Windows (энэ талын хананд суусан)" },
            new Row { Key = Ceilings, Label = "Тааз", SpotHint = "Таазны доод ирмэг", DimHint = "Босоо 1-р эгнээ: таазны доод ирмэг", CanTag = true,
                      English = "Ceilings", Categories = "Revit: Ceilings" },
            new Row { Key = Floors, Label = "Шал, хучилт", SpotHint = "Шалны дээд ирмэг (0,00 — давхраас, зүүн талд)", DimHint = "Босоо 1-р эгнээ: дээд хучилтын доод ирмэг, шалны дээд ирмэг, шалны зузаан", CanTag = true,
                      English = "Floors", Categories = "Revit: Floors (шал, өнгөлгөөний шал, дээд давхрын хучилт)" },
            new Row { Key = Levels, Label = "Давхар", DimHint = "Босоо 2-р эгнээ: давхар хоорондын өндөр",
                      English = "Levels", Categories = "Revit: Levels" },
            new Row { Key = Grids, Label = "Тэнхлэг (ойс)", DimHint = "Хэвтээ гинж: дэлгээсийг огтлох тэнхлэг",
                      English = "Grids", Categories = "Revit: Grids" },
            new Row { Key = "plumbing", Label = "Сантехник", DimHint = ElementDim, CanTag = true,
                      English = "Plumbing Fixtures", Categories = "Revit: Plumbing Fixtures" },
            new Row { Key = "generic", Label = "Ерөнхий модел", DimHint = ElementDim, CanTag = true,
                      English = "Generic Models", Categories = "Revit: Generic Models" },
            new Row { Key = "specialty", Label = "Тусгай тоног төхөөрөмж", DimHint = ElementDim, CanTag = true,
                      English = "Specialty Equipment", Categories = "Revit: Specialty Equipment" },
            new Row { Key = "furniture", Label = "Тавилга", DimHint = ElementDim, CanTag = true,
                      English = "Furniture", Categories = "Revit: Furniture" },
            new Row { Key = "casework", Label = "Тогтмол тавилга", DimHint = ElementDim, CanTag = true,
                      English = "Casework", Categories = "Revit: Casework" },
            new Row { Key = "curtainpanels", Label = "Хөшиг ханын хавтан", DimHint = ElementDim, CanTag = true,
                      English = "Curtain Panels", Categories = "Revit: Curtain Panels" },
            new Row { Key = Electrical, Label = "Цахилгаан цэг (розетк, унтраалга, хананы гэрэл)",
                      DimHint = "Байрлалын хэмжээс: шалнаас төв хүртэл, ханын захаас төв хүртэл", CanTag = true,
                      English = "Group: electrical & devices",
                      Categories = "БҮЛЭГ — нэг Revit ангилал БИШ: Electrical Fixtures, Lighting Devices, Lighting Fixtures (зөвхөн хананы — шалнаас ≤ 2400 мм, "
                                   + "таазнаас доош), Data Devices, Communication Devices, Telephone Devices, Security Devices, Fire Alarm Devices, Nurse Call Devices" },
            new Row { Key = Finishes, Label = "Ханын өнгөлгөөний бүс (шалны хүрээ, хавтан)",
                      DimHint = "Босоо гинж: шалны хүрээ, хавтангийн дээд/доод ирмэг + шалнаас тааз хүртэл нийт",
                      CanTag = true, KeynoteOnly = true,
                      English = "Group: finish bands",
                      Categories = "БҮЛЭГ — нэг Revit ангилал БИШ: Wall Sweeps (шалны хүрээ, бүс) + харах гадаргуун өмнөх нимгэн (≤ 120 мм) Walls + гадаргуу дээрх "
                                   + "нимгэн (≤ 150 мм) Generic Models / Casework / Specialty Equipment (хавтан)" },
        };

        private const string ElementDim = "Хэвтээ гинж: элементийн хоёр зах (хоорондын зай)";

        /// <summary>
        /// Өгөгдмөл.  2026-10-07: «floors:spot» нэмэгдэв — жишээ хуудас 206A-G-ийн зүүн талын «0,00» (шалны дээд, давхраас харьцангуй).
        /// 2026-10-08: интерьерийн жишээ — өнгөлгөөний бүс, цахилгаан цэгийн байрлалын хэмжээс + шошго, тавилгын шошго («ЗТ-05»);
        /// мөн өдөр «finishes:keynote» — жишээ 215A-D: өнгөлгөөний хана «ЦАГААН ЭМУЛЬС» (дээр), шалны хүрээ «МЕТАЛЛ ХАР ШАЛНЫ ХҮРЭЭ» (доор).
        /// </summary>
        public const string DefaultSet =
            "doors:spot,windows:spot,ceilings:spot,floors:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim,electrical:dim,finishes:dim," +
            "doors:tag,windows:tag,furniture:tag,electrical:tag,finishes:keynote";

        /// <summary>2026-10-07-ноос ӨМНӨХ өгөгдмөл — хадгалсан тохиргоо яг үүнтэй тэнцүү бол (хэрэглэгч өөрчлөөгүй) шинэ өгөгдмөл рүү.</summary>
        public const string PreviousDefaultSet =
            "doors:spot,windows:spot,ceilings:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim," +
            "doors:tag,windows:tag";

        /// <summary>Хуучин өгөгдмөлүүд (шинэ → хуучин).  Хадгалсан сонголт аль нэгтэй нь яг тэнцүү бол шинэ өгөгдмөл рүү.</summary>
        public static readonly string[] PreviousDefaultSets =
        {
            "doors:spot,windows:spot,ceilings:spot,floors:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim,electrical:dim,finishes:dim," +
            "doors:tag,windows:tag,furniture:tag,electrical:tag",
            "doors:spot,windows:spot,ceilings:spot,floors:spot," +
            "walls:dim,doors:dim,windows:dim,ceilings:dim,floors:dim,levels:dim,grids:dim," +
            "doors:tag,windows:tag",
            PreviousDefaultSet,
        };

        public static string Cell(string row, string col) { return row + ":" + col; }

        public static Row Find(string key)
        {
            foreach (Row r in Rows) if (string.Equals(r.Key, key, StringComparison.Ordinal)) return r;
            return null;
        }

        /// <summary>Тухайн нүд сонгогдох боломжтой эсэх (жишээ: «Давхар» мөрөнд шошго байхгүй).</summary>
        public static bool Applicable(string row, string col)
        {
            Row r = Find(row);
            if (r == null) return false;
            switch (col)
            {
                case Spot: return r.SpotHint != null;
                case Dim: return r.DimHint != null;
                case Tag: return r.CanTag && !r.KeynoteOnly;
                case Keynote: return r.CanTag;
                default: return false;
            }
        }

        /// <summary>Хэзээ ч throw хийхгүй; танихгүй / хамаарахгүй нүдийг хаяна.</summary>
        public static HashSet<string> Parse(string csv)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(csv)) return set;
            foreach (string raw in csv.Split(',', ';', ' '))
            {
                string c = raw.Trim();
                int i = c.IndexOf(':');
                if (i <= 0) continue;
                if (Applicable(c.Substring(0, i), c.Substring(i + 1))) set.Add(c);
            }
            return set;
        }

        /// <summary>Тогтвортой дараалалтай (хүснэгтийн дарааллаар) — тохиргооны файл, тэмдэг өөрчлөгдөхгүй.</summary>
        public static string Format(IEnumerable<string> cells)
        {
            var set = new HashSet<string>(cells ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            var list = new List<string>();
            foreach (Row r in Rows)
                foreach (string col in new[] { Spot, Dim, Tag, Keynote })
                    if (set.Contains(Cell(r.Key, col)) && Applicable(r.Key, col)) list.Add(Cell(r.Key, col));
            return string.Join(",", list);
        }
    }

    // ── Оролт: загвараас уншсан эх өгөгдөл (сонголтын орчмоос НЭГ удаа) ─────────

    public sealed class WeLevelInfo
    {
        public long Id;
        public string Name;
        public double Z;
    }

    public enum WeSlabKind
    {
        Floor = 0,
        Ceiling = 1,
    }

    /// <summary>
    /// W08 (2026-10-16): шал/таазны хэмжих нүүрний ХАВТГАЙ (хэвтээ эсвэл налуу) — нүүрний аль ч цэгийн бодит өндөр.  Босоо нүүр биш
    /// (<see cref="Normal"/>.Z ≠ 0).  Revit-ийн PlanarFace-ээс (Origin, FaceNormal) — зохиомол утга БИШ.
    /// </summary>
    public sealed class WeSlabPlane
    {
        public WeV3 Origin;
        /// <summary>Нэгж нормаль.</summary>
        public WeV3 Normal;

        /// <summary>Хэвтээ биш (налуу шал/тааз, налуу зам).</summary>
        public bool Sloped { get { return Math.Abs(Math.Abs(Normal.Z) - 1) > 1e-3; } }

        /// <summary>Хавтгайн план цэг (x, y) дээрх өндөр.</summary>
        public double ZAt(double x, double y)
        {
            if (Math.Abs(Normal.Z) < 1e-9) return Origin.Z;
            return Origin.Z - (Normal.X * (x - Origin.X) + Normal.Y * (y - Origin.Y)) / Normal.Z;
        }
    }

    /// <summary>Хэвтээ элемент (шал/хучилт, тааз) — тэнхлэгт зэрэгцсэн хайрцгаар (дэлхийн).</summary>
    public sealed class WeSlabInfo
    {
        public long Id;
        public WeSlabKind Kind;
        public WeV3 Min;
        public WeV3 Max;
        /// <summary>
        /// Хэмжих нүүрний (таазны доод, шалны дээд) план дахь контур — нүүр бүр гадна + дотоод (нүх) хүрээ, XY.  null = мэдэгдэхгүй →
        /// хайрцгаар.  ХЭМЖСЭН (MITIC 218/219, 2026-10-08): олон өрөөг хамарсан L хэлбэрийн таазны ХАЙРЦАГ нь өрөөг «хамарч» гол тааз гэж
        /// сонгогдоод spot level нь «лавлагаа олдсонгүй» болсон (нүүр нь тэр өрөөнд огт байхгүй).
        /// </summary>
        public List<List<List<WeV3>>> Faces;
        /// <summary>
        /// W08: <see cref="Faces"/>-тэй ИЖИЛ индексээр нүүр бүрийн хавтгай (налуу нүүр ч — план дээрх контур нь проекц).  null (эсвэл тухайн
        /// мөр null) = мэдэгдэхгүй — өндөр хайрцгаар (шал — дээд, тааз — доод), өмнөх зан төлөв.
        /// </summary>
        public List<WeSlabPlane> Planes;

        /// <summary>Хэмжих нүүрний аль нэг нь налуу.</summary>
        public bool HasSlope { get { return Planes != null && Planes.Any(pl => pl != null && pl.Sloped); } }

        /// <summary>Цэг (план) хэмжих нүүр дээр (эсвэл контургүй үед хайрцагт) байх уу.</summary>
        public bool Covers(WeV3 p)
        {
            if (Faces == null || Faces.Count == 0)
                return p.X >= Min.X - 1e-6 && p.X <= Max.X + 1e-6 && p.Y >= Min.Y - 1e-6 && p.Y <= Max.Y + 1e-6;
            return FaceIndexAt(p) >= 0;
        }

        /// <summary>Цэгийг (план) агуулах хэмжих нүүрийн индекс (<see cref="Faces"/>); контургүй эсвэл гадна бол −1.</summary>
        public int FaceIndexAt(WeV3 p)
        {
            if (Faces == null) return -1;
            for (int k = 0; k < Faces.Count; k++)
            {
                List<List<WeV3>> face = Faces[k];
                if (face == null) continue;
                bool inside = false;
                foreach (List<WeV3> loop in face)
                    for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++)
                    {
                        WeV3 a = loop[i], b = loop[j];
                        if ((a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
                    }
                if (inside) return k;
            }
            return -1;
        }

        /// <summary>
        /// Хэмжих нүүрний (шал — дээд, тааз — доод) план цэг дээрх БОДИТ өндөр: нүүр нь хавтгайтай бол хавтгайгаас (налуу ч), үгүй бол хайрцгаас.
        /// Цэг нүүр дээр (эсвэл контургүй үед хайрцагт) байхгүй бол false.  <paramref name="face"/> = нүүрийн индекс (−1 = хайрцаг).
        /// </summary>
        public bool HeightAt(WeV3 p, out double z, out int face)
        {
            face = -1;
            z = Kind == WeSlabKind.Ceiling ? Min.Z : Max.Z;
            if (Faces == null || Faces.Count == 0) return Covers(p);
            face = FaceIndexAt(p);
            if (face < 0) return false;
            WeSlabPlane pl = Planes != null && face < Planes.Count ? Planes[face] : null;
            if (pl != null) z = pl.ZAt(p.X, p.Y);
            return true;
        }

        /// <summary>Нүүрний хавтгай (байхгүй бол null).</summary>
        public WeSlabPlane PlaneOf(int face)
        {
            return Planes != null && face >= 0 && face < Planes.Count ? Planes[face] : null;
        }
    }

    public enum WeInsertKind
    {
        Door = 0,
        Window = 1,
    }

    /// <summary>Хананд суусан хаалга/цонх.  Төв + хагас өргөн (ханын дагуу), доод/дээд өндөр (дэлхийн).</summary>
    public sealed class WeInsertInfo
    {
        public long Id;
        public WeInsertKind Kind;
        public string HostWallUid;
        public WeV3 Center;
        public double HalfWidth;
        public double BottomZ;
        public double TopZ;
    }

    /// <summary>
    /// Шошго, keynote, хэвтээ гинжид орж болох элемент (ангиллын түлхүүр = <see cref="WeAnno.Rows"/>-ийн мөр).  Хайрцаг нь
    /// тэнхлэгт зэрэгцсэн (дэлхийн); хана бол location line + зузаан нь илүү нарийн (эргэлттэй ханын хайрцаг хэт өргөн).
    /// </summary>
    public sealed class WeTaggable
    {
        public long Id;
        public string CategoryKey;
        public WeV3 Min;
        public WeV3 Max;
        /// <summary>Хана бол өөрийн UniqueId (ханын шошгыг зөвхөн дэлгээсийн ханад).</summary>
        public string WallUid;
        /// <summary>Хана: location line-ийн хоёр үзүүр, зузаан (бусад элементэд хэрэглэхгүй).</summary>
        public bool HasLine;
        public WeV3 LineA;
        public WeV3 LineB;
        public double Width;
        /// <summary>Элементийн төрлийн id (0 = мэдэгдэхгүй) — өнгөлгөөний keynote төрөл бүрээс НЭГ.</summary>
        public long TypeId;
        /// <summary>Гэрэлтүүлгийн хэрэгсэл (Lighting Fixtures) — «electrical» мөрөнд ордог ч таазны гэрлийг хананы цэгээс ялгана.</summary>
        public bool Lighting;
        /// <summary>
        /// Харагдах геометрийн ПЛАН дахь гүдгэр бүрхүүл (дэлхийн XY; Z ашиглахгүй) + босоо муж.  Тавилга, тогтмол тавилга, сантехник,
        /// ерөнхий модел, тусгай тоног — 2026-10-14 (эзэн: «тавилгын хэмжээсийг ЗӨВ тавь»).  Bounding box нь дэлхийн тэнхлэгт
        /// зэрэгцсэн тул эргүүлсэн тавилгыг томсгож (30° эргүүлсэн 1200×600 ширээ → 1339 өргөн), далд/clearance геометрийг ч
        /// агуулдаг байв — гинжийн хэмжээс тавилгын ирмэг дээр буудаггүй.  null = бүрхүүл уншигдаагүй (хайрцгаар).
        /// </summary>
        public List<WeV3> Hull;
        public double HullBottomZ;
        public double HullTopZ;
        public bool HasHull { get { return Hull != null && Hull.Count > 0; } }
    }

    /// <summary>Тэнхлэг (Grid) — план дахь шулуун.</summary>
    public sealed class WeGridInfo
    {
        public long Id;
        public string Name;
        public WeV3 A;
        public WeV3 B;
    }

    public sealed class WeAnnoSources
    {
        public List<WeLevelInfo> Levels = new List<WeLevelInfo>();
        public List<WeSlabInfo> Slabs = new List<WeSlabInfo>();
        public List<WeInsertInfo> Inserts = new List<WeInsertInfo>();
        public List<WeTaggable> Taggables = new List<WeTaggable>();
        public List<WeGridInfo> Grids = new List<WeGridInfo>();
        /// <summary>
        /// Өрөөний ДЭЭР байж болох бүтэц (шат, хашлага, налуу зам, link-ийн шал/тавилга/ерөнхий модел) — зөвхөн «таазны дээр трибун/шат
        /// байна уу» гэдгийг танихад (<see cref="WeAnnotationPlanner"/>).  Шошго, хэмжээсэнд ОРОХГҮЙ.  <see cref="WeTaggable.CategoryKey"/> =
        /// «stairs» эсвэл «floors» (шал — дээд/доод нүүрээр шалгана) эсвэл «other».
        /// </summary>
        public List<WeTaggable> Overheads = new List<WeTaggable>();
    }

    // ── Гаралт: нэг дэлгээсний тэмдэглэгээний төлөвлөгөө (дэлгээсийн ДОТООД координатаар) ──

    public enum WeRefKind
    {
        /// <summary>Түвшний хавтгай (Level).</summary>
        Level = 0,
        /// <summary>Шалны дээд гадаргуу.</summary>
        FloorTop = 1,
        /// <summary>Шалны доод гадаргуу (зузаан).</summary>
        FloorBottom = 2,
        /// <summary>Дээд давхрын хучилтын доод гадаргуу.</summary>
        SlabBottom = 3,
        /// <summary>Таазны доод гадаргуу.</summary>
        CeilingBottom = 4,
        InsertLeft = 5,
        InsertRight = 6,
        InsertTop = 7,
        InsertBottom = 8,
        /// <summary>Харах гадаргуугийн зүүн зах (хөрш хана / ханын үзүүр).</summary>
        FaceStart = 9,
        /// <summary>Харах гадаргуугийн баруун зах.</summary>
        FaceEnd = 10,
        /// <summary>Тэнхлэг (Grid).</summary>
        Grid = 11,
        /// <summary>Элементийн зүүн зах (сантехник, тавилга, дундах хана …).</summary>
        ElementLeft = 12,
        ElementRight = 13,
        /// <summary>Элементийн доод ирмэг (өнгөлгөөний бүс — хавтан, шалны хүрээ).</summary>
        ElementBottom = 14,
        /// <summary>Элементийн дээд ирмэг (шалны хүрээний дээд, хавтангийн дээд).</summary>
        ElementTop = 15,
        /// <summary>Элементийн хэвтээ төв (розетк, унтраалга — family-ийн «Center (Left/Right)»).</summary>
        ElementCenterX = 16,
        /// <summary>Элементийн босоо төв (розетк — family-ийн «Center (Elevation)»).</summary>
        ElementCenterY = 17,
    }

    /// <summary>
    /// Нэг лавлагааны ЗОРИЛТ.  <see cref="Pos"/> = дотоод координат: хэвтээ гинжид x (баруун), босоо гинжид y (дээш, хүрээний
    /// эхнээс).  Revit давхарга элементээс тохирох нүүр/хавтгайг <see cref="Tol"/> дотор хайна.
    /// </summary>
    public sealed class WeAnnoRef
    {
        public WeRefKind Kind;
        public long ElementId;
        public double Pos;
        public double Tol;
        /// <summary>
        /// Байрлал нь элементийн БОДИТ харагдах геометрээс (<see cref="WeTaggable.Hull"/>) — Revit тал зөвхөн тэр цэгт (≤ <see cref="Tol"/>)
        /// таарах нүүр/family хавтгай авна, олдохгүй бол тэр цэгт үл харагдах туслах шугам (хэмжээсийн утга ҮРГЭЛЖ зөв).
        /// </summary>
        public bool Exact;
    }

    /// <summary>Хэмжээсийн эгнээний бүлэг (тайлан, тест; <see cref="WeDimRow.Group"/>).</summary>
    public static class WeDimGroup
    {
        public const string Vertical1 = "v1";
        public const string Vertical2 = "v2";
        /// <summary>Нэг холимог гинж (<see cref="WeDimGrouping.Combined"/>).</summary>
        public const string Combined = "h";
        /// <summary>Тоноглол, тавилга, сантехник, ерөнхий модел …</summary>
        public const string Elements = "h-elements";
        /// <summary>Хаалга, цонх.</summary>
        public const string Openings = "h-openings";
        /// <summary>Дундах хана, тэнхлэг.</summary>
        public const string Reference = "h-reference";
        /// <summary>Нийт урт (хана → хана).</summary>
        public const string Overall = "h-overall";
        /// <summary>Шалны дээдээс таазны доод хүртэл (+ дээд хучилт) — өнгөлгөөний бүстэй үед нарийн гинжийн гадна.</summary>
        public const string ClearHeight = "v-clear";
        /// <summary>Цахилгаан цэгийн өндөр (шалнаас төв хүртэл) — дэлгээсийн ДОТОР.</summary>
        public const string PointHeight = "e-v";
        /// <summary>Цахилгаан цэгийн хэвтээ байрлал (ханын захаас төв хүртэл, ижил өндрийн цэгүүдийн гинж) — дэлгээсийн ДОТОР.</summary>
        public const string PointPosition = "e-h";
    }

    public sealed class WeDimRow
    {
        /// <summary>true = босоо хэмжээс (дэлгээсийн баруун талд), false = хэвтээ (доор).</summary>
        public bool Vertical;
        /// <summary><see cref="WeDimGroup"/>.</summary>
        public string Group;
        /// <summary>Хэмжээсийн шугамын байрлал: босоо бол x, хэвтээ бол y (дотоод).</summary>
        public double At;
        public List<WeAnnoRef> Refs = new List<WeAnnoRef>();
        public string What;
    }

    public sealed class WeSpot
    {
        public WeAnnoRef Target;
        /// <summary>Лавлагаа дээрх цэг (дотоод x, y; z = гүн).</summary>
        public double X;
        public double Y;
        public double Depth;
        public bool Leader;
        /// <summary>Leader-тэй бол тэмдгийн байрлал (дотоод x).</summary>
        public double EndX;
        /// <summary>
        /// ТОЛИН (2026-10-14, интерьерийн баг: «шал, таазны сумыг жишээ зургийнх шиг mirrored»): бичвэр тэмдгийн ГАДНА талд — «2,81 ▽———» (зурагнаас
        /// холдох тал), өмнө нь «▽ 2,81———» (тэмдэг, зургийн хооронд).  ХЭМЖСЭН (Revit 2024, gate DIAG-SPOT-FADE-FRAME): spot-ын бичвэр leader-ийн
        /// мөрний (shoulder) ТАЛД, төгсгөлөөс 6.35 мм-т гардаг — тиймээс bend-ийг төгсгөлөөс гадагш тавина.
        /// </summary>
        public bool Mirrored;
        public string What;
    }

    public sealed class WeTagItem
    {
        public long ElementId;
        public string CategoryKey;
        public bool Keynote;
        public double HeadX;
        public double HeadY;
        public double AnchorX;
        public double AnchorY;
        public bool Leader;
    }

    /// <summary>
    /// Дэлгээст ТАНИГДСАН элемент — ангиллаар (харагдах хүрээ, гүнд байгаа; нүх нь энэ талын хананд суусан).  Хэрэглэгчид «энэ дэлгээс юу
    /// харж байна, юуг хэмжиж/шошголох вэ» гэдгийг харуулна.  Тэмдгийн хураангуйд ОРОХГҮЙ (харагдацыг шинэчлүүлэхгүй).
    /// </summary>
    public sealed class WeCensusEntry
    {
        /// <summary><see cref="WeAnno.Rows"/>-ийн мөрийн түлхүүр.</summary>
        public string CategoryKey;
        public string Label;
        public int Count;
        /// <summary>Хэвтээ/босоо хэмжээст орно (хэрэглэгчийн сонголтоор).</summary>
        public bool Dimensioned;
        /// <summary>Шошго эсвэл keynote тавина.</summary>
        public bool Tagged;
        /// <summary>Spot level тавина.</summary>
        public bool Spotted;
    }

    public sealed class WeAnnotationPlan
    {
        /// <summary>Танигдсан элемент (ангиллын хүснэгтийн дарааллаар).</summary>
        public List<WeCensusEntry> Census = new List<WeCensusEntry>();
        public List<WeDimRow> Rows = new List<WeDimRow>();
        public List<WeSpot> Spots = new List<WeSpot>();
        public List<WeTagItem> Tags = new List<WeTagItem>();
        public List<string> Notes = new List<string>();
        /// <summary>Тэмдэглэгээний хураангуй — харагдацын тэмдэгт залгагдана (өөрчлөгдвөл дэлгээс «шинэчлэгдэнэ»).</summary>
        public string Digest = string.Empty;
        /// <summary>Хамгийн гадна босоо эгнээний x (түвшний тэмдгийг цааш гаргахад) — эгнээгүй бол NaN.</summary>
        public double OuterVerticalX = double.NaN;
        /// <summary>
        /// Таазаар тасалсан хүрээний дээд хил (дотоод y) — таазны ДЭЭР трибун/шат байгаа өрөөнд (эзний шийдвэр 2026-10-14).  NaN = таслаагүй.
        /// <see cref="WePlanner"/> дэлгээсийн хүрээг энэ хүртэл БАГАСГАНА.
        /// </summary>
        public double CeilingCutY = double.NaN;
        /// <summary>
        /// Spot level-ийн суурь — өрөөний ДАВХРЫН host түвшин (2026-10-14, интерьерийн баг: «6-р давхарт шал ±0.00, тааз шалнаас»).
        /// Revit давхарга spot бүрийн «Relative Base»-ийг үүгээр тавина — нэрээр биш (link-ийн өрөөний давхрын нэр host-ынхоос өөр байж болно).
        /// 0 = олдсонгүй.
        /// </summary>
        public long BaseLevelId;
        public string BaseLevelName;
        /// <summary>
        /// ТОД хэсгийн дээд хил (дотоод y) — түүнээс хүрээний орой хүртэл БҮДЭГ (2026-10-14, интерьерийн баг 3-р тойрог; <see cref="WeFadeMode"/>).
        /// NaN = бүдэгрүүлэхгүй.  Revit давхарга masking region + тунгалаг байдлаар зурна (<c>WeAnnotator.Decorate</c>).
        /// </summary>
        public double FadeFromY = double.NaN;

        public bool IsEmpty { get { return Rows.Count == 0 && Spots.Count == 0 && Tags.Count == 0; } }
    }
}
