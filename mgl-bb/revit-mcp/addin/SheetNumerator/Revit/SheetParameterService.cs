using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Хуудасны параметртэй ажиллах Revit давхарга: таних түлхүүр, төрлийн ангилал, утга унших, түлхүүрээр
    /// олох, бичих.
    ///
    /// ⚠️ ТАНИХ нь `ElementId` ЭСВЭЛ харагдах нэрээр БИШ: built-in → BuiltInParameter тоо, shared → GUID,
    /// төслийн параметр → нэр (өөр тогтвортой танигч байхгүй).  Нэр нь локалчлагддаг, мөн «Sheet Number» гэх мэт
    /// нэр ХОЁР built-in параметрт (SHEET_NUMBER, VIEWER_SHEET_NUMBER) давтагддаг (Revit 2027.2 дээр хэмжсэн).
    /// </summary>
    internal static class SheetParameterService
    {
        // ── Түлхүүр ─────────────────────────────────────────────────
        public static ParameterKey KeyOf(Parameter p)
        {
            Definition def = p.Definition;
            if (p.IsShared)
            {
                Guid g;
                try { g = p.GUID; }
                catch (Exception) { g = Guid.Empty; }
                if (g != Guid.Empty)
                    return ParameterKey.Shared(g, def.Name);
            }
            InternalDefinition idef = def as InternalDefinition;
            if (idef != null && idef.BuiltInParameter != BuiltInParameter.INVALID)
                return ParameterKey.BuiltIn((int)idef.BuiltInParameter);
            return ParameterKey.Project(def.Name);
        }

        /// <summary>Түлхүүрээр параметрийг олно (байхгүй бол null).</summary>
        public static Parameter Resolve(Element sheet, ParameterKey key)
        {
            if (sheet == null || key == null)
                return null;
            switch (key.Kind)
            {
                case ParameterKind.BuiltIn:
                    return sheet.get_Parameter((BuiltInParameter)key.BuiltInId);
                case ParameterKind.Shared:
                    return sheet.get_Parameter(key.SharedGuid);
                default:
                    foreach (Parameter p in sheet.Parameters)
                    {
                        if (p.IsShared)
                            continue;
                        InternalDefinition idef = p.Definition as InternalDefinition;
                        if (idef != null && idef.BuiltInParameter != BuiltInParameter.INVALID)
                            continue;
                        if (string.Equals(p.Definition.Name, key.Name, StringComparison.Ordinal))
                            return p;
                    }
                    return null;
            }
        }

        /// <summary>Параметр id-аар (негатив = built-in; эерэг = ParameterElement) — Browser-ийн эрэмбэлэх параметрт.</summary>
        public static Parameter ResolveById(Element element, long id)
        {
            if (element == null)
                return null;
            foreach (Parameter p in element.Parameters)
            {
                if (p.Id.Value == id)
                    return p;
            }
            return null;
        }

        // ── Төрлийн ангилал ─────────────────────────────────────────
        public static ParamValueKind Classify(Parameter p)
        {
            try
            {
                switch (p.StorageType)
                {
                    case StorageType.String:
                        return ParamValueKind.Text;
                    case StorageType.ElementId:
                        return ParamValueKind.ElementReference;
                    case StorageType.Integer:
                    {
                        ForgeTypeId spec = p.Definition.GetDataType();
                        if (spec != null && spec == SpecTypeId.Boolean.YesNo)
                            return ParamValueKind.YesNo;
                        return ParamValueKind.Integer;
                    }
                    case StorageType.Double:
                    {
                        ForgeTypeId spec = p.Definition.GetDataType();
                        if (spec != null && spec == SpecTypeId.Number)
                            return ParamValueKind.Number;
                        if (spec != null && UnitUtils.IsMeasurableSpec(spec))
                            return ParamValueKind.Dimensional;
                        return ParamValueKind.Other;
                    }
                    default:
                        return ParamValueKind.Other;
                }
            }
            catch (Exception)
            {
                return ParamValueKind.Other;
            }
        }

        /// <summary>
        /// Каталогт ОРУУЛАХГҮЙ «шуугиан»: Category/Family/Type, VIEWER_* (зөвхөн унших лавлагаа), SYMBOL_*,
        /// харагдацын дотоод тохиргоо.  Тэд нь дугаарын угтвар/дагавар, бичих зорилт болох утгагүй.
        /// </summary>
        public static bool IsNoise(Parameter p)
        {
            InternalDefinition idef = p.Definition as InternalDefinition;
            if (idef == null || idef.BuiltInParameter == BuiltInParameter.INVALID)
                return false;
            string name = idef.BuiltInParameter.ToString();
            return name.StartsWith("ELEM_", StringComparison.Ordinal)
                || name.StartsWith("SYMBOL_", StringComparison.Ordinal)
                || name.StartsWith("VIEWER_", StringComparison.Ordinal)
                || name.StartsWith("VIEW_", StringComparison.Ordinal)
                || name.StartsWith("DESIGN_OPTION", StringComparison.Ordinal)
                || name.StartsWith("SHEET_REVISIONS", StringComparison.Ordinal)
                || name == "SHEET_NUMBER"      // дугаар өөрөө — «параметрт бичих» замаар ОРООГҮЙ, 2 алхамт алгоритмаар
                || name == "SHEET_NAME"        // нэр — нэрийн тусдаа сонголтоор
                || name == "SHEET_COLLECTION"; // цуглуулгыг энэ хэрэгсэл ӨӨРЧЛӨХГҮЙ
        }

        // ── Утга унших ──────────────────────────────────────────────
        public static SheetParameterValue Read(Parameter p)
        {
            try
            {
                switch (p.StorageType)
                {
                    case StorageType.String:
                    {
                        string s = p.AsString();
                        return new SheetParameterValue(p.HasValue && !string.IsNullOrEmpty(s), s);
                    }
                    case StorageType.ElementId:
                    {
                        ElementId id = p.AsElementId();
                        if (id == null || id == ElementId.InvalidElementId)
                            return new SheetParameterValue(false, string.Empty);
                        return new SheetParameterValue(true, p.AsValueString());
                    }
                    case StorageType.Integer:
                    {
                        if (!p.HasValue)
                            return new SheetParameterValue(false, string.Empty);
                        string v = p.AsValueString();
                        return new SheetParameterValue(true, string.IsNullOrEmpty(v)
                            ? p.AsInteger().ToString(CultureInfo.InvariantCulture) : v);
                    }
                    case StorageType.Double:
                    {
                        if (!p.HasValue)
                            return new SheetParameterValue(false, string.Empty);
                        string v = p.AsValueString();
                        return new SheetParameterValue(true, string.IsNullOrEmpty(v)
                            ? p.AsDouble().ToString("R", CultureInfo.InvariantCulture) : v);
                    }
                    default:
                        return new SheetParameterValue(false, string.Empty);
                }
            }
            catch (Exception)
            {
                return new SheetParameterValue(false, string.Empty);
            }
        }

        /// <summary>
        /// Каталогийг эцэслэнэ: нэр давхцсан (жишээ «Sheet Number» ×2) мөрөнд ялгах шошго нэмж, нэрээр эрэмбэлнэ.
        /// Каталогийг хуудас бүрийн параметрээс `SheetSnapshotService` угсарна.
        /// </summary>
        public static void FinalizeCatalog(List<SheetParameterInfo> catalog)
        {
            var byName = catalog.GroupBy(c => c.DisplayName, StringComparer.CurrentCultureIgnoreCase).Where(g => g.Count() > 1);
            foreach (var g in byName)
            {
                foreach (SheetParameterInfo info in g)
                    info.Label = info.DisplayName + " [" + ShortKey(info.Key) + "]";
            }
            catalog.Sort((a, b) =>
            {
                int c = string.Compare(a.Label ?? a.DisplayName, b.Label ?? b.DisplayName, StringComparison.CurrentCultureIgnoreCase);
                return c != 0 ? c : string.CompareOrdinal(a.Key.Stable, b.Key.Stable);
            });
        }

        private static string ShortKey(ParameterKey key)
        {
            switch (key.Kind)
            {
                case ParameterKind.BuiltIn:
                    return Enum.IsDefined(typeof(BuiltInParameter), key.BuiltInId)
                        ? ((BuiltInParameter)key.BuiltInId).ToString() : "bip " + key.BuiltInId;
                case ParameterKind.Shared:
                    return "shared";
                default:
                    return "project";
            }
        }

        // ── Бичих ───────────────────────────────────────────────────
        /// <summary>
        /// Параметрийг хуудсанд бичнэ.  false бол <paramref name="reason"/>-д шалтгаан.  Нээлттэй Transaction дотор.
        /// </summary>
        public static bool TryWrite(ViewSheet sheet, ParameterWrite write, out string reason)
        {
            reason = null;
            Parameter p = Resolve(sheet, write.Key);
            if (p == null)
            {
                reason = Msg.MissingParameterOnSheet(write.DisplayName);
                return false;
            }
            if (p.IsReadOnly)
            {
                reason = Msg.TargetReadOnly(write.DisplayName);
                return false;
            }

            bool ok;
            switch (write.Kind)
            {
                case ParamWriteKind.Integer:
                    if (p.StorageType != StorageType.Integer)
                    {
                        reason = Msg.TargetIncompatible(write.DisplayName);
                        return false;
                    }
                    ok = p.Set((int)write.IntValue);
                    break;
                case ParamWriteKind.Number:
                    if (p.StorageType != StorageType.Double)
                    {
                        reason = Msg.TargetIncompatible(write.DisplayName);
                        return false;
                    }
                    ok = p.Set(write.NumberValue);
                    break;
                default:
                    if (p.StorageType != StorageType.String)
                    {
                        reason = Msg.TargetIncompatible(write.DisplayName);
                        return false;
                    }
                    ok = p.Set(write.Text ?? string.Empty);
                    break;
            }
            if (!ok)
                reason = Msg.TargetIncompatible(write.DisplayName);
            return ok;
        }

        /// <summary>Бичихээс ӨМНӨ: параметр байгаа, бичигдэхүйц, төрөл нь таарч байна.</summary>
        public static string CheckWritable(ViewSheet sheet, ParameterWrite write)
        {
            Parameter p = Resolve(sheet, write.Key);
            if (p == null)
                return Msg.MissingParameterOnSheet(write.DisplayName);
            if (p.IsReadOnly)
                return Msg.TargetReadOnly(write.DisplayName);
            StorageType need = write.Kind == ParamWriteKind.Integer ? StorageType.Integer
                : write.Kind == ParamWriteKind.Number ? StorageType.Double : StorageType.String;
            if (p.StorageType != need)
                return Msg.TargetIncompatible(write.DisplayName);
            return null;
        }
    }
}
