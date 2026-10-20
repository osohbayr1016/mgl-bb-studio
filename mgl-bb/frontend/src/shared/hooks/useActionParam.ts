import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * `?action=<name>` URL параметрийг уншиж, нэг удаа "хэрэглээд" арчина.
 *
 * Доод navbar-ын түргэн үйлдлийн sheet нь хуудас руу шилжихдээ энэ
 * параметрийг дагуулж илгээдэг (жишээ нь `/app/attendance?action=leave`),
 * зорилтот хуудас нь аль хэдийн байгаа local state-ээ (ихэвчлэн `showForm`)
 * нээнэ.  Ингэснээр диалог бүрийг глобал state рүү өргөх шаардлагагүй.
 *
 *   const [wantsLeave, clearAction] = useActionParam('leave');
 *   useEffect(() => { if (wantsLeave) { setShowForm(true); clearAction(); } }, [wantsLeave, clearAction]);
 */
export function useActionParam(action: string): [boolean, () => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get('action') === action;

  const clear = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('action');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return [active, clear];
}
