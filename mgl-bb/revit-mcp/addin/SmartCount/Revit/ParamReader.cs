using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.SmartCount.Core;

namespace RevitMcpAddin.SmartCount
{
    /// <summary>
    /// Revit-ийн `Parameter` → ЦЭВЭР `ParamValue`.  Тоон утгыг ҮРГЭЛЖ каноник нэгжээр гаргана
    /// (урт → мм, талбай → м², эзлэхүүн → м³, өнцөг → °) — Revit-ийн дотоод ФУТ утгыг цаашаа
    /// ДАМЖУУЛАХГҮЙ.  Хэрэглэгчийн «3000 мм»-ийг дотоод double-тэй шууд харьцуулах алдааг бүтцээр хаана.
    ///
    /// Нэгжийн гэр бүлийг `ForgeTypeId` spec-ийн ХҮЧИНТЭЙ НЭГЖҮҮДЭЭР (`UnitUtils.GetValidUnits`) тодорхойлно:
    /// специйн нэрийг бичихгүйгээр «мм-тэй нэгдэх бүх spec = урт» (хоолойн диаметр, арматурын урт зэрэг
    /// мөн орно).  Бусад хэмжигдэхүүн (даралт, урсгал...) → `other`: ТӨСЛИЙН нэгжээр, нэгж хөрвүүлэлтгүй.
    ///
    /// ⚠️ Revit API-д хүрнэ — үндсэн thread, хүчинтэй контекст.
    /// </summary>
    internal sealed class ParamReader
    {
        private sealed class SpecInfo
        {
            public string Family;
            /// <summary>Каноник нэгж (урт → мм...); `other` бол төслийн харагдах нэгж; null = нэгж-гүй.</summary>
            public ForgeTypeId Unit;
        }

        private readonly Document _doc;
        private readonly Autodesk.Revit.DB.Units _units;
        private readonly Dictionary<string, SpecInfo> _specs = new Dictionary<string, SpecInfo>(StringComparer.Ordinal);

        internal ParamReader(Document doc)
        {
            _doc = doc;
            Autodesk.Revit.DB.Units u = null;
            try { u = doc.GetUnits(); } catch (Exception) { }
            _units = u;
        }

        internal ParamValue Read(Parameter p)
        {
            if (p == null) return ParamValue.Missing;
            try
            {
                if (!p.HasValue) return new ParamValue { Exists = true, HasValue = false };

                switch (p.StorageType)
                {
                    case StorageType.String:
                        return ParamValue.OfText(p.AsString());

                    case StorageType.Integer:
                    {
                        string display = SafeValueString(p);
                        int v = p.AsInteger();
                        return ParamValue.OfNumber(v, "count", string.IsNullOrEmpty(display) ? v.ToString(CultureInfo.InvariantCulture) : display);
                    }

                    case StorageType.Double:
                    {
                        double raw = p.AsDouble();
                        string display = SafeValueString(p);
                        SpecInfo info = SpecOf(p);
                        if (info.Unit != null)
                            return ParamValue.OfNumber(UnitUtils.ConvertFromInternalUnits(raw, info.Unit), info.Family, display);
                        return ParamValue.OfNumber(raw, info.Family, display);
                    }

                    case StorageType.ElementId:
                    {
                        string name = SafeValueString(p);
                        if (string.IsNullOrEmpty(name))
                        {
                            Element e = _doc.GetElement(p.AsElementId());
                            name = e != null ? e.Name : null;
                        }
                        return ParamValue.OfText(name);
                    }

                    default:
                        return new ParamValue { Exists = true, HasValue = false };
                }
            }
            catch (Exception)
            {
                // Нэг параметрийн уншилтын алдаа бүтэн тоололтыг унагаахгүй — «байхгүй» гэж үзнэ.
                return ParamValue.Missing;
            }
        }

        private static string SafeValueString(Parameter p)
        {
            try { return p.AsValueString(); }
            catch (Exception) { return null; }
        }

        private SpecInfo SpecOf(Parameter p)
        {
            ForgeTypeId spec = null;
            try { spec = p.Definition.GetDataType(); } catch (Exception) { }
            string key = spec != null ? spec.TypeId : "";
            SpecInfo info;
            if (_specs.TryGetValue(key, out info)) return info;

            info = new SpecInfo { Family = "count", Unit = null };
            try
            {
                if (spec != null && UnitUtils.IsMeasurableSpec(spec))
                {
                    ICollection<ForgeTypeId> valid = UnitUtils.GetValidUnits(spec);
                    if (valid.Contains(UnitTypeId.Millimeters)) info = new SpecInfo { Family = "length", Unit = UnitTypeId.Millimeters };
                    else if (valid.Contains(UnitTypeId.SquareMeters)) info = new SpecInfo { Family = "area", Unit = UnitTypeId.SquareMeters };
                    else if (valid.Contains(UnitTypeId.CubicMeters)) info = new SpecInfo { Family = "volume", Unit = UnitTypeId.CubicMeters };
                    else if (valid.Contains(UnitTypeId.Degrees)) info = new SpecInfo { Family = "angle", Unit = UnitTypeId.Degrees };
                    else
                    {
                        ForgeTypeId display = null;
                        try { if (_units != null) display = _units.GetFormatOptions(spec).GetUnitTypeId(); } catch (Exception) { }
                        info = new SpecInfo { Family = "other", Unit = display };
                    }
                }
            }
            catch (Exception) { /* spec-ийг тодорхойлж чадсангүй → нэгж-гүй тоо */ }

            _specs[key] = info;
            return info;
        }
    }
}
