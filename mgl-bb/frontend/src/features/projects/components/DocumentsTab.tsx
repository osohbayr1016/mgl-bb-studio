import { useState, useEffect, useCallback } from 'react';
import { apiFetch, uploadFile, mediaUrl } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import type { DocumentItem, DocumentDetailResponse, BlockProgress } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Badge } from '@/ui/badge';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import {
  FileText,
  Upload,
  Download,
  Clock,
  CheckCircle2,
  XCircle,
  FileIcon,
  MessageSquare,
  Plus,
  Loader2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { toast } from '@/shared/components/Toast';

import { formatDate } from '@/shared/lib/time';
export function DocumentsTab({
  projectId,
  blocks,
}: {
  projectId: number;
  blocks: BlockProgress[];
}) {
  const { t } = useLanguage();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch<{ documents: DocumentItem[] }>(
        `/documents?project_id=${projectId}`,
      );
      setDocuments(res.documents);
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  if (selectedDocId) {
    return (
      <DocumentDetailView
        docId={selectedDocId}
        onBack={() => {
          setSelectedDocId(null);
          loadDocs();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('documentsTab.title')}</h3>
        <UploadDocumentDialog projectId={projectId} blocks={blocks} onUploaded={loadDocs} />
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <Card className="border-dashed border-2 border-destructive/30 bg-destructive/5">
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <XCircle className="h-10 w-10 text-destructive opacity-60" />
            <p>{t('common.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={loadDocs}>
              {t('common.retry')}
            </Button>
          </div>
        </Card>
      ) : documents.length === 0 ? (
        <Card className="border-dashed border-2 bg-muted/20">
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <FileText className="h-10 w-10 opacity-20" />
            <p>{t('documentsTab.empty')}</p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('documentsTab.revision')}</TableHead>
                  <TableHead>{t('documentsTab.status')}</TableHead>
                  <TableHead>{t('documentsTab.uploadedBy')}</TableHead>
                  <TableHead>{t('documentsTab.date')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedDocId(doc.id)}
                  >
                    <TableCell>
                      <div className="font-medium flex items-center gap-2">
                        <FileIcon className="h-4 w-4 text-primary" />
                        {doc.title}
                      </div>
                      {doc.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[250px] mt-1">
                          {doc.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        Rev-{String(doc.revision_number ?? 0).padStart(2, '0')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={doc.status ?? 'pending'} />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{doc.uploaded_by_name || doc.created_by_name}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {doc.uploaded_at ? formatDate(new Date(doc.uploaded_at)) : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a href={mediaUrl(doc.file_url)} target="_blank" rel="noreferrer" download>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  if (status === 'approved')
    return (
      <Badge className="bg-success/10 text-success hover:bg-success/20 border-success/20">
        <CheckCircle2 className="h-3 w-3 mr-1" /> {t('documentsTab.approved')}
      </Badge>
    );
  if (status === 'rejected')
    return (
      <Badge
        variant="destructive"
        className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
      >
        <XCircle className="h-3 w-3 mr-1" /> {t('documentsTab.rejected')}
      </Badge>
    );
  return (
    <Badge
      variant="secondary"
      className="bg-warning/10 text-warning hover:bg-warning/20 border-warning/20"
    >
      <Clock className="h-3 w-3 mr-1" /> {t('documentsTab.pending')}
    </Badge>
  );
}

function UploadDocumentDialog({
  projectId,
  blocks,
  onUploaded,
}: {
  projectId: number;
  blocks: BlockProgress[];
  onUploaded: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // For linking (simplified to block/drawing for now)
  const [blockId, setBlockId] = useState<string>('none');
  const [drawingId, setDrawingId] = useState<string>('none');

  const selectedBlock = blocks.find((b) => b.id.toString() === blockId);

  const handleUpload = async () => {
    if (!title.trim() || !file) return;
    setUploading(true);
    try {
      const fileUrl = await uploadFile(file);
      await apiFetch('/documents', {
        data: {
          project_id: projectId,
          block_id: blockId !== 'none' ? Number(blockId) : undefined,
          drawing_id: drawingId !== 'none' ? Number(drawingId) : undefined,
          title: title.trim(),
          description: desc.trim(),
          file_url: fileUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        },
      });
      setOpen(false);
      setTitle('');
      setDesc('');
      setFile(null);
      setBlockId('none');
      setDrawingId('none');
      onUploaded();
    } catch (err) {
      toast.error(
        t('documentsTab.uploadFailed'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" /> {t('documentsTab.newDocument')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('documentsTab.uploadDocument')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>{t('documentsTab.titleLabel')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('documentsTab.titlePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>{t('documentsTab.blockOptional')}</Label>
              <Select
                value={blockId}
                onValueChange={(v) => {
                  setBlockId(v);
                  setDrawingId('none');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('documentsTab.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('documentsTab.noLink')}</SelectItem>
                  {blocks.map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('documentsTab.drawingOptional')}</Label>
              <Select value={drawingId} onValueChange={setDrawingId} disabled={blockId === 'none'}>
                <SelectTrigger>
                  <SelectValue placeholder={t('documentsTab.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('documentsTab.noLink')}</SelectItem>
                  {selectedBlock?.drawings.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('common.description')}</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('documentsTab.descPlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('documentsTab.fileLabel')}</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>

          <Button
            className="w-full"
            onClick={handleUpload}
            disabled={!title.trim() || !file || uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDetailView({ docId, onBack }: { docId: number; onBack: () => void }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [data, setData] = useState<DocumentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await apiFetch<DocumentDetailResponse>(`/documents/${docId}`);
      setData(res);
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleApprove = async (revId: number, status: 'approved' | 'rejected') => {
    const notes = prompt(
      status === 'rejected' ? t('documentsTab.rejectReason') : t('documentsTab.approveNote'),
    );
    if (status === 'rejected' && !notes?.trim()) {
      // Require reason for rejection: dismiss/empty aborts quietly with a hint
      if (notes !== null) toast.warn(t('documentsTab.rejectReason'));
      return;
    }
    try {
      await apiFetch(`/documents/${docId}/revisions/${revId}/approve`, {
        data: { status, notes },
      });
      loadDetail();
    } catch (err) {
      toast.error(t('documentsTab.failed'), err instanceof Error ? err.message : undefined);
    }
  };

  const handleComment = async (revId: number) => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await apiFetch(`/documents/${docId}/revisions/${revId}/comments`, {
        data: { content: commentText },
      });
      setCommentText('');
      loadDetail();
    } catch (err) {
      toast.error(t('documentsTab.failed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading)
    return (
      <div className="py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </div>
    );
  if (loadError)
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Card className="border-dashed border-2 border-destructive/30 bg-destructive/5">
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <XCircle className="h-10 w-10 text-destructive opacity-60" />
            <p>{t('common.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={loadDetail}>
              {t('common.retry')}
            </Button>
          </div>
        </Card>
      </div>
    );
  if (!data) return <div>{t('documentsTab.notFound')}</div>;

  const { document, revisions } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          {t('common.back')}
        </Button>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {document.title}
          </h2>
          {document.description && (
            <p className="text-sm text-muted-foreground mt-1">{document.description}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Revisions List */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-lg">{t('documentsTab.revisions')}</h3>
          {revisions.map((rev, idx) => {
            const isLatest = idx === 0;
            return (
              <Card
                key={rev.id}
                className={isLatest ? 'border-primary/50 shadow-sm' : 'opacity-80'}
              >
                <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={isLatest ? 'default' : 'outline'} className="font-mono">
                          Rev-{String(rev.revision_number).padStart(2, '0')}
                        </Badge>
                        {isLatest && (
                          <Badge variant="secondary" className="text-micro">
                            {t('documentsTab.latest')}
                          </Badge>
                        )}
                        <StatusBadge status={rev.status} />
                      </div>
                      <div className="text-sm mt-2 text-muted-foreground">
                        {t('documentsTab.uploadedByLabel')}{' '}
                        <span className="font-medium text-foreground">{rev.uploaded_by_name}</span>{' '}
                        · {new Date(rev.uploaded_at).toLocaleString()}
                      </div>
                      {rev.reviewed_by_name && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {t('documentsTab.reviewedByLabel')}{' '}
                          <span className="font-medium text-foreground">
                            {rev.reviewed_by_name}
                          </span>
                          {rev.review_notes && (
                            <span className="italic ml-2">"{rev.review_notes}"</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={mediaUrl(rev.file_url)} target="_blank" rel="noreferrer" download>
                          <Download className="h-4 w-4 mr-2" /> {t('documentsTab.download')}
                        </a>
                      </Button>
                      {isLatest &&
                        (user?.role === 'admin' || user?.role === 'senior') &&
                        rev.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              className="bg-success hover:bg-success"
                              onClick={() => handleApprove(rev.id, 'approved')}
                            >
                              {t('documentsTab.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleApprove(rev.id, 'rejected')}
                            >
                              {t('documentsTab.reject')}
                            </Button>
                          </>
                        )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      {t('documentsTab.comments', { count: rev.comments?.length || 0 })}
                    </h4>

                    <div className="space-y-3">
                      {rev.comments?.map((c) => (
                        <div key={c.id} className="flex gap-3 bg-muted/30 p-3 rounded-lg">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={c.profile_image || ''} />
                            <AvatarFallback>
                              {c.user_name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{c.user_name}</span>
                              <span className="text-micro text-muted-foreground">
                                {new Date(c.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm mt-1 whitespace-pre-wrap">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-start gap-2 mt-4">
                      <Textarea
                        placeholder={t('documentsTab.commentPlaceholder')}
                        value={isLatest ? commentText : ''}
                        onChange={(e) => isLatest && setCommentText(e.target.value)}
                        disabled={!isLatest || submittingComment}
                        className="min-h-[80px] text-sm"
                      />
                      <Button
                        size="sm"
                        disabled={!isLatest || !commentText.trim() || submittingComment}
                        onClick={() => handleComment(rev.id)}
                      >
                        {t('documentsTab.send')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Right: Upload New Revision */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('documentsTab.newRevision')}</CardTitle>
              <CardDescription>{t('documentsTab.newRevisionHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <UploadRevisionForm docId={docId} onUploaded={loadDetail} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function UploadRevisionForm({ docId, onUploaded }: { docId: number; onUploaded: () => void }) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fileUrl = await uploadFile(file);
      await apiFetch(`/documents/${docId}/revisions`, {
        data: {
          file_url: fileUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        },
      });
      setFile(null);
      onUploaded();
    } catch (err) {
      toast.error(
        t('documentsTab.uploadFailed'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <Button className="w-full" onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Upload className="h-4 w-4 mr-2" />
        )}
        {t('documentsTab.addRevision')}
      </Button>
    </div>
  );
}
