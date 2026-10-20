import { useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import type { Team } from '@/shared/types';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { TeamFormDialog, type TeamFormState } from './TeamFormDialog';
import { TeamDeleteConfirm } from './TeamDeleteConfirm';

const EMPTY_FORM: TeamFormState = {
  code: '',
  name_mn: '',
  name_en: '',
  description: '',
  sort_order: 100,
};

export function useTeamAdminDialogs(onSaved: () => void) {
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditing(team);
    setForm({
      code: team.code,
      name_mn: team.name_mn,
      name_en: team.name_en ?? '',
      description: team.description ?? '',
      sort_order: team.sort_order ?? 100,
    });
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.code.trim() || !form.name_mn.trim()) {
      setError(t('teams.validateRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name_mn: form.name_mn.trim(),
        name_en: form.name_en.trim() || null,
        description: form.description.trim() || null,
        sort_order: Number(form.sort_order) || 100,
      };
      if (editing) {
        await apiFetch(`/teams/${editing.id}`, { method: 'PUT', data: payload });
        toast.success(
          t('teams.toastUpdatedTitle'),
          t('teams.toastUpdated', { name: payload.name_mn }),
        );
      } else {
        await apiFetch('/teams', { method: 'POST', data: payload });
        toast.success(
          t('teams.toastCreatedTitle'),
          t('teams.toastCreated', { name: payload.name_mn }),
        );
      }
      setDialogOpen(false);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.saveFailed');
      setError(msg);
      toast.error(editing ? t('teams.toastUpdateFailed') : t('teams.toastCreateFailed'), msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const name = confirmDelete.name_mn;
    try {
      await apiFetch(`/teams/${confirmDelete.id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      onSaved();
      toast.success(t('teams.toastDeletedTitle'), t('teams.toastDeleted', { name }));
    } catch (err) {
      console.error(err);
      toast.error(t('common.deleteFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  const dialogs = (
    <>
      <TeamFormDialog
        open={dialogOpen}
        editing={!!editing}
        form={form}
        error={error}
        saving={saving}
        onOpenChange={setDialogOpen}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onSubmit={handleSubmit}
      />
      <TeamDeleteConfirm
        team={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );

  return { openCreate, openEdit, setConfirmDelete, dialogs };
}
