using System.Collections.Generic;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// Add-in-ий ИТГЭДЭГ лицензийн нийтийн түлхүүрүүд.
    ///
    /// ⚠️ Хувийн хагас нь ЗӨВХӨН Worker-ийн secret `REVIT_LICENSE_KEY`-д (мөн эзний
    ///    компьютерт `%USERPROFILE%\.mgl-secrets\revit-license-key-&lt;kid&gt;.json` нөөц) —
    ///    репод, логт, zip-д ХЭЗЭЭ Ч орохгүй.
    ///
    /// ⚠️ ТҮЛХҮҮР СОЛИХ ДАРААЛАЛ: (1) шинэ kid-ийг ЭНД НЭМЭЭД add-in-ийг тараа,
    ///    (2) бүх компьютер шинэчлэгдсэний дараа Worker-ийн secret-ийг шинэ түлхүүрээр
    ///    соль, (3) дараагийн хувилбарт хуучныг хас.  Эсрэг дарааллаар хийвэл хуучин
    ///    add-in бүх ажилтанд түгжигдэнэ.
    ///
    /// ⚠️ ТЕСТИЙН түлхүүр (`test-0001`) ЭНД ХЭЗЭЭ Ч орохгүй — тестүүд түлхүүрээ
    ///    өөрсдөө дамжуулна.
    /// </summary>
    public static class LicenseKeys
    {
        public static readonly IReadOnlyDictionary<string, TrustedKey> Production =
            new Dictionary<string, TrustedKey>
            {
                ["mgl-2026-10"] = new TrustedKey(
                    "mgl-2026-10",
                    "utfAV8CCA9xXVkGoa-np_EptjBgdhCQ-cMtDqW2QMG0",
                    "17Yqwgvqo6BIRjiseyxyfa8slgiVByCRWPqeF4aGjlc"),
            };
    }
}
