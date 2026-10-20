/**
 * MGL AI · НОРМ-ЫН ЕРӨНХИЙ ОЙЛГОЛТ + ЗАСАГЛАЛЫН ЗАРЧИМ (NORM-INTEL v3, 2026-10-04).
 *
 * ⚠️ ЭНЭ БОЛ НОРМЫН БАРИМТЫН САН БИШ.  Эндээс ямар ч ТОО, ЗААЛТ, ХҮСНЭГТ, «заавал / доод / дээд» шаардлага
 *    ХЭЗЭЭ Ч гарахгүй.  Зөвхөн:
 *      (1) сэдвийн ЕРӨНХИЙ ойлголт — «утаанаас хамгаалагдсан шатны хонгил гэж юу вэ» (зорилго, санаа);
 *      (2) тэр сэдэвт хэрэглэгдэх эсэхийг ШИЙДЭХ оролтуудын жагсаалт (барилгын зориулалт, өндөр, ачаалал…);
 *      (3) нормын засаглалын ЗАРЧИМ — ноорог ≠ хүчинтэй, шинэ огноо ≠ хүчинтэй, зөрчил → шууд сонгохгүй.
 *    Тоон шаардлага, заалт нь ЗӨВХӨН баталгаажсан нотолгооноос (retrieval + currentness) гарна.
 *
 * ⚠️ `generalGuidance.test.ts` — бүх текст нь `validateNormIntel` generalOnly горимыг ХЯЗГААРГҮЙ давдаг (тоо, баттай
 *    модаль, зохиомол эшлэлгүй) гэдгийг шалгана.  Шинэ текст нэмэхдээ тэр тестийг ажиллуулна.
 */
import type { GovernanceKind } from './questionKind';

export type InputKey = 'building_use' | 'height_levels' | 'occupancy' | 'fire_strategy' | 'space_type' | 'structure' | 'door_use';

export const INPUT_LABEL: Record<InputKey, { mn: string; en: string }> = {
  building_use: { mn: 'барилгын зориулалт (орон сууц, оффис, сургууль, цэцэрлэг, эмнэлэг гэх мэт)', en: 'building use (residential, office, school, kindergarten, hospital…)' },
  height_levels: { mn: 'барилгын өндөр, давхрын тоо', en: 'building height and number of storeys' },
  occupancy: { mn: 'нэг давхарт/өрөөнд байх хүний тоо, ачаалал', en: 'number of occupants per floor or room' },
  fire_strategy: { mn: 'галын аюулгүй байдлын шийдэл (дохиолол, автомат гал унтраах, утаа хамгаалалтын систем)', en: 'fire-safety strategy (alarm, sprinklers, smoke control)' },
  space_type: { mn: 'тэр өрөө, орон зайн төрөл', en: 'the type of room or space' },
  structure: { mn: 'бүтээцийн систем, барилгын материал', en: 'structural system and materials' },
  door_use: { mn: 'хаалганы байршил, үүрэг (орц, эвакуацын гарц, дотор)', en: 'door location and role (entrance, escape, internal)' },
};

export interface TopicGuidance {
  id: string;
  labelMn: string;
  labelEn: string;
  /** Ерөнхий ойлголт — тоо, заалт, баттай шаардлагагүй. */
  conceptMn: string;
  conceptEn: string;
  /** Тэр сэдвийн шийдвэрт нөлөөлдөг оролтууд. */
  needs: InputKey[];
}

export const TOPIC_GUIDANCE: Record<string, TopicGuidance> = {
  high_rise: {
    id: 'high_rise', labelMn: 'өндөр барилга', labelEn: 'high-rise building',
    conceptMn: 'Өндөр барилгыг ихэвчлэн зөвхөн давхрын тоогоор бус, барилгын өндөр, зориулалт, галын аюулын шинж чанар зэргийг хамтад нь авч үзэж ангилдаг. Яг ямар хэмжүүрээр ангилдгийг хүчинтэй нормын бичвэр тодорхойлно.',
    conceptEn: 'A high-rise is usually classified by height, use and fire-risk characteristics together, not by the number of storeys alone. The exact criterion is set by the norm text in force.',
    needs: ['building_use', 'height_levels'],
  },
  evacuation: {
    id: 'evacuation', labelMn: 'эвакуаци, гарц', labelEn: 'evacuation and exits',
    conceptMn: 'Эвакуаци нь галын үед хүмүүсийг барилгын аюултай хэсгээс аюулгүй газар хүртэл түргэн хүргэх замын систем юм: гарц, коридор, шат бүгд нэг гинжин шугам болж ажиллана. Гарцын тоо, байрлал нь барилгын зориулалт, өндөр, хүний тооноос хамаарна.',
    conceptEn: 'Evacuation is the system of routes (exits, corridors, stairs) that takes people from a hazardous area to safety in a fire. The number and position of exits depend on use, height and occupancy.',
    needs: ['building_use', 'height_levels', 'occupancy'],
  },
  stairs: {
    id: 'stairs', labelMn: 'шат, шатны хонгил', labelEn: 'stairs and stairwells',
    conceptMn: 'Шатны хонгил нь давхруудыг холбохоос гадна галын үед хүмүүсийн гарах гол зам болдог тул утаа, галаас хамгаалах шаардлага бусад шатнаас өндөр байж болно. Шатны хэмжээс нь ашиглагчдын тоо, барилгын зориулалтаас хамаарна.',
    conceptEn: 'A stairwell connects floors and is also the main escape route in a fire, so its protection from smoke and fire can be stricter than for other stairs. Its dimensions depend on occupancy and use.',
    needs: ['building_use', 'height_levels', 'occupancy'],
  },
  smoke: {
    id: 'smoke', labelMn: 'утаа хамгаалалт', labelEn: 'smoke protection',
    conceptMn: 'Утаа хамгаалалт нь галын үед үүссэн утааг гарах зам, шатны хонгил руу орохоос сэргийлэх эсвэл гадагш гаргах шийдлүүдийн нэр юм. Жишээ нь агаар шахах, утаа соруулах, тамбур-шлюзээр тусгаарлах. Утаанаас хамгаалагдсан шатны хонгилын яг ямар төрөл Монголын нормд бий, аль барилгад аль нь хэрэгтэй гэдгийг хүчинтэй нормын бичвэрээс шалгана.',
    conceptEn: 'Smoke protection means solutions that keep smoke out of escape routes and stairwells or remove it, for example air pressurisation, smoke extraction or a protected lobby. Which types the Mongolian norm recognises, and where each is needed, must be read from the norm text in force.',
    needs: ['building_use', 'height_levels', 'fire_strategy'],
  },
  firefighter_lift: {
    id: 'firefighter_lift', labelMn: 'гал унтраагчийн лифт', labelEn: 'firefighter lift',
    conceptMn: 'Гал унтраах, аврах багийн лифт нь гал унтраагчид болон тоног төхөөрөмжийг дээд давхрууд руу хүргэхэд зориулагдсан, галын нөхцөлд ажиллахаар тусгайлан хамгаалагдсан лифт юм. Хэзээ, хэдэн ширхэг шаардлагатайг барилгын өндөр, зориулалтаар норм тодорхойлно.',
    conceptEn: 'A firefighter lift is a lift specially protected to keep working in a fire, used to bring firefighters and equipment to upper floors. When and how many are needed is set by the norm according to height and use.',
    needs: ['building_use', 'height_levels'],
  },
  fire_lift_use: {
    id: 'fire_lift_use', labelMn: 'галын үеийн лифт', labelEn: 'lifts during a fire',
    conceptMn: 'Галын үед ердийн зорчигчийн лифтээр хүн гаргахгүй байх нь инженерийн ерөнхий зарчим; харин галын үед ажиллахаар тусгайлан зохиосон лифтийн ашиглалтын нөхцөлийг хүчинтэй норм тодорхойлно.',
    conceptEn: 'As a general engineering principle ordinary passenger lifts are not used to evacuate people in a fire; the conditions for lifts designed to operate in a fire are set by the norm in force.',
    needs: ['building_use', 'height_levels'],
  },
  refuge: {
    id: 'refuge', labelMn: 'аюулгүй бүс, хоргодох талбай', labelEn: 'refuge area',
    conceptMn: 'Аюулгүй бүс (хоргодох талбай) нь өндөр барилгын галын үед хүмүүс гарахаас өмнө түр хамгаалагдаж хүлээх боломжтой, галаас тусгаарлагдсан талбай юм. Хэрэгцээ, хэмжээ нь барилгын өндөр, зориулалтаас хамаарна.',
    conceptEn: 'A refuge area is a fire-separated area where people can wait protected for a while before leaving a tall building in a fire. The need and size depend on height and use.',
    needs: ['building_use', 'height_levels', 'occupancy'],
  },
  compartment: {
    id: 'compartment', labelMn: 'галын тасалгаа', labelEn: 'fire compartment',
    conceptMn: 'Галын тасалгаа нь галыг барилгын нэг хэсэгт хязгаарлахын тулд галд тэсвэртэй хаалтаар тусгаарласан хэсэг юм. Хэмжээ, тусгаарлах хаалтын шаардлага нь зориулалт, галын аюулын ангилал, барилгын өндрөөс хамаарна.',
    conceptEn: 'A fire compartment is a part of a building separated by fire-resisting construction to contain fire. Its size and the separating construction depend on use, fire-hazard class and height.',
    needs: ['building_use', 'height_levels', 'fire_strategy'],
  },
  fire_resistance: {
    id: 'fire_resistance', labelMn: 'галын эсэргүүцлийн зэрэг', labelEn: 'fire resistance rating',
    conceptMn: 'Галын эсэргүүцлийн зэрэг нь барилгын элемент галын үед ачаалал даах, бүрэн бүтэн байх, дулаан дамжуулахгүй байх чадвараа хэр хугацаанд хадгалахыг илэрхийлдэг ангилал юм. Шаардлагатай зэргийг барилгын зориулалт, өндөр, бүтээцийн төрлөөс хамааруулан норм тогтооно.',
    conceptEn: 'A fire resistance rating expresses how long a building element keeps carrying load, staying intact and limiting heat transfer in a fire. The norm sets the needed rating by use, height and structural type.',
    needs: ['building_use', 'height_levels', 'structure'],
  },
  fire_door: {
    id: 'fire_door', labelMn: 'галын хаалга', labelEn: 'fire door',
    conceptMn: 'Галын хаалга нь галыг тусгаарлах хэсэгт суурилуулагддаг, галд тодорхой хугацаанд тэсвэрлэхээр баталгаажсан хаалга юм. Шаардлагатай ангилал нь хаалганы байршил, үүргээс хамаарна.',
    conceptEn: 'A fire door is a door certified to resist fire for a stated time where fire separation is needed. The required class depends on where the door is and what it does.',
    needs: ['building_use', 'space_type', 'door_use'],
  },
  fire_rating_class: {
    id: 'fire_rating_class', labelMn: 'EI ангилал', labelEn: 'EI classification',
    conceptMn: 'EI ангилал нь хаалт галын үед бүрэн бүтэн байх (E) ба нөгөө талдаа дулаан дамжуулахгүй байх (I) чадвараа хадгалах хугацааг илэрхийлдэг галын эсэргүүцлийн ангилал юм. Аль ангиллыг хаана ашиглахыг хүчинтэй нормоос шалгана.',
    conceptEn: 'The EI classification expresses how long a barrier keeps its integrity (E) and insulation (I) in a fire. Which class is used where must be checked in the norm in force.',
    needs: ['building_use', 'space_type', 'door_use'],
  },
  dead_end: {
    id: 'dead_end', labelMn: 'мухар коридор', labelEn: 'dead-end corridor',
    conceptMn: 'Мухар коридор нь галын үед зөвхөн нэг чиглэлд гарах боломжтой коридор тул тэр чиглэл гал, утаанд хаагдвал хүн хаягдах эрсдэлтэй. Иймээс ийм коридорын урт, зохион байгуулалтыг ихэвчлэн хязгаарладаг; яг хязгаарыг барилгын зориулалт, хүний тооноос хамааруулан норм тогтооно.',
    conceptEn: 'A dead-end corridor allows escape in one direction only, so people can be trapped if that way is blocked by fire or smoke; its length and layout are usually limited. The exact limit is set by the norm according to use and occupancy.',
    needs: ['building_use', 'occupancy', 'height_levels'],
  },
  corridor: {
    id: 'corridor', labelMn: 'коридор', labelEn: 'corridor',
    conceptMn: 'Коридорын өргөнийг тэр коридороор өнгөрөх хүний тоо, барилгын зориулалт, эвакуацын үеийн хүмүүсийн урсгал, хаалгын нээгдэх чиглэл зэргээс хамааруулан тодорхойлдог.',
    conceptEn: 'Corridor width is determined from the number of people using it, the building use, the evacuation flow and door swings.',
    needs: ['building_use', 'occupancy'],
  },
  handrail: {
    id: 'handrail', labelMn: 'хашлага, бариул', labelEn: 'handrail and guard',
    conceptMn: 'Хашлага, бариул нь шат, налуу замаар зорчихад тулгуур болж, уналтаас хамгаалдаг тул түүний өндөр, бат бөх байдлыг ашиглагчдын бүрэлдэхүүн (хүүхэд, хөгжлийн бэрхшээлтэй хүн), байршлаас хамааруулан норм тогтооно.',
    conceptEn: 'Handrails and guards give support on stairs and ramps and protect against falls, so their height and strength are set by the norm according to who uses them and where.',
    needs: ['building_use', 'space_type'],
  },
  ramp: {
    id: 'ramp', labelMn: 'налуу зам', labelEn: 'ramp',
    conceptMn: 'Налуу замын налуу нь хөдөлгөөний хүндрэл, аюулгүй байдалд шууд нөлөөлдөг тул ашиглагчид (тэргэнцэртэй хүн зэрэг), налуугийн урт, өргөнөөс хамаарч хязгаарлагддаг.',
    conceptEn: 'A ramp slope directly affects ease and safety of movement, so it is limited according to users (for example wheelchair users) and the length and width of the ramp.',
    needs: ['building_use', 'space_type'],
  },
  accessibility: {
    id: 'accessibility', labelMn: 'хүртээмжтэй орчин', labelEn: 'accessible environment',
    conceptMn: 'Хүртээмжтэй орчин гэдэг нь тэргэнцэр, таяг ашигладаг, хараа сонсголын бэрхшээлтэй хүн зэрэг бүх хэрэглэгч бусдын тусламжгүй, аюулгүй зорчиж, үйлчилгээ авах боломжтой орчин юм. Тодорхой хэмжээс, тоог барилгын зориулалтаас хамааруулан норм тогтооно.',
    conceptEn: 'An accessible environment lets every user, including wheelchair users and people with sensory impairments, move and use services safely without help. Specific dimensions and counts are set by the norm according to building use.',
    needs: ['building_use', 'space_type'],
  },
  accessible_parking: {
    id: 'accessible_parking', labelMn: 'хөгжлийн бэрхшээлтэй иргэний зогсоол', labelEn: 'accessible parking',
    conceptMn: 'Хөгжлийн бэрхшээлтэй иргэний зогсоол нь орох гарах хаалгатай ойр, тэргэнцрээр буух зайтай байхаар төлөвлөгддөг. Тоо, хэмжээ нь зогсоолын нийт багтаамж, барилгын зориулалтаас хамаарна.',
    conceptEn: 'Accessible parking is planned close to the entrance with room to transfer to a wheelchair. Count and size depend on total parking capacity and building use.',
    needs: ['building_use', 'occupancy'],
  },
  room_dims: {
    id: 'room_dims', labelMn: 'өрөөний хэмжээс', labelEn: 'room dimensions',
    conceptMn: 'Өрөөний доод талбай, хэмжээс нь тэр өрөөний үүрэг, ашиглагчийн тоо, тавилга, хөдөлгөөний зайг харгалзан тогтоогддог бөгөөд барилгын зориулалт, нормын хувилбараас хамаарч өөр байж болно.',
    conceptEn: 'Minimum room area and dimensions follow the room function, number of users, furniture and circulation space, and can differ by building use and norm edition.',
    needs: ['building_use', 'space_type'],
  },
  clear_width: {
    id: 'clear_width', labelMn: 'хаалганы цэвэр өргөн', labelEn: 'door clear width',
    conceptMn: 'Хаалганы цэвэр өргөн нь хаалга бүрэн нээгдсэний дараа бодитоор чөлөөтэй гарах өргөн юм; хаалганы нийт өргөнөөс ялгаатай. Шаардлагатай цэвэр өргөн хаалганы үүрэг, ашиглагчдаас хамаарна.',
    conceptEn: 'Door clear width is the actual free opening once the door is fully open, which differs from the overall door width. The needed clear width depends on the door role and its users.',
    needs: ['building_use', 'door_use'],
  },
  door_swing: {
    id: 'door_swing', labelMn: 'хаалганы нээгдэх чиглэл', labelEn: 'door swing direction',
    conceptMn: 'Хаалганы нээгдэх чиглэл нь хүн олноор гарах үед аюулгүй байдалд нөлөөлдөг. Гарах чиглэлд нээгдэх нь түгээмэл зарчим боловч аль хаалганд яг ямар чиглэл шаардлагатайг хүчинтэй норм тодорхойлно.',
    conceptEn: 'Door swing direction affects safety when many people leave at once. Opening in the direction of escape is a common principle, but which doors need which direction is set by the norm in force.',
    needs: ['building_use', 'occupancy', 'door_use'],
  },
  core_requirements: {
    id: 'core_requirements', labelMn: 'core-ийн шаардлага', labelEn: 'core planning',
    conceptMn: 'Core (цөм) нь лифт, шат, босоо инженерийн шугам, галын аюулгүй байдлын шийдлүүдийг нэг дор төвлөрүүлдэг тул түүний шаардлагууд эвакуаци, утаа хамгаалалт, лифт, бүтээцийн хөшүүн чанар зэрэг хэд хэдэн нормын хэсэгт хуваагдан байрладаг.',
    conceptEn: 'The core concentrates lifts, stairs, vertical services and fire-safety measures, so its requirements are spread across several parts of the norms: evacuation, smoke protection, lifts and structural stiffness.',
    needs: ['building_use', 'height_levels'],
  },
};

/** Асуултад хамгийн тохирох ЭХНИЙ сэдвийн заавар (олон сэдэвтэй бол жагсаалтын дарааллаар). */
export function guidanceFor(topics: readonly string[]): TopicGuidance[] {
  return topics.map((t) => TOPIC_GUIDANCE[t]).filter((g): g is TopicGuidance => g !== undefined);
}

/* ================================================================== */
/*  Нормын засаглалын зарчим — детерминист хариулт                      */
/* ================================================================== */

type Bi = { mn: string; en: string };

const CONFLICT_ORDER: Bi = {
  mn: 'Шалгах дараалал: (1) хоёр шаардлага тэр барилга, зориулалтад хамаарах эсэх (хамрах хүрээ); (2) хоёулаа хүчин төгөлдөр эсэх; (3) аль нэг баримт өөрөө давуу эрх, хамрах хүрээгээ тодорхой зааснаа шалгах; (4) тусгай зориулалтын шаардлага ерөнхий шаардлагыг нарийвчилж байгаа эсэх. Эдгээрээр шийдэгдэхгүй бол төслийн ахлагч, батлагч эсвэл эрх бүхий байгууллагаас албан ёсоор тодруулна.',
  en: 'Check in this order: (1) whether both requirements apply to this building and use (scope); (2) whether both are in force; (3) whether either document states its own precedence and scope; (4) whether the special-purpose requirement refines the general one. If this does not settle it, ask the design lead, the approver or the competent authority formally.',
};

export const GOVERNANCE: Record<GovernanceKind, Bi> = {
  newer_date_not_in_force: {
    mn: 'Үгүй. Баримтын огноо шинэ байх нь түүнийг хүчин төгөлдөр болгодоггүй: хүчин төгөлдөр байдлыг баримтыг батлан гаргасан эрх бүхий акт, албан ёсны бүртгэлээр (жишээ нь MCIS, legalinfo.mn) тодорхойлно. Шинэ огноотой ч ноорог эсвэл батлагдаагүй баримт хүчин төгөлдөр биш; MGL AI хүчинтэй гэж баталгаажаагүй баримтыг одоогийн шаардлага болгон ашиглахгүй.',
    en: 'No. A newer date does not make a document in force: legal status comes from the approving act and the official register (for example MCIS, legalinfo.mn). A draft or unapproved document with a newer date is not in force; MGL AI does not treat a document it could not verify as a current requirement.',
  },
  draft_vs_active: {
    mn: 'Ноорог (draft) баримт батлагдаж хүчин төгөлдөр болтол одоогийн шаардлага биш. Зөрчилдсөн тохиолдолд баталгаажсан, хүчин төгөлдөр баримтыг мөрдөнө; ноорогийг зөвхөн ирээдүйн өөрчлөлтийг мэдэх лавлагаа болгон ашиглаж болно. Аль нь хүчинтэй гэдгийг албан ёсны бүртгэлээс (MCIS, legalinfo.mn) баталгаажуулна уу.',
    en: 'A draft is not a current requirement until it is approved and enters into force. If they differ, the verified document in force applies; a draft may only be used as a reference for upcoming changes. Confirm which one is in force in the official register (MCIS, legalinfo.mn).',
  },
  how_to_verify_status: {
    mn: 'MGL AI нормын хүчин төгөлдөр байдлыг зөвхөн баталгаатай эх сурвалжаас шалгана: албан ёсны норм, стандартын бүртгэл (MCIS), legalinfo.mn болон баримтыг батлан гаргасан эрх бүхий байгууллагын акт. Бүртгэлээс олдоогүй эсвэл төлөв нь шалгагдаагүй баримтыг хүчинтэй гэж хэлэхгүй; төлөвийг ил тэмдэглэж, хүн шалгах шаардлагатайг сануулна.',
    en: 'MGL AI checks legal status only against verifiable sources: the official norm and standard register (MCIS), legalinfo.mn and the act of the approving authority. A document not found in the register, or whose status is unchecked, is not called current; the status is stated openly and a human check is flagged.',
  },
  superseded_citation: {
    mn: 'Үгүй, хуучин нормоос шаардлагыг одоогийн шаардлага болгон иш татаж болохгүй. Баримт шинэ баримтаар солигдсон бол хуучин нь түүхэн лавлагаа; хуучин заалтын шаардлага шинэ хүчинтэй баримтад адилхан байгаа нь тусад нь баталгаажаагүй бол ашиглахгүй. Шаардлагыг орлосон хүчинтэй баримтын эх бичвэрээс шалгаж иш татна.',
    en: 'No. A requirement from a superseded norm may not be cited as current. The old document is historical reference only, and its requirement is not used unless the replacing document independently confirms it. Cite the requirement from the text of the replacing document in force.',
  },
  amendment_check: {
    mn: 'Тийм. Нэмэлт, өөрчлөлт нь үндсэн баримтын тодорхой заалтыг өөрчилдөг тул үндсэн баримт хүчинтэй хэвээр байсан ч тэр заалтыг нэмэлт өөрчлөлтийн дараах байдлаар нь тусад нь шалгах шаардлагатай. Дараагийн нэмэлт өөрчлөлт шалгагдаагүй бол MGL AI үүнийг хариултад ил тэмдэглэнэ.',
    en: 'Yes. An amendment changes specific provisions of the base document, so even when the base document stays in force the provision must be checked separately in its amended form. When later amendments have not been verified, MGL AI states that openly in the answer.',
  },
  conflict_general_vs_special: { mn: `Зөрчилтэй шаардлагын аль нэгийг MGL AI шууд сонгохгүй. ${CONFLICT_ORDER.mn}`, en: `MGL AI does not pick one of two conflicting requirements on its own. ${CONFLICT_ORDER.en}` },
  conflict_two_valid: { mn: `Хоёр хүчинтэй баримтын шаардлага үнэхээр зөрчилдөж байвал MGL AI аль нэгийг шууд сонгохгүй. ${CONFLICT_ORDER.mn}`, en: `If two documents in force truly conflict, MGL AI does not pick one directly. ${CONFLICT_ORDER.en}` },
  conflict_generic: { mn: `Аль нь давуу вэ гэдгийг баримтуудын төлөв, хамрах хүрээ, тэдгээрийн өөрсдийн заасан давуу эрхээс тодорхойлдог тул MGL AI таамаглан сонгохгүй. ${CONFLICT_ORDER.mn}`, en: `Which one prevails depends on the documents' status, scope and any precedence they state themselves, so MGL AI does not guess. ${CONFLICT_ORDER.en}` },
  approximate_number: {
    mn: 'Үгүй. Яг заалт баталгаажаагүй үед MGL AI ойролцоогоор ч тоо хэлэхгүй: ойролцоо тоо нь аюулгүй байдал, нормын шаардлагад алдаа үүсгэж болзошгүй. Оронд нь ямар баримт, заалтыг шалгах, ямар оролт дутуу байгааг хэлнэ; баталгаажсан эх сурвалж олдсоны дараа яг утгыг эх сурвалжтай нь өгнө.',
    en: 'No. When the exact clause is not verified, MGL AI does not give an approximate number either: an approximation can cause errors in safety and compliance. It says which document and clause to check and which inputs are missing, and gives the exact value with its source once a verified source is found.',
  },
  precedent_approved: {
    mn: 'Үгүй. Өмнөх төсөл дээр ижил шийдэл батлагдсан нь энэ төсөл нормд нийцнэ гэсэн нотолгоо биш: хүчинтэй норм, барилгын зориулалт, өндөр, ачаалал, баримтын хувилбар төсөл бүрд өөр байж болно. Нийцлийг энэ төслийн нөхцөлөөр хүчинтэй нормын бичвэрээс тусад нь шалгана; өмнөх жишээг зөвхөн лавлагаа болгоно.',
    en: 'No. A solution approved on an earlier project does not prove this project complies: the norm in force, building use, height, load and document edition can differ from project to project. Compliance is checked separately for this project against the norm text in force; the earlier example is reference only.',
  },
  compliance_certificate: {
    mn: 'MGL AI нормд нийцсэн гэсэн баталгаа, дүгнэлт гаргахгүй: нийцлийг батлах нь эрх бүхий мэргэжилтэн, магадлагаа хийх этгээдийн албан ёсны шийдвэр юм. MGL AI зөвхөн баталгаажсан эх сурвалжийн шаардлагыг иш татаж, нийцлийг шалгахад ямар оролт дутууг хэлж чадна. Барилгын зориулалт, өндөр, ачаалал зэргийг хэлбэл шалгах шаардлагуудыг нэрлэж өгье.',
    en: 'MGL AI does not issue a statement that something complies with the norms: certifying compliance is the formal decision of a competent professional or the body doing the review. MGL AI can cite requirements from verified sources and say which inputs are missing for a check. Give the building use, height and load and it will name the requirements to check.',
  },
  historical_code_use: {
    mn: 'Хуучин (жишээ нь СНиП, ГОСТ) нормын дугаарыг хүчин төгөлдөр байдлыг нь баталгаажуулалгүй шууд ашиглахгүй. Тэр баримт солигдсон, хүчингүй болсон, эсвэл зөвхөн тодорхой хүрээнд мөрдөгдөж байж болно. Эхлээд албан ёсны бүртгэлээс (MCIS, legalinfo.mn) одоогийн төлөвийг шалгаж, орлосон баримт байвал түүнийг ашиглана.',
    en: 'A historical norm number (for example SNiP or GOST) is not used directly without verifying that it is still in force. The document may be superseded, repealed, or in force only in a limited scope. First check its current status in the official register (MCIS, legalinfo.mn) and use the replacing document if there is one.',
  },
  code_known_clause_missing: {
    mn: 'Нормын код мэдэгдэж байгаа ч заалт, хуудас олдоогүй бол MGL AI кодыг баталгаажсан хэмжээнд л дурдаж, заалтын агуулга, тоо, хуудсыг зохиохгүй: баримтыг таньсан, гэхдээ тэр заалтыг баталгаажуулж чадсангүй гэж ил хэлнэ. Зөв заалтын дугаар, хуудас эсвэл эх бичвэрийг өгвөл дахин шалгана.',
    en: 'When a norm code is known but the clause or page cannot be found, MGL AI mentions the code only as far as it is verified and does not invent clause content, numbers or pages: it says openly that the document was recognised but the clause could not be verified. Give the right clause number, page or text and it will check again.',
  },
};

/* ================================================================== */
/*  Төлөвийн ЗААВАР өгүүлбэрүүд (канон өгүүлбэрээс ГАДНА)               */
/* ================================================================== */

export const GENERAL_LABEL: Bi = {
  mn: 'Ерөнхий ойлголт (энэ нь норм биш, баталгаажсан шаардлага гэж ойлгохгүй):',
  en: 'General background (not the norm — do not read it as a verified requirement):',
};

export const NEXT_STEP: Record<'NO_VERIFIED_MATCH' | 'RETRIEVAL_UNAVAILABLE' | 'MISSING_APPLICABILITY_INPUT' | 'HUMAN_REVIEW_REQUIRED' | 'CURRENTNESS_UNVERIFIED', Bi> = {
  NO_VERIFIED_MATCH: {
    mn: 'Тиймээс тоо, заалт зохиохгүй. Яг шаардлагыг хүчинтэй нормын бичвэрээс шалгах хэрэгтэй.',
    en: 'So no numbers or clauses are invented. The exact requirement has to be checked in the norm text in force.',
  },
  RETRIEVAL_UNAVAILABLE: {
    mn: 'Хайлт сэргэсний дараа дахин асуугаарай; тэр хүртэл тоо, заалт хэлэхгүй.',
    en: 'Please ask again once search is back; until then no numbers or clauses are given.',
  },
  MISSING_APPLICABILITY_INPUT: {
    mn: 'Эдгээрийг мэдэж байж л шаардлага энэ тохиолдолд хамаарах эсэхийг шийднэ.',
    en: 'Only with these can it be decided whether the requirement applies to this case.',
  },
  HUMAN_REVIEW_REQUIRED: {
    mn: 'Хүн эх бичвэрийг шалгаж баталгаажуултал баттай шийдвэр гаргахгүй.',
    en: 'No firm decision is given until a person verifies the source text.',
  },
  CURRENTNESS_UNVERIFIED: {
    mn: 'Хүчинтэй хувилбарыг албан ёсны бүртгэлээс (MCIS, legalinfo.mn) баталгаажуулсны дараа шаардлагыг хэлнэ.',
    en: 'The requirement can be stated once the version in force is confirmed in the official register (MCIS, legalinfo.mn).',
  },
};

export const NEEDS_INTRO: Bi = {
  mn: 'Яг заалтыг хайж баталгаажуулахад дараах мэдээлэл хэрэгтэй:',
  en: 'To look up and verify the exact clause, these are needed:',
};

export const MISSING_INTRO: Bi = {
  mn: 'Холбогдох заалт олдсон боловч яг энэ тохиолдолд хамаарах эсэхийг шийдэхэд дараах мэдээлэл дутуу байна:',
  en: 'A relevant clause was found, but these inputs are missing to decide whether it applies here:',
};
