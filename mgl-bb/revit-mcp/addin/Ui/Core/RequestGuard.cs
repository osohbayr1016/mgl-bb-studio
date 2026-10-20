namespace RevitMcpAddin.Ui.Core
{
    /// <summary>
    /// Async хүсэлтийн «хоцорсон хариу»-аас хамгаалах ЦЭВЭР төлөв (UI thread дээр л ашиглана — түгжээгүй).
    ///
    ///  • `Begin()` — шинэ хүсэлт хуучин бүгдийг ХҮЧИНГҮЙ болгоно (хамгийн сүүлийнх л хариу авна);
    ///  • `InvalidateInFlight()` — оролт (серверийн хаяг) солигдсон: яг одоо явж буй хүсэлтийн хариу хаягдана;
    ///  • `Close()` — цонх хаагдсан: хоцорсон хариу ЮУГ Ч бичихгүй;
    ///  • `ShouldClearCredential()` — хуучин токентой хүсэлтийн хоцорсон 401 нь ШИНЭ нэвтрэлтийг устгаж болохгүй.
    /// `SettingsDialog` үүнийг хэрэглэнэ; нэг хэсэг нь Revit-гүй тул macOS дээр тестлэгдэнэ.
    /// </summary>
    public sealed class RequestGuard
    {
        private int _requestId;
        private int _epoch;
        private bool _closed;

        public int Epoch { get { return _epoch; } }
        public bool IsClosed { get { return _closed; } }

        public int Begin()
        {
            return ++_requestId;
        }

        public void InvalidateInFlight()
        {
            _epoch++;
        }

        public void Close()
        {
            _closed = true;
        }

        /// <summary>Хариу ОДОО ч хүчинтэй юу: цонх хаагдаагүй, хамгийн сүүлийн хүсэлт, оролт солигдоогүй.</summary>
        public bool Accept(int requestId, int epoch)
        {
            return !_closed && requestId == _requestId && epoch == _epoch;
        }

        /// <summary>401 хүлээн авсан хүсэлт ЯГ ОДООГИЙН нэвтрэлтээр явсан бол л нэвтрэлтийг арилгана.</summary>
        public static bool ShouldClearCredential(string tokenUsedByRequest, string currentToken)
        {
            return !string.IsNullOrEmpty(tokenUsedByRequest) && string.Equals(tokenUsedByRequest, currentToken, System.StringComparison.Ordinal);
        }
    }
}
