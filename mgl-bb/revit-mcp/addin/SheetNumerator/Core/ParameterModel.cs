using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.SheetNumerator.Core
{
    public enum ParameterKind
    {
        /// <summary>Revit-ийн built-in параметр (BuiltInParameter тоо).  Нэр локалчлагддаг тул НЭРЭЭР таних БУС.</summary>
        BuiltIn = 0,

        /// <summary>Shared параметр (GUID).</summary>
        Shared = 1,

        /// <summary>Төслийн (shared БИШ) параметр — тогтвортой танигч байхгүй тул нэрээр.</summary>
        Project = 2,
    }

    /// <summary>
    /// Параметрийн ТОГТВОРТОЙ танигч.
    ///
    /// ⚠️ `ElementId`-г урт хугацааны танигч болгон хадгалахгүй (өөр төсөл дээр өөр утгатай).  Built-in:
    /// `bip:-1007404`, shared: `guid:…`, төслийн: `prj:Нэр`.  Харагдах нэр нь локалчлагддаг, мөн
    /// «Sheet Number» зэрэг нэр ХОЁР built-in параметрт давтагддаг тул таних түлхүүр биш.
    /// </summary>
    public sealed class ParameterKey : IEquatable<ParameterKey>
    {
        private ParameterKey(ParameterKind kind, int builtInId, Guid guid, string name)
        {
            Kind = kind;
            BuiltInId = builtInId;
            SharedGuid = guid;
            Name = name ?? string.Empty;
            switch (kind)
            {
                case ParameterKind.BuiltIn:
                    Stable = "bip:" + builtInId.ToString(CultureInfo.InvariantCulture);
                    break;
                case ParameterKind.Shared:
                    Stable = "guid:" + guid.ToString("D");
                    break;
                default:
                    Stable = "prj:" + Name;
                    break;
            }
        }

        public ParameterKind Kind { get; }
        public int BuiltInId { get; }
        public Guid SharedGuid { get; }

        /// <summary>Зөвхөн <see cref="ParameterKind.Project"/>-д утгатай (нөгөөд нь бодит нэр, оношилгоонд).</summary>
        public string Name { get; }

        /// <summary>Хадгалах/харьцуулах стринг.</summary>
        public string Stable { get; }

        public static ParameterKey BuiltIn(int builtInId)
        {
            return new ParameterKey(ParameterKind.BuiltIn, builtInId, Guid.Empty, null);
        }

        public static ParameterKey Shared(Guid guid, string displayName = null)
        {
            return new ParameterKey(ParameterKind.Shared, 0, guid, displayName);
        }

        public static ParameterKey Project(string name)
        {
            return new ParameterKey(ParameterKind.Project, 0, Guid.Empty, name);
        }

        public static bool TryParse(string stable, out ParameterKey key)
        {
            key = null;
            if (string.IsNullOrEmpty(stable))
                return false;
            if (stable.StartsWith("bip:", StringComparison.Ordinal))
            {
                int id;
                if (int.TryParse(stable.Substring(4), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out id))
                {
                    key = BuiltIn(id);
                    return true;
                }
                return false;
            }
            if (stable.StartsWith("guid:", StringComparison.Ordinal))
            {
                Guid g;
                if (Guid.TryParse(stable.Substring(5), out g))
                {
                    key = Shared(g);
                    return true;
                }
                return false;
            }
            if (stable.StartsWith("prj:", StringComparison.Ordinal) && stable.Length > 4)
            {
                key = Project(stable.Substring(4));
                return true;
            }
            return false;
        }

        public bool Equals(ParameterKey other)
        {
            return other != null && string.Equals(Stable, other.Stable, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return Equals(obj as ParameterKey);
        }

        public override int GetHashCode()
        {
            return StringComparer.Ordinal.GetHashCode(Stable);
        }

        public override string ToString()
        {
            return Stable;
        }
    }

    /// <summary>Параметрийн утгын ангилал (Revit-ийн StorageType + Spec-ээс гаргасан, манай дүрэмд хэрэгтэй хэлбэр).</summary>
    public enum ParamValueKind
    {
        /// <summary>Текст (String).</summary>
        Text = 0,

        /// <summary>Бүхэл тоо (Integer, Yes/No БИШ).</summary>
        Integer = 1,

        /// <summary>Нэгжгүй тоо (Double + Number spec).</summary>
        Number = 2,

        /// <summary>Yes/No (Integer storage + Boolean spec).</summary>
        YesNo = 3,

        /// <summary>Хэмжигдэхүйц (урт, талбай, өнцөг …) — нэгжтэй, дугаар бичих БОЛОХГҮЙ.</summary>
        Dimensional = 4,

        /// <summary>ElementId (материал, цуглуулга, гарчгийн хүснэгт …).</summary>
        ElementReference = 5,

        Other = 6,
    }

    /// <summary>Параметрийн каталогийн нэг мөр (бүх хуудсын instance параметрээс).</summary>
    public sealed class SheetParameterInfo
    {
        public ParameterKey Key { get; set; }
        public string DisplayName { get; set; }
        public ParamValueKind ValueKind { get; set; }
        public bool IsReadOnly { get; set; }

        /// <summary>Хэдэн хуудсанд байна.</summary>
        public int PresentOnSheets { get; set; }

        /// <summary>Нэр давхцдаг (жишээ «Sheet Number» ×2) үед ялгах шошго.</summary>
        public string Label { get; set; }

        public bool IsWritable => !IsReadOnly && (ValueKind == ParamValueKind.Text
            || ValueKind == ParamValueKind.Integer || ValueKind == ParamValueKind.Number);

        public override string ToString()
        {
            return (Label ?? DisplayName) + " [" + Key + "]";
        }
    }

    /// <summary>Нэг хуудасны нэг параметрийн УНШСАН утга (текстээр).</summary>
    public sealed class SheetParameterValue
    {
        public SheetParameterValue(bool hasValue, string text)
        {
            HasValue = hasValue;
            Text = text ?? string.Empty;
        }

        /// <summary>false = утга тохируулаагүй (null/unset).  Параметр БАЙХГҮЙ нь тусдаа: толь бичигт түлхүүр алга.</summary>
        public bool HasValue { get; }

        public string Text { get; }
    }

    public enum ParamWriteKind
    {
        Text = 0,
        Integer = 1,
        Number = 2,
    }

    /// <summary>Apply-д дамжих нэг параметр бичих даалгавар.</summary>
    public sealed class ParameterWrite
    {
        public ParameterKey Key { get; set; }
        public string DisplayName { get; set; }
        public ParamWriteKind Kind { get; set; }
        public string Text { get; set; }
        public long IntValue { get; set; }
        public double NumberValue { get; set; }

        public string Describe()
        {
            switch (Kind)
            {
                case ParamWriteKind.Integer:
                    return IntValue.ToString(CultureInfo.InvariantCulture);
                case ParamWriteKind.Number:
                    return NumberValue.ToString("R", CultureInfo.InvariantCulture);
                default:
                    return Text ?? string.Empty;
            }
        }
    }

    public static class ParameterRules
    {
        /// <summary>
        /// Текстийг зорилтот параметрийн төрөлд хөрвүүлнэ.  false бол <paramref name="error"/>-т ШАЛТГААН.
        ///
        /// ⚠️ Хэмжигдэхүйц (урт, талбай, өнцөг), Yes/No, ElementId зорилт ХЭЗЭЭ Ч хүлээн авахгүй — нэгжгүй
        /// дарааллын тоог урт гэж чимээгүй бичих нь модельд ГАЖУУДАЛ оруулна.
        /// </summary>
        public static bool TryConvert(SheetParameterInfo target, string text, out ParameterWrite write, out string error)
        {
            write = null;
            error = null;
            if (target == null)
            {
                error = Msg.ParameterNotSelected;
                return false;
            }
            if (target.IsReadOnly)
            {
                error = Msg.TargetReadOnly(target.DisplayName);
                return false;
            }

            switch (target.ValueKind)
            {
                case ParamValueKind.Text:
                    write = new ParameterWrite
                    {
                        Key = target.Key, DisplayName = target.DisplayName, Kind = ParamWriteKind.Text, Text = text ?? string.Empty,
                    };
                    return true;

                case ParamValueKind.Integer:
                {
                    long v;
                    if (!TryParseInteger(text, out v) || v < int.MinValue || v > int.MaxValue)
                    {
                        error = Msg.InvalidInteger(target.DisplayName, text);
                        return false;
                    }
                    write = new ParameterWrite
                    {
                        Key = target.Key, DisplayName = target.DisplayName, Kind = ParamWriteKind.Integer, IntValue = v,
                    };
                    return true;
                }

                case ParamValueKind.Number:
                {
                    double d;
                    if (!double.TryParse((text ?? string.Empty).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)
                        || double.IsNaN(d) || double.IsInfinity(d))
                    {
                        error = Msg.InvalidNumber(target.DisplayName, text);
                        return false;
                    }
                    write = new ParameterWrite
                    {
                        Key = target.Key, DisplayName = target.DisplayName, Kind = ParamWriteKind.Number, NumberValue = d,
                    };
                    return true;
                }

                default:
                    error = Msg.TargetIncompatible(target.DisplayName);
                    return false;
            }
        }

        /// <summary>
        /// Бичих утга хуудасны ОДООГИЙН утгатай ижил бол true — тэр үед бичихгүй: урьдчилсан харалт, «Хэрэгжүүлэх»
        /// нь бодит өөрчлөлтийг л тоолно (хэрэгжүүлсний дараа дахин «Өөрчлөгдөх N хуудас» гэж харуулахгүй, давтан
        /// Apply нь ижил утгыг дахин бичиж Undo-ийн илүү алхам нэмэхгүй).
        ///
        /// ⚠️ Нэгжгүй тоо (<see cref="ParamWriteKind.Number"/>)-ыг ТАНИХГҮЙ: snapshot-ийн текст нь Revit-ийн харуулах
        /// (дугуйруулсан, локалчлагдсан) хэлбэр тул «ижил» гэж таамаглах нь бодит утгыг үлдээж болно — үргэлж бичнэ.
        /// </summary>
        public static bool IsUnchanged(ParameterWrite write, string currentText, bool hasValue)
        {
            if (write == null)
                return false;
            switch (write.Kind)
            {
                case ParamWriteKind.Text:
                {
                    string want = write.Text ?? string.Empty;
                    return hasValue
                        ? string.Equals(currentText ?? string.Empty, want, StringComparison.Ordinal)
                        : want.Length == 0;
                }
                case ParamWriteKind.Integer:
                {
                    long current;
                    return hasValue && TryParseInteger(currentText, out current) && current == write.IntValue;
                }
                default:
                    return false;
            }
        }

        public static bool TryParseInteger(string text, out long value)
        {
            value = 0;
            if (string.IsNullOrWhiteSpace(text))
                return false;
            string t = text.Trim();
            int start = 0;
            if (t[0] == '+' || t[0] == '-')
                start = 1;
            if (t.Length == start)
                return false;
            for (int i = start; i < t.Length; i++)
            {
                if (t[i] < '0' || t[i] > '9')
                    return false;
            }
            return long.TryParse(t, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value);
        }
    }
}
