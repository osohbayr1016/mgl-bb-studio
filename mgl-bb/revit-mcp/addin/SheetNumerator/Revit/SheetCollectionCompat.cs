using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Хуудасны цуглуулга (Sheet Collection)-тай холбоотой Revit API-н ГАНЦ орох цэг.
    ///
    /// ⚠️ `SheetCollection` анги ба `ViewSheet.SheetCollectionId` нь Revit 2025-аас.  Энэ репод нэг csproj нь
    /// Revit оны тус бүрд өөр TFM-ээр эмхэтгэгддэг (2024 = net48, 2025/2026 = net8, 2027 = net10 — csproj-ийн
    /// толгой тайлбар), тиймээс «Revit 2025+» ≡ `NET8_0_OR_GREATER`.  Цуглуулгад хүрэх БҮХ дуудлага ЭНД —
    /// net48 (Revit 2024) build-д эдгээр API ОГТ эмхэтгэгдэхгүй, бусад код хуучин зам хэвээр.
    ///
    /// Хэмжсэн (Revit 2027.2): дугаар нь «Model-д шууд байгаа хуудсууд»-д нэг, цуглуулга бүрт тус бүр нэг;
    /// assembly хуудас цуглуулгад орж ЧАДАХГҮЙ (ArgumentException).
    /// </summary>
    internal static class SheetCollectionApi
    {
        public static bool IsSupported
        {
            get
            {
#if NET8_0_OR_GREATER
                return true;
#else
                return false;
#endif
            }
        }

        /// <summary>Давхардлын хүрээ: Revit 2025+ — цуглуулга бүрээр; Revit 2024 — ГЛОБАЛ.</summary>
        public static UniquenessMode Uniqueness
        {
            get { return IsSupported ? UniquenessMode.PerSheetCollection : UniquenessMode.Global; }
        }

        /// <summary>Хуудасны цуглуулгын id (0 = цуглуулгагүй, эсвэл энэ Revit-д цуглуулга байхгүй).</summary>
        public static long CollectionIdOf(ViewSheet sheet)
        {
#if NET8_0_OR_GREATER
            ElementId id = sheet.SheetCollectionId;
            return id == null || id == ElementId.InvalidElementId ? 0 : id.Value;
#else
            return 0;
#endif
        }

        /// <summary>Document дахь БҮХ цуглуулга (id → нэр).  Revit 2024-д хоосон.</summary>
        public static IReadOnlyList<CollectionInfo> List(Document doc)
        {
            var list = new List<CollectionInfo>();
#if NET8_0_OR_GREATER
            foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(SheetCollection)))
                list.Add(new CollectionInfo { Id = e.Id.Value, Name = e.Name });
#endif
            return list;
        }
    }
}
