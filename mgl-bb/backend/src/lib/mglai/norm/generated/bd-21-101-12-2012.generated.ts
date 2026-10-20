/**
 * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.
 *    БД 21-101-12 · багц mgl-ai-bd-21-101-12@0.2.0 · dataset sha256 0f0c659df63f8f592f2a8153b7bf09933a3da1a4419c8093c68c386e6f428813
 *    Дахин үүсгэх: cd ai && npm run ai:norm:generate   (шалгах: -- --check)
 *    Үүсгэгч: mgl-norm-compiler/1 · адаптер: bd-21-101-12/1
 */
import type { CompiledDocument } from '../registryTypes';
export const NORM_DOC_BD_21_101_12_2012: CompiledDocument = {
  "cases": [
    {
      "caseId": "R001",
      "expected": {
        "room_category": "А"
      },
      "inputs": {
        "explosion_overpressure_kpa": 7,
        "flash_point_c": 25,
        "medium": "flammable_liquid_vapor"
      },
      "page": 4,
      "queryEn": "A room contains vapor from a liquid with flash point 25 C and calculated explosion overpressure 7 kPa. What category?",
      "queryLatin": "Uruund 25C avaltsan asakh khemtei shingenii uuryn tesreltiin iluudel daralt 7 kPa garval yamar angilal ve?",
      "queryMn": "Өрөөнд 25°C авалцан асах хэмтэй шингэний уурын тэсрэлтийн илүүдэл даралт 7 кПа гарвал ямар ангилал вэ?",
      "recordId": "BD-21-101-12-2012:room:A:gas_liquid"
    },
    {
      "caseId": "R002",
      "expected": {
        "room_category": "Б"
      },
      "inputs": {
        "explosion_overpressure_kpa": 8,
        "flash_point_c": 35,
        "medium": "flammable_liquid"
      },
      "page": 4,
      "queryEn": "A combustible liquid has flash point 35 C and vapor explosion overpressure 8 kPa. What room category?",
      "queryLatin": "35C avaltsan asakh khemtei shatamkhai shingenees uusakh agaar-uuriin kholimgiin delta P 8 kPa bol uruu yamar angilal ve?",
      "queryMn": "35°C авалцан асах хэмтэй шатамхай шингэнээс үүсэх агаар-уурын холимгийн ΔP 8 кПа бол өрөө ямар ангилал вэ?",
      "recordId": "BD-21-101-12-2012:room:B:dust_liquid"
    },
    {
      "caseId": "R003",
      "expected": {
        "room_category": "В1"
      },
      "inputs": {
        "g_mj_m2": 2500
      },
      "page": 13,
      "queryEn": "If specific fire load is 2500 MJ/m2, which V subcategory applies?",
      "queryLatin": "Khuviin galyn achaalal 2500 MJ/m2 bol V angillyn ali ded angilal ve?",
      "queryMn": "Хувийн галын ачаалал 2500 МДж/м² бол В ангиллын аль дэд ангилал вэ?",
      "recordId": "BD-21-101-12-2012:room:V1:g"
    },
    {
      "caseId": "R004",
      "expected": {
        "requires_4_20_upgrade_check": true,
        "room_category": "В2"
      },
      "inputs": {
        "g_mj_m2": 1800
      },
      "page": 13,
      "queryEn": "What is the initial V subcategory at a specific fire load of 1800 MJ/m2?",
      "queryLatin": "Khuviin galyn achaalal 1800 MJ/m2 bol ekhnii angilal yu ve?",
      "queryMn": "Хувийн галын ачаалал 1800 МДж/м² бол эхний ангилал юу вэ?",
      "recordId": "BD-21-101-12-2012:room:V2:g"
    },
    {
      "caseId": "R005",
      "expected": {
        "requires_4_20_upgrade_check": true,
        "room_category": "В3"
      },
      "inputs": {
        "g_mj_m2": 500
      },
      "page": 13,
      "queryEn": "Which V category applies at 500 MJ/m2 specific fire load?",
      "queryLatin": "Khuviin galyn achaalal 500 MJ/m2 bol ali angilal ve?",
      "queryMn": "Хувийн галын ачаалал 500 МДж/м² бол аль ангилал вэ?",
      "recordId": "BD-21-101-12-2012:room:V3:g"
    },
    {
      "caseId": "R006",
      "expected": {
        "requires_spacing_check": true,
        "room_category": "В4"
      },
      "inputs": {
        "g_mj_m2": 100
      },
      "page": 13,
      "queryEn": "Which V category applies at 100 MJ/m2?",
      "queryLatin": "Khuviin galyn achaalal 100 MJ/m2 bol ali angilal ve?",
      "queryMn": "Хувийн галын ачаалал 100 МДж/м² бол аль ангилал вэ?",
      "recordId": "BD-21-101-12-2012:room:V4:g"
    },
    {
      "caseId": "C001",
      "expected": {
        "g_MJ_m2": 900
      },
      "inputs": {
        "Q_MJ": 18000,
        "S_m2": 20
      },
      "page": 13,
      "queryEn": "If Q=18000 MJ and S=20 m2, what is the specific fire load?",
      "queryLatin": "Galyn achaalal Q=18000 MJ, talbai S=20 m2 bol khuviin galyn achaalal khed ve?",
      "queryMn": "Галын ачаалал Q=18000 МДж, талбай S=20 м² бол хувийн галын ачаалал хэд вэ?",
      "recordId": "BD-21-101-12-2012:4.20:22"
    },
    {
      "caseId": "C002",
      "expected": {
        "min_spacing_m": 18
      },
      "inputs": {
        "H_m": 8
      },
      "page": 15,
      "queryEn": "For flammable liquid fire load sections with H=8 m, what minimum spacing is required?",
      "queryLatin": "H=8 m ued khyalbar avaltsan asakh shingenii galyn achaallyn khesguudiin khamgiin baga zai khed ve?",
      "queryMn": "H=8 м үед хялбар авалцан асах шингэний галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?",
      "recordId": "BD-21-101-12-2012:4.20:24"
    },
    {
      "caseId": "C003",
      "expected": {
        "min_spacing_m": 15
      },
      "inputs": {
        "H_m": 12
      },
      "page": 14,
      "queryEn": "For H=12 m, what minimum spacing is required between flammable liquid fire-load sections?",
      "queryLatin": "H=12 m ued khyalbar avaltsan asakh shingenii galyn achaallyn khesguudiin khamgiin baga zai khed ve?",
      "queryMn": "H=12 м үед хялбар авалцан асах шингэний галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?",
      "recordId": "BD-21-101-12-2012:4.20:23"
    },
    {
      "caseId": "C004",
      "expected": {
        "threshold_MJ": 2560,
        "upgrade_required": true
      },
      "inputs": {
        "H_m": 2,
        "Q_MJ": 5000,
        "g_MJ_m2": 1000
      },
      "page": 15,
      "queryEn": "Does Q=5000 MJ satisfy Q >= 0.64*g*H^2 when g=1000 MJ/m2 and H=2 m?",
      "queryLatin": "Q=5000 MJ, g=1000 MJ/m2, H=2 m bol Q >= 0.64gH2 nukhtsul bielekh uu?",
      "queryMn": "Q=5000 МДж, g=1000 МДж/м², H=2 м бол Q ≥ 0.64gH² нөхцөл биелэх үү?",
      "recordId": "BD-21-101-12-2012:4.20:upgrade"
    },
    {
      "caseId": "C005",
      "expected": {
        "Va_m3": 20
      },
      "inputs": {
        "P1_kPa": 200,
        "V_m3": 10
      },
      "page": 8,
      "queryEn": "If apparatus pressure is 200 kPa and volume is 10 m3, what is Va?",
      "queryLatin": "Apparatyn daralt 200 kPa, ezlekhun 10 m3 bol Va khed ve?",
      "queryMn": "Аппаратын даралт 200 кПа, эзлэхүүн 10 м³ бол V_a хэд вэ?",
      "recordId": "BD-21-101-12-2012:4.8:7"
    },
    {
      "caseId": "C006",
      "expected": {
        "closure_time_s": 120
      },
      "inputs": {
        "failure_probability_per_year": 0.000002,
        "manual": false,
        "redundant": false
      },
      "page": 5,
      "queryEn": "If automatic shutoff failure probability is 0.000002/year and there is no redundant system, what closure time is used?",
      "queryLatin": "Avtomat khaaltyn sistemiin ajillagaagui bolokh magadlal 0.000002/jil, nuuts sistemgui bol khaakh khugatsaag khedээр avakh ve?",
      "queryMn": "Автомат хаалтын системийн ажиллагаагүй болох магадлал 0.000002/жил, нөөц системгүй бол хаах хугацааг хэдээр авах вэ?",
      "recordId": "BD-21-101-12-2012:clause:4.2.valve"
    },
    {
      "caseId": "C007",
      "expected": {
        "closure_time_s": 300
      },
      "inputs": {
        "manual": true
      },
      "page": 5,
      "queryEn": "What closure time is used for manual shutoff?",
      "queryLatin": "Garaar khaakh shugam khooloin tootsoot khaakh khugatsaa khed ve?",
      "queryMn": "Гараар хаах шугам хоолойн тооцоот хаах хугацаа хэд вэ?",
      "recordId": "BD-21-101-12-2012:clause:4.2.valve"
    },
    {
      "caseId": "C008",
      "expected": {
        "free_volume_m3": 400
      },
      "inputs": {
        "equipment_volume_known": false,
        "geometric_volume_m3": 500
      },
      "page": 6,
      "queryEn": "If room geometric volume is 500 m3 and equipment occupied volume cannot be determined, what free volume is used?",
      "queryLatin": "Uruunii niit ezlekhun 500 m3, tonog tukhuurumjiin ezlekhuniig tootsoh bolomjgui bol chuluut ezlekhuniig khed gej avakh ve?",
      "queryMn": "Өрөөний нийт эзлэхүүн 500 м³, тоног төхөөрөмжийн эзлэхүүнийг тооцох боломжгүй бол чөлөөт эзлэхүүнийг хэд гэж авах вэ?",
      "recordId": "BD-21-101-12-2012:clause:4.4"
    }
  ],
  "clauses": [
    {
      "chunkId": "BD-21-101-12-2012:clause:intro.scope",
      "kind": "clause",
      "page": 3,
      "section": "Удиртгал",
      "textMn": "Дүрэм нь үйлдвэрлэлийн технологийн процессоос шалтгаалан үйлдвэрлэлд хэрэглэх, хадгалах бодис материал, эд зүйлийн шатах, тэсрэх аюулын хэмжээнээс хамааран үйлдвэрийн ба агуулахын зориулалттай барилга, өрөө тасалгааны галын болон тэсэрч шатах аюулын ангиллыг тодорхойлох аргачлалыг тогтооно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:intro.exclusion",
      "kind": "clause",
      "page": 3,
      "section": "Удиртгал",
      "textMn": "Тэсэрч дэлбэрэх бодис, материалын үйлдвэр, түүнийг хадгалах агуулахын барилга, өрөө тасалгаанд тавигдах шаардлагад энэхүү дүрэм хамаарахгүй.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:1.1",
      "kind": "clause",
      "page": 3,
      "section": "1. Ерөнхий зүйл",
      "textMn": "Үйлдвэрийн барилгын өрөө тасалгааг төлөвлөхдөө тэсэрч шатах галын аюулын ангиллыг дагуу төсөллөж, бусад холбогдох баримт бичиг, технологийн тусгай шаардлагад нийцүүлнэ.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:1.2",
      "kind": "clause",
      "page": 3,
      "section": "1. Ерөнхий зүйл",
      "textMn": "Барилга, өрөө тасалгааны тэсрэх, шатах галын аюулын ангиллыг А, Б, В1-В4, Г, Д гэж ангилна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:1.3",
      "kind": "clause",
      "page": 3,
      "section": "1. Ерөнхий зүйл",
      "textMn": "Ангиллыг өрөө тасалгаа, тоног төхөөрөмж дэх шатамхай бодис, материалын хэмжээ, төрөл зүйлээс хамааран шатах, тэсрэх хамгийн эрсдэлтэй нөхцлөөр тооцож тогтооно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:1.4",
      "kind": "clause",
      "page": 3,
      "section": "1. Ерөнхий зүйл",
      "textMn": "Бодис, материал, эд зүйлийн галын аюулын шинж чанарыг тухайн орчны агаарын даралт, температурын нөхцөлд батлагдсан туршилтын үр дүнгээр ашиглана.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:2",
      "kind": "clause",
      "page": 4,
      "section": "2. Нэр томьёо ба тодорхойлолт",
      "textMn": "Дүрэмд БНбД 21-01-02, БНбД 21-02-02 болон MNS 4284:1995-д иш татсан нэр томьёог ашигласан.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:3.1",
      "kind": "clause",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "Өрөө тасалгааны тэсрэх, шатах галын аюулын ангиллыг хүснэгт 1-ээр тодорхойлно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.1",
      "kind": "clause",
      "page": 5,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Тэсэрч шатах галын аюулыг тодорхойлох тооцооны үзүүлэлтийг сонгохдоо тоног төхөөрөмжид гарч болох хамгийн аюултай осол эсвэл жирийн ажиллагааны үед хамгийн их хохирол учруулж болох хувилбараар бодож сонгоно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.2",
      "kind": "clause",
      "page": 5,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Өрөө тасалгаанд тэсэрч дэлбэрэх аюултай агаар-хий болон агаар-уурын холимог бий болох хэмжээг урьдчилсан нөхцөлөөр тодорхойлно: хамгийн аюултай осол/ажиллагааны нөхцөл, тоног төхөөрөмж дэх бодис алдагдах, шугам хоолойгоос хаалт хүртэл алдагдах, асгарсан шингэн уурших, нээлттэй сав/будсан гадаргуугаас уурших, бүрэн ууршилтын хугацааг ихдээ 3600 секундээр авах.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.2.valve",
      "kind": "clause",
      "page": 5,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Шугам хоолойг хаах тооцоот хугацаа: автомат системийн ажиллагаагүй болох магадлал жилд 0.000001-ээс бага ба нөөц хангалттай бол техникийн паспортын хугацаа; магадлал 0.000001-ээс их ба нөөцгүй бол 120 секунд; гараар хаах бол 300 секунд.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.2.spill",
      "kind": "clause",
      "page": 6,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Асгарсан шингэний ууршилтын талбайн лавлах үзүүлэлтгүй бол жингийн 70 хүртэл хувийг уусгагч эзэлсэн 1 л холимог ба уусмалыг 0.5 м² талбайд, бусад шингэнийг 1 м² талбайд асгарсан гэж тооцно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.4",
      "kind": "clause",
      "page": 6,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Өрөөний чөлөөт багтаамж нь нийт багтаамжаас тоног төхөөрөмжийн эзлэх зайг хассан хэмжээ. Тооцох боломжгүй бол геометрийн багтаамжийн 80%-ийг авна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.7",
      "kind": "clause",
      "page": 8,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Ослын агааржуулалттай үед шатамхай хий, хялбар авалцан асах болон шатамхай шингэний уурын ослын тооцоот жинг бууруулах коэффициент K=A*T+1 ашиглаж болно, хэрэв агааржуулалт шаардлагатай найдвартай байдалтай, нөөцтэй, тэсрэлт үүсэх байрлалд I ангиллын хамгаалалттай цахилгаан хангамжтай бол.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.19",
      "kind": "clause",
      "page": 12,
      "section": "4. Тооцооны аргачлал",
      "textMn": "В1-В4 өрөөний ангиллыг тогтоохдоо өрөөний галын ачааллын нэгж талбай дахь хамгийн их хувийн утгыг хүснэгт 4-ийн ангиллын утгатай харьцуулна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.20",
      "kind": "clause",
      "page": 13,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Галын ачаалал Q = Σ G_i Q_Hi^p; хувийн галын ачаалал g=Q/S, энд S нь галын ачааллын байрлалын талбай бөгөөд 10 м²-аас багагүй.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.20.b4",
      "kind": "clause",
      "page": 13,
      "section": "4. Тооцооны аргачлал",
      "textMn": "В4 ангиллын өрөөнд галын ачааллын хэсгүүдийн хоорондын зай нь хүснэгт 5-д заасан хязгаарын зайгаас их байна. qкр тодорхойгүй бол lхя ≥ 12 м гэж авна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.20.liquid_spacing",
      "kind": "clause",
      "page": 14,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Хялбар авалцан асах болон шатамхай шингэний хувьд галын ачааллын хэсгүүдийн хоорондын хязгаарын зай: H≥11 үед lхя≥15 м; H<11 үед lхя≥26-H.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.20.upgrade",
      "kind": "clause",
      "page": 15,
      "section": "4. Тооцооны аргачлал",
      "textMn": "В2 ба В3 ангиллыг тодорхойлоход галын ачааллын хэмжээ Q ≥ 0.64 g H² нөхцөлийг хангах үед өрөөг дээд ангилал руу шилжүүлэх нөхцөл үйлчилнэ.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.21",
      "kind": "clause",
      "page": 15,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Агаарын хүчилтөрөгч, ус болон өөр хоорондоо урвалд орсноос тэсрэх/шатах бодисын тэсрэлтийн илүүдэл даралтыг тогтоохдоо Z=1, H_T-г эцсийн байдлын харилцан үйлчлэлээр тооцож, ΔP тогтоох боломжгүй бол 5 кПа-аас их гэж авна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:4.22",
      "kind": "clause",
      "page": 15,
      "section": "4. Тооцооны аргачлал",
      "textMn": "Шатамхай хий/уур болон тоос агуулсан шатамхай холимгийн тэсрэлтийн тооцооны илүүдэл даралт ΔP=ΔP1+ΔP2.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:clause:5.5",
      "kind": "clause",
      "page": 16,
      "section": "5. Барилгын ангилал",
      "textMn": "Барилга нь А, Б, В, Г ангилалд хамаарахгүй бол Д ангилалд хамаарна.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:A:gas_liquid",
      "kind": "classification_rule",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "Агаар-хий/уурын холимог шатахад тооцоогоор 5 кПа-аас илүү илүүдэл даралт үүсгэх хэмжээтэй, авалцан асах хэм 28°C-аас бага шатамхай хий ба хялбар авалцан асах шингэн; эсвэл ус, агаарын хүчилтөрөгч, өөр хоорондоо урвалд орж 5 кПа-аас илүү илүүдэл даралт үүсгэх бодис материал.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:B:dust_liquid",
      "kind": "classification_rule",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "Агаар-тоосны эсвэл агаар-уурын холимог шатахад 5 кПа-аас илүү илүүдэл даралт үүсгэх хэмжээ бүхий шатах тоос/хивэгдэс, эсвэл авалцан асах хэм 28°C-аас их хялбар авалцан асах/шатамхай шингэн.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:V:combustible_material",
      "kind": "classification_rule",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "А, Б ангилалд хамаарахгүй боловч агаарын хүчилтөрөгч, ус, өөр бодистой харилцан үйлчлэхэд шатдаг, шатамхай болон тэсвэрлэн шатдаг шингэн, хатуу бодис материал, тоос, хивэгдэс агуулсан өрөө.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:G",
      "kind": "classification_rule",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "Халуун, улайссан эсвэл хайлсан байдалдаа илч, оч, дөл ялгаруулдаг шатдаггүй бодис материал; эсвэл түлш болгон шатаах эсвэл өөрөөр ашигладаг шатамхай шингэн, хий, хатуу бодис материал.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:D",
      "kind": "classification_rule",
      "page": 4,
      "section": "3. Өрөө тасалгааны ангилал",
      "textMn": "Хүйтэн байдалд байгаа шатдаггүй бодис материал, эд зүйл.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:V1:g",
      "kind": "classification_rule",
      "page": 13,
      "section": "Хүснэгт 4",
      "textMn": "В1 ангилал: хувийн галын ачаалал g >2200 МДж/м² (Хүснэгт 4); арга: нормчлохгүй.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:V2:g",
      "kind": "classification_rule",
      "page": 13,
      "section": "Хүснэгт 4",
      "textMn": "В2 ангилал: хувийн галын ачаалал g = 1401–2200 МДж/м² (Хүснэгт 4); арга: 4.20-д заасан.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:V3:g",
      "kind": "classification_rule",
      "page": 13,
      "section": "Хүснэгт 4",
      "textMn": "В3 ангилал: хувийн галын ачаалал g = 181–1400 МДж/м² (Хүснэгт 4); арга: 4.20-д заасан.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:room:V4:g",
      "kind": "classification_rule",
      "page": 13,
      "section": "Хүснэгт 4",
      "textMn": "В4 ангилал: хувийн галын ачаалал g = 1–180 МДж/м² (Хүснэгт 4); арга: 10 м² талбайтай өрөөний дурын нэг хэсэг; галын ачааллын талбайг 4.20-оор сонгоно.",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:building:A",
      "kind": "building_classification_rule",
      "page": 15,
      "section": "5.1",
      "textMn": "Барилгын А ангиллын дүрэм. {\"any\": [{\"category_area_share_pct\": {\"category\": \"А\", \"gt\": 5}}, {\"category_area_m2\": {\"category\": \"А\", \"gte\": 200}}]}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:building:B",
      "kind": "building_classification_rule",
      "page": 15,
      "section": "5.2",
      "textMn": "Барилгын Б ангиллын дүрэм. {\"all\": [{\"not_building_category\": \"А\"}, {\"any\": [{\"combined_area_share_pct\": {\"categories\": [\"А\", \"Б\"], \"gt\": 5}}, {\"combined_area_m2\": {\"categories\": [\"А\", \"Б\"], \"gte\": 200}}]}]}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:building:V",
      "kind": "building_classification_rule",
      "page": 16,
      "section": "5.3",
      "textMn": "Барилгын В ангиллын дүрэм. Барилга нь А, Б ангилалд хамаарахгүй; А, Б ба В ангиллын өрөө тасалгааны талбай нь нийт талбайн 5% ... (хэрэв А, Б өрөөгүй бол 10%).",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:building:G",
      "kind": "building_classification_rule",
      "page": 16,
      "section": "5.4",
      "textMn": "Барилгын Г ангиллын дүрэм. Барилга нь А, Б, В ангилалд хамаарахгүй; А, Б, В ба Г ангиллын өрөө тасалгааны талбай нь нийт талбайн 5% ...",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:building:D",
      "kind": "building_classification_rule",
      "page": 16,
      "section": "5.5",
      "textMn": "Барилгын Д ангиллын дүрэм. {\"all\": [{\"not_building_category\": [\"А\", \"Б\", \"В\", \"Г\"]}]}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.5:1",
      "kind": "formula",
      "page": 6,
      "section": "4.5",
      "textMn": "C,H,O,N,Cl,Br,I,F агуулсан шатамхай бодисын тэсрэлтийн илүүдэл даралт. Томьёо: \\Delta P=(P_{max}-P_0)\\frac{mZ}{V_{free}\\rho_{g,p}}\\frac{100}{C_{st}}\\frac{1}{K_H}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.5:2",
      "kind": "formula",
      "page": 7,
      "section": "4.5",
      "textMn": "Хий, уурын нягт. Томьёо: \\rho_{g,p}=\\frac{M}{V_0(1+0.00367t_p)}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.5:3",
      "kind": "formula",
      "page": 7,
      "section": "4.5",
      "textMn": "Стехиометрийн эзлэхүүний хувь. Томьёо: C_{st}=\\frac{100}{1+4.84\\beta},\\quad \\beta=n_C+\\frac{n_H-n_X}{4}-\\frac{n_O}{2}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.6:4",
      "kind": "formula",
      "page": 8,
      "section": "4.6",
      "textMn": "4.5-д хамаарахгүй бодис/холимгийн тэсрэлтийн илүүдэл даралт. Томьёо: \\Delta P=\\frac{mH_TP_0Z}{V_{free}\\rho_{air}C_pT_0K_H}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.7:5",
      "kind": "formula",
      "page": 8,
      "section": "4.7",
      "textMn": "Ослын агааржуулалтын бууруулах коэффициент. Томьёо: K=AT+1",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.8:6",
      "kind": "formula",
      "page": 8,
      "section": "4.8",
      "textMn": "Ослын үед өрөөнд орж ирэх тооцоот хий. Томьёо: \\tau=(V_a+V_T)\\rho_g",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.8:7",
      "kind": "formula",
      "page": 8,
      "section": "4.8",
      "textMn": "Аппаратаас гарах хийн эзлэхүүн. Томьёо: V_a=0.01P_1V",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.8:8",
      "kind": "formula",
      "page": 8,
      "section": "4.8",
      "textMn": "Дамжуулах хоолойноос гарах хийн нийт эзлэхүүн. Томьёо: V_T=V_{1T}+V_{2T}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.8:9",
      "kind": "formula",
      "page": 9,
      "section": "4.8",
      "textMn": "Хаахаас өмнө шугам хоолойноос гарах хий. Томьёо: V_{1T}=qT",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.8:10",
      "kind": "formula",
      "page": 9,
      "section": "4.8",
      "textMn": "Хааснаас хойш хоолойноос гарах хий. Томьёо: V_{2T}=0.01\\pi P_2(r_1^2L_1+r_2^2L_2+\\cdots+r_n^2L_n)",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.9:11",
      "kind": "formula",
      "page": 9,
      "section": "4.9",
      "textMn": "Өрөөнд үүсэх шингэний уурын тооцоот хэмжээ. Томьёо: \\tau=\\tau_x+\\tau_{ca}+\\tau_y",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.9:12",
      "kind": "formula",
      "page": 9,
      "section": "4.9",
      "textMn": "Ууршсан шингэний жин. Томьёо: m=WF_uT",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.11:13",
      "kind": "formula",
      "page": 10,
      "section": "4.11",
      "textMn": "Ууршилтын идэвхи. Томьёо: W=10^{-6}\\eta\\sqrt{MP_H}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.12:14",
      "kind": "formula",
      "page": 10,
      "section": "4.12",
      "textMn": "Тоосонцрын тэсрэлтэд оролцох итгэлцүүр. Томьёо: Z=0.5F",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.13:15",
      "kind": "formula",
      "page": 10,
      "section": "4.13",
      "textMn": "Ослын үед өрөөнд тархсан тоосонцрын тооцооны жин. Томьёо: \\tau=\\tau_{xy}+\\tau_{oc}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.14:16",
      "kind": "formula",
      "page": 10,
      "section": "4.14",
      "textMn": "Хуйларсан тоосонцрын тооцооны жин. Томьёо: \\tau_{xy}=K_{xy}\\tau_{\\theta}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.15:17",
      "kind": "formula",
      "page": 11,
      "section": "4.15",
      "textMn": "Ослын нөхцлөөс үүсэх тоосны тооцооны хэмжээ. Томьёо: \\tau_{oc}=(\\tau_{ap}+qT)K_{\\theta}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.16:18",
      "kind": "formula",
      "page": 11,
      "section": "4.16",
      "textMn": "Осол болох үед өрөөнд хуримтлагдсан тоос. Томьёо: m_n=\\frac{K_r}{K_y}(m_1+m_2)",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.17:19",
      "kind": "formula",
      "page": 12,
      "section": "4.17",
      "textMn": "Тодорхой хугацаанд талбай дээрх тоосны хэмжээ. Томьёо: m_i=M_i(1-\\alpha)\\beta_i,\\quad i=1,2",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.18:20",
      "kind": "formula",
      "page": 12,
      "section": "4.18",
      "textMn": "Тоног төхөөрөмжийн хамгийн их ачааллын үеийн хуримтлагдах тоос. Томьёо: M_i=\\sum_j(G_{ij}F_{ij})t_i,\\quad i=1,2",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.20:21",
      "kind": "formula",
      "page": 13,
      "section": "4.20",
      "textMn": "Галын ачаалал. Томьёо: Q=\\sum_{i=1}^{n}G_iQ_{Hi}^{p}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.20:22",
      "kind": "formula",
      "page": 13,
      "section": "4.20",
      "textMn": "Хувийн галын ачаалал. Томьёо: g=\\frac{Q}{S}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.20:23",
      "kind": "formula",
      "page": 14,
      "section": "4.20",
      "textMn": "Хялбар авалцан асах/шатамхай шингэний галын ачааллын хэсгүүдийн зай, H≥11. Томьёо: H\\ge 11\\Rightarrow l_{xya}\\ge 15\\text{ m}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.20:24",
      "kind": "formula",
      "page": 15,
      "section": "4.20",
      "textMn": "Хялбар авалцан асах/шатамхай шингэний галын ачааллын хэсгүүдийн зай, H<11. Томьёо: H<11\\Rightarrow l_{xya}\\ge 26-H",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.20:upgrade",
      "kind": "formula",
      "page": 15,
      "section": "4.20",
      "textMn": "В2/В3 ангиллын дээд ангилал руу шилжих галын ачааллын нөхцөл. Томьёо: Q\\ge 0.64gH^2",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:4.22:25",
      "kind": "formula",
      "page": 15,
      "section": "4.22",
      "textMn": "Хий/уур ба тоос агуулсан холимгийн нийт тэсрэлтийн илүүдэл даралт. Томьёо: \\Delta P=\\Delta P_1+\\Delta P_2",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:1",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Z итгэлцүүр - тархалтын хязгаар өрөөний хагасаас бага үед. Томьёо: z=\\frac{5\\cdot10^{-3}}{m}\\rho_{g,p}\\left[c_0+\\frac{c_Hk_{pr}}{\\delta}\\right]X_{ndh}Y_{ndh}Z_{ndh}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:2",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Z итгэлцүүр - тархалтын хязгаар өрөөний хагасаас их үед. Томьёо: z=\\frac{5\\cdot10^{-3}}{m}\\rho_{g,p}\\left[c_0+\\frac{c_Hk_{pr}}{\\delta}\\right]FZ_{ndh}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:3",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Шатамхай хий, агаарын орчин хөдөлгөөнгүй үеийн C0. Томьёо: C_0=3.77\\cdot10^3\\frac{m}{\\rho_gV_{ce}}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:4",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Шатамхай хий, агаарын орчин хөдөлгөөнтэй үеийн C0. Томьёо: C_0=3\\cdot10^2\\frac{m}{\\rho_gV_{ce}U}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:5",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Хялбар авалцан асах шингэний уур, орчин хөдөлгөөнгүй үеийн c. Томьёо: c=c_H\\left[\\frac{m\\cdot100}{c_HP_HV_{ce}}\\right]^{0.41}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:6",
      "kind": "formula",
      "page": 17,
      "section": "Хавсралт",
      "textMn": "Хялбар авалцан асах шингэний уур, орчин хөдөлгөөнтэй үеийн c. Томьёо: c=c_H\\left[\\frac{m\\cdot100}{c_HP_HV_{ce}U}\\right]^{0.46}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:7",
      "kind": "formula",
      "page": 18,
      "section": "Хавсралт",
      "textMn": "Ханасан уурын концентраци. Томьёо: C_H=100\\frac{P_H}{P_0}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:8",
      "kind": "formula",
      "page": 19,
      "section": "Хавсралт",
      "textMn": "X хэмжигдэхүүн. Томьёо: X=\\begin{cases}C_H/C^*,&C_H\\ge C^*\\\\1,&C_H<C^*\\end{cases}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:9",
      "kind": "formula",
      "page": 20,
      "section": "Хавсралт",
      "textMn": "C*. Томьёо: C^*=\\varphi C_{st}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:10",
      "kind": "formula",
      "page": 20,
      "section": "Хавсралт",
      "textMn": "X_ndh зай. Томьёо: X_{ndh}=K_1L\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:11",
      "kind": "formula",
      "page": 20,
      "section": "Хавсралт",
      "textMn": "Y_ndh зай. Томьёо: Y_{ndh}=K_1S\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:appendix:12",
      "kind": "formula",
      "page": 20,
      "section": "Хавсралт",
      "textMn": "Z_ndh зай. Томьёо: Z_{ndh}=K_3H\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "verificationStatus": "needs_human_review"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_2_Z_participation_factor",
      "kind": "reference_table",
      "page": 7,
      "section": "table_2_Z_participation_factor",
      "textMn": "[{\"material\": \"Устөрөгч\", \"condition\": \"hydrogen\", \"Z\": 1.0}, {\"material\": \"Шатамхай хий (устөрөгчөөс бусад)\", \"condition\": \"combustible_gas_non_hydrogen\", \"Z\": 0.5}, {\"material\": \"Хялбар авалцан асах/шатамхай шингэн\", \"condition\": \"heated_to_flash_point_or_above\", \"Z\": 0.3}, {\"material\": \"Хялбар авалцан асах/шатамхай шингэн\", \"condition\": \"below_flash_point_aerosol_possible\", \"Z\": 0.3}, {\"material\": \"Хялбар авалцан асах/шатамхай шингэн\", \"condition\": \"below_flash_point_aerosol_impossible\", \"Z\": 0.0}]",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_3_eta_evaporation_factor",
      "kind": "reference_table",
      "page": 10,
      "section": "table_3_eta_evaporation_factor",
      "textMn": "{\"air_velocity_m_s\": [0, 0.1, 0.2, 0.5, 1.0], \"temperature_c\": [10, 15, 20, 30, 35], \"eta\": [[1.0, 1.0, 1.0, 1.0, 1.0], [3.0, 2.6, 2.4, 1.8, 1.6], [4.6, 3.8, 3.5, 2.4, 2.3], [6.6, 5.7, 5.4, 3.6, 3.2], [10.0, 8.7, 7.7, 5.6, 4.6]]}",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_4_specific_fire_load_categories",
      "kind": "reference_table",
      "page": 13,
      "section": "table_4_specific_fire_load_categories",
      "textMn": "[{\"category\": \"В1\", \"g_mj_m2\": \">2200\", \"method\": \"нормчлохгүй\"}, {\"category\": \"В2\", \"g_mj_m2\": \"1401-2200\", \"method\": \"4.20-д заасан\"}, {\"category\": \"В3\", \"g_mj_m2\": \"181-1400\", \"method\": \"4.20-д заасан\"}, {\"category\": \"В4\", \"g_mj_m2\": \"1-180\", \"method\": \"10 м² талбайтай өрөөний дурын нэг хэсэг; галын ачааллын талбайг 4.20-оор сонгоно\"}]",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_5_spacing_limit",
      "kind": "reference_table",
      "page": 14,
      "section": "table_5_spacing_limit",
      "textMn": "[{\"q_critical_kw_m2\": 5, \"l_limit_m\": 12}, {\"q_critical_kw_m2\": 10, \"l_limit_m\": 8}, {\"q_critical_kw_m2\": 15, \"l_limit_m\": 6}, {\"q_critical_kw_m2\": 20, \"l_limit_m\": 5}, {\"q_critical_kw_m2\": 25, \"l_limit_m\": 4}, {\"q_critical_kw_m2\": 30, \"l_limit_m\": 3.8}, {\"q_critical_kw_m2\": 40, \"l_limit_m\": 3.2}, {\"q_critical_kw_m2\": 50, \"l_limit_m\": 2.8}]",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_6_material_qcritical_kw_m2",
      "kind": "reference_table",
      "page": 14,
      "section": "table_6_material_qcritical_kw_m2",
      "textMn": "[{\"material_mn\": \"Мод (нарс, чийгшилт 12%)\", \"q_critical\": 13.9}, {\"material_mn\": \"Мод-үртэсний шахмал хавтан (нягт 417 кг/м³)\", \"q_critical\": 8.3}, {\"material_mn\": \"Шахмал хүлэр\", \"q_critical\": 13.2}, {\"material_mn\": \"Зүсмэл хүлэр\", \"q_critical\": 9.8}, {\"material_mn\": \"Хөвөн-хивэгдэс /волокно/\", \"q_critical\": 7.5}, {\"material_mn\": \"Үет ялтас /хавтсан/\", \"q_critical\": 15.4}, {\"material_mn\": \"Шилэн ялтас\", \"q_critical\": 15.3}, {\"material_mn\": \"Пергамин цаас\", \"q_critical\": 17.4}, {\"material_mn\": \"Резина\", \"q_critical\": 14.8}, {\"material_mn\": \"Нүүрс\", \"q_critical\": 35.0}, {\"material_mn\": \"Дээврийн рулон\", \"q_critical\": 17.4}, {\"material_mn\": \"Өвс, сүрэл (8% хүртэл чийгшилтэй)\", \"q_critical\": 7.0}]",
      "verificationStatus": "verified_from_page_image"
    },
    {
      "chunkId": "BD-21-101-12-2012:table:table_7_density_deviation_delta",
      "kind": "reference_table",
      "page": 18,
      "section": "table_7_density_deviation_delta",
      "textMn": "[{\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 0.1, \"delta\": 1.29}, {\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 0.05, \"delta\": 1.38}, {\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 0.01, \"delta\": 1.53}, {\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 0.003, \"delta\": 1.63}, {\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 0.001, \"delta\": 1.7}, {\"medium\": \"combustible_gas\", \"air_motion\": false, \"Q\": 1e-06, \"delta\": 2.04}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 0.1, \"delta\": 1.29}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 0.05, \"delta\": 1.37}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 0.01, \"delta\": 1.52}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 0.003, \"delta\": 1.62}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 0.001, \"delta\": 1.7}, {\"medium\": \"combustible_gas\", \"air_motion\": true, \"Q\": 1e-06, \"delta\": 2.03}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 0.1, \"delta\": 1.19}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 0.05, \"delta\": 1.25}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 0.01, \"delta\": 1.35}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 0.003, \"delta\": 1.41}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 0.001, \"delta\": 1.46}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": false, \"Q\": 1e-06, \"delta\": 1.68}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 0.1, \"delta\": 1.21}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 0.05, \"delta\": 1.27}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 0.01, \"delta\": 1.38}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 0.003, \"delta\": 1.45}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 0.001, \"delta\": 1.51}, {\"medium\": \"flammable_liquid_vapor\", \"air_motion\": true, \"Q\": 1e-06, \"delta\": 1.75}]",
      "verificationStatus": "verified_from_page_image"
    }
  ],
  "codeAliases": [
    "БД 21-101-12",
    "БД21-101-12",
    "21-101-12",
    "BD 21-101-12",
    "BD21-101-12"
  ],
  "currentness": "CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED",
  "datasetFiles": [
    "aliases.json",
    "building_category_rules.jsonl",
    "calculation_cases.jsonl",
    "classification_decision_tree.json",
    "document.json",
    "formulas.jsonl",
    "keyword_alias_index.jsonl",
    "knowledge_chunks.jsonl",
    "manifest.json",
    "qa_retrieval_tests.jsonl",
    "reference_tables.json",
    "room_category_rules.jsonl",
    "v_subcategory_rules.jsonl"
  ],
  "datasetId": "mgl-ai-bd-21-101-12",
  "datasetSha256": "0f0c659df63f8f592f2a8153b7bf09933a3da1a4419c8093c68c386e6f428813",
  "datasetVersion": "0.2.0",
  "documentCode": "БД 21-101-12",
  "documentId": "BD-21-101-12-2012",
  "effectiveFrom": "2012-06-01",
  "formulas": [
    {
      "constraints": {},
      "equationLatex": "\\Delta P=(P_{max}-P_0)\\frac{mZ}{V_{free}\\rho_{g,p}}\\frac{100}{C_{st}}\\frac{1}{K_H}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.5:1",
      "inputs": [
        "Pmax_kPa",
        "P0_kPa",
        "m_kg",
        "Z",
        "Vfree_m3",
        "rho_g_p_kg_m3",
        "Cst_pct",
        "K_H"
      ],
      "nameMn": "C,H,O,N,Cl,Br,I,F агуулсан шатамхай бодисын тэсрэлтийн илүүдэл даралт",
      "number": "1",
      "output": {
        "name": "deltaP",
        "unit": "kPa"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "1",
        "page": 6,
        "recordId": "BD-21-101-12-2012:4.5:1",
        "section": "4.5",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.5"
    },
    {
      "constraints": {},
      "equationLatex": "\\rho_{g,p}=\\frac{M}{V_0(1+0.00367t_p)}",
      "executable": true,
      "expressionPython": "M / (V0 * (1 + 0.00367 * tp_c))",
      "formulaId": "BD-21-101-12-2012:4.5:2",
      "inputs": [
        "M_kg_per_kmol",
        "V0_m3_per_kmol",
        "tp_c"
      ],
      "nameMn": "Хий, уурын нягт",
      "number": "2",
      "output": {
        "name": "rho_g_p",
        "unit": "kg/m3"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "2",
        "page": 7,
        "recordId": "BD-21-101-12-2012:4.5:2",
        "section": "4.5",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.5"
    },
    {
      "constraints": {},
      "equationLatex": "C_{st}=\\frac{100}{1+4.84\\beta},\\quad \\beta=n_C+\\frac{n_H-n_X}{4}-\\frac{n_O}{2}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.5:3",
      "inputs": [
        "n_C",
        "n_H",
        "n_X",
        "n_O"
      ],
      "nameMn": "Стехиометрийн эзлэхүүний хувь",
      "number": "3",
      "output": {
        "name": "Cst",
        "unit": "percent"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "3",
        "page": 7,
        "recordId": "BD-21-101-12-2012:4.5:3",
        "section": "4.5",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.5"
    },
    {
      "constraints": {},
      "equationLatex": "\\Delta P=\\frac{mH_TP_0Z}{V_{free}\\rho_{air}C_pT_0K_H}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.6:4",
      "inputs": [
        "m_kg",
        "H_T_J_per_kg",
        "P0_kPa",
        "Z",
        "Vfree_m3",
        "rho_air_kg_m3",
        "Cp_J_kgK",
        "T0_K",
        "K_H"
      ],
      "nameMn": "4.5-д хамаарахгүй бодис/холимгийн тэсрэлтийн илүүдэл даралт",
      "number": "4",
      "output": {
        "name": "deltaP",
        "unit": "kPa"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "4",
        "page": 8,
        "recordId": "BD-21-101-12-2012:4.6:4",
        "section": "4.6",
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": "4.6"
    },
    {
      "constraints": {},
      "equationLatex": "K=AT+1",
      "executable": true,
      "expressionPython": "A_per_s * T_s + 1",
      "formulaId": "BD-21-101-12-2012:4.7:5",
      "inputs": [
        "A_per_s",
        "T_s"
      ],
      "nameMn": "Ослын агааржуулалтын бууруулах коэффициент",
      "number": "5",
      "output": {
        "name": "K",
        "unit": "dimensionless"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "5",
        "page": 8,
        "recordId": "BD-21-101-12-2012:4.7:5",
        "section": "4.7",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.7"
    },
    {
      "constraints": {},
      "equationLatex": "\\tau=(V_a+V_T)\\rho_g",
      "executable": true,
      "expressionPython": "(Va_m3 + Vt_m3) * rho_g_kg_m3",
      "formulaId": "BD-21-101-12-2012:4.8:6",
      "inputs": [
        "Va_m3",
        "Vt_m3",
        "rho_g_kg_m3"
      ],
      "nameMn": "Ослын үед өрөөнд орж ирэх тооцоот хий",
      "number": "6",
      "output": {
        "name": "tau_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "6",
        "page": 8,
        "recordId": "BD-21-101-12-2012:4.8:6",
        "section": "4.8",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.8"
    },
    {
      "constraints": {},
      "equationLatex": "V_a=0.01P_1V",
      "executable": true,
      "expressionPython": "0.01 * P1_kPa * V_m3",
      "formulaId": "BD-21-101-12-2012:4.8:7",
      "inputs": [
        "P1_kPa",
        "V_m3"
      ],
      "nameMn": "Аппаратаас гарах хийн эзлэхүүн",
      "number": "7",
      "output": {
        "name": "Va_m3",
        "unit": "m3"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "7",
        "page": 8,
        "recordId": "BD-21-101-12-2012:4.8:7",
        "section": "4.8",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.8"
    },
    {
      "constraints": {},
      "equationLatex": "V_T=V_{1T}+V_{2T}",
      "executable": true,
      "expressionPython": "V1t_m3 + V2t_m3",
      "formulaId": "BD-21-101-12-2012:4.8:8",
      "inputs": [
        "V1t_m3",
        "V2t_m3"
      ],
      "nameMn": "Дамжуулах хоолойноос гарах хийн нийт эзлэхүүн",
      "number": "8",
      "output": {
        "name": "Vt_m3",
        "unit": "m3"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "8",
        "page": 8,
        "recordId": "BD-21-101-12-2012:4.8:8",
        "section": "4.8",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.8"
    },
    {
      "constraints": {},
      "equationLatex": "V_{1T}=qT",
      "executable": true,
      "expressionPython": "q_m3_s * T_s",
      "formulaId": "BD-21-101-12-2012:4.8:9",
      "inputs": [
        "q_m3_s",
        "T_s"
      ],
      "nameMn": "Хаахаас өмнө шугам хоолойноос гарах хий",
      "number": "9",
      "output": {
        "name": "V1t_m3",
        "unit": "m3"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "9",
        "page": 9,
        "recordId": "BD-21-101-12-2012:4.8:9",
        "section": "4.8",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.8"
    },
    {
      "constraints": {},
      "equationLatex": "V_{2T}=0.01\\pi P_2(r_1^2L_1+r_2^2L_2+\\cdots+r_n^2L_n)",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.8:10",
      "inputs": [
        "P2_kPa",
        "pipe_segments[{radius_m,length_m}]"
      ],
      "nameMn": "Хааснаас хойш хоолойноос гарах хий",
      "number": "10",
      "output": {
        "name": "V2t_m3",
        "unit": "m3"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "10",
        "page": 9,
        "recordId": "BD-21-101-12-2012:4.8:10",
        "section": "4.8",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.8"
    },
    {
      "constraints": {},
      "equationLatex": "\\tau=\\tau_x+\\tau_{ca}+\\tau_y",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.9:11",
      "inputs": [
        "tau_spill_kg",
        "tau_open_vessel_kg",
        "tau_surface_kg"
      ],
      "nameMn": "Өрөөнд үүсэх шингэний уурын тооцоот хэмжээ",
      "number": "11",
      "output": {
        "name": "tau_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "11",
        "page": 9,
        "recordId": "BD-21-101-12-2012:4.9:11",
        "section": "4.9",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.9"
    },
    {
      "constraints": {},
      "equationLatex": "m=WF_uT",
      "executable": true,
      "expressionPython": "W_kg_m2_s * Fu_m2 * T_s",
      "formulaId": "BD-21-101-12-2012:4.9:12",
      "inputs": [
        "W_kg_m2_s",
        "Fu_m2",
        "T_s"
      ],
      "nameMn": "Ууршсан шингэний жин",
      "number": "12",
      "output": {
        "name": "m_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "12",
        "page": 9,
        "recordId": "BD-21-101-12-2012:4.9:12",
        "section": "4.9",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.9"
    },
    {
      "constraints": {},
      "equationLatex": "W=10^{-6}\\eta\\sqrt{MP_H}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.11:13",
      "inputs": [
        "eta",
        "M",
        "P_H_kPa"
      ],
      "nameMn": "Ууршилтын идэвхи",
      "number": "13",
      "output": {
        "name": "W",
        "unit": "kg/(m2*s)"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "13",
        "page": 10,
        "recordId": "BD-21-101-12-2012:4.11:13",
        "section": "4.11",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.11"
    },
    {
      "constraints": {},
      "equationLatex": "Z=0.5F",
      "executable": true,
      "expressionPython": "0.5 * F",
      "formulaId": "BD-21-101-12-2012:4.12:14",
      "inputs": [
        "F"
      ],
      "nameMn": "Тоосонцрын тэсрэлтэд оролцох итгэлцүүр",
      "number": "14",
      "output": {
        "name": "Z",
        "unit": "dimensionless"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "14",
        "page": 10,
        "recordId": "BD-21-101-12-2012:4.12:14",
        "section": "4.12",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.12"
    },
    {
      "constraints": {},
      "equationLatex": "\\tau=\\tau_{xy}+\\tau_{oc}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.13:15",
      "inputs": [
        "tau_suspended_kg",
        "tau_accident_kg"
      ],
      "nameMn": "Ослын үед өрөөнд тархсан тоосонцрын тооцооны жин",
      "number": "15",
      "output": {
        "name": "tau_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "15",
        "page": 10,
        "recordId": "BD-21-101-12-2012:4.13:15",
        "section": "4.13",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.13"
    },
    {
      "constraints": {},
      "equationLatex": "\\tau_{xy}=K_{xy}\\tau_{\\theta}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.14:16",
      "inputs": [
        "K_xy",
        "tau_accumulated_kg"
      ],
      "nameMn": "Хуйларсан тоосонцрын тооцооны жин",
      "number": "16",
      "output": {
        "name": "tau_suspended_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "16",
        "page": 10,
        "recordId": "BD-21-101-12-2012:4.14:16",
        "section": "4.14",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.14"
    },
    {
      "constraints": {},
      "equationLatex": "\\tau_{oc}=(\\tau_{ap}+qT)K_{\\theta}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.15:17",
      "inputs": [
        "tau_apparatus_kg",
        "q_kg_s",
        "T_s",
        "K_dust"
      ],
      "nameMn": "Ослын нөхцлөөс үүсэх тоосны тооцооны хэмжээ",
      "number": "17",
      "output": {
        "name": "tau_accident_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "17",
        "page": 11,
        "recordId": "BD-21-101-12-2012:4.15:17",
        "section": "4.15",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.15"
    },
    {
      "constraints": {},
      "equationLatex": "m_n=\\frac{K_r}{K_y}(m_1+m_2)",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.16:18",
      "inputs": [
        "K_combustible_fraction",
        "K_cleaning_quality",
        "m1_kg",
        "m2_kg"
      ],
      "nameMn": "Осол болох үед өрөөнд хуримтлагдсан тоос",
      "number": "18",
      "output": {
        "name": "mn_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "18",
        "page": 11,
        "recordId": "BD-21-101-12-2012:4.16:18",
        "section": "4.16",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.16"
    },
    {
      "constraints": {},
      "equationLatex": "m_i=M_i(1-\\alpha)\\beta_i,\\quad i=1,2",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.17:19",
      "inputs": [
        "M_i_kg",
        "alpha",
        "beta_i"
      ],
      "nameMn": "Тодорхой хугацаанд талбай дээрх тоосны хэмжээ",
      "number": "19",
      "output": {
        "name": "m_i_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "19",
        "page": 12,
        "recordId": "BD-21-101-12-2012:4.17:19",
        "section": "4.17",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.17"
    },
    {
      "constraints": {},
      "equationLatex": "M_i=\\sum_j(G_{ij}F_{ij})t_i,\\quad i=1,2",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.18:20",
      "inputs": [
        "G_ij_kg_m2_s",
        "F_ij_m2",
        "t_i_s"
      ],
      "nameMn": "Тоног төхөөрөмжийн хамгийн их ачааллын үеийн хуримтлагдах тоос",
      "number": "20",
      "output": {
        "name": "M_i_kg",
        "unit": "kg"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "20",
        "page": 12,
        "recordId": "BD-21-101-12-2012:4.18:20",
        "section": "4.18",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.18"
    },
    {
      "constraints": {},
      "equationLatex": "Q=\\sum_{i=1}^{n}G_iQ_{Hi}^{p}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.20:21",
      "inputs": [
        "materials[{mass_kg,lower_heat_mj_kg}]"
      ],
      "nameMn": "Галын ачаалал",
      "number": "21",
      "output": {
        "name": "Q_MJ",
        "unit": "MJ"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "21",
        "page": 13,
        "recordId": "BD-21-101-12-2012:4.20:21",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.20"
    },
    {
      "constraints": {
        "S_m2_min": 10
      },
      "equationLatex": "g=\\frac{Q}{S}",
      "executable": true,
      "expressionPython": "Q_MJ / S_m2",
      "formulaId": "BD-21-101-12-2012:4.20:22",
      "inputs": [
        "Q_MJ",
        "S_m2"
      ],
      "nameMn": "Хувийн галын ачаалал",
      "number": "22",
      "output": {
        "name": "g_MJ_m2",
        "unit": "MJ/m2"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "22",
        "page": 13,
        "recordId": "BD-21-101-12-2012:4.20:22",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.20"
    },
    {
      "constraints": {},
      "equationLatex": "H\\ge 11\\Rightarrow l_{xya}\\ge 15\\text{ m}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:4.20:23",
      "inputs": [
        "H_m"
      ],
      "nameMn": "Хялбар авалцан асах/шатамхай шингэний галын ачааллын хэсгүүдийн зай, H≥11",
      "number": "23",
      "output": {
        "name": "min_spacing_m",
        "unit": "m"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "23",
        "page": 14,
        "recordId": "BD-21-101-12-2012:4.20:23",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.20"
    },
    {
      "constraints": {},
      "equationLatex": "H<11\\Rightarrow l_{xya}\\ge 26-H",
      "executable": true,
      "expressionPython": "26 - H_m",
      "formulaId": "BD-21-101-12-2012:4.20:24",
      "inputs": [
        "H_m"
      ],
      "nameMn": "Хялбар авалцан асах/шатамхай шингэний галын ачааллын хэсгүүдийн зай, H<11",
      "number": "24",
      "output": {
        "name": "min_spacing_m",
        "unit": "m"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "24",
        "page": 15,
        "recordId": "BD-21-101-12-2012:4.20:24",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.20"
    },
    {
      "constraints": {},
      "equationLatex": "Q\\ge 0.64gH^2",
      "executable": true,
      "expressionPython": "Q_MJ >= 0.64 * g_MJ_m2 * (H_m ** 2)",
      "formulaId": "BD-21-101-12-2012:4.20:upgrade",
      "inputs": [
        "Q_MJ",
        "g_MJ_m2",
        "H_m"
      ],
      "nameMn": "В2/В3 ангиллын дээд ангилал руу шилжих галын ачааллын нөхцөл",
      "number": "classification_condition",
      "output": {
        "name": "upgrade_required",
        "unit": "boolean"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "classification_condition",
        "page": 15,
        "recordId": "BD-21-101-12-2012:4.20:upgrade",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.20"
    },
    {
      "constraints": {},
      "equationLatex": "\\Delta P=\\Delta P_1+\\Delta P_2",
      "executable": true,
      "expressionPython": "deltaP_gas_vapor_kPa + deltaP_dust_kPa",
      "formulaId": "BD-21-101-12-2012:4.22:25",
      "inputs": [
        "deltaP_gas_vapor_kPa",
        "deltaP_dust_kPa"
      ],
      "nameMn": "Хий/уур ба тоос агуулсан холимгийн нийт тэсрэлтийн илүүдэл даралт",
      "number": "25",
      "output": {
        "name": "deltaP_total_kPa",
        "unit": "kPa"
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "25",
        "page": 15,
        "recordId": "BD-21-101-12-2012:4.22:25",
        "section": "4.22",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": "4.22"
    },
    {
      "constraints": {},
      "equationLatex": "z=\\frac{5\\cdot10^{-3}}{m}\\rho_{g,p}\\left[c_0+\\frac{c_Hk_{pr}}{\\delta}\\right]X_{ndh}Y_{ndh}Z_{ndh}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:1",
      "inputs": [],
      "nameMn": "Z итгэлцүүр - тархалтын хязгаар өрөөний хагасаас бага үед",
      "number": "A1",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A1",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:1",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "z=\\frac{5\\cdot10^{-3}}{m}\\rho_{g,p}\\left[c_0+\\frac{c_Hk_{pr}}{\\delta}\\right]FZ_{ndh}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:2",
      "inputs": [],
      "nameMn": "Z итгэлцүүр - тархалтын хязгаар өрөөний хагасаас их үед",
      "number": "A2",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A2",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:2",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "C_0=3.77\\cdot10^3\\frac{m}{\\rho_gV_{ce}}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:3",
      "inputs": [],
      "nameMn": "Шатамхай хий, агаарын орчин хөдөлгөөнгүй үеийн C0",
      "number": "A3",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A3",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:3",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "C_0=3\\cdot10^2\\frac{m}{\\rho_gV_{ce}U}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:4",
      "inputs": [],
      "nameMn": "Шатамхай хий, агаарын орчин хөдөлгөөнтэй үеийн C0",
      "number": "A4",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A4",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:4",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "c=c_H\\left[\\frac{m\\cdot100}{c_HP_HV_{ce}}\\right]^{0.41}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:5",
      "inputs": [],
      "nameMn": "Хялбар авалцан асах шингэний уур, орчин хөдөлгөөнгүй үеийн c",
      "number": "A5",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A5",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:5",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "c=c_H\\left[\\frac{m\\cdot100}{c_HP_HV_{ce}U}\\right]^{0.46}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:6",
      "inputs": [],
      "nameMn": "Хялбар авалцан асах шингэний уур, орчин хөдөлгөөнтэй үеийн c",
      "number": "A6",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A6",
        "page": 17,
        "recordId": "BD-21-101-12-2012:appendix:6",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "C_H=100\\frac{P_H}{P_0}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:7",
      "inputs": [],
      "nameMn": "Ханасан уурын концентраци",
      "number": "A7",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A7",
        "page": 18,
        "recordId": "BD-21-101-12-2012:appendix:7",
        "section": null,
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "X=\\begin{cases}C_H/C^*,&C_H\\ge C^*\\\\1,&C_H<C^*\\end{cases}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:8",
      "inputs": [],
      "nameMn": "X хэмжигдэхүүн",
      "number": "A8",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A8",
        "page": 19,
        "recordId": "BD-21-101-12-2012:appendix:8",
        "section": null,
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "C^*=\\varphi C_{st}",
      "executable": true,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:9",
      "inputs": [],
      "nameMn": "C*",
      "number": "A9",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A9",
        "page": 20,
        "recordId": "BD-21-101-12-2012:appendix:9",
        "section": null,
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "X_{ndh}=K_1L\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:10",
      "inputs": [],
      "nameMn": "X_ndh зай",
      "number": "A10",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A10",
        "page": 20,
        "recordId": "BD-21-101-12-2012:appendix:10",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "Y_{ndh}=K_1S\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:11",
      "inputs": [],
      "nameMn": "Y_ndh зай",
      "number": "A11",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A11",
        "page": 20,
        "recordId": "BD-21-101-12-2012:appendix:11",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    },
    {
      "constraints": {},
      "equationLatex": "Z_{ndh}=K_3H\\left(k_2\\ln\\frac{\\delta C_0}{C_Hk_{pr}}\\right)^{0.5}",
      "executable": false,
      "expressionPython": null,
      "formulaId": "BD-21-101-12-2012:appendix:12",
      "inputs": [],
      "nameMn": "Z_ndh зай",
      "number": "A12",
      "output": {
        "name": "",
        "unit": ""
      },
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": "A12",
        "page": 20,
        "recordId": "BD-21-101-12-2012:appendix:12",
        "section": null,
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "section": ""
    }
  ],
  "generatorVersion": "bd-21-101-12/1",
  "legalStatusRaw": "current_status_not_checked_for_later_amendments",
  "rules": [
    {
      "boundaryConflicts": [
        {
          "detailMn": "Гүйцэтгэх бичлэг «<= 28», эх бичвэр «< 28» — яг 28 дээр санал нийлэхгүй.",
          "executableOp": "<=",
          "field": "flash_point_c",
          "proseOp": "<",
          "reason": "source_boundary_conflict",
          "value": 28
        }
      ],
      "category": "А",
      "descriptionMn": "Агаар-хий/уурын холимог шатахад тооцоогоор 5 кПа-аас илүү илүүдэл даралт үүсгэх хэмжээтэй, авалцан асах хэм 28°C-аас бага шатамхай хий ба хялбар авалцан асах шингэн; эсвэл ус, агаарын хүчилтөрөгч, өөр хоорондоо урвалд орж 5 кПа-аас илүү илүүдэл даралт үүсгэх бодис материал.",
      "executable": true,
      "family": "room_category",
      "method": null,
      "predicate": {
        "kind": "any",
        "of": [
          {
            "kind": "all",
            "of": [
              {
                "field": "medium",
                "in": [
                  "flammable_gas",
                  "flammable_liquid_vapor"
                ],
                "kind": "enum"
              },
              {
                "field": "flash_point_c",
                "kind": "number",
                "op": "<=",
                "unit": null,
                "value": 28
              },
              {
                "field": "explosion_overpressure_kpa",
                "kind": "number",
                "op": ">",
                "unit": null,
                "value": 5
              }
            ]
          },
          {
            "kind": "all",
            "of": [
              {
                "field": "reacts_with",
                "in": [
                  "water",
                  "air_oxygen",
                  "other_substances"
                ],
                "kind": "enum"
              },
              {
                "field": "explosion_overpressure_kpa",
                "kind": "number",
                "op": ">",
                "unit": null,
                "value": 5
              }
            ]
          }
        ]
      },
      "priority": 1,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 4,
        "recordId": "BD-21-101-12-2012:room:A:gas_liquid",
        "section": "3.1",
        "table": 1,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:A:gas_liquid",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Б",
      "descriptionMn": "Агаар-тоосны эсвэл агаар-уурын холимог шатахад 5 кПа-аас илүү илүүдэл даралт үүсгэх хэмжээ бүхий шатах тоос/хивэгдэс, эсвэл авалцан асах хэм 28°C-аас их хялбар авалцан асах/шатамхай шингэн.",
      "executable": true,
      "family": "room_category",
      "method": null,
      "predicate": {
        "kind": "any",
        "of": [
          {
            "kind": "all",
            "of": [
              {
                "field": "medium",
                "in": [
                  "combustible_dust",
                  "combustible_fiber"
                ],
                "kind": "enum"
              },
              {
                "field": "explosion_overpressure_kpa",
                "kind": "number",
                "op": ">",
                "unit": null,
                "value": 5
              }
            ]
          },
          {
            "kind": "all",
            "of": [
              {
                "field": "medium",
                "in": [
                  "flammable_liquid"
                ],
                "kind": "enum"
              },
              {
                "field": "flash_point_c",
                "kind": "number",
                "op": ">",
                "unit": null,
                "value": 28
              },
              {
                "field": "explosion_overpressure_kpa",
                "kind": "number",
                "op": ">",
                "unit": null,
                "value": 5
              }
            ]
          }
        ]
      },
      "priority": 2,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 4,
        "recordId": "BD-21-101-12-2012:room:B:dust_liquid",
        "section": "3.1",
        "table": 1,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:B:dust_liquid",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В1-В4",
      "descriptionMn": "А, Б ангилалд хамаарахгүй боловч агаарын хүчилтөрөгч, ус, өөр бодистой харилцан үйлчлэхэд шатдаг, шатамхай болон тэсвэрлэн шатдаг шингэн, хатуу бодис материал, тоос, хивэгдэс агуулсан өрөө.",
      "executable": true,
      "family": "room_category",
      "method": null,
      "predicate": {
        "kind": "all",
        "of": [
          {
            "categories": [
              "А",
              "Б"
            ],
            "kind": "not_category"
          },
          {
            "field": "combustible_material_present",
            "kind": "flag",
            "value": true
          }
        ]
      },
      "priority": 3,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 4,
        "recordId": "BD-21-101-12-2012:room:V:combustible_material",
        "section": "3.1",
        "table": 1,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:V:combustible_material",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Г",
      "descriptionMn": "Халуун, улайссан эсвэл хайлсан байдалдаа илч, оч, дөл ялгаруулдаг шатдаггүй бодис материал; эсвэл түлш болгон шатаах эсвэл өөрөөр ашигладаг шатамхай шингэн, хий, хатуу бодис материал.",
      "executable": true,
      "family": "room_category",
      "method": null,
      "predicate": {
        "kind": "any",
        "of": [
          {
            "field": "hot_or_molten_noncombustible_material",
            "kind": "flag",
            "value": true
          },
          {
            "field": "combustible_used_as_fuel",
            "kind": "flag",
            "value": true
          }
        ]
      },
      "priority": 4,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 4,
        "recordId": "BD-21-101-12-2012:room:G",
        "section": "3.1",
        "table": 1,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:G",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Д",
      "descriptionMn": "Хүйтэн байдалд байгаа шатдаггүй бодис материал, эд зүйл.",
      "executable": true,
      "family": "room_category",
      "method": null,
      "predicate": {
        "kind": "all",
        "of": [
          {
            "field": "noncombustible_material_cold",
            "kind": "flag",
            "value": true
          },
          {
            "categories": [
              "А",
              "Б",
              "В1",
              "В2",
              "В3",
              "В4",
              "Г"
            ],
            "kind": "not_category"
          }
        ]
      },
      "priority": 5,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 4,
        "recordId": "BD-21-101-12-2012:room:D",
        "section": "3.1",
        "table": 1,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:D",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В1",
      "descriptionMn": "В1 ангилал: хувийн галын ачаалал g >2200 МДж/м² (Хүснэгт 4); арга: нормчлохгүй.",
      "executable": true,
      "family": "v_subcategory",
      "method": "normalization_not_required",
      "predicate": {
        "field": "g_mj_m2",
        "kind": "number",
        "op": ">",
        "unit": null,
        "value": 2200
      },
      "priority": 6,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 13,
        "recordId": "BD-21-101-12-2012:room:V1:g",
        "section": "4.19",
        "table": 4,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:V1:g",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В2",
      "descriptionMn": "В2 ангилал: хувийн галын ачаалал g = 1401–2200 МДж/м² (Хүснэгт 4); арга: 4.20-д заасан.",
      "executable": true,
      "family": "v_subcategory",
      "method": "apply_4_20",
      "predicate": {
        "field": "g_mj_m2",
        "kind": "number",
        "op": "between",
        "unit": null,
        "value": [
          1401,
          2200
        ]
      },
      "priority": 7,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 13,
        "recordId": "BD-21-101-12-2012:room:V2:g",
        "section": "4.19",
        "table": 4,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:V2:g",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В3",
      "descriptionMn": "В3 ангилал: хувийн галын ачаалал g = 181–1400 МДж/м² (Хүснэгт 4); арга: 4.20-д заасан.",
      "executable": true,
      "family": "v_subcategory",
      "method": "apply_4_20",
      "predicate": {
        "field": "g_mj_m2",
        "kind": "number",
        "op": "between",
        "unit": null,
        "value": [
          181,
          1400
        ]
      },
      "priority": 8,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 13,
        "recordId": "BD-21-101-12-2012:room:V3:g",
        "section": "4.19",
        "table": 4,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:V3:g",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "В4 ангилал: хувийн галын ачаалал g = 1–180 МДж/м² (Хүснэгт 4); арга: 10 м² талбайтай өрөөний дурын нэг хэсэг; галын ачааллын талбайг 4.20-оор сонгоно.",
      "executable": true,
      "family": "v_subcategory",
      "method": "10m2_arbitrary_section_and_spacing",
      "predicate": {
        "field": "g_mj_m2",
        "kind": "number",
        "op": "between",
        "unit": null,
        "value": [
          1,
          180
        ]
      },
      "priority": 9,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 13,
        "recordId": "BD-21-101-12-2012:room:V4:g",
        "section": "4.19",
        "table": 4,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:room:V4:g",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "А",
      "descriptionMn": "Барилгын А ангилал (5.1).",
      "executable": false,
      "family": "building_category",
      "method": null,
      "predicate": null,
      "priority": 10,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 15,
        "recordId": "BD-21-101-12-2012:building:A",
        "section": "5.1",
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "reviewNote": "The scan says '5%-с дээш ... эсвэл 200 м² бол'; verify whether the second comparator is ≥200 m² / >200 m² in the authoritative copy.",
      "ruleId": "BD-21-101-12-2012:building:A",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Б",
      "descriptionMn": "Барилгын Б ангилал (5.2).",
      "executable": false,
      "family": "building_category",
      "method": null,
      "predicate": null,
      "priority": 11,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 15,
        "recordId": "BD-21-101-12-2012:building:B",
        "section": "5.2",
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "reviewNote": "Verify the exact 200 m² comparator against the authoritative copy.",
      "ruleId": "BD-21-101-12-2012:building:B",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В",
      "descriptionMn": "Барилга нь А, Б ангилалд хамаарахгүй; А, Б ба В ангиллын өрөө тасалгааны талбай нь нийт талбайн 5% ... (хэрэв А, Б өрөөгүй бол 10%).",
      "executable": false,
      "family": "building_category",
      "method": null,
      "predicate": null,
      "priority": 12,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 16,
        "recordId": "BD-21-101-12-2012:building:V",
        "section": "5.3",
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "reviewNote": "The printed source appears to read '5%-иас ихгүй', which conflicts with the usual category escalation logic. Preserve source, but do not execute until a qualified reviewer confirms the intended comparator.",
      "ruleId": "BD-21-101-12-2012:building:V",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Г",
      "descriptionMn": "Барилга нь А, Б, В ангилалд хамаарахгүй; А, Б, В ба Г ангиллын өрөө тасалгааны талбай нь нийт талбайн 5% ...",
      "executable": false,
      "family": "building_category",
      "method": null,
      "predicate": null,
      "priority": 13,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 16,
        "recordId": "BD-21-101-12-2012:building:G",
        "section": "5.4",
        "table": null,
        "verificationStatus": "needs_human_review"
      },
      "reviewNote": "The printed source comparator around 5% is visually/semantically ambiguous; reviewer approval required before executable use.",
      "ruleId": "BD-21-101-12-2012:building:G",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "Д",
      "descriptionMn": "Барилгын Д ангилал (5.5).",
      "executable": true,
      "family": "building_category",
      "method": null,
      "predicate": {
        "kind": "all",
        "of": [
          {
            "categories": [
              "А",
              "Б",
              "В",
              "Г"
            ],
            "kind": "not_category"
          }
        ]
      },
      "priority": 14,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 16,
        "recordId": "BD-21-101-12-2012:building:D",
        "section": "5.5",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:building:D",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": null,
      "descriptionMn": "Өрөөний чөлөөт багтаамж нь нийт багтаамжаас тоног төхөөрөмжийн эзлэх зайг хассан хэмжээ. Тооцох боломжгүй бол геометрийн багтаамжийн 80%-ийг авна.",
      "executable": true,
      "family": "fallback_ratio",
      "method": null,
      "predicate": {
        "field": "equipment_volume_known",
        "kind": "flag",
        "value": false
      },
      "priority": 15,
      "provenance": {
        "clause": "4.4",
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 6,
        "recordId": "BD-21-101-12-2012:clause:4.4",
        "section": "4.4",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:clause:4.4",
      "value": 0.8
    },
    {
      "boundaryConflicts": [],
      "category": null,
      "descriptionMn": "Гараар хаах бол тооцоот хаах хугацаа 300 с.",
      "executable": true,
      "family": "shutoff_time",
      "method": null,
      "predicate": {
        "field": "manual",
        "kind": "flag",
        "value": true
      },
      "priority": 16,
      "provenance": {
        "clause": "4.2",
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 5,
        "recordId": "BD-21-101-12-2012:clause:4.2.valve",
        "section": "4.2",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:clause:4.2.valve:manual",
      "value": 300
    },
    {
      "boundaryConflicts": [],
      "category": null,
      "descriptionMn": "Автомат хаалтын ажиллагаагүй болох магадлал жилд 0.000001-ээс их ба нөөцгүй бол 120 секунд.",
      "executable": true,
      "family": "shutoff_time",
      "method": null,
      "predicate": {
        "kind": "all",
        "of": [
          {
            "field": "manual",
            "kind": "flag",
            "value": false
          },
          {
            "field": "redundant",
            "kind": "flag",
            "value": false
          },
          {
            "field": "failure_probability_per_year",
            "kind": "number",
            "op": ">",
            "unit": "1/year",
            "value": 0.000001
          }
        ]
      },
      "priority": 16,
      "provenance": {
        "clause": "4.2",
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 5,
        "recordId": "BD-21-101-12-2012:clause:4.2.valve",
        "section": "4.2",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:clause:4.2.valve:auto_no_redundancy",
      "value": 120
    },
    {
      "boundaryConflicts": [],
      "category": null,
      "descriptionMn": "Магадлал жилд 0.000001-ээс бага ба нөөц хангалттай бол техникийн паспортын хугацаа.",
      "executable": true,
      "family": "shutoff_time",
      "method": null,
      "predicate": {
        "kind": "all",
        "of": [
          {
            "field": "manual",
            "kind": "flag",
            "value": false
          },
          {
            "field": "redundant",
            "kind": "flag",
            "value": true
          },
          {
            "field": "failure_probability_per_year",
            "kind": "number",
            "op": "<",
            "unit": "1/year",
            "value": 0.000001
          }
        ]
      },
      "priority": 16,
      "provenance": {
        "clause": "4.2",
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 5,
        "recordId": "BD-21-101-12-2012:clause:4.2.valve",
        "section": "4.2",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:clause:4.2.valve:auto_redundant_passport",
      "value": null
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "В4 ангиллын өрөөнд галын ачааллын хэсгүүдийн хоорондын зай нь хүснэгт 5-д заасан хязгаарын зайгаас их байна. qкр тодорхойгүй бол lхя ≥ 12 м гэж авна.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_known",
        "kind": "flag",
        "value": false
      },
      "priority": 19,
      "provenance": {
        "clause": "4.20",
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 13,
        "recordId": "BD-21-101-12-2012:clause:4.20.b4",
        "section": "4.20",
        "table": null,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:clause:4.20.b4:default",
      "value": 12
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 5 кВт/м² бол хязгаарын зай l = 12 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 5
      },
      "priority": 20,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q5",
      "value": 12
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 10 кВт/м² бол хязгаарын зай l = 8 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 10
      },
      "priority": 21,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q10",
      "value": 8
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 15 кВт/м² бол хязгаарын зай l = 6 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 15
      },
      "priority": 22,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q15",
      "value": 6
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 20 кВт/м² бол хязгаарын зай l = 5 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 20
      },
      "priority": 23,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q20",
      "value": 5
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 25 кВт/м² бол хязгаарын зай l = 4 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 25
      },
      "priority": 24,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q25",
      "value": 4
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 30 кВт/м² бол хязгаарын зай l = 3.8 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 30
      },
      "priority": 25,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q30",
      "value": 3.8
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 40 кВт/м² бол хязгаарын зай l = 3.2 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 40
      },
      "priority": 26,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q40",
      "value": 3.2
    },
    {
      "boundaryConflicts": [],
      "category": "В4",
      "descriptionMn": "Хүснэгт 5: q_кр = 50 кВт/м² бол хязгаарын зай l = 2.8 м.",
      "executable": true,
      "family": "spacing",
      "method": null,
      "predicate": {
        "field": "q_critical_kw_m2",
        "kind": "number",
        "op": "=",
        "unit": "kW/m2",
        "value": 50
      },
      "priority": 27,
      "provenance": {
        "clause": null,
        "documentCode": "БД 21-101-12",
        "documentId": "BD-21-101-12-2012",
        "formula": null,
        "page": 14,
        "recordId": "BD-21-101-12-2012:table:table_5_spacing_limit",
        "section": "4.20",
        "table": 5,
        "verificationStatus": "verified_from_page_image"
      },
      "reviewNote": null,
      "ruleId": "BD-21-101-12-2012:table:table_5_spacing_limit:q50",
      "value": 2.8
    }
  ],
  "sourceSha256": "22291830d0b83bb34116e157f1fa2a8450b20c82eed3571429b9adfbf49f07f1",
  "titleEn": "Determination of Categories of Rooms, Buildings on Explosion and Fire Hazard",
  "titleMn": "Барилга байгууламж, өрөө тасалгааны тэсрэх, шатах галын аюулын ангиллыг тодорхойлох дүрэм"
} as const satisfies CompiledDocument;
