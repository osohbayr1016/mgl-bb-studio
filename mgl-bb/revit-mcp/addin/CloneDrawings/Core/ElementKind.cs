using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.CloneDrawings.Core
{
    /// <summary>
    /// Загвар элементийг НЭРЭЭР нь таних (Revit-гүй, тесттэй): ангилал + family/төрлийн нэрээс
    /// инженерийн ойлгох нэр («Дам нуруу», «Ферм», «Багана» …) гаргана.  Цонхны гарчиг, сонголтын
    /// жагсаалт, мэдэгдэлд хэрэглэнэ — «дам нуруу клонлож байна» гэдгийг тод харуулна.
    /// </summary>
    public static class ElementKind
    {
        private static readonly Dictionary<string, string> ByCategory = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["OST_StructuralFraming"] = "Дам нуруу",
            ["OST_StructuralColumns"] = "Багана",
            ["OST_Columns"] = "Багана (арх.)",
            ["OST_StructuralFoundation"] = "Суурь",
            ["OST_Walls"] = "Хана",
            ["OST_Floors"] = "Хавтан",
            ["OST_Ceilings"] = "Тааз",
            ["OST_Roofs"] = "Дээвэр",
            ["OST_Stairs"] = "Шат",
            ["OST_Ramps"] = "Налуу зам",
            ["OST_Railings"] = "Хашлага",
            ["OST_StairsRailing"] = "Хашлага",
            ["OST_Doors"] = "Хаалга",
            ["OST_Windows"] = "Цонх",
            ["OST_CurtainWallPanels"] = "Шилэн хананы хавтан",
            ["OST_CurtainWallMullions"] = "Шилэн хананы хүрээ",
            ["OST_StructuralTruss"] = "Ферм",
            ["OST_StructuralConnectionHandler"] = "Холболт",
            ["OST_StructConnections"] = "Холболт",
            ["OST_Rebar"] = "Арматур",
            ["OST_GenericModel"] = "Ерөнхий загвар",
            ["OST_Furniture"] = "Тавилга",
            ["OST_Casework"] = "Шүүгээ",
            ["OST_PlumbingFixtures"] = "Сантехник",
            ["OST_MechanicalEquipment"] = "Механик тоног",
            ["OST_DuctCurves"] = "Агаарын суваг",
            ["OST_PipeCurves"] = "Хоолой",
            ["OST_CableTray"] = "Кабелийн тавиур",
            ["OST_Conduit"] = "Хоолой (цахилгаан)",
            ["OST_ElectricalEquipment"] = "Цахилгаан тоног",
            ["OST_LightingFixtures"] = "Гэрэлтүүлэг",
            ["OST_Parking"] = "Зогсоол",
            ["OST_Site"] = "Талбай",
        };

        /// <summary>
        /// Инженерийн нэр.  <paramref name="builtInCategory"/> — «OST_StructuralFraming» гэх мэт
        /// (Revit-гүй тест хийхийн тулд мөр).  <paramref name="structuralUsage"/> — «Brace», «Joist» …
        /// </summary>
        public static string Describe(string builtInCategory, string familyName, string typeName, string structuralUsage,
            string fallbackCategoryName)
        {
            string fam = (familyName ?? "") + " " + (typeName ?? "");
            if (builtInCategory == "OST_StructuralFraming")
            {
                if (structuralUsage == "Brace" || Has(fam, "brace", "налуу", "тулгуур"))
                    return "Налуу тулгуур";
                if (structuralUsage == "Purlin" || Has(fam, "purlin", "прогон"))
                    return "Прогон";
                if (Has(fam, "joist", "k-series", "lh-series", "ферм"))
                    return "Ферм";
                return "Дам нуруу";
            }
            if (builtInCategory == "OST_Walls" && Has(fam, "retaining", "тулах"))
                return "Тулах хана";
            if (builtInCategory == "OST_StructuralFoundation")
            {
                if (Has(fam, "pile", "шон"))
                    return "Шон суурь";
                if (Has(fam, "strip", "wall foundation", "туузан"))
                    return "Туузан суурь";
                return "Суурь";
            }
            if (builtInCategory != null && ByCategory.TryGetValue(builtInCategory, out string name))
                return name;
            return string.IsNullOrWhiteSpace(fallbackCategoryName) ? "Элемент" : fallbackCategoryName;
        }

        private static bool Has(string text, params string[] needles)
        {
            foreach (string n in needles)
            {
                if (CultureInfo.InvariantCulture.CompareInfo.IndexOf(text, n, CompareOptions.IgnoreCase) >= 0)
                    return true;
            }
            return false;
        }
    }

    /// <summary>Харагдац/хуудасны нэрэнд элементийн тэмдэг (Mark) БҮТЭН үгээр орсон эсэх.</summary>
    public static class NameMatch
    {
        /// <summary>
        /// «B1 - Зүсэлт», «Зүсэлт B1», «B1_фасад», «(B1)» → true.  «B12», «AB1» → false.  Тэмдэг
        /// солиход аюултай (IsReplaceableMark биш: «1», «12») бол ХЭЗЭЭ Ч таарахгүй — «Level 1» бүх
        /// харагдацыг «холбоотой» гэж андуурахгүйн тулд.  Том/жижиг үсэг ялгахгүй, кирилл/латин
        /// хольж бичсэн «В1» (кирилл В) ба «B1» (латин B)-ийг ижил гэж үзнэ.
        /// </summary>
        public static bool ContainsMark(string text, string mark)
        {
            if (string.IsNullOrEmpty(text) || !CloneNaming.IsReplaceableMark(mark))
                return false;
            string t = Fold(text), m = Fold(mark);
            int i = 0;
            while (i <= t.Length - m.Length)
            {
                int at = t.IndexOf(m, i, StringComparison.Ordinal);
                if (at < 0)
                    return false;
                bool left = at == 0 || !char.IsLetterOrDigit(t[at - 1]);
                int end = at + m.Length;
                bool right = end >= t.Length || !char.IsLetterOrDigit(t[end]);
                if (left && right)
                    return true;
                i = at + 1;
            }
            return false;
        }

        /// <summary>Кирилл/латин ижил дүрстэй үсгийг нэгтгэж, том болгоно (А/A, В/B, С/C, Е/E, Н/H, К/K, М/M, О/O, Р/P, Т/T, Х/X).</summary>
        public static string Fold(string s)
        {
            var chars = s.ToUpperInvariant().ToCharArray();
            for (int k = 0; k < chars.Length; k++)
            {
                switch (chars[k])
                {
                    case 'А': chars[k] = 'A'; break;
                    case 'В': chars[k] = 'B'; break;
                    case 'С': chars[k] = 'C'; break;
                    case 'Е': chars[k] = 'E'; break;
                    case 'Н': chars[k] = 'H'; break;
                    case 'К': chars[k] = 'K'; break;
                    case 'М': chars[k] = 'M'; break;
                    case 'О': chars[k] = 'O'; break;
                    case 'Р': chars[k] = 'P'; break;
                    case 'Т': chars[k] = 'T'; break;
                    case 'Х': chars[k] = 'X'; break;
                }
            }
            return new string(chars);
        }
    }
}
