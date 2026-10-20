/**
 * Хүрэлтийн удирдлагын мөр — зөвхөн дэлгэцэд хүрэхэд гарч ирнэ.
 *
 * Байнга харагдахгүй байх нь зориуд: самбар бол мэдээллийн гадаргуу, апп биш.
 * Товчнууд байнга сууж байвал зурагт «хэн нэгний нээлттэй орхисон программ»
 * шиг харагдана.
 *
 * ГАРАХ ТОВЧ ХОЁР АЛХАМТАЙ.  Самбар лоббид байх тул зочин санамсаргүй дараад
 * оффисын дотоод самбар руу орох ёсгүй.  Эхний хүрэлт нь баталгаажуулалт
 * асууна, 6 секундын дараа өөрөө буцна.
 *
 * ХЭМЖЭЭ: товч бүр хамгийн багадаа 7vh өндөр.  55-65 инчийн дэлгэц дээр
 * хуруу нь хулганы заагчаас хамаагүй том — жижиг товч онохгүй.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, LockOpen, Maximize2, Minimize2, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { TV, TV_SIZE, metaStyle } from './theme';

export function TvControls({
  scenes,
  sceneIndex,
  locked,
  onPrev,
  onNext,
  onJump,
  onToggleLock,
  onExit,
  onInteract,
}: {
  scenes: Array<{ id: string; title: string }>;
  sceneIndex: number;
  locked: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJump: (index: number) => void;
  onToggleLock: () => void;
  onExit: () => void;
  /** Товч дарагдах бүрт дуудагдана — нуух хугацааг тэглэнэ. */
  onInteract: () => void;
}) {
  const { t } = useLanguage();
  const [confirmExit, setConfirmExit] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

  // Баталгаажуулалт өөрөө буцна — хэн нэгэн дундаа орхиод явахад «Тийм»
  // товч дэлгэц дээр үлдэх ёсгүй.
  useEffect(() => {
    if (!confirmExit) return;
    const id = setTimeout(() => setConfirmExit(false), 6_000);
    return () => clearTimeout(id);
  }, [confirmExit]);

  // Бүтэн дэлгэцээс F11 эсвэл Esc-ээр гарч болно — товчны төлөв үүнийг дагана.
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    onInteract();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <div
      data-tv-control
      className="mb-[1.6vh] flex items-stretch"
      style={{
        border: `1px solid ${TV.line}`,
        background: 'rgba(6, 11, 20, 0.86)',
        backdropFilter: 'blur(6px)',
        animation: 'tvControlsIn 260ms ease-out both',
      }}
    >
      <Btn label={t('companyTvPage.ctrlPrev')} onPress={() => { onInteract(); onPrev(); }}>
        <ChevronLeft style={{ width: '2.1vw', height: '2.1vw' }} />
      </Btn>

      {/* Кадрын дугаарууд — шууд үсрэх.  Гарчгийг биш дугаарыг харуулсан нь
          10 нэр нэг мөрөнд багтахгүй, мөн дугаар нь зургийн хуудасны
          дугаарлалттай (үндсэн бичээс дэх 03/10) таарна. */}
      <div className="flex flex-1 items-stretch overflow-hidden">
        {scenes.map((s, i) => {
          const active = i === sceneIndex;
          return (
            <button
              key={s.id}
              type="button"
              data-tv-control
              onClick={() => { onInteract(); onJump(i); }}
              title={s.title}
              className="flex flex-1 items-center justify-center"
              style={{
                ...metaStyle,
                minHeight: '7vh',
                borderLeft: `1px solid ${TV.line}`,
                color: active ? TV.bg : TV.ink3,
                background: active ? TV.accent : 'transparent',
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </button>
          );
        })}
      </div>

      <Btn label={t('companyTvPage.ctrlNext')} onPress={() => { onInteract(); onNext(); }}>
        <ChevronRight style={{ width: '2.1vw', height: '2.1vw' }} />
      </Btn>

      {/* Түгжээ — нэг кадрыг барих.  Захиалагчид төслийн явцыг үзүүлж байхад
          20 секундын дараа дэлгэц солигдох нь саад. */}
      <Btn
        label={locked ? t('companyTvPage.ctrlUnlock') : t('companyTvPage.ctrlLock')}
        onPress={() => { onInteract(); onToggleLock(); }}
        tone={locked ? TV.gold : undefined}
      >
        {locked ? (
          <Lock style={{ width: '1.9vw', height: '1.9vw' }} />
        ) : (
          <LockOpen style={{ width: '1.9vw', height: '1.9vw' }} />
        )}
      </Btn>

      <Btn
        label={t('companyTvPage.ctrlFullscreen')}
        onPress={toggleFullscreen}
      >
        {isFullscreen ? (
          <Minimize2 style={{ width: '1.9vw', height: '1.9vw' }} />
        ) : (
          <Maximize2 style={{ width: '1.9vw', height: '1.9vw' }} />
        )}
      </Btn>

      {/* Гарах — хоёр алхамт. */}
      {confirmExit ? (
        <>
          <div
            className="flex items-center px-[1.4vw]"
            style={{ ...metaStyle, color: TV.gold, borderLeft: `1px solid ${TV.line}` }}
          >
            {t('companyTvPage.ctrlExitConfirm')}
          </div>
          <Btn label={t('companyTvPage.ctrlYes')} onPress={onExit} tone={TV.down} />
          <Btn
            label={t('companyTvPage.ctrlNo')}
            onPress={() => { onInteract(); setConfirmExit(false); }}
          />
        </>
      ) : (
        <Btn
          label={t('companyTvPage.ctrlExit')}
          onPress={() => { onInteract(); setConfirmExit(true); }}
        >
          <X style={{ width: '1.9vw', height: '1.9vw' }} />
        </Btn>
      )}
    </div>
  );
}

/** Удирдлагын нэг нүд.  Дүрс + шошго, эсвэл зөвхөн шошго. */
function Btn({
  label,
  onPress,
  tone,
  children,
}: {
  label: string;
  onPress: () => void;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tv-control
      onClick={onPress}
      className="flex flex-col items-center justify-center gap-[0.5vh] px-[1.6vw]"
      style={{
        minHeight: '7vh',
        minWidth: '7vw',
        borderLeft: `1px solid ${TV.line}`,
        color: tone ?? TV.ink2,
        cursor: 'pointer',
      }}
    >
      {children}
      <span style={{ ...metaStyle, fontSize: '0.72vw', color: 'inherit' }}>{label}</span>
    </button>
  );
}

/**
 * Эхний ачаалалтад 6 секунд гарч, дараа нь дахин харагдахгүй сануулга.
 * Хүрэлтийн дэлгэц гэдгийг мэдэхгүй хүн байнга байх тул нэг л удаа хэлнэ;
 * байнгын сануулга байвал самбарын цэвэр гадаргууг эвдэнэ.
 */
export function TouchHint({ text }: { text: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShow(false), 6_000);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center"
      style={{ bottom: '15vh', animation: 'tvFadeIn 500ms ease-out both' }}
      aria-hidden
    >
      <span
        style={{
          ...metaStyle,
          fontSize: TV_SIZE.meta,
          color: TV.ink3,
          padding: '0.9vh 1.6vw',
          border: `1px solid ${TV.line}`,
        }}
      >
        {text}
      </span>
    </div>
  );
}
