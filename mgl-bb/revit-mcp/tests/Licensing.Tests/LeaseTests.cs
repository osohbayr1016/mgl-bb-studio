using System;
using System.Collections.Generic;
using System.Text;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing.Tests
{
    public static class LeaseTests
    {
        // ЗӨВХӨН ТЕСТИЙН түлхүүр (`backend/src/lib/revitLicense.test.ts`-ийн TEST_KEY_JSON).
        // Production build үүнд ХЭЗЭЭ Ч итгэхгүй — `LicenseKeys.Production`-д байхгүй.
        private static readonly IReadOnlyDictionary<string, TrustedKey> TestKeys =
            new Dictionary<string, TrustedKey>
            {
                ["test-0001"] = new TrustedKey(
                    "test-0001",
                    "4u4bnjuUzrYh_tLI0GSzO2rD2ZKO_hAbIrhAZybljuk",
                    "n6YABSm6JZQPoQIqNAOQyuXJbCAJJNY0hlOkjBvgqPo"),
            };

        /// <summary>
        /// СЕРВЕРИЙН жинхэнэ `signLease` (Workers WebCrypto-той ижил Node WebCrypto) тестийн
        /// түлхүүрээр гарын үсэг зурсан лиценз: sub=12, «Б.Бат», engineer,
        /// dev = "0123456789abcdef"×4, iat = 1790000000, exp = iat + 72 ц, rfa = iat + 6 ц.
        /// </summary>
        private const string Vector =
            "eyJ2IjoxLCJraWQiOiJ0ZXN0LTAwMDEiLCJhdWQiOiJtZ2wtcmV2aXQtYWRkaW4iLCJzdWIiOjEyLCJ1biI6ImJhdCIsIm5tIjoi0JEu0JHQsNGCIiwicmwiOiJlbmdpbmVlciIsImRldiI6IjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ2aWEiOiJtYXRjaCIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMjU5MjAwLCJyZmEiOjE3OTAwMjE2MDB9" +
            ".pnKi8rTXVat5TXMmKkcTRt4VwsXObiZfD8DaPSMskstQVA35qGAblH9ZAJ5-gaUDtomiDBbYZobT9cDb6GquVA";

        private const string Dev = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        private static readonly DateTimeOffset Iat = DateTimeOffset.FromUnixTimeSeconds(1790000000);

        private static LeaseStatus V(string token, string dev, DateTimeOffset now, DateTimeOffset? maxSeen = null)
        {
            return LicenseLease.Verify(token, TestKeys, dev, now, maxSeen, out _);
        }

        [Test]
        public static void ServerSignedVector_IsValid_AndParsed()
        {
            LeaseStatus st = LicenseLease.Verify(Vector, TestKeys, Dev, Iat.AddHours(1), null, out LeaseInfo info);
            Assert.Eq(LeaseStatus.Valid, st);
            Assert.Eq(12L, info.Sub);
            Assert.Eq("Б.Бат", info.Name);
            Assert.Eq("bat", info.UserName);
            Assert.Eq("engineer", info.Role);
            Assert.Eq("match", info.Via);
            Assert.Eq(Iat.AddHours(72), info.ExpiresAt);
            Assert.Eq(Iat.AddHours(6), info.RefreshAfter);
            Assert.False(LicenseLease.NeedsRefresh(info, Iat.AddHours(5)));
            Assert.True(LicenseLease.NeedsRefresh(info, Iat.AddHours(6)));
        }

        [Test]
        public static void DeviceId_IsCaseInsensitiveHex()
        {
            Assert.Eq(LeaseStatus.Valid, V(Vector, Dev.ToUpperInvariant(), Iat.AddHours(1)));
        }

        [Test]
        public static void Expired_After72Hours()
        {
            Assert.Eq(LeaseStatus.Valid, V(Vector, Dev, Iat.AddHours(72).AddSeconds(-1)));
            Assert.Eq(LeaseStatus.Expired, V(Vector, Dev, Iat.AddHours(72)));
        }

        [Test]
        public static void OtherComputer_IsWrongDevice()
        {
            Assert.Eq(LeaseStatus.WrongDevice, V(Vector, new string('f', 64), Iat.AddHours(1)));
            Assert.Eq(LeaseStatus.WrongDevice, V(Vector, null, Iat.AddHours(1)));
        }

        [Test]
        public static void ClockSetBackwards_IsDetected()
        {
            // Хугацааг сунгах гэж цагийг өмнө рүү эргүүлэв.
            Assert.Eq(LeaseStatus.NotYetValid, V(Vector, Dev, Iat.AddMinutes(-30)));
            Assert.Eq(LeaseStatus.ClockRolledBack, V(Vector, Dev, Iat.AddHours(1), Iat.AddHours(80)));
            // 10 минутын хэлбэлзэл зөвшөөрөгдөнө.
            Assert.Eq(LeaseStatus.Valid, V(Vector, Dev, Iat.AddHours(1), Iat.AddHours(1).AddMinutes(5)));
        }

        [Test]
        public static void ForgedPayload_IsBadSignature()
        {
            // exp-ийг 2096 он болгож хуурамчаар өөрчилсөн — гарын үсэг таарахгүй.
            string[] parts = Vector.Split('.');
            string json = Encoding.UTF8.GetString(Base64Url.Decode(parts[0]))
                .Replace("\"exp\":1790259200", "\"exp\":3999999999");
            string forged = Base64Url.Encode(Encoding.UTF8.GetBytes(json)) + "." + parts[1];
            Assert.Eq(LeaseStatus.BadSignature, V(forged, Dev, Iat.AddHours(1)));

            // Гарын үсгийн нэг тэмдэгт солигдсон.
            char c = parts[1][10] == 'A' ? 'B' : 'A';
            string flipped = parts[0] + "." + parts[1].Substring(0, 10) + c + parts[1].Substring(11);
            Assert.Eq(LeaseStatus.BadSignature, V(flipped, Dev, Iat.AddHours(1)));
        }

        [Test]
        public static void ProductionKeys_DoNotTrustTestKey()
        {
            // ⚠️ Тестийн түлхүүрээр гарын үсэг зурсан лицензийг production build хүлээн авах
            //    ЁСГҮЙ — тэр нь «хувийн түлхүүр репод байгаа» гэсэн үг болно.
            LeaseStatus st = LicenseLease.Verify(Vector, LicenseKeys.Production, Dev, Iat.AddHours(1), null, out _);
            Assert.Eq(LeaseStatus.UnknownKey, st);
            Assert.False(((IDictionary<string, TrustedKey>)new Dictionary<string, TrustedKey>(LicenseKeys.Production)).ContainsKey("test-0001"));
            Assert.True(LicenseKeys.Production.Count >= 1);
        }

        [Test]
        public static void Malformed_And_Missing()
        {
            Assert.Eq(LeaseStatus.Missing, V(null, Dev, Iat));
            Assert.Eq(LeaseStatus.Missing, V("  ", Dev, Iat));
            Assert.Eq(LeaseStatus.Malformed, V("abc", Dev, Iat));
            Assert.Eq(LeaseStatus.Malformed, V("a.b.c", Dev, Iat));
            Assert.Eq(LeaseStatus.Malformed, V("!!!.###", Dev, Iat));
            string notJson = Base64Url.Encode(Encoding.UTF8.GetBytes("[1,2]")) + "." + Vector.Split('.')[1];
            Assert.Eq(LeaseStatus.Malformed, V(notJson, Dev, Iat));
            string dupKey = Base64Url.Encode(Encoding.UTF8.GetBytes("{\"v\":1,\"v\":2}")) + "." + Vector.Split('.')[1];
            Assert.Eq(LeaseStatus.Malformed, V(dupKey, Dev, Iat));
        }

        [Test]
        public static void UnknownKid_IsUnknownKey()
        {
            string json = Encoding.UTF8.GetString(Base64Url.Decode(Vector.Split('.')[0]))
                .Replace("\"kid\":\"test-0001\"", "\"kid\":\"evil-0001\"");
            string t = Base64Url.Encode(Encoding.UTF8.GetBytes(json)) + "." + Vector.Split('.')[1];
            Assert.Eq(LeaseStatus.UnknownKey, V(t, Dev, Iat.AddHours(1)));
        }

        [Test]
        public static void DeviceId_IsStableSha256()
        {
            string a = DeviceProfile.ComputeDeviceId("ABCD-1234", "MGL\\Bat");
            string b = DeviceProfile.ComputeDeviceId("abcd-1234 ", "mgl\\bat");
            Assert.Eq(a, b);
            Assert.Eq(64, a.Length);
            Assert.True(System.Text.RegularExpressions.Regex.IsMatch(a, "^[0-9a-f]{64}$"));
            Assert.False(a == DeviceProfile.ComputeDeviceId("ABCD-1234", "MGL\\Dorj"));
            Assert.Eq("1920x1080", DeviceProfile.ScreenKey(1920, 1080));
            Assert.Null(DeviceProfile.ScreenKey(0, 1080));
        }
    }
}
