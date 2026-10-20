/* ─────────────────────────────────────────────────────────────────────────
 * «Гэрээний шатны төсөл нэмэх» — ЗӨВХӨН нэрээр.
 *
 * Энэ нь бүрэн төсөл БИШ, САНУУЛГА: гэрээ нь хараахан байгуулагдаагүй,
 * хэлэлцээрийн шатанд яваа ажлыг Timeline дээр нүдэнд харагдуулж, мартахаас
 * сэргийлнэ.  Тиймээс байршил, нарийн төвөгтэй байдал, багийн хуваарилалт
 * зэрэг бүх талбарыг АСУУХГҮЙ — сервер тал бүгдийг анхдагчаар нь бөглөнө.
 *
 * Ийм төсөл `is_pending = 1`-тэй үүсэх бөгөөд инженер, архитектор,
 * харилцагчийн Төслүүдийн жагсаалтад ОГТ гарахгүй (backend-ийн харагдацын
 * шүүлт).  Гэрээ байгуулагдвал мөрний 🤝 товчийг дарж тэмдгийг арилгахад
 * ердийн төсөл болно — өгөгдөл нь аль хэдийн байрандаа байна.
 * ───────────────────────────────────────────────────────────────────────── */
import { useState } from 'react';

import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

interface AddPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Нэрийг цэвэрлэсэн хэлбэрээр буцаана; хаах ажлыг дуудагч хийнэ. */
  onSubmit: (name: string) => Promise<void>;
}

export function AddPendingDialog({ open, onOpenChange, onSubmit }: AddPendingDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
      setName('');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Хадгалж байх үед хаахыг зөвшөөрөхгүй — хагас төлөв үүсгэнэ.
        if (saving) return;
        if (!next) setName('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('timelinePage.addPendingTitle')}</DialogTitle>
          <DialogDescription>{t('timelinePage.addPendingDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="pending-name">{t('timelinePage.addPendingLabel')}</Label>
          <Input
            id="pending-name"
            value={name}
            autoFocus
            placeholder={t('timelinePage.addPendingPlaceholder')}
            onChange={(e) => setName(e.target.value)}
            // Enter → хадгална.  Ганц талбартай маягтад хамгийн хурдан зам.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!trimmed || saving}>
            {saving ? t('common.saving') : t('timelinePage.addPendingSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
