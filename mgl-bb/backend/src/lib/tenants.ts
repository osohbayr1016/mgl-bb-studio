/**
 * ОЛОН-TENANT УГСРАА — нэг Worker олон компанийг үйлчилнэ.
 *
 * ЗАГВАР:  Компани бүр өөрийн D1 + R2-той.  Код нь НЭГ, binding нь ОЛОН:
 *
 *   [[d1_databases]] binding = "DB"        → MGL
 *   [[d1_databases]] binding = "DB_ACME"   → ACME
 *   [[r2_buckets]]   binding = "MEDIA_ACME"  …
 *
 * Хүсэлт ирэхэд аль компанийнх болохыг тодорхойлж, `env`-ийн `DB` /
 * `MEDIA_BUCKET` / `MEETING_BUCKET`-ыг ТЭР компанийнхаар СОЛИНО.  Код
 * бүхэлдээ `c.env.DB` уншдаг тул үлдсэн нь юу ч мэдэхгүй.
 *
 * ⚠️ ТОХИРУУЛААГҮЙ ҮЕД ОГТ ИДЭВХЖИХГҮЙ.  `TENANTS` var байхгүй бол
 *    `resolveTenant` нь `null` буцааж, хүсэлт өнөөдрийнхтэй ЯГ ИЖИЛ замаар
 *    явна.  MGL-ийн ажиллаж байгаа суулгацад ямар ч өөрчлөлт гарахгүй.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ АЮУЛГҮЙ БАЙДЛЫН ГОЛ ЗАРЧИМ — УНШИХГҮЙГЭЭР БҮҮ ЗАС
 *
 * Tenant-ыг тодорхойлох НЬ БИШ, харин ТОКЕНЫГ ХИЛЭЭР БАРИХ нь жинхэнэ
 * хамгаалалт.  Учир нь:
 *
 *   • `JWT_SECRET` нь Worker-т НЭГ.  Тиймээс A компанид олгосон токен нь
 *     B компанийн контекстэд ч гарын үсгийн хувьд ХҮЧИНТЭЙ шалгагдана.
 *   • Токены `sub` нь ТУХАЙН компанийн DB доторх user id.  A-гийн `sub: 5`
 *     нь B-д ӨӨР ХҮН байна.
 *   → Хэрэв tenant хооронд шалгахгүй бол A компанийн ажилтан B компанийн
 *     5 дугаар хэрэглэгчээр нэвтэрнэ.  Энэ бол бүрэн эрхийн давалт.
 *
 * Тиймээс токен бүр `tid` (tenant id) claim агуулах ба `middleware/auth.ts`
 * нь хүсэлтийн tenant-тай тулгана.  Тулгалт зөрвөл 401.
 *
 * ⚠️ ХОЁРДУГААР ДҮРЭМ (1A-4): компани бүр `media` + `meeting` bucket-аа
 *    ЗААВАЛ зарлана.  Заагаагүй бичлэгийг `parseTenants` БҮРЭН ХАЯНА —
 *    «дефолт руу унагаах» нь B компанийн файлыг MGL-ийн нээлттэй bucket руу
 *    чимээгүй бичих бөгөөд ямар ч алдаа өгөхгүй.  Мөн `tenantEnv` нь
 *    `LEGACY_MEDIA_ORIGIN`-ыг ҮРГЭЛЖ дарж бичнэ (`[vars]` нь Worker-т глобал).
 * ─────────────────────────────────────────────────────────────────────
 */

/** Нэг компанийн binding зураглал. */
export interface TenantSpec {
  /** Тогтмол богино id — токены `tid` claim, лог, тохиргооны memo түлхүүр. */
  id: string;
  /** Хүнд харагдах нэр (лог, алдааны мессеж). */
  label: string;
  /**
   * Энэ компанийг заах host-ууд.  Custom domain тохируулсан үед хамгийн
   * найдвартай зам (`api.acme.mn`).  Жижиг үсгээр, порт хассан хэлбэрээр.
   */
  hosts: string[];
  /** D1 binding-ийн НЭР (`DB_ACME`).  Заавал. */
  db: string;
  /**
   * Нийтийн R2 binding-ийн нэр.  ЗААВАЛ.
   *
   * ⚠️ СОНГОЛТТОЙ БОЛГОЖ БОЛОХГҮЙ.  `tenantEnv` нь `{ ...bag }` хийдэг тул
   *    заагаагүй бол B компанийн зураг, гарын үсэг, хавсралт, тайлангийн PDF
   *    нь ҮНДСЭН (MGL-ийн) bucket руу ЧИМЭЭГҮЙ бичигдэнэ.  Тэр bucket нь
   *    `/media/:key`-ээр баталгаажуулалтгүй уншигддаг (`index.ts`-ийн
   *    `app.route('/media', media)` нь `app.use('/api/*', authMiddleware)`-ийн
   *    ГАДНА) — өөрөөр хэлбэл нэг талбар мартахад компани хооронд өгөгдөл
   *    гоожно.  Үндсэн компани нь `"MEDIA_BUCKET"` гэж ИЛ бичнэ.
   */
  media: string;
  /** Хурлын дуу бичлэгийн R2 binding.  ЗААВАЛ, `media`-тай ЯГ ИЖИЛ шалтгаанаар. */
  meeting: string;
  /**
   * Тухайн компанийн ХУУЧИН media origin (`routes/media.ts`-ийн нөхөж татах
   * салаа).  Өгөөгүй бол `tenantEnv` нь `LEGACY_MEDIA_ORIGIN`-ыг ХООСОН
   * болгоно → нөхөж татах бүхэлдээ унтарна (`routes/media.ts`-ийн
   * `if (!legacy) return c.notFound()`).
   *
   * ⚠️ Энэ талбар СОНГОЛТТОЙ боловч дефолт нь «унтраасан» — учир нь
   *    `LEGACY_MEDIA_ORIGIN` бол binding БИШ, `[vars]`-ийн мөр бөгөөд
   *    `{ ...bag }`-аар tenant бүрийн env рүү урсдаг.  Дарж бичихгүй бол B
   *    компанийн домэйнээр MGL-ийн ЯМАР Ч файлыг татаад, дээрээс нь B-гийн
   *    bucket руу БАЙНГЫН хуулбар үлдээнэ — компани хооронд өгөгдөл
   *    дамжуулах примитив.
   */
  legacyMediaOrigin?: string;
  /**
   * «Програмын хүсэлт»-ийн ХУВИЙН R2 binding-ийн нэр (2026-10-16).  СОНГОЛТТОЙ — заагаагүй tenant-д хавсралтын
   * замууд 503 (зөвхөн бичвэр).  ⚠️ `tenantEnv` нь `FEEDBACK_BUCKET`-ийг tenant бүрт ДАРЖ тавина (заагаагүй бол
   * undefined) — эс бөгөөс `...bag`-аар үндсэн компанийн хувийн bucket бусад компанид ЧИМЭЭГҮЙ хуваалцагдана.
   */
  feedback?: string;
}

/** `X-Tenant` толгойн нэр — host-оор ялгах боломжгүй үеийн нөөц зам. */
export const TENANT_HEADER = 'X-Tenant';

/* ------------------------------------------------------------------ */
/*  Задлан шинжлэх                                                     */
/* ------------------------------------------------------------------ */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * `TENANTS` var-ыг задална.  Утга нь `TenantSpec[]`-ийн JSON.
 *
 * Буруу бичлэг нь Worker-ийг УНАГААХ ЁСГҮЙ — `null` буцаана, тэгвэл систем
 * нэг-tenant горимоор үргэлжилнэ.  (Чимээгүй унтрахаас илүү аюултай зүйл
 * бол бүх хүсэлт 500 болох явдал.)
 */
export function parseTenants(raw: unknown): TenantSpec[] | null {
  if (!isNonEmptyString(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: TenantSpec[] = [];
  const seenIds = new Set<string>();
  const seenHosts = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (!isNonEmptyString(r.id) || !isNonEmptyString(r.db)) continue;
    // ⚠️ Bucket дутуу бичлэгийг «дефолт руу унагаах» БИШ, БҮРЭН ХАЯНА.
    //    Унагаах нь B компанийн файлыг MGL-ийн нээлттэй bucket руу бичих
    //    бөгөөд ямар ч алдаа өгөхгүй тул илрэхгүй.  Хаясан tenant нь
    //    `resolveTenant`-д олдохгүй → `index.ts` дээр 404 `unknown_tenant`
    //    (fail-closed: буруу тохиргоо нь өгөгдөл гоожихоос ИЛҮҮ дээр).
    if (!isNonEmptyString(r.media) || !isNonEmptyString(r.meeting)) {
      console.error(
        `[tenant] ${r.id.trim()}: media/meeting binding заагаагүй — бичлэгийг ХАЯЛАА`,
      );
      continue;
    }

    const id = r.id.trim();
    // Давхардсан id нь дуугүй эргэлзээ үүсгэнэ — ЭХНИЙХИЙГ нь авна.
    if (seenIds.has(id)) continue;

    // Жижиг үсэг + дотоод давхардлыг арилгана (`['a.mn','A.MN']` → нэг).
    const hosts = Array.isArray(r.hosts)
      ? [...new Set(r.hosts.filter(isNonEmptyString).map((h) => h.trim().toLowerCase()))]
      : [];
    // Нэг host хоёр КОМПАНИД харьяалагдах нь бүрэн эрхийн давалт болно —
    // хоёр дахийг нь ХАЯНА (эхнийх нь эзэмшинэ).
    const ownHosts = hosts.filter((h) => !seenHosts.has(h));
    for (const h of ownHosts) seenHosts.add(h);

    seenIds.add(id);
    out.push({
      id,
      label: isNonEmptyString(r.label) ? r.label.trim() : id,
      hosts: ownHosts,
      db: r.db.trim(),
      media: r.media.trim(),
      meeting: r.meeting.trim(),
      ...(isNonEmptyString(r.legacyMediaOrigin)
        ? { legacyMediaOrigin: r.legacyMediaOrigin.trim() }
        : {}),
      ...(isNonEmptyString(r.feedback) ? { feedback: r.feedback.trim() } : {}),
    });
  }

  return out.length > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/*  Шийдвэрлэх                                                         */
/* ------------------------------------------------------------------ */

/** Host-оос порт болон том үсгийг арилгана. */
function normalizeHost(h: string | null | undefined): string {
  if (!h) return '';
  return h.trim().toLowerCase().split(':')[0] ?? '';
}

export interface TenantResolution {
  tenant: TenantSpec;
  /** Юугаар олдсон бэ — лог, алдаа хайхад. */
  via: 'host' | 'header';
}

/**
 * Хүсэлтэд харгалзах компанийг олно.
 *
 * ДАРААЛАЛ:
 *   1. **Host** — `api.acme.mn` гэх мэт custom domain.  Хамгийн найдвартай:
 *      DNS + Worker route-аар баталгаажсан, хэрэглэгч хуурч чадахгүй.
 *   2. **`X-Tenant` толгой** — `*.workers.dev` дээр бүх компани НЭГ host
 *      хуваалцдаг тул host-оор ялгах боломжгүй.  Тэр үед frontend нь өөрийн
 *      build-д шигтгэсэн id-г толгойгоор илгээнэ.
 *
 * ⚠️ `X-Tenant` нь ХУУРАМЧЛАГДАЖ БОЛНО.  Тэр нь зөвхөн аль DB рүү харахыг
 *    сонгоно — ХЭН БОЛОХЫГ нотлохгүй.  Жинхэнэ хил нь токены `tid` claim
 *    (`middleware/auth.ts`).  Хуурамч толгойгоор өөр компанийн DB рүү
 *    чиглүүлсэн ч, тэр компанийн хүчинтэй токенгүйгээр юу ч уншиж чадахгүй.
 */
export function resolveTenant(
  tenants: readonly TenantSpec[],
  opts: { host?: string | null; header?: string | null },
): TenantResolution | null {
  const host = normalizeHost(opts.host);
  if (host) {
    for (const t of tenants) {
      if (t.hosts.includes(host)) return { tenant: t, via: 'host' };
    }
  }
  const hdr = opts.header?.trim().toLowerCase();
  if (hdr) {
    for (const t of tenants) {
      if (t.id.toLowerCase() === hdr) return { tenant: t, via: 'header' };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  env-ийг солих                                                      */
/* ------------------------------------------------------------------ */

/**
 * Тухайн компанийн binding-үүдийг үндсэн нэрсээр нь тавьсан ШИНЭ env объект.
 *
 * Эх `env`-ийг ХӨНДӨХГҮЙ (Worker-ийн env нь isolate-д хуваалцагддаг тул
 * мутаци нь бусад хүсэлтэд гоожно).
 *
 * Binding олдохгүй бол `null` буцаана — дуудагч 503 өгөх ёстой.  Байхгүй
 * binding-тэй үргэлжлэх нь `c.env.DB` нь `undefined` болж, хүсэлт бүр
 * ойлгомжгүй байдлаар унана.
 */
export function tenantEnv<T extends object>(env: T, tenant: TenantSpec): T | null {
  // `Env` бол interface тул index signature-гүй — binding-ийг НЭРЭЭР авахын
  // тулд нэг удаа bag болгож хөрвүүлнэ.  Гаралт нь эх төрлөө хадгална.
  const bag = env as unknown as Record<string, unknown>;

  const db = bag[tenant.db];
  if (!db) return null;

  const next: Record<string, unknown> = { ...bag, DB: db };

  // БОЛЗОЛГҮЙ — `TenantSpec.media`/`.meeting` нь заавал тул `if` шаардлагагүй.
  // `parseTenants` аль хэдийн шалгасан ч энэ нь ДАВХАР хамгаалалт: гараар
  // барьсан `TenantSpec` (тест, ирээдүйн дуудагч) ч энэ замаар орно.
  const mediaB = bag[tenant.media];
  if (!mediaB) return null;
  next.MEDIA_BUCKET = mediaB;

  const meetingB = bag[tenant.meeting];
  if (!meetingB) return null;
  next.MEETING_BUCKET = meetingB;

  // `LEGACY_MEDIA_ORIGIN` бол binding БИШ, `[vars]`-ийн мөр — дээрх `...bag`-аар
  // tenant бүрийн env рүү урсдаг.  Дарж бичихгүй бол B компанийн домэйнээр
  // `GET /media/<MGL-ийн түлхүүр>` дуудахад: (1) B-гийн bucket-д олдохгүй,
  // (2) MGL-ийн ХУУЧИН worker-ээс татаж хэрэглэгч рүү буцаана, (3)
  // `routes/media.ts` нь B-гийн bucket руу БАЙНГЫН хуулбар бичнэ.  Тиймээс
  // tenant өөрөө ИЛ зарлаагүй бол ХООСОН болгоно — `routes/media.ts`-ийн
  // `if (!legacy) return c.notFound()` дээр бүхэлдээ унтарна.
  next.LEGACY_MEDIA_ORIGIN = tenant.legacyMediaOrigin ?? '';

  // Програмын хүсэлтийн хувийн bucket — СОНГОЛТТОЙ.  Заагаагүй эсвэл binding олдоогүй бол undefined (хавсралтын замууд
  // 503), үндсэн компанийнхыг ХЭЗЭЭ Ч өвлүүлэхгүй.  Энэ binding дутуу байх нь бүхэл tenant-ыг 503 болгох шалтгаан биш.
  next.FEEDBACK_BUCKET = tenant.feedback ? bag[tenant.feedback] ?? undefined : undefined;

  return next as unknown as T;
}
