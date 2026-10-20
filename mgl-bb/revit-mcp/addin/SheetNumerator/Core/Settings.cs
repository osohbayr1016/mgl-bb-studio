using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SheetNumerator.Core
{
    public enum DisplayMode
    {
        /// <summary>«Бүлэглэж харах» — одоогийн Browser Organization-ий дагуу.</summary>
        Grouped = 0,

        /// <summary>«Бүгдийг нэг бүлэгт».</summary>
        AllInOne = 1,
    }

    /// <summary>Нэг хуудаст дугаар үүсгэх ДҮРМИЙН төрөл — <see cref="RenumberSettings.EffectiveMode"/>-оор шийдэгдэнэ.</summary>
    public enum NumberingMode
    {
        Simple = 0,
        Advanced = 1,
    }

    /// <summary>Тооцооны БОДИТ горим (settings-ийн тугуудаас гарна).</summary>
    public enum EffectiveMode
    {
        Simple = 0,
        Advanced = 1,

        /// <summary>Одоогийн дугаарын тоон хэсгийг ± өөрчлөх.</summary>
        Shift = 2,

        /// <summary>Зөөхөд дугаар дагана — бүлгийн АНХНЫ дугааруудын дарааллыг WorkingOrder-т дахин оноох.</summary>
        Move = 3,

        /// <summary>Мэдэгдэж буй үл үзэгдэх тэмдгийг хасах (ил цэвэрлэх команд).</summary>
        CleanMarkers = 4,
    }

    public enum PartValueMode
    {
        /// <summary>Тоон утгагүй (зөвхөн угтвар/дагавар).</summary>
        None = 0,

        /// <summary>Тогтмол утга (эхлэх утгаар).</summary>
        Fixed = 1,

        Increment = 2,
        Decrement = 3,
    }

    /// <summary>Үр дүнг (дугаар, нэр, параметр) бичихэд ямар ХЭСГИЙГ авах.</summary>
    public enum GeneratedValueSource
    {
        FullNumber = 0,
        Part1Full = 1,
        Part1Number = 2,
        Part2Full = 3,
        Part2Number = 4,
        Part3Full = 5,
        Part3Number = 6,
    }

    public enum CountWriteScope
    {
        FirstSheet = 0,
        AllSheets = 1,
    }

    /// <summary>Энгийн дугаарлалт: угтвар + (эхлэх + n, өргөнтэй) + дагавар.</summary>
    public sealed class SimpleNumberingSettings
    {
        public string Prefix { get; set; } = string.Empty;
        public string Suffix { get; set; } = string.Empty;

        /// <summary>true → дараалсан тоо; false → Угтвар + ОДООГИЙН дугаар + Дагавар.</summary>
        public bool UseStartNumber { get; set; } = true;

        /// <summary>Сөрөг утга зөвшөөрнө.  Өгөгдмөл 1.</summary>
        public long Start { get; set; } = 1;

        /// <summary>Хамгийн бага цифрийн тоо (тэгээр нөхнө).  Өгөгдмөл 1 (нөхөхгүй).</summary>
        public int Width { get; set; } = 1;

        public SimpleNumberingSettings Clone()
        {
            return (SimpleNumberingSettings)MemberwiseClone();
        }
    }

    /// <summary>Нарийвчилсан дугаарлалтын нэг хэсэг: Угтвар + тоон утга + Дагавар.</summary>
    public sealed class NumberPartSettings
    {
        public bool Enabled { get; set; }
        public string Prefix { get; set; } = string.Empty;
        public string Suffix { get; set; } = string.Empty;
        public PartValueMode ValueMode { get; set; } = PartValueMode.Increment;

        /// <summary>Эхлэх утга (Fixed үед тогтмол утга нь ЭНЭ).</summary>
        public long Start { get; set; } = 1;

        /// <summary>Алхам (≥ 1).</summary>
        public long Step { get; set; } = 1;

        public int Width { get; set; } = 1;

        /// <summary>Хязгаар: Increment үед ХАМГИЙН ИХ, Decrement үед ХАМГИЙН БАГА утга (дотор нь).  null = хязгааргүй.</summary>
        public long? Limit { get; set; }

        /// <summary>
        /// true → хязгаарт хүрвэл эхлэх утга руу буцаж, ӨМНӨХ (илүү өндөр эрэмбийн) өөрчлөгдөх хэсгийг нэмнэ
        /// (A-1-1…A-1-5, A-2-1…).  false → хязгаар давсан мөр АЛДААТАЙ (чимээгүй таслахгүй).
        /// </summary>
        public bool WrapAtLimit { get; set; }

        public bool IsAdvancing => Enabled && (ValueMode == PartValueMode.Increment || ValueMode == PartValueMode.Decrement);

        public NumberPartSettings Clone()
        {
            return (NumberPartSettings)MemberwiseClone();
        }
    }

    public sealed class AdvancedNumberingSettings
    {
        public const int PartCount = 3;

        public AdvancedNumberingSettings()
        {
            Parts = new NumberPartSettings[PartCount];
            for (int i = 0; i < PartCount; i++)
            {
                Parts[i] = new NumberPartSettings { Enabled = i == 0 };
            }
            Separators = new[] { "-", "-" };
        }

        /// <summary>Хэсэг 1..3.</summary>
        public NumberPartSettings[] Parts { get; set; }

        /// <summary>Хэсэг 1-2-ийн хоорондох, 2-3-ын хоорондох тусгаарлагч (дурын бичвэр, хоосон ч болно).</summary>
        public string[] Separators { get; set; }

        public AdvancedNumberingSettings Clone()
        {
            var c = new AdvancedNumberingSettings();
            for (int i = 0; i < PartCount; i++)
                c.Parts[i] = Parts[i].Clone();
            c.Separators = new[] { Separators[0], Separators[1] };
            return c;
        }
    }

    /// <summary>
    /// Дугаарлалтын БҮХ тохиргоо.  Цэвэр өгөгдөл (WPF/Revit-гүй) — урьдчилсан харалтыг энэ ба snapshot-оос л тооцно.
    /// </summary>
    public sealed class RenumberSettings
    {
        public RenumberSettings()
        {
            Simple = new SimpleNumberingSettings();
            Advanced = new AdvancedNumberingSettings();
        }

        // ── Горим ───────────────────────────────────────────────────
        public NumberingMode Mode { get; set; } = NumberingMode.Simple;
        public SimpleNumberingSettings Simple { get; set; }
        public AdvancedNumberingSettings Advanced { get; set; }

        // ── Параметрээс угтвар / дагавар ────────────────────────────
        public bool UseParameterPrefix { get; set; }
        public ParameterKey PrefixParameter { get; set; }
        public bool UseParameterSuffix { get; set; }
        public ParameterKey SuffixParameter { get; set; }

        // ── Үр дүнг параметрт бичих ─────────────────────────────────
        public bool WriteResultToParameter { get; set; }
        public ParameterKey ResultParameter { get; set; }
        public GeneratedValueSource ResultSource { get; set; } = GeneratedValueSource.FullNumber;

        // ── Бүлгийн хуудасны тоог параметрт бичих ───────────────────
        public bool WriteGroupCount { get; set; }
        public ParameterKey CountParameter { get; set; }
        public CountWriteScope CountScope { get; set; } = CountWriteScope.FirstSheet;

        // ── Хуудасны нэрэнд дугаар нэмэх ────────────────────────────
        public bool NameAtStart { get; set; }
        public bool NameAtEnd { get; set; }
        public GeneratedValueSource NameSource { get; set; } = GeneratedValueSource.FullNumber;
        public string NameSeparator { get; set; } = " ";

        // ── Одоогийн дугаарын тоон хэсгийг өөрчлөх ──────────────────
        public bool ShiftActive { get; set; }

        /// <summary>Өөрчлөлтийн ХЭМЖЭЭ (≥ 0, тэмдэггүй).  Чиглэл нь <see cref="ShiftDirection"/>.</summary>
        public long ShiftAmount { get; set; } = 1;

        /// <summary>+1 = Өсгөх, -1 = Бууруулах.</summary>
        public int ShiftDirection { get; set; } = 1;

        /// <summary>-1 = сүүлийн тоон хэсэг (өгөгдмөл), 0.. = зүүнээс тоолсон.</summary>
        public int ShiftTokenIndex { get; set; } = ExistingNumberShift.LastToken;

        // ── Тугууд ─────────────────────────────────────────────────
        /// <summary>«Зөөхөд дугаарыг дагуулж шинэчлэх».  Хадгалахгүй (сессийн төлөв).</summary>
        public bool MoveRenumber { get; set; }

        /// <summary>«Сонгосон хуудаснаас эхлэх».  Хадгалахгүй.</summary>
        public bool StartFromSelected { get; set; }

        /// <summary>«Давхардлыг хэвлэгддэггүй Unicode тэмдэг ашиглан ялгах».</summary>
        public bool UseUnicodeMarkers { get; set; }

        public char MarkerChar { get; set; } = '\u200B';

        /// <summary>«Хэвлэгддэггүй тэмдэг цэвэрлэх».  Хадгалахгүй.</summary>
        public bool CleanMarkers { get; set; }

        public EffectiveMode EffectiveMode
        {
            get
            {
                if (CleanMarkers)
                    return EffectiveMode.CleanMarkers;
                if (MoveRenumber)
                    return EffectiveMode.Move;
                if (ShiftActive)
                    return EffectiveMode.Shift;
                return Mode == NumberingMode.Advanced ? EffectiveMode.Advanced : EffectiveMode.Simple;
            }
        }

        public RenumberSettings Clone()
        {
            RenumberSettings c = (RenumberSettings)MemberwiseClone();
            c.Simple = Simple.Clone();
            c.Advanced = Advanced.Clone();
            return c;
        }
    }
}
