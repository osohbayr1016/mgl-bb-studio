using System;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /// <summary>Хөгжүүлэлтийн горим: өгөгдмөл ХААЛТТАЙ; зөвхөн яг «1».</summary>
    public static class DevModeTests
    {
        [Test] public static void Default_is_closed()
        {
            Assert.False(DevMode.IsEnabled(null));
            Assert.False(DevMode.IsEnabled(""));
        }

        [Test] public static void Only_the_exact_value_one_opens_it()
        {
            Assert.True(DevMode.IsEnabled("1"));
            foreach (string v in new[] { "0", "true", "TRUE", "yes", "on", " 1", "1 ", "01", "2", "enabled" })
                Assert.False(DevMode.IsEnabled(v), "'" + v + "' нээж болохгүй");
        }

        [Test] public static void Env_name_is_stable()
        {
            Assert.Eq("MGL_DEV_MODE", DevMode.EnvName);
        }
    }
}
