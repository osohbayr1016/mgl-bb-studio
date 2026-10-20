import { useId } from 'react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Plus, Trash2, Building2, UserPlus, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import type { ParticipantGroup } from './types';

export interface Employee {
  id: number;
  full_name: string;
  position?: string | null;
}

/** Editor for structured participants: a list of organisations, each with
 *  members (name + position).  Member names autocomplete against the employee
 *  directory; picking an employee links the member (user_id) so their saved
 *  signature is auto-inserted into the PDF.  Free text still works for external
 *  (non-employee) attendees. */
export function ParticipantsEditor({
  value,
  onChange,
  employees,
}: {
  value: ParticipantGroup[];
  onChange: (next: ParticipantGroup[]) => void;
  employees: Employee[];
}) {
  const { t } = useLanguage();
  const listId = useId();

  const patchGroup = (gi: number, patch: Partial<ParticipantGroup>) =>
    onChange(value.map((g, i) => (i === gi ? { ...g, ...patch } : g)));

  const addGroup = () => onChange([...value, { org: '', members: [{ name: '' }] }]);
  const removeGroup = (gi: number) => onChange(value.filter((_, i) => i !== gi));

  const addMember = (gi: number) =>
    patchGroup(gi, { members: [...value[gi]!.members, { name: '' }] });
  const removeMember = (gi: number, mi: number) =>
    patchGroup(gi, { members: value[gi]!.members.filter((_, i) => i !== mi) });
  const patchMember = (
    gi: number,
    mi: number,
    patch: { name?: string; position?: string; user_id?: number },
  ) =>
    patchGroup(gi, {
      members: value[gi]!.members.map((m, i) => (i === mi ? { ...m, ...patch } : m)),
    });

  // When a typed name exactly matches an employee, link it (user_id) and fill
  // the position if still empty.  Otherwise it's a free-text (external) member.
  const onMemberName = (gi: number, mi: number, name: string) => {
    const emp = employees.find((e) => e.full_name === name);
    const current = value[gi]!.members[mi]!;
    if (emp) {
      patchMember(gi, mi, {
        name,
        user_id: emp.id,
        position: current.position || emp.position || undefined,
      });
    } else {
      patchMember(gi, mi, { name, user_id: undefined });
    }
  };

  return (
    <div className="space-y-3">
      <datalist id={listId}>
        {employees.map((e) => (
          <option key={e.id} value={e.full_name} />
        ))}
      </datalist>

      {value.map((group, gi) => (
        <div key={gi} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Input
              value={group.org}
              onChange={(e) => patchGroup(gi, { org: e.target.value })}
              placeholder={t('meetingNotes.orgPlaceholder')}
              className="h-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => removeGroup(gi)}
              title={t('meetingNotes.removeOrg')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-1.5 pl-6">
            {group.members.map((m, mi) => (
              <div key={mi} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    list={listId}
                    value={m.name}
                    onChange={(e) => onMemberName(gi, mi, e.target.value)}
                    placeholder={t('meetingNotes.memberName')}
                    className="h-8"
                  />
                  {m.user_id != null && (
                    <span
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-primary"
                      title={t('meetingNotes.linkedEmployee')}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <Input
                  value={m.position ?? ''}
                  onChange={(e) => patchMember(gi, mi, { position: e.target.value })}
                  placeholder={t('meetingNotes.memberPosition')}
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => removeMember(gi, mi)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => addMember(gi)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> {t('meetingNotes.addMember')}
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addGroup}>
        <Plus className="h-4 w-4 mr-2" /> {t('meetingNotes.addOrg')}
      </Button>
    </div>
  );
}
