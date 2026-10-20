using System;
using System.Security.Cryptography;
using System.Text;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// БАРИМТЫН ТҮЛХҮҮР — `RevitTools.DocUid(doc)`-ийн НОРМЧИЛСОН хэлбэр.
    ///
    /// `DocUid` нь `ProjectInformation.UniqueId`-г, байхгүй бол (family,
    /// хадгалаагүй файл) `path:<бүтэн зам>`-ыг буцаадаг.  Тэр зам нь
    /// компанийн файл серверийн UNC хаяг байж болно — §11/§61-ээр ГЭРЭЭНД,
    /// ЖУРНАЛД, УТСАНД ОРОХГҮЙ.  Тиймээс Intelligence тал `path:`-ыг
    /// `path:<sha256-ийн эхний 16>` болгож, Track 2-ийн түүхий түлхүүрийг
    /// (`ChangeTracker`, `BimEmitter`) ХӨНДӨХГҮЙ — зөвхөн орж ирэх бүрд
    /// энэ функцээр дамжуулна.
    /// </summary>
    public static class DocKeys
    {
        public static string Normalize(string rawDocUid)
        {
            if (string.IsNullOrEmpty(rawDocUid)) return rawDocUid;
            if (!rawDocUid.StartsWith("path:", StringComparison.Ordinal)) return rawDocUid;
            using (var sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(rawDocUid));
                var sb = new StringBuilder("path:");
                for (int i = 0; i < 8; i++) sb.Append(h[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public static bool IsPathBased(string key)
        {
            return key != null && key.StartsWith("path:", StringComparison.Ordinal);
        }
    }
}
