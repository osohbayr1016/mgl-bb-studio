/**
 * MGL AI · СУУЛГАЦЫН ТАМГА (Session B §20) — хөтөч тал.
 *
 * Санал хүсэлт илгээгдэхэд локал runtime-ийн `/info`-оос суулгацын таних
 * тэмдэг + бүрэлдэхүүн тус бүрийн хувилбарыг уншиж `POST /mgl-ai/fleet/message-context`
 * руу тавина.  Админы алдааны inbox тэр тамгаар «ямар релиз дээр гарсан бэ»
 * гэдгийг мэднэ.
 *
 * ⚠️ БҮТЭЛГҮЙТЭЛ НЬ ЧИМЭЭГҮЙ.  Runtime суугаагүй (захиалагч, эсвэл өөр PC),
 *    хуучин runtime (`deployment` талбаргүй), сүлжээ — аль ч тохиолдолд санал
 *    хүсэлт өөрөө хадгалагдсан, тамга л дутуу.  Хэрэглэгчид алдаа үзүүлэхгүй.
 *
 * ⚠️ `installation_id` нь санамсаргүй UUID (хардверийн хээ биш); `versions`
 *    нь цагаан жагсаалтаар — сервер ч дахин шүүнэ.
 */
import { apiFetch } from '@/shared/api/client';

import { probe } from './runtime';

export interface DeploymentSummary {
  installation_id: string;
  channel: string;
  versions: Record<string, string>;
  release: string | null;
}

export async function readDeploymentSummary(): Promise<DeploymentSummary | null> {
  try {
    const p = await probe();
    if (!p.installed || !p.authorized) return null;
    const d = p.info.deployment;
    return d && typeof d.installation_id === 'string' ? d : null;
  } catch {
    return null;
  }
}

export async function stampMessageContext(convUid: string, msgUid: string): Promise<void> {
  const d = await readDeploymentSummary();
  if (!d) return;
  try {
    await apiFetch('/mgl-ai/fleet/message-context', {
      method: 'POST',
      data: {
        msg_uid: msgUid,
        conv_uid: convUid,
        installation_id: d.installation_id,
        channel: d.channel,
        versions: { ...d.versions, ...(d.release ? { release: d.release } : {}) },
      },
    });
  } catch {
    // тамга дутуу — санал хүсэлт өөрөө аль хэдийн хадгалагдсан
  }
}
