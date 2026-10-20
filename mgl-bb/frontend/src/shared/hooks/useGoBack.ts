import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Энэ табын түүхэнд одоогийн хуудас хэд дэх вэ.
 *
 * React Router-ийн `BrowserRouter` нь түүхийн мөр бүрд `{usr, key, idx}` гэж
 * бичдэг бөгөөд `idx` нь аппын ЭХНИЙ хуудсанд 0.  Тиймээс `idx > 0` бол
 * `navigate(-1)` аппын дотор үлдэнэ; 0 бол браузерын «буцах» нь сайтаас
 * гаргана (шинэ таб, мэдэгдлийн холбоос, гараар бичсэн URL).
 *
 * `location.key` БИШ: эхний хуудас `replace`-ээр солигдоход (жишээ нь `/` →
 * `/app` чиглүүлэлт) key нь санамсаргүй болдог ч `idx` 0 хэвээр үлддэг.
 */
function historyIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : 0;
}

/**
 * Браузерын «буцах» товчтой ЯГ ижил: өмнөх хуудас руу (таб, шүүлтүүр,
 * гүйлгэлтийн байрлалтай нь — `useScrollRestoration` POP-ийг сэргээнэ).
 *
 * Өмнөх хуудас байхгүй үед (апп энэ хуудсаар нээгдсэн) `fallback` руу
 * `replace`-ээр очно — `push` хийвэл дахин дарахад эхний хуудас руу буцаж
 * ирээд хоёр хуудсын хооронд эргэлдэнэ.
 */
export function useGoBack(fallback = '/app') {
  const navigate = useNavigate();
  // Зам солигдох бүрд дахин render хийлгэж `canGoBack`-ийг шинэчилнэ.
  const { pathname } = useLocation();

  const hasHistory = historyIndex() > 0;
  // Буцах газар ч, түүх ч байхгүй (жишээ нь самбар шинэ табад нээгдсэн) —
  // товч юу ч хийхгүй тул харуулахгүй.
  const canGoBack = hasHistory || pathname !== fallback;

  const goBack = useCallback(() => {
    // Дарах агшинд дахин уншина — render-ээс хойш түүх өөрчлөгдсөн байж болно.
    if (historyIndex() > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);

  return { canGoBack, goBack };
}
