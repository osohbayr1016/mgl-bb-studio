using System;
using System.Collections.Generic;

namespace RevitMcpAddin.AutoAnnotate.Core
{
    /// <summary>Сонгогчийн нэг төрөл: тогтвортой <b>UniqueId</b> (харуулах нэр БИШ) + харуулах нэр.</summary>
    public sealed class AaTypeOption
    {
        public readonly string Uid;
        public readonly string Name;

        public AaTypeOption(string uid, string name)
        {
            Uid = uid ?? string.Empty;
            Name = name ?? string.Empty;
        }
    }

    /// <summary>Сонголтын үр дүн: аль төрлийг сонгосон (хоосон = файлын өгөгдмөл), хадгалсан сонголт хуучирсан эсэх.</summary>
    public sealed class AaTypeSelection
    {
        public string Uid = string.Empty;

        /// <summary>Хадгалсан төрөл энэ төсөлд алга (устгагдсан / өөр төслийн) — өгөгдмөл рүү унасан, дуудагч ИЛ хэлнэ.</summary>
        public bool Stale;

        public string StaleUid = string.Empty;

        public bool IsDefault { get { return Uid.Length == 0; } }
    }

    /// <summary>Ажиллуулахын өмнөх шийдвэр: сонгосон төрлөөр үүсгэх үү.</summary>
    public enum AaTypeVerdict
    {
        /// <summary>Хэрэглэгч өгөгдмөл (файлын) төрлийг сонгосон — хэмжээс файлын өгөгдмөл төрлөөр.</summary>
        UseDefault = 0,

        /// <summary>Сонгосон төрөл олдсон, зөв (Linear) — ЗААВАЛ энэ төрлөөр.</summary>
        UseSelected,

        /// <summary>Сонгосон төрөл олдсонгүй — ЗОГСООНО (өөр төрлөөр чимээгүй үүсгэхгүй).</summary>
        Missing,

        /// <summary>Элемент байгаа ч хэмжээсийн (Linear) төрөл БИШ — ЗОГСООНО.</summary>
        WrongKind,
    }

    /// <summary>
    /// «Хэмжээсийн төрөл» сонголтын цэвэр дүрэм.  Шалтгаан (2026-10-05): сонголт хоёр өөр хайрцагт (Арматур / Ерөнхий) байж, нэг нь чимээгүй
    /// үл тоогдож, мөн хадгалсан ElementId өөр төслийн ӨӨР элементийг заадаг байв.  Одоо НЭГ сонголт, UniqueId-аар, тулгалттай.
    /// </summary>
    public static class AaTypeChoice
    {
        /// <summary>Хадгалсан UniqueId-г жагсаалттай тулгана.  Хоосон = өгөгдмөл (хуучирсан биш).  Олдохгүй = өгөгдмөл + <see cref="AaTypeSelection.Stale"/>.</summary>
        public static AaTypeSelection Choose(IEnumerable<AaTypeOption> available, string savedUid)
        {
            var sel = new AaTypeSelection();
            if (string.IsNullOrEmpty(savedUid)) return sel;
            if (available != null)
            {
                foreach (AaTypeOption o in available)
                {
                    if (string.Equals(o.Uid, savedUid, StringComparison.Ordinal))
                    {
                        sel.Uid = o.Uid;
                        return sel;
                    }
                }
            }
            sel.Stale = true;
            sel.StaleUid = savedUid;
            return sel;
        }

        /// <summary>
        /// Үүсгэхийн ӨМНӨ: хэрэглэгчийн сонгосон UniqueId-ийн элемент олдсон уу, хэмжээсийн (Linear) төрөл мөн үү.
        /// Хоосон UniqueId = хэрэглэгч өгөгдмөлийг ИЛ сонгосон.
        /// </summary>
        public static AaTypeVerdict Decide(string uid, bool elementFound, bool isLinearDimensionType)
        {
            if (string.IsNullOrEmpty(uid)) return AaTypeVerdict.UseDefault;
            if (!elementFound) return AaTypeVerdict.Missing;
            return isLinearDimensionType ? AaTypeVerdict.UseSelected : AaTypeVerdict.WrongKind;
        }

        /// <summary>
        /// Үүссэн хэмжээсийн БОДИТ төрөл хүссэнтэй таарч байна уу.  <paramref name="expectedId"/> ≤ 0 (өгөгдмөл) бол шалгахгүй (true).
        /// </summary>
        public static bool Matches(long expectedId, long actualId)
        {
            return expectedId <= 0 || expectedId == actualId;
        }

        public static string VerdictMessage(AaTypeVerdict v)
        {
            switch (v)
            {
                case AaTypeVerdict.Missing:
                    return "Сонгосон хэмжээсийн төрөл энэ төсөлд олдсонгүй (устгагдсан эсвэл өөр төслийн). Хэмжээсийн төрлөө дахин сонгоно уу.";
                case AaTypeVerdict.WrongKind:
                    return "Сонгосон элемент хэмжээсийн (Linear Dimension) төрөл биш. Хэмжээсийн төрлөө дахин сонгоно уу.";
                default:
                    return null;
            }
        }
    }
}
