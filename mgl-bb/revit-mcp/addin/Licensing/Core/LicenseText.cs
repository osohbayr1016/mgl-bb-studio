namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>Лицензийн төлөвийн ажилтанд харагдах тайлбар (цонх, MCP bridge).</summary>
    public static class LicenseText
    {
        public static string ForStatus(LeaseStatus status)
        {
            switch (status)
            {
                case LeaseStatus.Valid:
                    return "Лиценз хүчинтэй.";
                case LeaseStatus.Missing:
                    return "MGL add-in-ийг ашиглахын тулд компанийн бүртгэлээрээ нэвтэрнэ үү.";
                case LeaseStatus.Expired:
                    return "Лицензийн хугацаа дууссан — интернэтэд холбогдоод дахин шалгана уу.";
                case LeaseStatus.ClockRolledBack:
                case LeaseStatus.NotYetValid:
                    return "Компьютерын цаг буруу байна. Цагаа засаад дахин шалгана уу.";
                case LeaseStatus.WrongDevice:
                    return "Энэ лиценз өөр компьютерынх. Энэ компьютер дээр дахин нэвтэрнэ үү.";
                case LeaseStatus.UnknownKey:
                case LeaseStatus.BadSignature:
                case LeaseStatus.WrongAudience:
                case LeaseStatus.Malformed:
                default:
                    return "Хадгалсан лиценз хүчингүй байна. Дахин нэвтэрнэ үү.";
            }
        }

        public static string RoleLabel(string role)
        {
            switch (role)
            {
                case "admin": return "админ";
                case "engineer": return "инженер";
                case "architect": return "архитектор";
                case "senior": return "ахлах";
                case "client": return "захиалагч";
                default: return role ?? string.Empty;
            }
        }
    }
}
