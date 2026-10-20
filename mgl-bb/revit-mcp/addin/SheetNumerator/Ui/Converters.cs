using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// «Талбар → алдаа» толь бичгээс тухайн талбарын хүрээний өнгө (алдаатай бол улаан).
    /// ConverterParameter = талбарын түлхүүр («simple.start»).
    /// </summary>
    public sealed class FieldErrorBrushConverter : IValueConverter
    {
        // Алдааны хүрээ: сэдвийг дагадаг live «Danger» brush (`Ui/MglBrushes`); энгийн хүрээ тогтмол саарал (хоёр сэдэвт харагдана).
        private static Brush Red { get { return RevitMcpAddin.Ui.MglBrushes.Danger; } }
        private static readonly Brush Normal = Freeze(new SolidColorBrush(Color.FromRgb(0xAB, 0xAD, 0xB3)));

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var errors = value as IReadOnlyDictionary<string, string>;
            string key = parameter as string;
            return errors != null && key != null && errors.ContainsKey(key) ? Red : Normal;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }

        internal static Brush Freeze(SolidColorBrush b)
        {
            b.Freeze();
            return b;
        }
    }

    /// <summary>Талбарын алдааны мессеж (tooltip).  Алдаагүй бол null → tooltip харагдахгүй.</summary>
    public sealed class FieldErrorTextConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var errors = value as IReadOnlyDictionary<string, string>;
            string key = parameter as string;
            string msg;
            if (errors != null && key != null && errors.TryGetValue(key, out msg))
                return msg;
            return null;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }
    }

    /// <summary>Хэсгийн (Part) талбарын алдаа: values = [FieldErrors, Index]; ConverterParameter = «start» г.м.</summary>
    public sealed class PartFieldErrorBrushConverter : IMultiValueConverter
    {
        private static Brush Red { get { return RevitMcpAddin.Ui.MglBrushes.Danger; } }
        private static readonly Brush Normal = FieldErrorBrushConverter.Freeze(new SolidColorBrush(Color.FromRgb(0xAB, 0xAD, 0xB3)));

        public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
        {
            string key = KeyOf(values, parameter);
            var errors = values != null && values.Length > 0 ? values[0] as IReadOnlyDictionary<string, string> : null;
            return errors != null && key != null && errors.ContainsKey(key) ? Red : Normal;
        }

        public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }

        internal static string KeyOf(object[] values, object parameter)
        {
            if (values == null || values.Length < 2 || !(values[1] is int) || !(parameter is string))
                return null;
            return "part" + ((int)values[1] + 1) + "." + (string)parameter;
        }
    }

    public sealed class PartFieldErrorTextConverter : IMultiValueConverter
    {
        public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
        {
            string key = PartFieldErrorBrushConverter.KeyOf(values, parameter);
            var errors = values != null && values.Length > 0 ? values[0] as IReadOnlyDictionary<string, string> : null;
            string msg;
            if (errors != null && key != null && errors.TryGetValue(key, out msg))
                return msg;
            return null;
        }

        public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }
    }

    /// <summary>true → Collapsed, false → Visible (BooleanToVisibilityConverter-ийн урвуу).</summary>
    public sealed class InverseBoolToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            return value is bool && (bool)value ? Visibility.Collapsed : Visibility.Visible;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }
    }

    public sealed class NotConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            return value is bool ? !(bool)value : value;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            return value is bool ? !(bool)value : value;
        }
    }

    /// <summary>Хоосон бичвэр → Collapsed.</summary>
    public sealed class EmptyToCollapsedConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            string s = value as string;
            return string.IsNullOrEmpty(s) ? Visibility.Collapsed : Visibility.Visible;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }
    }
}
