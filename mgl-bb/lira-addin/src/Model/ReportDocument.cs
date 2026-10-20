using System.Collections.Generic;
using System.Runtime.Serialization;

namespace MglLiraReport.Model
{
    /// <summary>
    /// Тооцооны тайлангийн бүх агуулга — нэг .mglrep файлд (zip: report.json + images/) хадгалагдана.
    /// Энэ JSON нь цаашид «загвар» болох өгөгдөл тул талбарын нэрийг бүү өөрчил; шинэ талбар нэмэхэд
    /// хуучин файл уншигдсаар байх ёстой (DataContract нь дутуу талбарыг default-оор үлдээдэг).
    /// </summary>
    [DataContract]
    public class ReportDocument
    {
        public const string CurrentSchema = "mgl-lira-report/1";
        public const string KindConcrete = "rc";
        public const string KindSteel = "steel";

        [DataMember(Order = 1)] public string Schema { get; set; } = CurrentSchema;
        /// <summary>rc = Төмөр бетон бүтээц, steel = Металл бүтээц.</summary>
        [DataMember(Order = 2)] public string Kind { get; set; } = KindConcrete;
        [DataMember(Order = 3)] public ProjectInfo Project { get; set; } = new ProjectInfo();
        [DataMember(Order = 4)] public List<ReportPage> Pages { get; set; } = new List<ReportPage>();

        public static ReportDocument CreateNew(string kind)
        {
            var doc = new ReportDocument { Kind = kind };
            doc.Pages.Add(new ReportPage { Kind = ReportPage.KindCover, Title = "Нүүр хуудас" });
            doc.Pages.Add(new ReportPage { Kind = ReportPage.KindInfo, Title = "Төслийн мэдээлэл" });
            return doc;
        }

        /// <summary>Хуучин/гараар засагдсан файлд null үлдсэн жагсаалтуудыг нөхнө.</summary>
        public void Normalize()
        {
            if (Project == null) Project = new ProjectInfo();
            Project.Normalize();
            if (Pages == null) Pages = new List<ReportPage>();
            if (!Pages.Exists(p => p.Kind == ReportPage.KindCover))
                Pages.Insert(0, new ReportPage { Kind = ReportPage.KindCover, Title = "Нүүр хуудас" });
            if (!Pages.Exists(p => p.Kind == ReportPage.KindInfo))
                Pages.Insert(1, new ReportPage { Kind = ReportPage.KindInfo, Title = "Төслийн мэдээлэл" });
            foreach (var p in Pages) p.Normalize();
            if (string.IsNullOrEmpty(Kind)) Kind = KindConcrete;
        }
    }

    [DataContract]
    public class ProjectInfo
    {
        // Төсөл
        /// <summary>Нүүр хуудасны гарчиг; «\n» = мөр шилжүүлэг (жишээнд «…ТООЦООНЫ / ТАЙЛАН»).</summary>
        [DataMember(Order = 1)] public string Title { get; set; } = "БАРИЛГА БҮТЭЭЦИЙН ТООЦООНЫ\nТАЙЛАН";
        [DataMember(Order = 2)] public string Name { get; set; } = "";
        [DataMember(Order = 3)] public string Location { get; set; } = "";
        [DataMember(Order = 4)] public string Shifr { get; set; } = "";
        [DataMember(Order = 5)] public string Client { get; set; } = "";
        [DataMember(Order = 6)] public string ClientAddress { get; set; } = "";

        // Гүйцэтгэгч
        [DataMember(Order = 7)] public string Company { get; set; } = "\"ЭМ ЖИ ЭЛ И ЭН СИ\" ХХК";
        [DataMember(Order = 8)] public string Director { get; set; } = "";
        /// <summary>Нүүр хуудасны «Гүйцэтгэсэн инженер» ба булангийн хүснэгтийн «Гүйцэтгэсэн».</summary>
        [DataMember(Order = 9)] public string Engineer { get; set; } = "";
        /// <summary>Булангийн хүснэгтэд гарах гарын үсгийн зураг (images/ доторх id), сонголттой.</summary>
        [DataMember(Order = 10)] public string EngineerSignatureImage { get; set; }
        [DataMember(Order = 11)] public List<AuthorInfo> Authors { get; set; } = new List<AuthorInfo>();

        // Тооцоо
        [DataMember(Order = 12)] public string Program { get; set; } = "Лира 10.12";
        [DataMember(Order = 13)] public string License { get; set; } = "";
        [DataMember(Order = 14)] public string Date { get; set; } = "";
        [DataMember(Order = 15)] public string Year { get; set; } = "";

        // Компанийн тогтмол мэдээлэл (нүүр хуудас)
        [DataMember(Order = 16)] public string CoverLine1 { get; set; } = "БАРИЛГЫН ЗУРАГ ТӨСЛИЙН";
        [DataMember(Order = 17)] public string CoverLine2 { get; set; } = "\"Эм Жи Эл И Эн Си\" ХХК";
        [DataMember(Order = 18)] public string CompanyAddress { get; set; } =
            "Улаанбаатар хот, Чингэлтэй дүүрэг 5-р хороо, Самбуугийн гудамж\n" +
            "МН Тауэр, 2008 тоот\n" +
            "Утас: 976-77034425, 976-96999996\n" +
            "Шуудан: structure@mglenc.com";

        public void Normalize()
        {
            if (Authors == null) Authors = new List<AuthorInfo>();
            Title = Title ?? ""; Name = Name ?? ""; Location = Location ?? ""; Shifr = Shifr ?? "";
            Client = Client ?? ""; ClientAddress = ClientAddress ?? ""; Company = Company ?? "";
            Director = Director ?? ""; Engineer = Engineer ?? ""; Program = Program ?? "";
            License = License ?? ""; Date = Date ?? ""; Year = Year ?? "";
            CoverLine1 = CoverLine1 ?? ""; CoverLine2 = CoverLine2 ?? ""; CompanyAddress = CompanyAddress ?? "";
        }
    }

    [DataContract]
    public class AuthorInfo
    {
        [DataMember(Order = 1)] public string Name { get; set; } = "";
        [DataMember(Order = 2)] public string Qualification { get; set; } = "";
    }

    [DataContract]
    public class ReportPage
    {
        public const string KindCover = "cover";
        public const string KindInfo = "info";
        public const string KindContent = "content";

        [DataMember(Order = 1)] public string Kind { get; set; } = KindContent;
        /// <summary>Зөвхөн хуудасны жагсаалтад харагдах нэр — Word-д гарахгүй.</summary>
        [DataMember(Order = 2)] public string Title { get; set; } = "";
        [DataMember(Order = 3)] public List<ReportBlock> Blocks { get; set; } = new List<ReportBlock>();

        public bool IsFixed => Kind == KindCover || Kind == KindInfo;

        public void Normalize()
        {
            if (Blocks == null) Blocks = new List<ReportBlock>();
            foreach (var b in Blocks) b.Normalize();
            if (string.IsNullOrEmpty(Kind)) Kind = KindContent;
            Title = Title ?? "";
        }
    }

    [DataContract]
    public class ReportBlock
    {
        public const string KindHeading = "heading";
        public const string KindText = "text";
        public const string KindImage = "image";

        [DataMember(Order = 1)] public string Kind { get; set; } = KindText;
        /// <summary>Гарчгийн түвшин 1..3.</summary>
        [DataMember(Order = 2)] public int Level { get; set; } = 1;
        [DataMember(Order = 3)] public string Text { get; set; } = "";
        /// <summary>Зургийн блок: 1 эсвэл 2 зураг (2 бол зэрэгцээ).</summary>
        [DataMember(Order = 4)] public List<ImageRef> Images { get; set; } = new List<ImageRef>();
        /// <summary>Ганц зургийн өргөн, бичих талбайн хувиар (20..100).</summary>
        [DataMember(Order = 5)] public int WidthPercent { get; set; } = 90;
        /// <summary>Гарчиг/текстийн байрлал: "" (зүүн/тэгшлэх) эсвэл "center".</summary>
        [DataMember(Order = 6)] public string Align { get; set; } = "";
        public bool Centered => Align == "center";

        public void Normalize()
        {
            if (Images == null) Images = new List<ImageRef>();
            foreach (var r in Images) r.Normalize();
            Text = Text ?? "";
            Align = Align ?? "";
            if (Level < 1 || Level > 3) Level = 1;
            if (WidthPercent < 20 || WidthPercent > 100) WidthPercent = 90;
        }
    }

    [DataContract]
    public class ImageRef
    {
        /// <summary>images/ доторх файлын нэр, жишээ нь «a1b2c3d4.png».</summary>
        [DataMember(Order = 1)] public string ImageId { get; set; }
        [DataMember(Order = 2)] public string Caption { get; set; } = "";
        /// <summary>Зургийн ДЭЭР төвд (жишээ: «X чиглэлд»).</summary>
        [DataMember(Order = 3)] public string Title { get; set; } = "";
        /// <summary>Зургийн ДООР баруун талд (жишээ: «min=220.41mm»).</summary>
        [DataMember(Order = 4)] public string Note { get; set; } = "";
        /// <summary>Зураг LIRA-аас автоматаар үүссэн бол эх сурвалж (загвар, хослол) — дахин үүсгэхэд хэрэглэнэ.</summary>
        [DataMember(Order = 5)] public string Source { get; set; }

        public void Normalize() { Caption = Caption ?? ""; Title = Title ?? ""; Note = Note ?? ""; }
    }
}
