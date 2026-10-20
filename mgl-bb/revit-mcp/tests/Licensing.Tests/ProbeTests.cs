using System;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing.Tests
{
    /// <summary>
    /// `HardwareProbe`-ийг ЭНЭ компьютер дээр бодитоор ажиллуулна — сервер рүү явах
    /// профайлыг хэвлэнэ (хөтчийн ирцийн профайлтай гараар тулгахад).
    /// </summary>
    public static class ProbeTests
    {
        [Test]
        public static void ReadsThisComputer()
        {
            DeviceProfile p = HardwareProbe.Read();
            Console.WriteLine("       device_id = " + p.DeviceId + "  (short " + p.ShortId + ")");
            Console.WriteLine("       gpus      = " + string.Join(" | ", p.Gpus));
            Console.WriteLine("       cores     = " + p.Cores);
            Console.WriteLine("       screens   = " + string.Join(", ", p.Screens));
            Assert.True(System.Text.RegularExpressions.Regex.IsMatch(p.DeviceId, "^[0-9a-f]{64}$"), "device id");
            Assert.True(p.Cores > 0, "cores");
            Assert.True(p.Gpus.Count > 0, "дор хаяж нэг дэлгэцийн адаптер");
            Assert.True(p.Screens.Count > 0, "дор хаяж нэг дэлгэц");
            // Процесс дотор id тогтвортой.
            Assert.Eq(p.DeviceId, HardwareProbe.DeviceId());
        }
    }
}
