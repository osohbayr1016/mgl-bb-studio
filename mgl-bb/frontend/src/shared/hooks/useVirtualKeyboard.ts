import { useEffect, useState } from 'react';

/**
 * Дэлгэцэн дээрх гар нээлттэй байхыг илрүүлнэ.
 *
 * `visualViewport.height` нь гар гарахад багасдаг ч `window.innerHeight`
 * хэвээр үлддэг — тэдгээрийн зөрүү нь гарын өндөр.  150px босго нь
 * хаягийн мөр нуугдах зэрэг жижиг өөрчлөлтийг гар гэж андуурахгүй байх
 * хэмжээ (хамгийн намхан гар ч ~250px).
 *
 * Хэрэглээ: гар гарахад доод таб мөрийг нуух.  Жинхэнэ утасны аппууд
 * бүгд ингэдэг — эс тэгвэл таб мөр гарын дээр хөвж, бичиж буй талбарыг
 * дарж, хуудас «дээшээ үсэрсэн» мэт мэдрэгддэг.
 */
const KEYBOARD_THRESHOLD_PX = 150;

function isKeyboardOpen(): boolean {
  if (typeof window === 'undefined') return false;
  const vv = window.visualViewport;
  if (!vv) return false;
  return window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX;
}

export function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(isKeyboardOpen);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setOpen(isKeyboardOpen());
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return open;
}
