using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Нарийвчилсан дугаарлалтын НЭГ мөрийн үр дүн: хэсэг бүрийн бүтэн/тоон бичвэр + нийлмэл дугаар.</summary>
    public sealed class PartsResult
    {
        public PartsResult()
        {
            Full = new string[AdvancedNumberingSettings.PartCount];
            Number = new string[AdvancedNumberingSettings.PartCount];
            Values = new long?[AdvancedNumberingSettings.PartCount];
            Present = new bool[AdvancedNumberingSettings.PartCount];
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                Full[i] = string.Empty;
                Number[i] = string.Empty;
            }
        }

        /// <summary>Хэсэг бүрийн Угтвар + тоо + Дагавар.</summary>
        public string[] Full { get; }

        /// <summary>Хэсэг бүрийн ЗӨВХӨН тоон бичвэр (форматласан).</summary>
        public string[] Number { get; }

        /// <summary>Тоон утга (None горимд null).</summary>
        public long?[] Values { get; }

        /// <summary>Энэ хэсэг энэ горимд оршин байна (Enabled).</summary>
        public bool[] Present { get; }

        /// <summary>Хэсгүүдийг тусгаарлагчаар нийлүүлсэн дугаар (параметрийн угтвар/дагаваргүй).</summary>
        public string Composite { get; set; } = string.Empty;

        /// <summary>Хязгаар давсан (WrapAtLimit=false) мөр — АЛДАА.</summary>
        public bool LimitExceeded { get; set; }

        /// <summary>Аль хэсгийн хязгаар давсан (1-ээс).</summary>
        public int ExceededPart { get; set; }

        /// <summary>Тооцоолсон утга хэт том.</summary>
        public bool Overflow { get; set; }
    }

    /// <summary>
    /// Нарийвчилсан дугаарлалтын «гүйлтийн тоолуур» (odometer).
    ///
    /// Дүрэм (тест + баримтад тодорхойлсон, санамсаргүй БИШ):
    ///  1. Тоон утга нь Increment/Decrement горимтой, идэвхтэй хэсгүүд «өөрчлөгдөх хэсэг».
    ///  2. ХАМГИЙН СҮҮЛИЙН (баруун талын) өөрчлөгдөх хэсэг мөр бүрт нэг алхам хөдөлнө.
    ///  3. Хэсэг хязгаартаа хүрсэн (дараагийн алхам Limit-ээс давна) бөгөөд WrapAtLimit=true бол эхлэх утга руугаа
    ///     буцаж, ӨМНӨХ (зүүн талын) өөрчлөгдөх хэсэг нэг алхам хөдөлнө (A-1-1 … A-1-5, A-2-1 …).
    ///  4. WrapAtLimit=false үед хязгаар давсан МӨР болон түүнээс хойшхи бүх мөр «PartLimitExceeded» алдаатай —
    ///     утгыг чимээгүй таслахгүй, давхардуулахгүй.
    ///  5. Хамгийн зүүн өөрчлөгдөх хэсэг ч хязгаарт хүрч wrap хийвэл бүх тоолуур эхлэлдээ буцна (давтагдах
    ///     дараалал; давхардлыг давхардлын шалгалт барина).
    ///  6. Fixed / None хэсэг хэзээ ч хөдлөхгүй.
    /// </summary>
    public sealed class PartSequence
    {
        private readonly AdvancedNumberingSettings _s;
        private readonly long[] _values = new long[AdvancedNumberingSettings.PartCount];
        private readonly List<int> _advancing = new List<int>();
        private int _exceededPart; // 0 = үгүй, эс бөгөөс 1-ээс
        private bool _overflow;

        public PartSequence(AdvancedNumberingSettings settings)
        {
            _s = settings;
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                NumberPartSettings p = settings.Parts[i];
                _values[i] = p.Start;
                if (p.IsAdvancing)
                    _advancing.Add(i);
            }
        }

        /// <summary>Одоогийн төлөвийн мөрийг үүсгэнэ (төлөвийг өөрчлөхгүй).</summary>
        public PartsResult Current()
        {
            var r = new PartsResult
            {
                LimitExceeded = _exceededPart != 0,
                ExceededPart = _exceededPart,
                Overflow = _overflow,
            };

            var rendered = new List<KeyValuePair<int, string>>();
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                NumberPartSettings p = _s.Parts[i];
                r.Present[i] = p.Enabled;
                if (!p.Enabled)
                    continue;

                string num = string.Empty;
                if (p.ValueMode != PartValueMode.None)
                {
                    num = NumberFormatting.Format(_values[i], p.Width);
                    r.Values[i] = _values[i];
                }
                r.Number[i] = num;
                r.Full[i] = (p.Prefix ?? string.Empty) + num + (p.Suffix ?? string.Empty);
                if (r.Full[i].Length > 0)
                    rendered.Add(new KeyValuePair<int, string>(i, r.Full[i]));
            }

            // Нийлмэл: зөвхөн ҮЗЭГДЭЖ БУЙ (хоосон БИШ) хэсгүүдийг, өмнөх хэсгийн ХАРЬЯАЛАХ тусгаарлагчаар.
            // Хэсэг 2 идэвхгүй бол 1→3 нь Separators[0]-ыг ашиглана (давхар тусгаарлагч гарахгүй).
            var sb = new StringBuilder();
            for (int k = 0; k < rendered.Count; k++)
            {
                if (k > 0)
                {
                    int prevIndex = rendered[k - 1].Key;
                    string sep = prevIndex < _s.Separators.Length ? (_s.Separators[prevIndex] ?? string.Empty) : string.Empty;
                    sb.Append(sep);
                }
                sb.Append(rendered[k].Value);
            }
            r.Composite = sb.ToString();
            return r;
        }

        /// <summary>Дараагийн мөр рүү нэг алхам.</summary>
        public void Advance()
        {
            if (_exceededPart != 0 || _overflow || _advancing.Count == 0)
                return;
            AdvancePart(_advancing.Count - 1);
        }

        private void AdvancePart(int advIndex)
        {
            int part = _advancing[advIndex];
            NumberPartSettings p = _s.Parts[part];
            long step = p.Step < 1 ? 1 : p.Step;
            long delta = p.ValueMode == PartValueMode.Increment ? step : -step;

            long next;
            if (!NumberFormatting.TryAdd(_values[part], delta, out next))
            {
                _overflow = true;
                return;
            }

            bool beyond = false;
            if (p.Limit.HasValue)
            {
                beyond = p.ValueMode == PartValueMode.Increment ? next > p.Limit.Value : next < p.Limit.Value;
            }

            if (!beyond)
            {
                _values[part] = next;
                return;
            }

            if (!p.WrapAtLimit)
            {
                _exceededPart = part + 1;
                return;
            }

            // Wrap: эхлэх утга руу буцаад, илүү өндөр эрэмбийн өөрчлөгдөх хэсэгт «зөөвөрлөнө».
            _values[part] = p.Start;
            if (advIndex > 0)
                AdvancePart(advIndex - 1);
        }
    }
}
