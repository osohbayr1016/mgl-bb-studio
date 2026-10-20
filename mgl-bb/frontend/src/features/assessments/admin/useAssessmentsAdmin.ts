import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/shared/components/Toast';
import {
  assessmentKeys,
  deleteRound,
  deleteTemplate,
  fetchRounds,
  fetchTemplates,
  updateRound,
} from '../api';
import { createDraftTemplate } from '../lib/createDraftTemplate';
import { emptyDraft } from '../lib/schemaDraft';
import type { TranslationKey } from '@/shared/i18n';
import type { AssessmentRoundSummary, RoundStatus } from '../types';
import { TEMPLATES_ROUTE } from './assessmentsAdminShared';

export function useAssessmentsAdmin(
  isAdmin: boolean,
  t: (key: TranslationKey) => string,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pickOpen, setPickOpen] = useState(false);
  const [pickTemplateId, setPickTemplateId] = useState('');
  const [docxOpen, setDocxOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AssessmentRoundSummary | null>(null);

  const roundsQuery = useQuery({
    queryKey: assessmentKeys.rounds,
    queryFn: fetchRounds,
    enabled: isAdmin,
  });
  const templatesQuery = useQuery({
    queryKey: assessmentKeys.templates,
    queryFn: fetchTemplates,
    enabled: isAdmin,
  });
  const rounds = useMemo(() => roundsQuery.data?.rounds ?? [], [roundsQuery.data]);
  const templates = useMemo(() => templatesQuery.data?.templates ?? [], [templatesQuery.data]);

  const invalidateRounds = () =>
    queryClient.invalidateQueries({ queryKey: assessmentKeys.rounds });
  const invalidateTemplates = () =>
    queryClient.invalidateQueries({ queryKey: assessmentKeys.templates });

  const newTemplateMutation = useMutation({
    mutationFn: () => createDraftTemplate(emptyDraft()),
    onSuccess: (template) => {
      void invalidateTemplates();
      navigate(`${TEMPLATES_ROUTE}/${template.id}`);
    },
    onError: () => toast.error(t('assessments.templateCreateFailed')),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: RoundStatus }) =>
      updateRound(id, { status }),
    onSuccess: () => {
      void invalidateRounds();
      toast.success(t('assessments.roundUpdated'));
    },
    onError: () => toast.error(t('assessments.roundUpdateFailed')),
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name, period }: { id: number; name: string; period: string }) =>
      updateRound(id, { name, period }),
    onSuccess: (_res, vars) => {
      void invalidateRounds();
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.roundResults(vars.id) });
      setRenameTarget(null);
      toast.success(t('assessments.roundUpdated'));
    },
    onError: () => toast.error(t('assessments.roundUpdateFailed')),
  });
  const deleteRoundMutation = useMutation({
    mutationFn: (id: number) => deleteRound(id),
    onSuccess: () => {
      void invalidateRounds();
      toast.success(t('assessments.roundDeleted'));
    },
    onError: () => toast.error(t('assessments.roundDeleteFailed')),
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      void invalidateTemplates();
      toast.success(t('assessments.templateDeleted'));
    },
    onError: () => toast.error(t('assessments.templateDeleteFailed')),
  });

  return {
    rounds,
    templates,
    roundsLoading: roundsQuery.isLoading,
    templatesLoading: templatesQuery.isLoading,
    pickOpen,
    setPickOpen,
    pickTemplateId,
    setPickTemplateId,
    docxOpen,
    setDocxOpen,
    renameTarget,
    setRenameTarget,
    statusPending: statusMutation.isPending,
    creatingTemplate: newTemplateMutation.isPending,
    renamePending: renameMutation.isPending,
    openPicker: () => {
      setPickTemplateId(templates[0] ? String(templates[0].id) : '');
      setPickOpen(true);
    },
    goPublish: () => {
      const id = Number(pickTemplateId);
      if (!id) {
        toast.warn(t('assessments.roundCreateMissing'));
        return;
      }
      setPickOpen(false);
      navigate(`${TEMPLATES_ROUTE}/${id}?publish=1`);
    },
    openRound: (id: number) => navigate(`/app/admin/assessments/${id}`),
    openTemplate: (id: number) => navigate(`${TEMPLATES_ROUTE}/${id}`),
    mutateStatus: (id: number, status: RoundStatus) => statusMutation.mutate({ id, status }),
    mutateRename: (id: number, name: string, period: string) =>
      renameMutation.mutate({ id, name, period }),
    mutateDeleteRound: (id: number) => deleteRoundMutation.mutate(id),
    mutateNewTemplate: () => newTemplateMutation.mutate(),
    mutateDeleteTemplate: (id: number) => deleteTemplateMutation.mutate(id),
  };
}
