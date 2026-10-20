using System;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// «Хөгжүүлэлтийн горим» — энгийн ажилтны интерфэйсээс DEV/тест хэрэгслийг (синтетик загвар үүсгэх, өөрчлөх,
    /// хадгалах) ИЛ ТОДОРХОЙ тохиргоогоор л гаргана.
    ///
    ///  • Тохиргоо: процессын орчны хувьсагч `MGL_DEV_MODE=1` (ЯГ «1», том жижиг үсэг үл хамаарах биш).  Өгөгдмөл ХААЛТТАЙ.
    ///    `BridgeAuth.ArbitraryCodeAllowed` ← `MGL_ALLOW_EXEC`-ийн ИЖИЛ хэв маяг.  `settings.json`-д БИШ (хэрэглэгч
    ///    санамсаргүй орхиж болно, QtoDtos.cs-ийн «тохиргоо хэзээ ч эрх нээхгүй»), `#if DEBUG`-д ч БИШ (энэ төсөлд `DEBUG`
    ///    тогтмол ХЭЗЭЭ Ч тодорхойлогддоггүй — тохиргооны нэр `DEBUG_R27`).
    ///  • ⚠️ Энэ нь ЗӨВХӨН UI-ийн ил байдал.  `TestModelFixture` дахь хамгаалалт (`Gate`, `IsTestMarked`,
    ///    `TEST_*_REFUSED`) болон localhost bridge-ийн `/tool` (token + лиценз) ХЭВЭЭР — DEV товч харагдах нь
    ///    тэдгээрийг нээхгүй.
    /// </summary>
    public static class DevMode
    {
        public const string EnvName = "MGL_DEV_MODE";

        public static bool IsEnabled(string value)
        {
            return string.Equals(value, "1", StringComparison.Ordinal);
        }

        /// <summary>Одоогийн процессын орчноос.  Уншиж чадаагүй (хандалтын алдаа) бол ХААЛТТАЙ.</summary>
        public static bool IsEnabled()
        {
            try { return IsEnabled(Environment.GetEnvironmentVariable(EnvName)); }
            catch { return false; }
        }
    }
}
