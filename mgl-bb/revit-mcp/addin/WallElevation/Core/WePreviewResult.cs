using System;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Цонхны доод талын урьдчилсан зураг (2026-10-14): Revit-ээр түр үүсгэж буцаасан дэлгээсийн PNG.</summary>
    public sealed class WePreviewResult
    {
        /// <summary>PNG файл (түр хавтаст); алдаа бол null.</summary>
        public string Path;
        public string Error;
        /// <summary>Нийт хугацаа (мс) — tooltip-д.</summary>
        public long Ms;
    }

    /// <summary>
    /// Урьдчилсан зургийг АЛХАМ АЛХМААР бэлтгэх ажил (2026-10-14, интерьерийн баг: «preview бэлдэх нь арын дэвсгэрт, цонх огт гацахгүй»).
    /// Revit API нэг thread-тэй тул жинхэнэ арын thread боломжгүй — оронд нь ажил богино алхмуудад хуваагдаж, цонх алхам бүрийн ХООРОНД
    /// хэрэглэгчийн оролтыг (чагт, бичвэр, гүйлгэлт) боловсруулна.  <see cref="IDisposable.Dispose"/> = цуцлах: түр өөрчлөлтийг БУЦААНА.
    /// </summary>
    public interface IWePreviewJob : IDisposable
    {
        bool Done { get; }
        /// <summary>Одоогийн алхам («205A — харагдац үүсгэж байна») — цонхонд.</summary>
        string Status { get; }
        /// <summary>0..1.</summary>
        double Fraction { get; }
        /// <summary><see cref="Done"/> болсны дараа — зураг эсвэл алдаа.</summary>
        WePreviewResult Result { get; }
        /// <summary>НЭГ богино алхам.  Хэзээ ч шидэхгүй (алдаа нь <see cref="Result"/>-д).</summary>
        void Step();
    }
}
