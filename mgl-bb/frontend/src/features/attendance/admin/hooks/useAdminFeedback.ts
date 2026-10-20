import { useState } from 'react';

/** Хуудсын дээд талын алдаа / амжилтын мэдэгдлийн нэгдсэн төлөв.
 *  Бүх дэд hook энэ объектыг хүлээж авч `setError` / `setSuccess` дуудна. */
export function useAdminFeedback() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  return { error, setError, success, setSuccess };
}

export type AdminFeedback = ReturnType<typeof useAdminFeedback>;
