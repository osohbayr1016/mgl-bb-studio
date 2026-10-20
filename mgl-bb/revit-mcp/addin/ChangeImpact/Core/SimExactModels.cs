using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum SimClashState
    {
        /// <summary>Revit-ийн boolean ХОЁР элементийн ЭЗЭЛХҮҮН огтлолцож байгааг баталсан.</summary>
        Confirmed = 0,
        /// <summary>Шалгагдсан, огтлолцол алга (эсвэл босгоос бага).</summary>
        NoClash,
        /// <summary>Бодис байхгүй / дэмжигдэхгүй — «шалгаж чадсангүй» (клаш байхгүй гэж ХЭЗЭЭ Ч хэлэхгүй).</summary>
        Unsupported,
        /// <summary>Геометр/boolean алдаа.</summary>
        Error,
    }

    /// <summary>Revit sandbox-д (зөөсний ДАРАА, settled) шалгасан нэг хос.</summary>
    public sealed class SimExactClash
    {
        public string Key { get; set; }
        public long Id { get; set; }
        public int Slot { get; set; } = -1;
        public string Label { get; set; }
        public string CategoryName { get; set; }
        public string LinkName { get; set; }
        public SimKind Kind { get; set; }
        public SimClashState State { get; set; }
        public double VolumeCm3 { get; set; }
        /// <summary>Огтлолцлын хүрээ [minX,minY,minZ,maxX,maxY,maxZ] — local мм.  null = тодорхойгүй.</summary>
        public double[] BoxMm { get; set; }
        public string Reason { get; set; }
        /// <summary>Revit ийм элементийг автоматаар засна (нэгдсэн хана) — мэдээллийн шинжтэй.</summary>
        public bool Reactive { get; set; }
        /// <summary>Хөдөлгөөнгүй (ӨМНӨХ) төлөвд ч аль хэдийн давхцсан (хаалга нүхэндээ, нэгдсэн хана) — шинэ мөргөлдөөн БИШ.</summary>
        public bool PreExisting { get; set; }
        public double BeforeVolumeCm3 { get; set; }
        /// <summary>Шинэ мөргөлдөөн: өмнө байгаагүй, эсвэл ӨМНӨХӨӨС 25% + 20 см³-ээс илүү өссөн.</summary>
        public bool IsNew { get { return !PreExisting || VolumeCm3 > BeforeVolumeCm3 * 1.25 + 20; } }
    }

    public sealed class SimRoomChange
    {
        public long Id { get; set; }
        public string Name { get; set; }
        public double BeforeM2 { get; set; }
        public double AfterM2 { get; set; }
        /// <summary>Зөөлтийн дараа өрөө хаагдахаа больсон / талбай 0 / байрлал алдагдсан.</summary>
        public bool NotEnclosed { get; set; }
        public bool Deleted { get; set; }
        public double DeltaM2 { get { return AfterM2 - BeforeM2; } }
    }

    public sealed class SimDeletedElement
    {
        public long Id { get; set; }
        public string Label { get; set; }
        public SimKind Kind { get; set; }
        /// <summary>Хэрэглэгчид харагддаг элемент (хостлогдсон, хэмжээс, шошго, нэр дэвшигч) — таниагүй (Revit-ийн дотоод) бол false.</summary>
        public bool Known { get; set; }
    }

    /// <summary>Хөдөлж буй элементтэй хамт өөрчлөгдөх (хэмжээс, шошго, хостлогдсон хаалга…).</summary>
    public sealed class SimDependent
    {
        public long Id { get; set; }
        public string Label { get; set; }
        public string Category { get; set; }
        public SimKind Kind { get; set; }
        /// <summary>Хост дагаж хөдөлнө / шинэчлэгдэнэ.</summary>
        public bool Follows { get; set; } = true;
    }

    /// <summary>
    /// Зөөлтийн үр дүнд Revit-ээр ӨӨРӨӨ өөрчлөгдөх бие (элемент) — баганыг дагаж төгсгөл нь шилжих дам нуруу, нэгдсэн хана, холбогдсон суваг, нүх нь
    /// шинэчлэгдэх шал…  Хэмжсэн (Revit 2027, Snowdon Towers, 2026-10-06): нэг баганыг 1.5 м зөөхөд Revit 73 элементийг өөрчилсөн, тайлан тэднийг
    /// «73 элемент шинэчилнэ» гэж л хэлдэг байв — хэний ажил хөндөгдөхийг тодорхойлох гол мэдээлэл.
    /// </summary>
    public sealed class SimAffected
    {
        public long Id { get; set; }
        public string Label { get; set; }
        public string Category { get; set; }
        public SimKind Kind { get; set; }
        /// <summary>Байрлал (шугам/цэг/хүрээ) нь ӨӨРЧЛӨГДСӨН эсэх: true = дагаж шилжсэн/сунасан; false = зөвхөн холболт/нэгдэл/зүсэлт шинэчлэгдсэн; null = мэдэгдэхгүй (шууд зөөлт).</summary>
        public bool? LocationChanged { get; set; }
        /// <summary>Шинжилгээний үеийн (зөөсний ДАРАА) байрлал — буцаалтын дараа анхныхтай харьцуулахад (мм).</summary>
        public double[] SettledLoc { get; set; }
    }

    /// <summary>Revit-ийн sandbox-ийн ЭЦСИЙН дүн (нэг offset-д).  Хулганаар чирэх бүрт БИШ — суусны (settle) дараа нэг удаа.</summary>
    public sealed class SimExactResult
    {
        public int Generation { get; set; }
        /// <summary>Аль offset-д (мм) тооцсон.</summary>
        public double[] OffsetMm { get; set; } = new double[3];
        public SandboxOutcome Outcome { get; set; }
        public List<string> BlockReasons { get; set; } = new List<string>();
        public List<FailureNote> Failures { get; set; } = new List<FailureNote>();

        public bool ClashesEvaluated { get; set; }
        /// <summary>Host файлын хос шалгалт БҮРЭН дууссан (cap, цагийн хязгаарт хүрээгүй).  false бол «клаш байхгүй» гэж хэлэхгүй.</summary>
        public bool ClashesComplete { get; set; }
        public List<SimExactClash> Clashes { get; set; } = new List<SimExactClash>();

        public bool RoomsEvaluated { get; set; }
        public List<SimRoomChange> Rooms { get; set; } = new List<SimRoomChange>();

        public List<SimDeletedElement> Deleted { get; set; } = new List<SimDeletedElement>();
        public List<SimDependent> Dependents { get; set; } = new List<SimDependent>();
        public int ModifiedCount { get; set; }
        /// <summary>Revit өөрөө өөрчлөх БИЕ (зөөгдсөн, хостлогдсон, шошго/хэмжээсээс бусад) — `SimAffected`.</summary>
        public List<SimAffected> Affected { get; set; } = new List<SimAffected>();

        /// <summary>Зөөсний ДАРАА (Revit settled) зөөгдсөн элемент(үүд)-ийн жинхэнэ геометр — local мм, ЭЦСИЙН байрлалд.  Дэлгэцэнд «Revit-ийн бодит үр дүн» гэж харуулна.  Хоосон байж болно.</summary>
        public List<SimMesh> SettledMoving { get; set; } = new List<SimMesh>();
        /// <summary>Хөдөлгөөнөөс болж өөрчлөгдсөн бусад элемент (хөрш хана г.м.)-ийн settled геометр — зөвхөн харуулахад.</summary>
        public List<SimMesh> SettledAffected { get; set; } = new List<SimMesh>();

        /// <summary>Шалгалт бүрэн БИШ шалтгаанууд (шийдвэрт нөлөөлнө: «клаш илрээгүй» ≠ «байхгүй»).</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        /// <summary>Мэдээллийн шинжтэй (линк unload, workset…) — шийдвэрт нөлөөлөхгүй, харин ИЛ хэлнэ.</summary>
        public List<string> AdvisoryReasons { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
        public double ElapsedMs { get; set; }
        /// <summary>Шинжилгээний үеийн загварын өөрчлөлтийн тэмдэг — Apply-ийн хуучирсан эсэхийг шалгана.</summary>
        public string Stamp { get; set; }
        /// <summary>Зөөлтийн ДАРАА (settled) байрлал: элемент бүрийн байрлалын шугам/цэг эсвэл bbox (мм, дэлхийн) — Apply-ийн бодит үр дүнтэй тулгана.</summary>
        public Dictionary<long, double[]> SettledLocations { get; set; } = new Dictionary<long, double[]>();
        public List<long> DeletedIds { get; set; } = new List<long>();
        public Dictionary<string, double> StageMs { get; set; } = new Dictionary<string, double>();

        public bool Matches(SimVec offset)
        {
            return OffsetMm != null && OffsetMm.Length >= 3
                && Math.Abs(OffsetMm[0] - offset.X) < 0.5 && Math.Abs(OffsetMm[1] - offset.Y) < 0.5 && Math.Abs(OffsetMm[2] - offset.Z) < 0.5;
        }
    }
}
