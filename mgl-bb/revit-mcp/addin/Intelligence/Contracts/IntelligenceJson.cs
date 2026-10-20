using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /// <summary>
    /// SESSION R — Revit Intelligence гэрээнүүдийн ГАНЦ JSON тохиргоо.
    ///
    /// ⚠️ Enum нь ҮРГЭЛЖ НЭРЭЭР (`JsonStringEnumConverter`) — тоон утгыг
    ///    утсаар илгээхгүй (`Units.cs`-ийн дүрэм).  Гишүүдийн нэр нь
    ///    UPPER_SNAKE тул утсан дээр `"ON_LEVEL"`, `"HOSTED_BY"` гэж гарна.
    /// ⚠️ `null` талбарыг ХАСНА — Revit-ээс уншиж чадаагүй утга нь
    ///    «мэдэхгүй» бөгөөд түүнийг `0`/`""` болгож ХУДАЛ мэдээлэл болгохгүй.
    /// </summary>
    public static class IntelligenceJson
    {
        public static readonly JsonSerializerOptions Options = Build(false);
        public static readonly JsonSerializerOptions Pretty = Build(true);

        private static JsonSerializerOptions Build(bool indented)
        {
            var o = new JsonSerializerOptions
            {
                WriteIndented = indented,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                PropertyNameCaseInsensitive = true,
            };
            o.Converters.Add(new JsonStringEnumConverter());
            return o;
        }

        public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
        public static T Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);
    }

    /// <summary>Гэрээ бүрийн `schema_version` — БҮГД 1.  Талбар нэмэхэд өсгөхгүй;
    /// утга нь ӨӨРЧЛӨГДӨХ (нэгж, семантик) үед л өсгөнө.</summary>
    public static class Schema
    {
        public const int Version = 1;
    }
}
