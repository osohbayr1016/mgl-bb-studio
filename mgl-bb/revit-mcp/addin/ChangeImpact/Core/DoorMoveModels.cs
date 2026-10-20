using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /* ====================================================================== */
    /*  ХААЛГА ЗӨӨХ (DoorMove) — ХУУЛСАН (detached) домэйн загвар.             */
    /*  Revit-гүй ЦЭВЭР.  Бүх урт SI (мм).  Revit обьект ХЭЗЭЭ Ч хадгалахгүй.     */
    /*                                                                        */
    /*  ХАЛГА = ЭНЭ ХАНЫН ДАГУУ скаляр: хаалганы төвийн ХОСТЫН ПАРАМЕТР `s` (мм)  */
    /*  = (P − хостын эхлэл) · хостын чиглэл.  Шинэ байрлал = s + offset.        */
    /*  Хаалга хостоо хадгална; дурын XYZ харьцуулалтыг ХЭРЭГЛЭХГҮЙ.            */
    /* ====================================================================== */

    /// <summary>Элементийн ТӨРӨЛ (Revit-ийн BuiltInCategory-ийг Revit давхарга энд буулгана).  Шийдвэрийн ангилал үүгээр.</summary>
    public enum ObstacleKind
    {
        Unknown = 0,
        Column,
        /// <summary>Бүтцийн тулгуур/тусгаар (structural framing, brace).</summary>
        Structure,
        Wall,
        Door,
        Window,
        /// <summary>Ханын тэгш өнцөгт нүх (Opening).</summary>
        Opening,
        Furniture,
        /// <summary>Тоног төхөөрөмж, сантехникийн, цахилгааны хэрэгсэл.</summary>
        Equipment,
        Fixture,
        Generic,
        Mep,
        Room,
    }

    /// <summary>Шийдвэрийн ангилал: батлагдсан физик огтлолцол ямар ноцтой вэ.</summary>
    public enum ObstacleClass
    {
        /// <summary>Багана, бүтэц, хана — батлагдсан геометрийн огтлолцол = 🔴.</summary>
        Structural = 0,
        /// <summary>Өөр хаалга/цонх/нүх — нүх давхцвал = 🔴.</summary>
        Opening,
        /// <summary>Тавилга, төхөөрөмж — батлагдсан геометр огтлолцол = 🟠 (хянах).</summary>
        Furnishing,
        /// <summary>MEP — шинэ хатуу clash = 🔴 (ClashNew).</summary>
        Mep,
        Other,
    }

    public static class ObstacleKinds
    {
        public static ObstacleClass ClassOf(ObstacleKind k)
        {
            switch (k)
            {
                case ObstacleKind.Column:
                case ObstacleKind.Structure:
                case ObstacleKind.Wall:
                    return ObstacleClass.Structural;
                case ObstacleKind.Door:
                case ObstacleKind.Window:
                case ObstacleKind.Opening:
                    return ObstacleClass.Opening;
                case ObstacleKind.Furniture:
                case ObstacleKind.Equipment:
                case ObstacleKind.Fixture:
                case ObstacleKind.Generic:
                    return ObstacleClass.Furnishing;
                case ObstacleKind.Mep:
                    return ObstacleClass.Mep;
                default:
                    return ObstacleClass.Other;
            }
        }

        public static string Label(ObstacleKind k)
        {
            switch (k)
            {
                case ObstacleKind.Column: return "Багана";
                case ObstacleKind.Structure: return "Бүтэц";
                case ObstacleKind.Wall: return "Хана";
                case ObstacleKind.Door: return "Хаалга";
                case ObstacleKind.Window: return "Цонх";
                case ObstacleKind.Opening: return "Нүх";
                case ObstacleKind.Furniture: return "Тавилга";
                case ObstacleKind.Equipment: return "Төхөөрөмж";
                case ObstacleKind.Fixture: return "Хэрэгсэл";
                case ObstacleKind.Generic: return "Элемент";
                case ObstacleKind.Mep: return "MEP";
                case ObstacleKind.Room: return "Өрөө";
                default: return "Элемент";
            }
        }
    }

    /// <summary>Хаалганы нүхний өргөн хаанаас ирснийг мэдэх нь чухал: параметр = найдвартай, bbox = ойролцоо, байхгүй = мэдэгдэхгүй.</summary>
    public enum WidthSource
    {
        Unknown = 0,
        /// <summary>Family-ийн «Rough Width» / «Width» параметр — нүхний бодит хэмжээ.</summary>
        Parameter,
        /// <summary>Хаалганы bounding box-ийн хостын дагуух өргөн (хүрээ, нарийн зурвас орно) — ойролцоо.</summary>
        BBox,
    }

    /// <summary>Хостын (шулуун ханын) геометр — хостын координат (s, n): s = дагуу (эхлэлээс), n = хөндлөн (зүүн нормаль).</summary>
    public sealed class HostGeometry
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Label { get; set; }
        public double StartX { get; set; }
        public double StartY { get; set; }
        public double EndX { get; set; }
        public double EndY { get; set; }
        public double ThicknessMm { get; set; }
        public double ZMinMm { get; set; }
        public double ZMaxMm { get; set; }
        /// <summary>Хостын эхлэл/төгсгөлд холбогдсон хөрш хананы зузаан (мм).  0 = чөлөөт төгсгөл.</summary>
        public double StartJoinThicknessMm { get; set; }
        public double EndJoinThicknessMm { get; set; }

        public double LengthMm
        {
            get { double dx = EndX - StartX, dy = EndY - StartY; return Math.Sqrt(dx * dx + dy * dy); }
        }

        /// <summary>Нэгж чиглэл (эхлэл → төгсгөл).  Урт 0 бол (0,0).</summary>
        public double TangentX { get { double l = LengthMm; return l < 1e-9 ? 0 : (EndX - StartX) / l; } }
        public double TangentY { get { double l = LengthMm; return l < 1e-9 ? 0 : (EndY - StartY) / l; } }
        /// <summary>Зүүн нормаль (−ty, tx).</summary>
        public double NormalX { get { return -TangentY; } }
        public double NormalY { get { return TangentX; } }
    }

    /// <summary>Хаалганы ӨӨРИЙН өгөгдөл (зөөхөөс өмнө).</summary>
    public sealed class DoorBody
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        /// <summary>«D-120» (Mark) эсвэл төрлийн нэр.</summary>
        public string Label { get; set; }
        public string TypeName { get; set; }
        /// <summary>Хаалганы төвийн ХОСТЫН ПАРАМЕТР (мм) — байрлалын цэгийн проекц.</summary>
        public double CenterParamMm { get; set; }
        /// <summary>Хаалганы төвийн ХӨНДЛӨН байрлал хостын шугамаас (мм).  Дүүргэх хайрцагт.</summary>
        public double CenterNormalMm { get; set; }
        /// <summary>Нүхний өргөн (мм).  `WidthSource == Unknown` бол 0 — «мэдэхгүй», 0 өргөн БИШ.</summary>
        public double WidthMm { get; set; }
        public WidthSource WidthSource { get; set; }
        /// <summary>Зөвхөн ХАРАА зурахад (ghost): өргөн мэдэгдэхгүй үед ч нэрлэсэн хэмжээ.  Шийдвэрт ХЭЗЭЭ Ч хэрэглэгдэхгүй.</summary>
        public double GhostWidthMm { get; set; }
        public double HeightMm { get; set; }
        public double ZMinMm { get; set; }
        public double ZMaxMm { get; set; }
        /// <summary>Хаалганы ойролцоо гүн (хөндлөн, мм) — ханын зузаан эсвэл bbox-ийн хөндлөн хэмжээ.</summary>
        public double DepthMm { get; set; }
        public long FromRoomId { get; set; }
        public long ToRoomId { get; set; }
        public string FromRoomLabel { get; set; }
        public string ToRoomLabel { get; set; }
        public bool RoomsReadable { get; set; }

        public bool WidthKnown { get { return WidthSource != WidthSource.Unknown && WidthMm > 0; } }

        /// <summary>Ghost-ийн өргөн: мэдэгдсэн өргөн, үгүй бол нэрлэсэн (`GhostWidthMm`).</summary>
        public double DrawWidthMm { get { return WidthKnown ? WidthMm : (GhostWidthMm > 0 ? GhostWidthMm : 900); } }
    }

    /// <summary>Ижил хост дээрх БУСАД хаалга/цонх/нүх — тэдний ХОСТЫН дагуух эзлэх зайг тооцно.</summary>
    public sealed class OpeningSpan
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Label { get; set; }
        public ObstacleKind Kind { get; set; }
        public double CenterParamMm { get; set; }
        public double WidthMm { get; set; }
        public WidthSource WidthSource { get; set; }
        /// <summary>Нүхний хайрцаг (мм, AABB) — дэлгэцийн тодруулга.  null = уншигдаагүй.</summary>
        public double[] BoxMm { get; set; }
        public bool WidthKnown { get { return WidthSource != WidthSource.Unknown && WidthMm > 0; } }
    }

    /// <summary>Хаалганы эргэн тойрны элемент — хайрцаг (мм, AABB) ба төрөл.  Fast scan, замын нөлөө, дэлгэцийн тодруулга.</summary>
    public sealed class ObstacleBox
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Label { get; set; }
        public ObstacleKind Kind { get; set; }
        /// <summary>[minX,minY,minZ,maxX,maxY,maxZ] мм (хост загварын координат; линкийнх transform-той хөрвүүлсэн).</summary>
        public double[] BoxMm { get; set; }
        public string LinkName { get; set; }
        /// <summary>Линк загварын instance-ийн id (host-ын).  0 = host загвар.</summary>
        public long LinkInstanceId { get; set; }

        public string Key { get { return LinkInstanceId + ":" + Id; } }
    }

    /// <summary>
    /// Нэг хаалганы ХУУЛСАН хамаарлын контекст — зөөх зайнаас ХАМААРАХГҮЙ.  600 → 620 мм-д ДАХИН БАРИХГҮЙ (кэшлэгдэнэ; өөрчлөлтийн тэмдэг солигдвол хүчингүй).
    /// ⚠️ Амьд Revit обьект ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ.
    /// </summary>
    public sealed class DoorMoveContext
    {
        public HostGeometry Host { get; set; }
        public DoorBody Door { get; set; }
        public List<OpeningSpan> Openings { get; set; } = new List<OpeningSpan>();
        public List<ObstacleBox> Obstacles { get; set; } = new List<ObstacleBox>();
        /// <summary>Хаалганы From/To болон ойролцоох өрөөний хайрцаг (дэлгэцийн тодруулга) — id → хайрцаг.</summary>
        public List<ObstacleBox> Rooms { get; set; } = new List<ObstacleBox>();
        /// <summary>Нэр дэвшигч цуглуулалт бүрэн биш (хязгаар, уншигдаагүй) — fast scan «бүрэн» гэж хэлж БОЛОХГҮЙ.</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
        /// <summary>Контекст бүтэхэд загварын өөрчлөлтийн тэмдэг (`ModelChangeCounter.Stamp`).  Өөрчлөгдвөл контекст ХУУЧИРСАН — шинээр барина.</summary>
        public string ModelStamp { get; set; }
        /// <summary>Контекстыг бүтээхэд зарцуулсан хугацаа (мс) — хэмжилт.</summary>
        public long BuildMs { get; set; }

        /// <summary>id (линкгүй) → хайрцаг.  Тодруулга, report-ийн мөрийг хайрцагтай холбоход.</summary>
        public ObstacleBox FindBox(long id, long linkInstanceId = 0)
        {
            ObstacleBox b = Obstacles.FirstOrDefault(o => o.Id == id && o.LinkInstanceId == linkInstanceId);
            if (b != null) return b;
            b = Rooms.FirstOrDefault(o => o.Id == id && o.LinkInstanceId == linkInstanceId);
            if (b != null || linkInstanceId != 0) return b;
            OpeningSpan op = Openings.FirstOrDefault(o => o.Id == id && o.BoxMm != null);
            return op == null ? null : new ObstacleBox { Id = op.Id, Uid = op.Uid, Label = op.Label, Kind = op.Kind, BoxMm = op.BoxMm };
        }

        /// <summary>`ObstacleBox.Key` («линк:id») → хайрцаг.  Таарахгүй/буруу бол null.</summary>
        public ObstacleBox FindByKey(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            int c = key.IndexOf(':');
            long link, id;
            if (c <= 0 || !long.TryParse(key.Substring(0, c), out link) || !long.TryParse(key.Substring(c + 1), out id)) return null;
            return FindBox(id, link);
        }
    }

    /// <summary>`DoorHostMath.Check`-ийн дүн — зорилтот байрлал хостын дотор уу?</summary>
    public sealed class DoorTargetCheck
    {
        public bool Ok { get; set; }
        /// <summary>Машин код: `ok` · `no.move` · `bad.input` · `outside.host`.</summary>
        public string Code { get; set; }
        /// <summary>Яагаад — Монголоор.</summary>
        public string Problem { get; set; }
        /// <summary>Revit энэ байрлалыг ХИЙЛГЭХГҮЙ нь тодорхой (хост гадна) → «зөөхгүй» (🔴).  false = зүгээр л хөдөлгөөнгүй.</summary>
        public bool Refused { get; set; }
        public double TargetParamMm { get; set; }
        /// <summary>Шинэ байрлал дахь нүхний [эхлэл, төгсгөл] (хост дагуу, мм).  Өргөн мэдэгдэхгүй бол хоёулаа төв.</summary>
        public double IntervalStartMm { get; set; }
        public double IntervalEndMm { get; set; }
        /// <summary>Нүхний захаас хостын эхлэл/төгсгөл хүртэлх зай (мм; сөрөг = хэтэрнэ).</summary>
        public double GapToStartMm { get; set; }
        public double GapToEndMm { get; set; }
    }
}
