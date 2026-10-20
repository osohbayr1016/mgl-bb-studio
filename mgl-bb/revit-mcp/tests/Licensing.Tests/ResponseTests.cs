using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing.Tests
{
    /// <summary>
    /// `POST /api/revit/license`-ийн хариу → add-in-ий үйлдэл.  JSON-ууд нь серверийн
    /// (`routes/revitLicense.ts`, middleware) БОДИТ хариуны хэлбэр.
    /// </summary>
    public static class ResponseTests
    {
        [Test]
        public static void Ok_ReturnsLease()
        {
            var r = LicenseResponse.Classify(200,
                "{\"ok\":true,\"lease\":\"aaa.bbb\",\"via\":\"match\",\"expires_at\":\"2026-10-04T08:00:00.000Z\"}");
            Assert.Eq(LicenseResponse.Kind.Ok, r.Kind);
            Assert.Eq("aaa.bbb", r.Lease);
        }

        [Test]
        public static void NotWorkPc_IsHardDeny_WithServerMessage()
        {
            var r = LicenseResponse.Classify(403,
                "{\"ok\":false,\"code\":\"NOT_WORK_PC\",\"error\":\"Энэ компьютер таны ирц бүртгүүлдэг ажлын компьютер гэж танигдсангүй.\"}");
            Assert.Eq(LicenseResponse.Kind.Denied, r.Kind);
            Assert.Eq("NOT_WORK_PC", r.Code);
            Assert.True(r.Message.StartsWith("Энэ компьютер"));
            foreach (string c in LicenseResponse.HardDenyCodes) Assert.True(LicenseResponse.IsHardDeny(c), c);
        }

        [Test]
        public static void RoleForbidden_WithoutCode_IsHardDeny()
        {
            // `requireRole` / workerScope / clientScope — кодгүй англи 403.
            var r = LicenseResponse.Classify(403, "{\"error\":\"Forbidden: insufficient permissions\"}");
            Assert.Eq(LicenseResponse.Kind.Denied, r.Kind);
            Assert.Eq("FORBIDDEN", r.Code);
            Assert.Eq("Таны бүртгэлээр MGL add-in ашиглах эрхгүй.", r.Message);
        }

        [Test]
        public static void OfficeNetwork_IsSoft_NotDeny()
        {
            var r = LicenseResponse.Classify(403,
                "{\"error\":\"Оффисын сүлжээнд холбогдоно уу\",\"detail\":\"IP хаяг (1.2.3.4) зөвшөөрөгдөөгүй байна\",\"code\":\"office_network_required\"}");
            Assert.Eq(LicenseResponse.Kind.Soft, r.Kind);
            Assert.Eq("Оффисын сүлжээнд холбогдоно уу", r.Message);
        }

        [Test]
        public static void Unauthorized_401()
        {
            var r = LicenseResponse.Classify(401, "{\"error\":\"Invalid or expired token\"}");
            Assert.Eq(LicenseResponse.Kind.Unauthorized, r.Kind);
        }

        [Test]
        public static void OldServer404_And_NotConfigured503_AreNotReady()
        {
            Assert.Eq(LicenseResponse.Kind.NotReady, LicenseResponse.Classify(404, "{\"error\":\"Not Found\"}").Kind);
            var r = LicenseResponse.Classify(503,
                "{\"ok\":false,\"code\":\"LICENSE_NOT_CONFIGURED\",\"error\":\"Лицензийн сервер тохируулагдаагүй байна. Admin-д хандана уу.\"}");
            Assert.Eq(LicenseResponse.Kind.NotReady, r.Kind);
            Assert.Eq("LICENSE_NOT_CONFIGURED", r.Code);
        }

        [Test]
        public static void ServerError_Html_And_200WithoutLease_AreSoft()
        {
            Assert.Eq(LicenseResponse.Kind.Soft, LicenseResponse.Classify(500, "<html>error 1101</html>").Kind);
            Assert.Eq(LicenseResponse.Kind.Soft, LicenseResponse.Classify(502, "").Kind);
            Assert.Eq(LicenseResponse.Kind.Soft, LicenseResponse.Classify(200, "{\"ok\":true}").Kind);
            Assert.Eq(LicenseResponse.Kind.Soft, LicenseResponse.Classify(200, "not json").Kind);
        }
    }
}
