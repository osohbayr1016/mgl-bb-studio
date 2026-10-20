import type { ReactNode } from 'react';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { useLanguage } from '@/shared/i18n';
import { DocBand, DocBlock, DocInput, DocLabel } from './AsrDocKit';

/**
 * Word загварын «Хяналт хийсэн» хүснэгт: 2 мөр × (Овог нэр | Огноо | Гарын үсэг)
 * — 2026-09-25-аас БАРИМТЫН хэлбэрээр (хар хүрээ, хар-хөх үүргийн нүд).
 *
 * ⚠️ 2026-09-23-аас (эзний хүсэлт): тайлан ҮҮСГЭЖ БУЙ хүний профайлын
 * гарын үсэг (`users.signature_url`) АВТОМАТААР эхний мөрөнд тавигдаж,
 * товчоор («Гарын үсэг ашиглах») хоёр мөрөнд ч сонгогдоно — өмнө нь
 * тайлан бүрт дахин зурах шаардлагатай байсан.  Гараар зурах/файл
 * оруулах зам ХЭВЭЭР (профайлдаа гарын үсэггүй хүн, эсвэл талбайн
 * инженерийн өөр гарын үсэг).  `SignatureCapture` нь canvas дээр зурж,
 * PNG болгож R2 руу байршуулаад `/media/<key>` буцаадаг.
 */
export interface AsrSignatureSlotValue {
  name: string;
  url: string | null;
  date: string;
}

function CellTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-1.5 text-label text-muted-foreground">{children}</div>;
}

function Row({
  role,
  value,
  onChange,
  readOnly,
  savedUrl,
  nameSlot,
  nameTitle,
}: {
  role: string;
  value: AsrSignatureSlotValue;
  onChange: (next: AsrSignatureSlotValue) => void;
  readOnly?: boolean;
  savedUrl?: string | null;
  /** Нэрийн нүдийг бүтнээр нь солих (оффис уулзалтын «Манай тал» сонголт). */
  nameSlot?: ReactNode;
  nameTitle?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 gap-px border-t-2 border-foreground/80 bg-foreground/35 first:border-t-0 sm:grid-cols-[26fr_40fr_34fr]">
      <DocLabel mn={role} className="sm:row-span-2" />
      <div className="min-w-0 bg-card">
        <CellTitle>{nameTitle ?? t('asr.sigName')}</CellTitle>
        {nameSlot ?? (
          <DocInput
            value={value.name}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        )}
      </div>
      <div className="min-w-0 bg-card">
        <CellTitle>{t('asr.sigDate')}</CellTitle>
        <DocInput
          type="date"
          value={value.date}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
      </div>
      <div className="min-w-0 bg-card p-2 sm:col-span-2">
        <SignatureCapture
          value={value.url}
          disabled={readOnly}
          savedUrl={savedUrl ?? null}
          onChange={(url) => onChange({ ...value, url })}
        />
      </div>
    </div>
  );
}

export function AsrSignatureBlock({
  arch,
  site,
  onArchChange,
  onSiteChange,
  readOnly,
  savedUrl,
  siteRole,
  archRole,
  archNameSlot,
  archNameTitle,
  band,
}: {
  arch: AsrSignatureSlotValue;
  site: AsrSignatureSlotValue;
  onArchChange: (v: AsrSignatureSlotValue) => void;
  onSiteChange: (v: AsrSignatureSlotValue) => void;
  readOnly?: boolean;
  /** Нэвтэрсэн хэрэглэгчийн профайлын гарын үсэг (`users.signature_url`). */
  savedUrl?: string | null;
  /**
   * Хоёр дахь мөрийн шошго — өгөөгүй бол «Талбайн инженер».  Оффис уулзалтад
   * «Захиалагч тал» (0367); өгөгдөл нь ижил `sig_site_*` баганууд.
   */
  siteRole?: string;
  /**
   * Эхний мөрийн шошго — өгөөгүй бол «Архитектор, Инженер».  Оффис уулзалтад
   * «Манай тал» (эзэн 2026-10-08) бөгөөд нэрийн нүд нь оролцогчдоос сонгогч
   * (`archNameSlot`); өгөгдөл нь ижил `sig_arch_*` баганууд.
   */
  archRole?: string;
  archNameSlot?: ReactNode;
  archNameTitle?: string;
  /** Туузын гарчиг — өгөөгүй бол «Хяналт хийсэн». */
  band?: string;
}) {
  const { t } = useLanguage();
  return (
    <DocBlock id="asr-sec-sign">
      <DocBand mn={band ?? t('asr.signatures')} en="Signatures" />
      <div>
        <Row
          role={archRole ?? t('asr.sigArchitect')}
          nameSlot={archNameSlot}
          nameTitle={archNameTitle}
          value={arch}
          onChange={onArchChange}
          readOnly={readOnly}
          savedUrl={savedUrl}
        />
        <Row
          role={siteRole ?? t('asr.sigSite')}
          value={site}
          onChange={onSiteChange}
          readOnly={readOnly}
          savedUrl={savedUrl}
        />
      </div>
    </DocBlock>
  );
}
