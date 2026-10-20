using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using RevitMcpAddin.Licensing;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing.Tests
{
    /// <summary>
    /// Төхөөрөмжийн түлхүүр / proof (add-in 1.10.0, migration 0375).  Тест вектор нь СЕРВЕРИЙН бодит
    /// `proofMessage` / `signLease` (`backend/src/lib/revitDeviceKey.ts`, `revitLicense.ts`)-ээр, тестийн
    /// түлхүүрүүдээр үүсгэгдсэн — TS ↔ C# гэрээ (канон мөр, key_id, P1363 гарын үсэг, `dk` уяа) таарч байгааг батална.
    /// </summary>
    public static class DeviceProofTests
    {
        // Тестийн ТӨХӨӨРӨМЖИЙН түлхүүрийн НИЙТИЙН хагас (хувийн хагас нь ЭНД БАЙХГҮЙ).
        private const string DevX = "UD9euni6F7-Nja-hGlkOdup_rvzcI7Ke6nzDB48BnPM";
        private const string DevY = "0UfnSt12WQpHRVN3sK0k0xNZm4kjHsq-r6Twxngx1wg";
        private const string KeyId = "f493dce259782196806f666cd400f37b75c575a94a151297ad976fe4f7778b7b";
        private const string Dev = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        private const string Message =
            "mgl-revit-device-proof|v1|license|c0ffee00c0ffee00c0ffee00c0ffee00|bm9uY2Utbm9uY2Utbm9uY2Utbm9uY2Utbm9uY2U|42|" +
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef|f493dce259782196806f666cd400f37b75c575a94a151297ad976fe4f7778b7b";

        private const string Signature =
            "xvamuL_8eJ30AnKhT-_ZrGOnLysmVUq_Icy_xOf2-rmP5kUxE_uYIHOCpURrJljEPQosZGqMCEMutMC9sQ9K2Q";

        /// <summary>Тестийн лицензийн түлхүүрээр (`test-0001`) гарын үсэг зурсан, sec=tpm, dk=KeyId, 12 цаг.</summary>
        private const string KeyedLease =
            "eyJ2IjoxLCJraWQiOiJ0ZXN0LTAwMDEiLCJhdWQiOiJtZ2wtcmV2aXQtYWRkaW4iLCJzdWIiOjQyLCJ1biI6ImJhdCIsIm5tIjoi0JEu0JHQsNGCIiwicmwiOiJlbmdpbmVlciIsImRldiI6IjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ2aWEiOiJtYXRjaCIsInNlYyI6InRwbSIsImRrIjoiZjQ5M2RjZTI1OTc4MjE5NjgwNmY2NjZjZDQwMGYzN2I3NWM1NzVhOTRhMTUxMjk3YWQ5NzZmZTRmNzc3OGI3YiIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDQzMjAwLCJyZmEiOjE3OTAwMDM2MDB9" +
            ".N0M3d5j_4g_PfUMrB-3sX_aftA9gBei4GHEiU3KkSiK6FX-wiFKpO3wxwA9pmTIoJZG6-AFrYcBh78DH135OQg";

        private static readonly DateTimeOffset Iat = DateTimeOffset.FromUnixTimeSeconds(1790000000);

        private static readonly IReadOnlyDictionary<string, TrustedKey> LeaseKeys =
            new Dictionary<string, TrustedKey>
            {
                ["test-0001"] = new TrustedKey(
                    "test-0001",
                    "4u4bnjuUzrYh_tLI0GSzO2rD2ZKO_hAbIrhAZybljuk",
                    "n6YABSm6JZQPoQIqNAOQyuXJbCAJJNY0hlOkjBvgqPo"),
            };

        [Test]
        public static void Message_IsByteIdenticalToServer()
        {
            string m = DeviceProof.Message("license", "c0ffee00c0ffee00c0ffee00c0ffee00",
                "bm9uY2Utbm9uY2Utbm9uY2Utbm9uY2Utbm9uY2U", 42, Dev, KeyId);
            Assert.Eq(Message, m);
        }

        [Test]
        public static void KeyId_IsSha256OfXY_MatchesServer()
        {
            Assert.Eq(KeyId, DeviceProof.KeyId(Base64Url.Decode(DevX), Base64Url.Decode(DevY)));
            Assert.Throws<ArgumentException>(() => DeviceProof.KeyId(new byte[31], new byte[32]));
        }

        [Test]
        public static void ServerSideSignature_VerifiesWithPublicKey()
        {
            var key = new TrustedKey("dev", DevX, DevY);
            byte[] sig = Base64Url.Decode(Signature);
            Assert.Eq(64, sig.Length);
            Assert.True(key.Verify(Encoding.UTF8.GetBytes(Message), sig), "TS-ийн ES256 P1363 гарын үсэг C#-д баталгаажна");
            Assert.False(key.Verify(Encoding.UTF8.GetBytes(Message + "x"), sig), "мөр өөрчлөгдвөл");
            // нэг бит эргүүлбэл
            sig[10] ^= 1;
            Assert.False(key.Verify(Encoding.UTF8.GetBytes(Message), sig), "гарын үсэг өөрчлөгдвөл");
        }

        [Test]
        public static void EccPublicBlob_Parses_AndRejectsGarbage()
        {
            byte[] x = Base64Url.Decode(DevX);
            byte[] y = Base64Url.Decode(DevY);
            var blob = new byte[72];
            blob[0] = 0x45; blob[1] = 0x43; blob[2] = 0x53; blob[3] = 0x31; // 'ECS1'
            blob[4] = 32;
            Buffer.BlockCopy(x, 0, blob, 8, 32);
            Buffer.BlockCopy(y, 0, blob, 40, 32);
            Assert.True(DeviceProof.TryParseEccPublicBlob(blob, out byte[] px, out byte[] py));
            Assert.Eq(DevX, Base64Url.Encode(px));
            Assert.Eq(DevY, Base64Url.Encode(py));
            Assert.False(DeviceProof.TryParseEccPublicBlob(new byte[10], out _, out _), "богино");
            blob[4] = 48; // P-384
            Assert.False(DeviceProof.TryParseEccPublicBlob(blob, out _, out _), "P-256 биш");
        }

        [Test]
        public static void KeyedLease_IsBoundToTheDeviceKey()
        {
            DateTimeOffset now = Iat.AddHours(1);
            Assert.Eq(LeaseStatus.Valid,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, KeyId, now, null, out LeaseInfo info));
            Assert.Eq("tpm", info.Security);
            Assert.Eq(KeyId, info.DeviceKeyId);
            Assert.Eq(Iat.AddHours(12), info.ExpiresAt);
            Assert.Eq(Iat.AddHours(1), info.RefreshAfter);

            // license.json-ийг түлхүүргүй PC руу хуулбал
            Assert.Eq(LeaseStatus.WrongDevice,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, null, now, null, out _));
            // өөр (халдагчийн) түлхүүртэй PC
            string other = new string('a', 64);
            Assert.Eq(LeaseStatus.WrongDevice,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, other, now, null, out _));
            // өөр device_id
            Assert.Eq(LeaseStatus.WrongDevice,
                LicenseLease.Verify(KeyedLease, LeaseKeys, new string('b', 64), KeyId, now, null, out _));
            // 12 цагийн дараа
            Assert.Eq(LeaseStatus.Expired,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, KeyId, Iat.AddHours(12), null, out _));
            // цаг ухраасан
            Assert.Eq(LeaseStatus.ClockRolledBack,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, KeyId, Iat.AddHours(1), Iat.AddHours(5), out _));
            // хуучин дуудагч (түлхүүр шалгахгүй) өөрчлөгдөөгүй
            Assert.Eq(LeaseStatus.Valid,
                LicenseLease.Verify(KeyedLease, LeaseKeys, Dev, now, null, out _));
        }

        [Test]
        public static void KeyRotation_UnknownKid_IsRejected_UntilTheNewKeyIsShipped()
        {
            // Add-in хуучин kid-ийг л мэднэ → шинэ kid-ээр гарсан лиценз `UnknownKey`.
            var onlyNew = new Dictionary<string, TrustedKey>
            {
                ["mgl-2027-01"] = new TrustedKey("mgl-2027-01", DevX, DevY),
            };
            Assert.Eq(LeaseStatus.UnknownKey,
                LicenseLease.Verify(KeyedLease, onlyNew, Dev, KeyId, Iat.AddHours(1), null, out _));
            // Хоёр түлхүүр хамт (overlap) — хуучин kid-ийн лиценз хэвээр хүчинтэй.
            var overlap = new Dictionary<string, TrustedKey>(onlyNew)
            {
                ["test-0001"] = LeaseKeys["test-0001"],
            };
            Assert.Eq(LeaseStatus.Valid,
                LicenseLease.Verify(KeyedLease, overlap, Dev, KeyId, Iat.AddHours(1), null, out _));
        }

        [Test]
        public static void ChallengeResponse_Parses()
        {
            ChallengeResult ok = DeviceResponses.ParseChallenge(200,
                "{\"ok\":true,\"challenge_id\":\"c0ffee00c0ffee00c0ffee00c0ffee00\",\"nonce\":\"AAAA\",\"user_id\":42,\"key_id\":\"" + KeyId + "\"}");
            Assert.True(ok.Ok);
            Assert.Eq(42L, ok.UserId);
            Assert.Eq(KeyId, ok.KeyId);

            ChallengeResult denied = DeviceResponses.ParseChallenge(403,
                "{\"ok\":false,\"code\":\"DEVICE_NOT_ENROLLED\",\"error\":\"Энэ төхөөрөмж бүртгэгдээгүй байна.\"}");
            Assert.False(denied.Ok);
            Assert.Eq("DEVICE_NOT_ENROLLED", denied.Code);

            Assert.False(DeviceResponses.ParseChallenge(200, "<html>").Ok);
            Assert.False(DeviceResponses.ParseChallenge(200, "{\"ok\":true}").Ok, "challenge_id байхгүй");
        }

        [Test]
        public static void EnrollAndSessionResponses_Parse()
        {
            EnrollResult e = DeviceResponses.ParseEnroll(200,
                "{\"ok\":true,\"status\":\"pending\",\"reason\":\"not_work_pc\",\"key_id\":\"x\",\"credential\":{\"token\":\"cred\",\"expires_at\":\"2026-11-01T00:00:00.000Z\"}}");
            Assert.True(e.Ok);
            Assert.Eq("pending", e.DeviceStatus);
            Assert.Eq("cred", e.Credential);
            Assert.True(e.CredentialExpiresAt.HasValue);

            SessionResult s = DeviceResponses.ParseSession(200,
                "{\"ok\":true,\"session\":{\"token\":\"sess\",\"expires_at\":\"2026-10-01T10:30:00.000Z\"},\"credential\":{\"token\":\"cred2\",\"expires_at\":\"2026-11-01T00:00:00.000Z\"}}");
            Assert.True(s.Ok);
            Assert.Eq("sess", s.Token);
            Assert.Eq("cred2", s.Credential);
            Assert.False(DeviceResponses.ParseSession(403, "{\"ok\":false,\"code\":\"DEVICE_PENDING\"}").Ok);
        }

        [Test]
        public static void LicenseResponse_NewCodes_AreClassified()
        {
            foreach (string c in new[] { "DEVICE_NOT_ENROLLED", "DEVICE_KEY_REQUIRED", "REAUTH_REQUIRED" })
            {
                var r = LicenseResponse.Classify(403, "{\"ok\":false,\"code\":\"" + c + "\",\"error\":\"Нууц үгээрээ нэвтэрнэ үү.\"}");
                Assert.Eq(LicenseResponse.Kind.NeedEnroll, r.Kind, c);
                Assert.Eq(c, r.Code);
            }
            foreach (string c in new[]
            {
                "DEVICE_PENDING", "DEVICE_REVOKED", "DEVICE_PROOF_INVALID", "DEVICE_PROOF_REQUIRED",
                "ADDIN_UPDATE_REQUIRED", "ADDIN_VERSION_BLOCKED", "REVIT_LICENSES_DISABLED", "DEVICE_LIMIT_REACHED",
            })
            {
                var r = LicenseResponse.Classify(403, "{\"ok\":false,\"code\":\"" + c + "\",\"error\":\"Админд хандана уу.\"}");
                Assert.Eq(LicenseResponse.Kind.Denied, r.Kind, c);
                Assert.True(LicenseResponse.IsHardDeny(c), c);
            }
            // 409 (түлхүүр таарахгүй) → хатуу
            Assert.Eq(LicenseResponse.Kind.Denied,
                LicenseResponse.Classify(409, "{\"ok\":false,\"code\":\"DEVICE_KEY_MISMATCH\",\"error\":\"Түлхүүр таарахгүй.\"}").Kind);
            // аюулгүй байдлын шалгалт хийгдээгүй (503) → хуучин лиценз хэвээр (интернэтгүй горимтой ижил)
            Assert.Eq(LicenseResponse.Kind.NotReady,
                LicenseResponse.Classify(503, "{\"ok\":false,\"code\":\"SECURITY_CHECK_FAILED\",\"error\":\"Аюулгүй байдлын шалгалт хийгдсэнгүй.\"}").Kind);
            // оффисын сүлжээ — татгалзал БИШ
            Assert.Eq(LicenseResponse.Kind.Soft,
                LicenseResponse.Classify(403, "{\"code\":\"office_network_required\",\"error\":\"Оффисын сүлжээнд холбогдоно уу\"}").Kind);
        }

        [Test]
        public static void LicenseResponse_Ok_CarriesSessionAndCredential()
        {
            var r = LicenseResponse.Classify(200,
                "{\"ok\":true,\"lease\":\"a.b\",\"sec\":\"tpm\",\"session\":{\"token\":\"s\",\"expires_at\":\"2026-10-01T10:30:00.000Z\"},\"credential\":{\"token\":\"c\",\"expires_at\":\"2026-11-01T00:00:00.000Z\"}}");
            Assert.Eq(LicenseResponse.Kind.Ok, r.Kind);
            Assert.Eq("s", r.SessionToken);
            Assert.Eq("c", r.Credential);
            Assert.Eq("tpm", r.Security);
        }

        // ── Windows CNG (зөвхөн Windows) ───────────────────────────────────

        [Test]
        public static void SoftwareKey_SignsAndVerifies_AndKeyIdMatches()
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return; // CNG зөвхөн Windows
            string name = "MGL-Revit-Device-test-" + Guid.NewGuid().ToString("N");
            var store = new DeviceKeyStore(name, false);
            try
            {
                Assert.Null(store.TryOpenExisting(), "анх түлхүүр байхгүй");
                DeviceSigner signer = store.OpenOrCreate(out string error);
                Assert.NotNull(signer, error);
                Assert.Eq("software", signer.SecurityLevel);
                Assert.Eq(DeviceProof.KeyId(Base64Url.Decode(signer.X), Base64Url.Decode(signer.Y)), signer.KeyId);

                string msg = DeviceProof.Message("session", "c0ffee00c0ffee00c0ffee00c0ffee00", "n", 7, Dev, signer.KeyId);
                byte[] sig = Base64Url.Decode(signer.Sign(msg));
                Assert.Eq(64, sig.Length);
                var pub = new TrustedKey("dev", signer.X, signer.Y);
                Assert.True(pub.Verify(Encoding.UTF8.GetBytes(msg), sig), "C# CNG гарын үсэг нийтийн түлхүүрээр баталгаажна");
                Assert.False(pub.Verify(Encoding.UTF8.GetBytes(msg + "!"), sig));

                // Дахин нээхэд ИЖИЛ түлхүүр (шинээр үүсгэхгүй)
                DeviceSigner again = store.TryOpenExisting();
                Assert.NotNull(again);
                Assert.Eq(signer.KeyId, again.KeyId);
                // Өөр нэртэй хадгалалт ижил түлхүүр гаргахгүй
                var other = new DeviceKeyStore(name + "-2", false);
                try
                {
                    DeviceSigner o = other.OpenOrCreate(out _);
                    Assert.True(o.KeyId != signer.KeyId, "түлхүүр бүр өвөрмөц");
                }
                finally { other.Delete(); }
            }
            finally
            {
                store.Delete();
            }
            Assert.Null(store.TryOpenExisting(), "устгасны дараа байхгүй");
        }

        [Test]
        public static void TpmKey_WhenAvailable_IsTpm_ElseExplicitlySoftware()
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;
            string name = "MGL-Revit-Device-test-tpm-" + Guid.NewGuid().ToString("N");
            var store = new DeviceKeyStore(name, true);
            try
            {
                DeviceSigner s = store.OpenOrCreate(out string error);
                Assert.NotNull(s, error);
                // TPM-тэй PC → tpm; TPM-гүй CI → software (ИЛ, чимээгүй downgrade биш — түвшин нь мэдэгдэнэ).
                Assert.True(s.SecurityLevel == "tpm" || s.SecurityLevel == "software");
                Console.WriteLine("    (түлхүүрийн хамгаалалт: " + s.SecurityLevel + ")");
            }
            finally
            {
                store.Delete();
            }
        }
    }
}
