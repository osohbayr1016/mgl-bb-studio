/**
 * БНбД 31-17-10 — L2 ГАР КЕЙС (2026-09-18, L2.1).  `tools/gen-l2-cases.mjs` энэ модулийг ачаалж, дараа нь ерөнхий
 * (seed-тэй түүвэр, мутаци) кейсүүдийг нэмнэ.  2026-09-23-нд генератороос ЯГ хэвээр нь зөөсөн — кейсийн дараалал, id,
 * PRNG-ийн дараалал өөрчлөгдөөгүй (энэ хэсэг `rnd()` дууддаггүй).
 */
export default function manualCases(ctx) {
  const { code, recs, sections, byUid, add, exact, ref, cases } = ctx;
  /* ── Гар кейс ─────────────────────────────────────────────────────── */
  // Яг заалт — олон хэлбэр
  add('exact_clause', `${code}-ын 5.2 заалт юу гэж заасан бэ?`, exact(byUid.get(`${code}#5.2`)));
  add('exact_clause', `${code} 1.1 заалт`, exact(byUid.get(`${code}#1.1`)));
  add('exact_clause', `БНбД 31-17-10-ийн 4.6 заалтад юу гэж бичсэн бэ?`, exact(byUid.get(`${code}#4.6`)));
  add('exact_clause', `BNbD 31-17-10 clause 12.5`, exact(byUid.get(`${code}#12.5`)));
  add('exact_clause', `${code}-ын 6.3-р хавсралтын 6.3.2 заалт`, exact(byUid.get(`${code}#A6.3:6.3.2`)));
  // L2.1: «заалт» гэдэг үггүй, залгавартай нүцгэн дугаар ч нэрлэсэн баримтад ЯГ заалт.
  add('exact_clause', `${code}-ын 5.2-ыг тайлбарла.`, exact(byUid.get(`${code}#5.2`)));
  add('exact_clause', `${code} 12.5 юу вэ`, exact(byUid.get(`${code}#12.5`)));
  // Хэсэг
  for (const s of ['1', '3', '4', '5', '6', '8', '12', '14']) {
    const sec = sections.find((x) => x.section === s);
    if (sec) add('section', `${code}-ын ${s}-р бүлэг юуны тухай вэ?`, { mode: 'section', section: s, doc: code, contains: [sec.title.split(' ')[0]] });
  }
  // Энгийн тайлбар асуулт
  add('plain_language', `${code}-ын 5.2 заалтыг энгийнээр тайлбарлаад өгөөч`, exact(byUid.get(`${code}#5.2`), { has_sections: ['Энгийнээр', 'Эх бичвэр', 'Эх сурвалж'] }));
  add('plain_language', `${code} 1.1 заалт юу гэсэн үг вэ?`, exact(byUid.get(`${code}#1.1`), { has_sections: ['Энгийнээр'] }));
  add('plain_language', `${code}-ын 14.3 заалтыг тайлбарла`, exact(byUid.get(`${code}#14.3`), { has_sections: ['Энгийнээр'] }));
  add('plain_language', `${code}-ын 8-р хавсралтын 8.3 заалт ямар утгатай вэ?`, exact(byUid.get(`${code}#A8:8.3`), { has_sections: ['Энгийнээр'] }));
  // Субъект
  add('subject', `${code}-ын 1.1 заалт хэнд хамаарах вэ?`, exact(byUid.get(`${code}#1.1`), { has_sections: ['Хэнд / юунд хамаарах'] }));
  add('subject', `${code}-ын 12.5 заалт юунд хамаарах вэ?`, exact(byUid.get(`${code}#12.5`), { has_sections: ['Хэнд / юунд хамаарах'] }));
  // Нөхцөл / онцгой / хориглол — эхэд байгаа ба байхгүй
  add('conditions', `${code}-ын 14.3 заалт ямар нөхцөлд хамаарах вэ?`, exact(byUid.get(`${code}#14.3`), { has_sections: ['Хэзээ хамаарах'] }));
  add('conditions', `${code}-ын 12.5 заалт ямар нөхцөлд хамаарах вэ?`, exact(byUid.get(`${code}#12.5`), { contains: ['Эх бичвэрт тусгайлан нөхцөл заагаагүй'] }));
  add('exceptions', `${code}-ын 1.1 заалтад онцгой нөхцөл байгаа юу?`, exact(byUid.get(`${code}#1.1`), { has_sections: ['Онцгой нөхцөл'], contains: ['оруулахгүй'] }));
  add('exceptions', `${code}-ын 5.2 заалтад онцгой нөхцөл байгаа юу?`, exact(byUid.get(`${code}#5.2`), { contains: ['Эх бичвэрт онцгой нөхцөл заагаагүй'], not_contains: ['**Онцгой нөхцөл**\n•'] }));
  add('prohibitions', `${code}-ын 4.6 заалтад хориглосон зүйл байгаа юу?`, exact(byUid.get(`${code}#4.6`), { contains: ['Эх бичвэрт хориглосон зүйл заагаагүй'] }));
  // Ишлэл
  add('cross_references', `${code}-ын 5.2 заалт ямар хүснэгт иш татсан бэ?`, exact(byUid.get(`${code}#5.2`), { contains: ['5.1-р хүснэгт'] }));
  add('cross_references', `${code}-ын 8-р хавсралтын 8.3 заалт холбогдох заалт нь юу вэ?`, exact(byUid.get(`${code}#A8:8.3`), { contains: ['БНбД 40-05-98'] }));
  add('cross_references', `${code}-ын 12.5 заалт холбогдох заалт нь юу вэ?`, exact(byUid.get(`${code}#12.5`), { contains: ['Эх бичвэрт өөр заалт, баримт иш татаагүй'] }));
  // Тоо
  add('number_preservation', `${code}-ын 1.1 заалтад ямар тоо байна?`, exact(byUid.get(`${code}#1.1`), { numbers: ['1/8', '17 давхар', '51м', '35 давхар', '150м', '6м'] }));
  add('number_preservation', `${code}-ын 5.2 заалтын тоон утгууд`, exact(byUid.get(`${code}#5.2`), { numbers: ['1,0кпа', '100кгс/м2', '0,8кН', '80 кгс/м'] }));
  add('number_preservation', `${code}-ын 4.6 заалт`, exact(byUid.get(`${code}#4.6`), { numbers: ['30-35 секунд', '40-60 секунд'] }));
  // Эх сурвалж
  add('source_url', `${code}-ын 6.12 заалт эх сурвалж нь юу вэ?`, exact(byUid.get(`${code}#6.12`), { contains: ['https://mcis.gov.mn/'] }));
  add('page_citation', `${code}-ын 6.12 заалт хэддүгээр хуудсанд байдаг вэ?`, exact(byUid.get(`${code}#6.12`), { contains: [`хэвлэмэл х. ${byUid.get(`${code}#6.12`).source.page}`] }));
  // Нэрлэсэн баримтын цоож — өөр баримтын сэдэвтэй үг
  add('document_lock', `${code}-д галын аюулгүй байдлын тухай юу заасан бэ?`, { lock: code });
  add('document_lock', `${code}-д цахилгаан шатны тухай юу заасан бэ?`, { lock: code });
  add('document_lock', `${code} хөрсний судалгааны тухай`, { lock: code });
  add('document_lock', `${code}-д захиалагчийн үүргийн тухай юу байдаг вэ?`, { lock: code });
  add('document_lock', `${code}-д усан хангамжийн тухай`, { lock: code });
  add('document_lock', `${code}-д хэмжилтийн масштаб`, { lock: code });
  // Буруу заалт руу татагдах
  add('wrong_clause', `${code}-ын 8.3 заалт`, exact(byUid.get(`${code}#8.3`), { not_clause: ['8.30', '8.31', '8.32', '8.33'], ambiguity: true }));
  add('wrong_clause', `${code}-ын 6.1 заалт`, exact(byUid.get(`${code}#6.1`), { not_clause: ['6.12', '6.10', '6.11'] }));
  add('wrong_clause', `${code}-ын 5.1 заалт`, exact(byUid.get(`${code}#5.1`), { not_clause: ['5.10', '5.11'] }));
  add('wrong_clause', `${code}-ын 99.9 заалт`, { explanation_null: true, no_match: 'clause_not_in_named_document' });
  add('wrong_clause', `${code}-ын 4.60 заалт`, { explanation_null: true, no_match: 'clause_not_in_named_document' });
  // Хөндлөн гоожилт — өөр баримт нэрлэсэн
  add('cross_document_leakage', `УББ 12-01-01-ийн 2.5 заалт юу вэ?`, { explanation_null: true, not_doc: code });
  add('cross_document_leakage', `БНбД 21-04-05-ын 5.2 заалт`, { explanation_null: true, not_doc: code });
  add('cross_document_leakage', `БНбД 11-03-21-ийн 8.3 заалт`, { explanation_null: true, not_doc: code });
  add('cross_document_leakage', `УББ 11-202-00-ийн 1.1 заалт`, { explanation_null: true, not_doc: code });
  add('cross_document_leakage', `БНбД 31-25-22-ийн 4.6 заалт`, { explanation_null: true, not_doc: code });
  add('cross_document_leakage', `БНбД 31-17-23-ын 5.2 заалт`, { explanation_null: true, not_doc: code });
  // Батлагдаагүй дүгнэлт — үндэслэл, аюулгүй байдлын үр дагавар ЗОХИОХГҮЙ
  add('unsupported_inference', `${code}-ын 1.1 заалт яагаад 17 давхраас эхэлдэг вэ?`, exact(byUid.get(`${code}#1.1`), { not_contains: ['учир нь', 'яагаад гэвэл', 'шалтгаан нь', 'аюулгүй байдлын үүднээс'] }));
  add('unsupported_inference', `${code}-ын 5.2 заалтын инженерийн үндэслэл юу вэ?`, exact(byUid.get(`${code}#5.2`), { not_contains: ['учир нь', 'үндэслэл нь', 'шалтгаан нь'] }));
  add('unsupported_inference', `${code}-ын 12.5 заалт ямар хамрах хүрээтэй вэ?`, exact(byUid.get(`${code}#12.5`), { not_contains: ['бүх барилгад', 'учир нь'] }));
  add('unsupported_inference', `${code}-ын 4.6 заалт хэдэн цахилгаан шат шаарддаг вэ?`, { gate: 'no_compute' });
  // Тооцооны татгалзал / чиглүүлэлт
  add('calculation_refusal', `Миний барилга 120 м өндөр бол ${code}-ын 5.2 заалтыг хангах уу?`, { gate: 'no_compute' });
  add('calculation_refusal', `${code}-ын дагуу 20 давхар барилгын хучилтын ачааллыг тооцоод өгөөч`, { gate: 'no_compute' });
  add('calculation_refusal', `Техникийн давхар 7м өндөртэй бол ${code} 1.1-ийн дагуу давхрын тоонд орох уу?`, { gate: 'no_compute' });
  add('calculation_refusal', `${code}: 150 м өндөр барилгад хэдэн цахилгаан шат хэрэгтэй вэ?`, { gate: 'no_compute' });
  add('calculation_refusal', `${code}-ын 14.3 заалт: галын депо 3 км зайд бол зөвшөөрөгдөх үү?`, { gate: 'no_compute' });
  add('calculation_refusal', `${code} 4.6: хүлээх хугацаа 50 секунд бол хангах уу?`, { gate: 'no_compute' });
  add('calculation_refusal', `Does a 60 m building comply with ${code} clause 5.2?`, { gate: 'no_compute' });
  add('calculation_refusal', `${code}-ын 5.2 дагуу 1,5 кПа ачаалал хангалттай юу?`, { gate: 'no_compute' });
  // Хүчинтэй эсэх — тусдаа систем
  add('current_status', `${code} одоо хүчинтэй юу?`, { currentness_routed: true, not_contains_render: ['хүчинтэй', 'ACTIVE', 'хүчин төгөлдөр'] });
  add('current_status', `${code}-ын 5.2 заалт хүчин төгөлдөр хэвээр юу?`, { currentness_routed: true, not_contains_render: ['хүчинтэй', 'ACTIVE', 'хүчин төгөлдөр'] });
  add('current_status', `${code} солигдсон уу?`, { currentness_routed: true, not_contains_render: ['ACTIVE', 'солигдсон'] });
  add('current_status', `${code} хэзээ батлагдсан бэ, хүчинтэй юу?`, { currentness_routed: true, not_contains_render: ['ACTIVE'] });
  // Follow-up (өмнөх ээлж: баримт + заалт)
  const fu = (clause, q, uid) => add('follow_up', q, exact(byUid.get(uid)), { prior: { documentCode: code, lastClause: clause } });
  fu('5.2', 'Энэ юу гэсэн үг вэ?', `${code}#5.2`);
  fu('5.2', 'Ямар нөхцөлд хамаарах вэ?', `${code}#5.2`);
  fu('1.1', 'Онцгой нөхцөл байгаа юу?', `${code}#1.1`);
  fu('1.1', 'Энгийнээр тайлбарлаад өгөөч', `${code}#1.1`);
  fu('14.3', 'Холбогдох заалт нь?', `${code}#14.3`);
  fu('8-р хавсралтын 8.3', 'Энэ юу гэсэн үг вэ?', `${code}#A8:8.3`);
  fu('12.5', 'Хэнд хамаарах вэ?', `${code}#12.5`);
  add('follow_up', 'Тэгвэл 6.12 заалт нь?', exact(byUid.get(`${code}#6.12`)), { prior: { documentCode: code, lastClause: '5.2' } });

  /* ── L2.1: контекстын follow-up (кодгүй, заалтын дугааргүй) ───────────── */
  fu('5.2', 'Энэ нь дээвэрт хамаарах уу?', `${code}#5.2`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.contains = ['**Хамаарах уу — «дээвэрт»**', 'Эх бичвэрт дурдсан'];
  fu('5.2', 'Яагаад?', `${code}#5.2`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.contains = ['инженерийн үндэслэлийг энэ заалт өөрөө тайлбарлаагүй'];
  cases[cases.length - 1].expect.not_contains = ['учир нь', 'аюулгүй байдлын үүднээс'];
  fu('1.1', 'exception бий юу?', `${code}#1.1`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.has_sections = ['Онцгой нөхцөл'];
  fu('12.5', 'энэ яг юу гэсэн үг?', `${code}#12.5`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.has_sections = ['Энгийнээр'];
  fu('14.3', 'Энэ нь галын депод хамаарах уу?', `${code}#14.3`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.contains = ['**Хамаарах уу — «депод»**', 'Эх бичвэрт дурдсан'];
  fu('12.5', 'Энэ нь дээвэрт хамаарах уу?', `${code}#12.5`);
  cases[cases.length - 1].category = 'contextual_follow_up';
  cases[cases.length - 1].expect.contains = ['тусгайлан дурдаагүй — хамаарах эсэхийг энэ заалт өөрөө тогтоогоогүй'];

  /* ── L2.1: нэр томьёо (1-р хавсралт) ──────────────────────────────── */
  const docExpl = ctx.docExpl;
  for (const d of (docExpl.definitions ?? []).slice(0, 6)) {
    add('terminology', `${code}-д «${d.term}» гэж юу вэ?`, { mode: 'definition', doc: code, definition_term: d.term, contains: [d.definition.slice(0, 40)] });
  }

  /* ── L2.1: шийдэгдээгүй ишлэл — холбоос ЗОХИОХГҮЙ ─────────────────── */
  // 2026-09-23: 5.6-ийн «2-р хүснэгт» нь «БНбД 22-01-01*/2006/-ийн 2-р хүснэгт» — ӨӨР баримтынх (build-l2 `ownerDoc`),
  //    шийдэгдээгүй ишлэл БИШ.  Хуучин L2-088-ийн байранд (id тогтвортой) гадаад ишлэлийн кейс.
  add('xref_external', `${ref(byUid.get(`${code}#5.6`))} ямар хүснэгт, заалт иш татсан бэ?`, exact(byUid.get(`${code}#5.6`), { contains: ['2-р хүснэгт (БНбД 22-01-01*/2006 — өөр баримтынх)'], external_target: '2' }));
  for (const r of recs.filter((x) => x.semantic_frame.cross_references.some((c) => c.resolution === 'unresolved'))) {
    const u = r.semantic_frame.cross_references.find((c) => c.resolution === 'unresolved');
    const label = u.kind === 'table' ? `${u.target}-р хүснэгт` : u.kind === 'appendix' ? `${u.target}-р хавсралт` : `${u.target} заалт`;
    add('xref_unresolved', `${ref(r)} ямар хүснэгт, заалт иш татсан бэ?`, exact(r, { contains: [`${label} (энэ баримтад олдсонгүй — шийдэгдээгүй ишлэл)`], unresolved_target: u.target }));
  }

  /* ── L2.1: семантик шалгагчийн adversarial кейс (retrieval биш — verifier) ─ */
  const sem = (name, uid, candidate, verdict, codeWanted = null) => add(`semantic_${name}`, `[verifier] ${uid}`, { verifier: true, clause_uid: uid, candidate, verdict, ...(codeWanted ? { code: codeWanted } : {}) });
  sem('negation_reversal', `${code}#1.2`, 'Өндөр барилгад шинэчлэлт, өөрчлөлт, их засвар хийхэд энэхүү норм ба дүрмийг хэрэглэнэ.', 'FAIL', 'REVERSED_NEGATION');
  sem('negation_reversal', `${code}#1.1`, 'Техникийн давхрын нийт талбай нь барилгажих талбайн 1/8-ээс хэтрэхгүй, өндөр нь 6м-ээс ихгүй байвал барилгын нийт өндрийн хэмжээ болон давхрын тоонд оруулна.', 'FAIL', 'REVERSED_NEGATION');
  sem('obligation_to_permission', `${code}#12.5`, 'Дулаан зогсоолын цахилгаан хангамжийг барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байлгаж болно.', 'FAIL', 'REQUIREMENT_TO_PERMISSION');
  sem('obligation_to_recommendation', `${code}#12.5`, 'Дулаан зогсоолын цахилгаан хангамжийг барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байлгах нь зүйтэй.', 'FAIL', 'REQUIREMENT_TO_RECOMMENDATION');
  sem('permission_to_obligation', `${code}#8.3`, 'Дамжуулах гол шугамын босоо шугамуудыг 2 болон түүнээс олон бүсэд зориулж заавал төлөвлөх ёстой.', 'FAIL', 'PERMISSION_TO_REQUIREMENT');
  sem('prohibition_to_permission', `${code}#8.13`, 'Хүйтэн, халуун усны гол түгээх шугам, галын босоо шугам болон цагираг шугамын холболтыг айлын өрөөний дундуур угсрахыг зөвшөөрнө.', 'FAIL', 'REVERSED_PROHIBITION');
  sem('lost_condition', `${code}#14.3`, 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс ихгүй байхаар зөвшөөрнө.', 'FAIL', 'LOST_CONDITION');
  sem('lost_condition', `${code}#4.15`, 'Гадна хана, фасадын дотор талд 1200 мм-ээс багагүй өндөртэй хашлага төлөвлөнө.', 'FAIL', 'LOST_CONDITION');
  sem('invented_condition', `${code}#5.2`, 'Орон сууцны өрөөний түр хамар ханын жин 1,0 кПа (100 кгс/м²)-аас их бол түүнд тэнцүү жигд тархсан нэмэлт ачаа гажуулна.', 'FAIL');
  sem('invented_condition', `${code}#12.5`, 'Хэрэв барилга 100 м-ээс өндөр бол дулаан зогсоолын цахилгаан хангамж нь тусдаа байх ёстой.', 'FAIL');
  sem('lost_exception', `${code}#1.1`, 'Техникийн давхрын нийт талбай, өндрийг барилгын нийт өндрийн хэмжээ болон давхрын тоонд оруулна.', 'FAIL');
  sem('invented_exception', `${code}#12.5`, 'Дулаан зогсоолын цахилгаан хангамж нь сууцны хэсгүүдийнхээс тусдаа байх ёстой, гэхдээ жижиг зогсоолоос бусад тохиолдолд.', 'FAIL');
  sem('changed_subject', `${code}#12.5`, 'Лифтний цахилгаан хангамж нь найдваржилтын I зэргийн дагуу барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байх ёстой.', 'FAIL', 'WRONG_SUBJECT');
  sem('changed_scope', `${code}#1.1`, 'Монгол Улсын нутаг дэвсгэрт баригдах бүх барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө.', 'FAIL', 'SCOPE_WIDENED');
  sem('changed_scope', `${code}#1.1`, 'Зөвхөн 35 давхар /150м/ хүртэлх өндөр барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө.', 'FAIL', 'SCOPE_NARROWED');
  sem('numeric_operator', `${code}#14.3`, 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс багагүй байх тохиолдолд зөвшөөрнө.', 'FAIL', 'WRONG_OPERATOR');
  sem('numeric_operator', `${code}#4.15`, 'Гадна хана, фасадыг нил шилэн ханаар хийх бол дотор талд нь 1200 мм-ээс ихгүй өндөртэй хашлага төлөвлөнө.', 'FAIL', 'WRONG_OPERATOR');
  sem('numeric_value', `${code}#14.3`, 'Өндөр барилгын байрлалыг галын депогоос 3 километрээс ихгүй байх тохиолдолд зөвшөөрнө.', 'FAIL', 'WRONG_NUMBER');
  sem('numeric_value', `${code}#4.6`, 'Өндөр барилгын гол орцын хөлийн өрөөний талбайг оргил ачаалалын үед цахилгаан шат хүлээх хугацаа 30.0-35 секунд байхаар тооцон тогтооно.', 'FAIL', 'WRONG_NUMBER');
  sem('unit_change', `${code}#4.6`, 'Өндөр барилгын гол орцын хөлийн өрөөний талбайг оргил ачаалалын үед олон нийтийн барилгад цахилгаан шат хүлээх хугацаа 30-35, орон сууц, зочид буудалд 40-60 байхаар тооцон тогтооно.', 'FAIL', 'WRONG_UNIT');
  sem('unit_change', `${code}#4.15`, 'Гадна хана, фасадыг нил шилэн ханаар хийх бол дотор талд нь 1200 см-ээс багагүй өндөртэй хашлага төлөвлөнө.', 'FAIL', 'WRONG_UNIT');
  sem('unsupported_rationale', `${code}#1.1`, '17 давхар /51м/-ээс 35 давхар /150м/ хүртэлх өндөр барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө, учир нь өндөр барилга галын аюул ихтэй.', 'FAIL', 'UNSUPPORTED_RATIONALE');
  sem('unsupported_status', `${code}#1.1`, 'Энэхүү норм ба дүрэм одоо хүчинтэй бөгөөд 17 давхар /51м/-ээс 35 давхар /150м/ хүртэлх өндөр барилгад мөрдөнө.', 'FAIL', 'UNSUPPORTED_STATUS');
  sem('misleading_simplification', `${code}#2.2`, 'Ишлэл авсан баримт бичгийн нэмэлт, өөрчлөлт шинэчлэл нь зөвхөн эхэд байгаа хэлбэрээр хэрэгжинэ.', 'FAIL');
  sem('misleading_simplification', `${code}#1.1`, 'Зураг төсөл зохиогчид энэ нормыг дагана; хоёр дахь хэсэг вэ?', 'FAIL', 'QUESTION_FRAGMENT');
  sem('unsupported_claim', `${code}#12.5`, 'Дулаан зогсоолын цахилгаан хангамжийг нарны хавтан, дизель генератороор нөөцлөх шаардлагатай.', 'FAIL', 'UNSUPPORTED_CLAIM');
  sem('foreign_code', `${code}#12.5`, 'Дулаан зогсоолын цахилгаан хангамж нь БНбД 43-101-03-ын дагуу тусдаа байх ёстой.', 'FAIL', 'FOREIGN_CODE');
  // Олон өгүүлбэрт заалтын шахалт — нөхцөл хадгалагдсан бол PASS, алдагдсан бол FAIL
  sem('multi_sentence_compression', `${code}#14.3`, 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс ихгүй байх тохиолдолд зөвшөөрнө. Хэрэв энэ зай хангагдахгүй мөн барилгын өндөр 100 метрээс давсан тохиолдолд галын депо эсвэл пост төлөвлөх шаардлагатай.', 'PASS');
  sem('multi_sentence_compression', `${code}#14.3`, 'Өндөр барилгыг галын депогоос 2 километрт байрлуулна; галын депо эсвэл пост төлөвлөх шаардлагатай.', 'FAIL');
  // Хавсралтын заалт (A8:8.3) — үнэнч / урвуу
  sem('appendix_context', `${code}#A8:8.3`, 'Хүйтэн, халуун усны тооцооны зардлыг «Барилга доторхи усан хангамж, ариутгах татуурга» /БНбД 40-05-98/ ба хүснэгт 8.1-ийн дагуу тодорхойлно.', 'PASS');
  sem('appendix_context', `${code}#A8:8.3`, 'Хүйтэн, халуун усны тооцооны зардлыг тодорхойлохгүй.', 'FAIL', 'REVERSED_NEGATION');
  // Үнэнч найруулга PASS (эхийн утга хадгалсан)
  sem('faithful_pass', `${code}#8.3`, 'Дамжуулах гол шугамын босоо шугамуудыг усан хангамжийн сонгосон схемээс хамаарч 2 болон түүнээс олон бүсэд зориулж төлөвлөж болно.', 'PASS');
  sem('faithful_pass', `${code}#1.2`, 'Өндөр барилгын шинэчлэлт, өөрчлөлт, их засвар хийхэд энэ заалтыг хэрэглэхгүй.', 'PASS');
  sem('faithful_pass', `${code}#2.2`, 'Ишлэл авсан баримт бичгүүдэд нэмэлт эсвэл өөрчлөлт хийсэн бол тус баримт бичгийг мөрдөнө.', 'PASS');
  sem('faithful_pass', `${code}#5.2`, 'Орон сууцны өрөөний түр хамар ханын жингээс үүсэх төвлөрсөн ачааллын хэмжээт утгыг 1,0 кПа (100 кгс/м²)-аас багагүй жигд тархсан нэмэлт ачаа болгон тооцохыг зөвшөөрнө.', 'PASS');
}
