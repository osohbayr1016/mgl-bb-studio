using System;
using System.Security.Cryptography;
using System.Text;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// ТОГТВОРТОЙ товч хэш — таних түлхүүр (clash fingerprint, баримтын хавтас, логийн id).
    ///
    /// ⚠️ Нууцлал биш, ТАНИХ тэмдэг: SHA-256-ийн эхний 8 байт (16 hex) нь
    /// мөргөлдөх магадлал хангалттай бага (2^-64 / хос) боловч криптограф хамгаалалт
    /// гэж ойлгож болохгүй.
    ///
    /// ⚠️ Хэсгүүдийг `\u001f` (unit separator)-оор холбодог тул ("ab","c") ≠ ("a","bc").
    /// </summary>
    public static class SmartHash
    {
        private const char Sep = '\u001f';

        public static string Short(string text, int bytes = 8)
        {
            if (bytes < 1) bytes = 1;
            if (bytes > 32) bytes = 32;
            byte[] h = SHA256.HashData(Encoding.UTF8.GetBytes(text ?? string.Empty));
            var sb = new StringBuilder(bytes * 2);
            for (int i = 0; i < bytes; i++) sb.Append(h[i].ToString("x2"));
            return sb.ToString();
        }

        /// <summary>Олон хэсгийн хэш — `("ab","c")` ≠ `("a","bc")` (хэсгүүдийн хооронд тусгаарлагч).</summary>
        public static string Of(params string[] parts)
        {
            return Short(string.Join(Sep.ToString(), parts ?? new string[0]), 8);
        }

        public static string NewId()
        {
            return Guid.NewGuid().ToString("N");
        }
    }
}
