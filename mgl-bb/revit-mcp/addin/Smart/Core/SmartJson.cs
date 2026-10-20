using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// «MGL Smart» (Publish / Count / Clash / Impact) дэд системийн ЛОКАЛ файлуудын
    /// JSON тохиргоо.  Утасны (сервер рүү явдаг) `[JsonPropertyName]` snake_case-тэй
    /// ТУСДАА — энэ нь зөвхөн `%APPDATA%\RevitMcpAddin\smart\` доторх файл.
    ///
    /// ⚠️ ТЭСВЭРТЭЙ ENUM.  Стандарт `JsonStringEnumConverter` нь танигдаагүй утгад
    /// АЛДАА шидэж, бүхэл файлыг «эвдэрсэн» болгодог.  Шинэ хувилбар enum-д утга
    /// нэмээд хуучин add-in тэр файлыг уншвал тэр дүрэм/мөрийг л алдахаас биш
    /// бүх түүхийг хаяж болохгүй.  Танигдаагүй утга → `default(T)`; тиймээс
    /// хадгалагддаг enum бүрийн 0 утга нь АЮУЛГҮЙ («Unknown») байх ёстой.
    /// </summary>
    public static class SmartJson
    {
        public static readonly JsonSerializerOptions Indented = Create(true);
        public static readonly JsonSerializerOptions Compact = Create(false);

        private static JsonSerializerOptions Create(bool indented)
        {
            var o = new JsonSerializerOptions
            {
                WriteIndented = indented,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true,
            };
            o.Converters.Add(new TolerantEnumConverterFactory());
            return o;
        }

        public static string Serialize<T>(T value, bool indented = false)
        {
            return JsonSerializer.Serialize(value, indented ? Indented : Compact);
        }

        public static T Deserialize<T>(string json)
        {
            return JsonSerializer.Deserialize<T>(json, Compact);
        }

        /// <summary>Эвдэрсэн/хоосон оролтод шидэхгүй — `default` буцаана.</summary>
        public static bool TryDeserialize<T>(string json, out T value)
        {
            value = default(T);
            if (string.IsNullOrWhiteSpace(json)) return false;
            try
            {
                value = JsonSerializer.Deserialize<T>(json, Compact);
                return value != null;
            }
            catch (JsonException) { return false; }
            catch (NotSupportedException) { return false; }
        }
    }

    public sealed class TolerantEnumConverterFactory : JsonConverterFactory
    {
        public override bool CanConvert(Type typeToConvert)
        {
            if (typeToConvert.IsEnum) return true;
            Type u = Nullable.GetUnderlyingType(typeToConvert);
            return u != null && u.IsEnum;
        }

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
        {
            Type u = Nullable.GetUnderlyingType(typeToConvert);
            Type enumType = u ?? typeToConvert;
            Type conv = (u != null ? typeof(NullableTolerantEnumConverter<>) : typeof(TolerantEnumConverter<>))
                .MakeGenericType(enumType);
            return (JsonConverter)Activator.CreateInstance(conv);
        }
    }

    internal static class EnumText
    {
        public static bool TryParse<T>(string s, out T value) where T : struct, Enum
        {
            value = default(T);
            if (string.IsNullOrEmpty(s)) return false;
            // camelCase / PascalCase / snake_case бүгдийг хүлээн авна.
            string norm = s.Replace("_", "").Replace("-", "");
            return Enum.TryParse(norm, true, out value) && Enum.IsDefined(typeof(T), value);
        }

        public static string Name<T>(T value) where T : struct, Enum
        {
            return JsonNamingPolicy.CamelCase.ConvertName(value.ToString());
        }
    }

    internal sealed class TolerantEnumConverter<T> : JsonConverter<T> where T : struct, Enum
    {
        public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.String:
                    T v;
                    return EnumText.TryParse(reader.GetString(), out v) ? v : default(T);
                case JsonTokenType.Number:
                    long n;
                    if (reader.TryGetInt64(out n))
                    {
                        T cast = (T)Enum.ToObject(typeof(T), n);
                        return Enum.IsDefined(typeof(T), cast) ? cast : default(T);
                    }
                    return default(T);
                default:
                    reader.Skip();
                    return default(T);
            }
        }

        public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(EnumText.Name(value));
        }
    }

    internal sealed class NullableTolerantEnumConverter<T> : JsonConverter<T?> where T : struct, Enum
    {
        private readonly TolerantEnumConverter<T> _inner = new TolerantEnumConverter<T>();

        public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Null) return null;
            return _inner.Read(ref reader, typeof(T), options);
        }

        public override void Write(Utf8JsonWriter writer, T? value, JsonSerializerOptions options)
        {
            if (value == null) writer.WriteNullValue();
            else _inner.Write(writer, value.Value, options);
        }
    }
}
