using System;
using System.Text;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing.Tests
{
    /// <summary>
    /// Ажилтан тутмын төхөөрөмжийн түлхүүр (1.10.0): токен / лицензийн `sub` → түлхүүрийн нэр.
    /// JWT-ийн хэлбэр нь серверийн `lib/jwt.ts signToken` ({sub: number, role, purpose?…}).
    /// </summary>
    public static class TokenPeekTests
    {
        private static string B64(string json) => Base64Url.Encode(Encoding.UTF8.GetBytes(json));

        [Test]
        public static void JwtSub_ReadsNumericSub()
        {
            string jwt = B64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}") + "." +
                         B64("{\"sub\":42,\"role\":\"engineer\",\"iat\":1,\"exp\":2}") + ".sig";
            Assert.Eq((long?)42, TokenPeek.JwtSub(jwt));
            string refresh = B64("{\"alg\":\"HS256\"}") + "." +
                             B64("{\"sub\":7,\"role\":\"architect\",\"purpose\":\"revit-refresh\",\"dev\":\"x\",\"kid\":\"y\"}") + ".s";
            Assert.Eq((long?)7, TokenPeek.JwtSub(refresh));
        }

        [Test]
        public static void JwtSub_StringSub_AndGarbage()
        {
            Assert.Eq((long?)15, TokenPeek.JwtSub(B64("{}") + "." + B64("{\"sub\":\"15\"}") + ".s"));
            Assert.Null(TokenPeek.JwtSub(null));
            Assert.Null(TokenPeek.JwtSub(""));
            Assert.Null(TokenPeek.JwtSub("not-a-jwt"));
            Assert.Null(TokenPeek.JwtSub("a.b"), "two parts is a lease, not a JWT");
            Assert.Null(TokenPeek.JwtSub(B64("{}") + "." + B64("{\"sub\":0}") + ".s"), "sub 0");
            Assert.Null(TokenPeek.JwtSub(B64("{}") + "." + B64("{\"sub\":-3}") + ".s"), "negative sub");
            Assert.Null(TokenPeek.JwtSub(B64("{}") + "." + B64("{\"role\":\"admin\"}") + ".s"), "no sub");
            Assert.Null(TokenPeek.JwtSub(B64("{}") + "." + B64("[1,2]") + ".s"), "array payload");
            Assert.Null(TokenPeek.JwtSub(B64("{}") + ".%%%." + "s"), "bad base64");
        }

        [Test]
        public static void LeaseSub_ReadsPayloadBeforeSignature()
        {
            string lease = B64("{\"v\":1,\"kid\":\"mgl-2026-10\",\"aud\":\"mgl-revit-addin\",\"sub\":31,\"dev\":\"d\",\"iat\":1,\"exp\":2}") + ".sig";
            Assert.Eq((long?)31, TokenPeek.LeaseSub(lease));
            Assert.Null(TokenPeek.LeaseSub(null));
            Assert.Null(TokenPeek.LeaseSub("a.b.c"), "three parts is a JWT, not a lease");
        }

        [Test]
        public static void ForUser_RejectsNonPositive()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => DeviceKeyStore.ForUser(0));
            Assert.Throws<ArgumentOutOfRangeException>(() => DeviceKeyStore.ForUser(-1));
        }

        /// <summary>
        /// Хоёр ажилтан НЭГ Windows профайлд → ӨӨР түлхүүр (бие биенийхээ бүртгэлийг эвдэхгүй); түлхүүрийг
        /// устгаад дахин үүсгэвэл ШИНЭ key_id (admin цуцалсан түлхүүрийн оронд).  Бодит CNG (TPM байвал TPM).
        /// </summary>
        [Test]
        public static void ForUser_SeparateKeysPerEmployee_AndRotationMakesNewKey()
        {
            if (!OperatingSystem.IsWindows()) return;
            long a = 900000000 + Environment.ProcessId % 1000;
            long b = a + 1;
            DeviceKeyStore sa = DeviceKeyStore.ForUser(a);
            DeviceKeyStore sb = DeviceKeyStore.ForUser(b);
            try
            {
                DeviceSigner ka = sa.OpenOrCreate(out string ea);
                DeviceSigner kb = sb.OpenOrCreate(out string eb);
                Assert.NotNull(ka, ea);
                Assert.NotNull(kb, eb);
                Assert.True(ka.KeyId != kb.KeyId, "two employees must not share a device key");
                Assert.Eq(ka.KeyId, DeviceKeyStore.ForUser(a).TryOpenExisting()?.KeyId, "reopen same employee");

                sa.Delete();
                Assert.Null(DeviceKeyStore.ForUser(a).TryOpenExisting(), "deleted");
                DeviceSigner ka2 = sa.OpenOrCreate(out string ea2);
                Assert.NotNull(ka2, ea2);
                Assert.True(ka2.KeyId != ka.KeyId, "rotation must yield a new key");
                Assert.Eq(kb.KeyId, DeviceKeyStore.ForUser(b).TryOpenExisting()?.KeyId, "other employee untouched");
            }
            finally
            {
                sa.Delete();
                sb.Delete();
            }
        }
    }
}
