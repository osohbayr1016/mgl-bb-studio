using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /* ================================================================== */
    /*  R4.1 — ЭЛЕМЕНТИЙН БАРИМТ (Revit-гүй, цэвэр) + preview-ийн холбоос  */
    /*                                                                    */
    /*  Executor (Revit/RevitActionExecutor.cs) Revit-ээс эдгээрийг УНШИЖ,  */
    /*  шалгалт бүр ЭНД (цэвэр, тесттэй) хийгдэнэ.  Revit API-г шалгалтын  */
    /*  логик руу ХЭЗЭЭ Ч ОРУУЛАХГҮЙ — тэгвэл тест боломжгүй болно.        */
    /* ================================================================== */

    public enum ParamStorage { NONE, INTEGER, DOUBLE, STRING, ELEMENT_ID }

    public sealed class ParamFacts
    {
        public string Name;
        public ParamStorage Storage;
        public bool ReadOnly;
        /// <summary>Одоогийн утга мөрөөр (DOUBLE = дотоод нэгж, invariant culture).</summary>
        public string Value;
        public bool IsTypeParam;
    }

    public sealed class TypeFacts
    {
        public long TypeId;
        public string Name;
        public string Family;
        public string Category;
    }

    public sealed class ElementFacts
    {
        public bool Exists;
        public long ElementId;
        public string UniqueId;
        public string Category;
        public string Family;
        public string Type;
        public long? TypeId;
        public bool IsLinked;
        public bool IsPinned;
        public bool IsElementType;
        /// <summary>Worksharing: элемент энэ хэрэглэгчид засварлагдах боломжтой (checkout OK / not workshared).</summary>
        public bool Editable = true;
        public string EditableReason;
        public double[] LocationMm;
        public bool HasPointOrCurveLocation;
        public Dictionary<string, ParamFacts> Params = new Dictionary<string, ParamFacts>(StringComparer.Ordinal);
        /// <summary>CHANGE_TYPE: тухайн элементэд ЗӨВШӨӨРӨГДӨХ төрлүүд (ижил категори/family агуулга).</summary>
        public List<TypeFacts> ValidTypes = new List<TypeFacts>();
    }

    public sealed class DocumentFacts
    {
        public string DocKey;
        public string Title;
        public bool IsReadOnly;
        public bool IsLinked;
        public bool IsFamily;
        public bool IsModifiable = true;
        public bool IsWorkshared;
        public bool IsTestFixture;
        /// <summary>Хурууны хээ — doc_key + title + элементийн тоо гэх мэт «өөрчлөлт мэдрэгч» утгуудаас.</summary>
        public string Fingerprint;
    }

    /// <summary>Хэш, хурууны хээ — preview-ийн холбоос (§14).</summary>
    public static class ActionHash
    {
        public static string Sha256(string s)
        {
            using (var h = SHA256.Create())
            {
                byte[] b = h.ComputeHash(Encoding.UTF8.GetBytes(s ?? ""));
                var sb = new StringBuilder(64);
                foreach (byte x in b) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }

        public static string Short(string sha) { return string.IsNullOrEmpty(sha) ? null : sha.Substring(0, 16); }

        public static string StateFingerprint(string value, double[] locationMm, long? typeId)
        {
            string loc = locationMm == null ? "-" : string.Join(",", Array.ConvertAll(locationMm, v => Math.Round(v, 1).ToString(CultureInfo.InvariantCulture)));
            return Short(Sha256((value ?? "") + "|" + loc + "|" + (typeId.HasValue ? typeId.Value.ToString(CultureInfo.InvariantCulture) : "-")));
        }

        public static string ProposalHash(RevitActionEnvelope a)
        {
            var sb = new StringBuilder();
            sb.Append(a.Action).Append('|').Append(a.DocKey).Append('|');
            if (a.TargetElementIds != null) sb.Append(string.Join(",", a.TargetElementIds));
            sb.Append('|');
            if (a.Parameters != null)
            {
                var keys = new List<string>(a.Parameters.Keys); keys.Sort(StringComparer.Ordinal);
                foreach (string k in keys) sb.Append(k).Append('=').Append(a.Parameters[k]).Append(';');
            }
            return Short(Sha256(sb.ToString()));
        }

        public static string Binding(string docFingerprint, string uniqueId, string beforeFingerprint, string proposalHash, string nonce)
        {
            return Sha256(docFingerprint + "|" + uniqueId + "|" + beforeFingerprint + "|" + proposalHash + "|" + nonce);
        }

        public static string Nonce()
        {
            return Guid.NewGuid().ToString("N").Substring(0, 12) + DateTime.UtcNow.Ticks.ToString("x");
        }
    }
}
