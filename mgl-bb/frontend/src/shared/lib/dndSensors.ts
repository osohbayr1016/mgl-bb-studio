import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Аппын нэгдсэн drag-and-drop сенсорууд.
 *
 * Урьд нь бүх `DndContext` зөвхөн `PointerSensor {distance: 4}`-ыг бүртгэдэг
 * байсан.  Мэдрэгчтэй дэлгэц дээр `pointermove` нь хуруу хөдлөх бүрд хөөрдөг
 * тул **4px хөдөлмөгц чирэлт эхэлдэг** — өөрөөр хэлбэл жагсаалтыг доош
 * гүйлгэх гэсэн оролдлого бүр элемент чирсэн болж хувирдаг.  Хамгийн
 * ноцтой нь ProjectsPage: төслийн БҮХ жагсаалт нэг `DndContext`-д ороосон
 * тул утсаар төсөл харах боломжгүй болсон.
 *
 * `TouchSensor`-ыг dnd-kit нь мэдрэгчтэй оролтын хувьд `PointerSensor`-оос
 * ӨМНӨ шалгадаг.  `delay: 250` нь платформын стандарт дохиог сэргээнэ:
 *   • удаан дарах (250мс)        → чирэлт
 *   • шудрах (250мс дотор >8px)  → энгийн гүйлгэлт, чирэлт цуцлагдана
 *
 * `KeyboardSensor` нь гараар эрэмбэлэх боломжийг өгнө (өмнө нь зөвхөн нэг
 * дуудлагад байсан).
 */
export function useAppDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
