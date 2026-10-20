/**
 * Image picker — file upload + URL paste + thumbnail preview.
 *
 * Lifted from the legacy AdminLandingPage. The "or paste a https URL"
 * affordance stays as a small fallback for external assets, but the
 * primary UX is the file picker → R2 upload, with a live thumbnail
 * so the admin sees what they uploaded.
 */

import { useState } from 'react';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';

import { uploadFile } from '@/shared/api/client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { toast } from '@/shared/components/Toast';
import { mediaUrl } from '@/features/landing/components/shared';

export interface ImagePickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
  hint?: string;
  /** Tighter layout for nested rows (e.g. award items, partner logos). */
  dense?: boolean;
  /** Optional override of the uploader — Phase 3 uses this to emit a
   *  local blob URL immediately and patch the real R2 URL when ready. */
  upload?: (file: File) => Promise<string>;
}

export function ImagePicker({
  value,
  onChange,
  label,
  hint,
  dense = false,
  upload,
}: ImagePickerProps) {
  const [busy, setBusy] = useState(false);
  const preview = mediaUrl(value ?? undefined);

  const handleUpload = async (file: File) => {
    setBusy(true);
    try {
      const url = await (upload ?? uploadFile)(file);
      onChange(url);
      toast.success('Зураг хадгалагдлаа');
    } catch (e) {
      toast.error('Хуулж чадсангүй', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const tileSize = dense ? 'h-16 w-20' : 'h-24 w-32';

  return (
    <div className={dense ? 'space-y-1' : 'space-y-2'}>
      <Label className={dense ? 'text-xs font-medium' : undefined}>{label}</Label>
      <div className="flex items-start gap-3">
        <div
          className={`relative ${tileSize} flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30`}
        >
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex gap-2">
            <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
              <Upload className="h-3.5 w-3.5" />
              Зураг хуулах
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <X className="h-3.5 w-3.5 mr-1" /> Арилгах
              </Button>
            )}
          </div>
          <Input
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="эсвэл https://... URL хуулах"
            className="h-8 text-xs"
          />
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
