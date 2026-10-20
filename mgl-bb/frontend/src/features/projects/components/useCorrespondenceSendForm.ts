import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import {
  getCorrespondenceAliases,
  getCorrespondenceSendOptions,
} from '@/features/projects/components/correspondenceSendApi';
import type { CorrespondenceDocType } from '@/features/projects/components/correspondenceConstants';
import type { ClientContact } from '@/shared/types';
import type { EmailAccount } from '@/features/email/types/email';

export function useCorrespondenceSendForm(open: boolean, projectId: number) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [accountId, setAccountId] = useState('');
  const [fromAddr, setFromAddr] = useState('');
  const [fromAliases, setFromAliases] = useState<string[]>([]);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [docType, setDocType] = useState<CorrespondenceDocType | ''>('');
  const [refNo, setRefNo] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  /** RFI/CR: илгээмэгц захиалагчид порталд гарын үсэг зуруулах хүсэлт тавих. */
  const [requestSignature, setRequestSignature] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    getCorrespondenceSendOptions(projectId)
      .then((res) => {
        setAccounts(res.accounts);
        setClientContacts(res.client_contacts);
        const first = res.accounts[0];
        if (first) {
          setAccountId(String(first.id));
          setFromAddr(first.address);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('correspondenceLogTab.loadFailed')))
      .finally(() => setLoading(false));
  }, [open, projectId, t]);

  useEffect(() => {
    if (!accountId) return;
    getCorrespondenceAliases(Number(accountId))
      .then((res) => setFromAliases(res.aliases))
      .catch(() => setFromAliases([]));
    const acct = accounts.find((a) => String(a.id) === accountId);
    if (acct) setFromAddr(acct.address);
  }, [accountId, accounts]);

  const appendContact = (email: string) => {
    const e = email.trim();
    if (!e) return;
    setTo((cur) => (cur.trim() ? `${cur.trim()}\n${e}` : e));
  };

  return {
    loading,
    error,
    setError,
    accounts,
    clientContacts,
    accountId,
    setAccountId,
    fromAddr,
    setFromAddr,
    fromAliases,
    to,
    setTo,
    cc,
    setCc,
    subject,
    setSubject,
    body,
    setBody,
    docType,
    setDocType,
    refNo,
    setRefNo,
    signatureUrl,
    setSignatureUrl,
    files,
    setFiles,
    requestSignature,
    setRequestSignature,
    appendContact,
  };
}
