/**
 * ГҮНИЙ СУРГАЛТЫН АГУУЛГА (2026-09-10, багц v.4) — `build_behavior_sft.mjs` импортолно.
 *
 * ⚠️ ЯАГААД ТУСДАА ФАЙЛ.  Smoke адаптер 0.1 «үргэлж богино» гэж сурсан (assistant зорилт
 *    дунджаар 48 токен, ≥128 токен ердөө 9 мөр).  Энд ОЙЛГОЛТЫН тайлбар (normal),
 *    БҮТЭЦТЭЙ дэлгэрэнгүй тайлбар (detailed) ба ХАРЬЦУУЛСАН хос (ижил сэдэв: «товчхон» →
 *    1–2 өгүүлбэр, «дэлгэрэнгүй» → бүтэцтэй) байна.  Зорилго нь «урт» биш, «ЗӨВ ГҮН».
 *
 * ⚠️ ЭХ СУРВАЛЖ-ТӨВИЙГ САХИСАН: нормын ТОО, бодит баримтын код, бодит төсөл/хүний нэр
 *    БАЙХГҮЙ — эдгээр нь хэл, бүтэц, тайлбарын чанарыг заана, баримтыг биш (§22).
 *    Системийн тухай баримтууд (ET/EZ/AZ, батлах урсгал, портал) нь CLAUDE.md-ийн
 *    баримтжуулсан тогтмол дүрэм.
 *
 * ⚠️ Markdown ХЭРЭГТЭЙ ҮЕД Л: normal → энгийн догол мөр (тод баримт зөвшөөрнө);
 *    detailed → богино гарчиг/жагсаалт; «Танилцуулга/Дүгнэлт» загварыг ДАВТАХГҮЙ.
 */

/** Нэг сэдэв: асуултын 5 хэлбэр [кирилл, латин, англи, кирилл-алдаатай, латин-алдаатай] + normal/short/detailed зорилт (mn, en). */
export const TOPICS = [
  {
    key: 'author-supervision',
    q: ['Зохиогчийн хяналт гэж юу вэ?', 'zohiogchiin hyanalt gej yu ve', 'What is author supervision (ASR)?', 'Зохиогчийн хяналт гэж юу вэ', 'zohiogchin hyanalt gej yu ve'],
    short: {
      mn: 'Зохиогчийн хяналт нь зураг төслийг боловсруулсан баг барилгын явцад ажил зурагтаа нийцэж байгаа эсэхийг шалгаж, тэмдэглэл үлдээх үйл ажиллагаа.',
      en: 'Author supervision is the design team checking, during construction, that the work matches the drawings and recording what it finds.',
    },
    normal: {
      mn: 'Зохиогчийн хяналт нь зураг төслийг боловсруулсан баг барилгын явцад талбай дээр очиж, гүйцэтгэл зурагтаа нийцэж байгаа эсэхийг шалгах үйл ажиллагаа.\n\nҮр дүн нь зохиогчийн хяналтын тайлан (ASR) хэлбэрээр бүртгэгдэнэ: очсон огноо, юу шалгасан, ямар зөрүү илэрсэн, ямар шийдвэр өгсөн. Тайлан батлагдсаны дараа захиалагчид харагдах боломжтой.',
      en: 'Author supervision is the design team visiting the site during construction to check that the work matches the drawings.\n\nThe result is recorded as an author-supervision report (ASR): visit date, what was checked, which deviations were found and what was decided. Once approved, the report can be shown to the client.',
    },
    detailed: {
      mn: 'Зохиогчийн хяналт нь зураг төслийг боловсруулсан баг барилгын явцад гүйцэтгэлийг зурагтай тулган шалгах, зөрүүг бүртгэх, шийдвэр өгөх үйл ажиллагаа.\n\n**Юу хийдэг вэ**\n- Талбайд очиж хийц, материал, хэмжээг зурагтай тулгана.\n- Илэрсэн зөрүү бүрийг тэмдэглэж, засах эсвэл зөвшөөрөх шийдвэр өгнө.\n- Захиалагч, гүйцэтгэгчийн асуултад зураг зохиогчийн байр сууринаас хариулна.\n\n**Тайлан (ASR)**\n- Айлчлал бүр нэг тайлан: огноо, шалгасан хэсэг, зөрүү, шийдвэр, фото.\n- Тайлан ноорог → илгээсэн → батлагдсан гэсэн төлөвөөр явна; батлагдсаны дараа л захиалагчид харагдана.\n\n**Яагаад чухал вэ**\nЗурагнаас зөрсөн гүйцэтгэлийг эрт барих нь дараа нь засахаас хамаагүй хямд, мөн хариуцлагын хил тодорхой болно.',
      en: 'Author supervision is the design team checking the construction against the drawings, recording deviations and giving decisions during the build.\n\n**What it involves**\n- Site visits comparing structure, materials and dimensions with the drawings.\n- Every deviation is recorded with a decision: fix it or accept it.\n- Answering client and contractor questions from the designer\'s side.\n\n**The report (ASR)**\n- One report per visit: date, area checked, deviations, decisions, photos.\n- Reports move draft → submitted → approved; only approved reports are visible to the client.\n\n**Why it matters**\nCatching a deviation early is far cheaper than fixing it later, and it keeps responsibility boundaries clear.',
    },
  },
  {
    key: 'working-drawing-set',
    q: ['Ажлын зургийн иж бүрдэл гэж юу вэ?', 'ajliin zurgiin ij burdel gej yu ve', 'What is a working-drawing set?', 'Ажлын зургын иж бүрдэл гэж юу вэ', 'ajlin zurgiin ij burdel gej yu ve'],
    short: {
      mn: 'Ажлын зургийн иж бүрдэл нь барилгыг барихад хэрэгтэй бүх салбарын зураг, тайлбар, ерөнхий мэдээллийн нэгдсэн багц.',
      en: 'A working-drawing set is the complete package of drawings and notes, from every discipline, needed to build the project.',
    },
    normal: {
      mn: 'Ажлын зургийн иж бүрдэл нь барилгыг барихад шаардлагатай бүх зургийг салбар бүрээр нь нэгтгэсэн багц.\n\nЕрөнхийдөө архитектур, барилгын хийц, ус хангамж, халаалт-агааржуулалт, цахилгаан, холбоо гэсэн хэсгүүдээс бүрдэнэ; хэсэг бүр өөрийн зургийн кодтой. Багц нь хувилбартай — засвар орсон зураг шинэ хувилбараар гарч, хуучин нь түүх болж үлдэнэ.',
      en: 'A working-drawing set is the package of every drawing needed to build the project, organised by discipline.\n\nTypically it covers architecture, structure, water supply, heating and ventilation, electrical and communications; each discipline has its own drawing code. The set is versioned — a revised drawing is issued as a new version and the old one stays as history.',
    },
    detailed: {
      mn: 'Ажлын зургийн иж бүрдэл нь барилгыг барихад шаардлагатай бүх зургийн нэгдсэн, хувилбартай багц.\n\n**Юунаас бүрдэх вэ**\n- Ерөнхий хэсэг: нүүр, зургийн жагсаалт, ерөнхий тайлбар, ерөнхий төлөвлөгөө.\n- Архитектур: план, фасад, огтлол, зангилаа, эдлэлийн жагсаалт.\n- Барилгын хийц: суурь, карказ, хучилт, хийцийн зангилаа.\n- Инженерийн систем: ус хангамж, халаалт-агааржуулалт, цахилгаан, холбоо.\n\n**Хэрхэн зохион байгуулагддаг вэ**\n- Хэсэг бүр өөрийн кодтой (жишээ нь архитектурын зураг, барилгын хийц гэх мэт), хуудас бүр дугаартай.\n- Зураг бүр хувилбартай: засвар орсон хуудас шинэ хувилбараар гарч, хуучин нь устахгүй, хүчингүй болсон гэж тэмдэглэгдэнэ.\n- Гаргасан багц нь захиалагч, гүйцэтгэгчид нэг дор хүрдэг тул талууд ижил хувилбар дээр ажиллана.\n\n**Юу гэж ойлгохгүй байх вэ**\nИж бүрдэл нь эскиз, ерөнхий төлөвлөгөөний шатны материал биш — тэдгээр санааг тогтоодог бол ажлын зураг хэмжээ бүрийг тогтооно.',
      en: 'A working-drawing set is the complete, versioned package of drawings needed to build the project.\n\n**What it contains**\n- General part: cover, drawing list, general notes, site plan.\n- Architecture: plans, elevations, sections, details, schedules.\n- Structure: foundations, frame, slabs, structural details.\n- Building services: water supply, heating and ventilation, electrical, communications.\n\n**How it is organised**\n- Each discipline has its own code and every sheet is numbered.\n- Every drawing is versioned: a revised sheet is issued as a new version; the old one is kept and marked superseded.\n- An issued set reaches the client and contractor together, so everyone works from the same version.\n\n**What it is not**\nIt is not sketch or master-plan material — those fix the idea; working drawings fix every dimension.',
    },
  },
  {
    key: 'design-brief',
    q: ['Зураг төслийн даалгавар гэж юу вэ, юу агуулдаг вэ?', 'zurag tosliin daalgavar gej yu ve, yu aguuldag ve', 'What is a design brief and what does it contain?', 'Зураг төслийн даалгавар гэж юу вэ юу агуулдаг вэ', 'zurag toslin daalgavar gej yu ve yu aguuldg ve'],
    short: {
      mn: 'Зураг төслийн даалгавар нь захиалагчийн шаардлагыг нэг баримтад нэгтгэсэн, зураг төслийн ажлын эхлэлийн үндэс.',
      en: 'A design brief is the single document that collects the client\'s requirements and starts the design work.',
    },
    normal: {
      mn: 'Зураг төслийн даалгавар нь захиалагчийн шаардлагыг нэг баримтад нэгтгэсэн, зураг төслийн ажлыг эхлүүлэх үндэс.\n\nИхэвчлэн барилгын зориулалт, талбай, давхрын тоо, хүчин чадал, тавигдах онцгой шаардлага, хугацаа зэргийг агуулна. Захиалагч даалгаврыг баталсны дараа л зураг зохиогчид эскизийн ажлаа эхэлдэг; дараа нь өөрчлөх бол албан ёсоор нэмэлт хийнэ.',
      en: 'A design brief is the document that collects the client\'s requirements and starts the design work.\n\nIt usually states the building\'s purpose, site, number of storeys, capacity, any special requirements and the timeline. Designers start sketch work only after the client approves it; later changes are made as formal amendments.',
    },
    detailed: {
      mn: 'Зураг төслийн даалгавар нь захиалагчийн шаардлагыг нэг баримтад нэгтгэсэн, зураг төслийн бүх ажлын эхлэл.\n\n**Юу агуулдаг вэ**\n- Зориулалт, байршил, талбайн нөхцөл.\n- Хэмжээ: талбай, давхрын тоо, хүчин чадал.\n- Онцгой шаардлага: инженерийн систем, материал, хүртээмж, аюулгүй байдал.\n- Хугацаа, шатлал, хүлээлгэн өгөх материалын жагсаалт.\n\n**Яагаад чухал вэ**\n- Даалгавар нь зураг зохиогч, захиалагч хоёрын гэрээт хүрээ: түүнд байхгүй зүйл ажлын хүрээнд орохгүй.\n- Батлагдсаны дараа өөрчлөлт нь албан ёсны нэмэлтээр орж, хугацаа, төлбөрт нөлөөлнө.\n\n**Урсгал**\nЗахиалагч даалгаврыг бэлтгэж баталгаажуулна → зураг зохиогч эскизийн шатыг эхлүүлнэ → эскиз батлагдсаны дараа ажлын зураг руу орно.',
      en: 'A design brief is the single document that collects the client\'s requirements and starts all design work.\n\n**What it contains**\n- Purpose, location, site conditions.\n- Size: floor area, number of storeys, capacity.\n- Special requirements: building services, materials, accessibility, safety.\n- Timeline, stages and the list of deliverables.\n\n**Why it matters**\n- The brief is the contractual scope between designer and client: what is not in it is not in scope.\n- After approval, changes go through formal amendments and affect time and fees.\n\n**Flow**\nThe client prepares and approves the brief → the designer starts the sketch stage → after sketch approval, working drawings begin.',
    },
  },
  {
    key: 'bim-model',
    q: ['BIM загвар гэж юу вэ, энгийн зурагнаас юугаараа ялгаатай вэ?', 'BIM zagvar gej yu ve, engiin zurgaas yugaaraa yalgaatai ve', 'What is a BIM model and how is it different from ordinary drawings?', 'BIM загвар гэж юу вэ энгийн зурагнаас юугаар ялгаатай вэ', 'BIM zagvar gej yu ve engiin zurgaas yugaar yalgaatai ve'],
    short: {
      mn: 'BIM загвар нь барилгыг гурван хэмжээст элементүүдээр (хана, хучилт, хаалга) мэдээлэлтэй нь хамт дүрсэлсэн загвар; зураг нь түүнээс гарсан харагдац.',
      en: 'A BIM model represents the building as 3D elements (walls, slabs, doors) carrying data; drawings are views generated from it.',
    },
    normal: {
      mn: 'BIM загвар нь барилгыг шугам биш, мэдээлэлтэй элементүүдээр (хана, хучилт, хаалга, систем) дүрсэлсэн гурван хэмжээст загвар.\n\nЭнгийн зурагт хана бол хоёр шугам; BIM-д хана бол зузаан, материал, өндөр, давхар зэрэг шинжтэй объект. План, огтлол, фасад, тоо хэмжээ бүгд тэр нэг загвараас гардаг тул нэг газар засахад бүх харагдац дагаж өөрчлөгдөнө.',
      en: 'A BIM model represents the building as data-carrying elements (walls, slabs, doors, services) in 3D rather than as lines.\n\nIn an ordinary drawing a wall is two lines; in BIM it is an object with thickness, material, height and level. Plans, sections, elevations and quantities all come from that one model, so one change updates every view.',
    },
    detailed: {
      mn: 'BIM загвар нь барилгыг мэдээлэлтэй элементүүдээр дүрсэлсэн гурван хэмжээст загвар; энгийн зураг нь түүнээс гаргасан харагдац.\n\n**Ялгаа**\n- Элемент ба мэдээлэл: хана, хучилт, хаалга бүр зузаан, материал, түвшин зэрэг шинжтэй объект — зурагт бол зөвхөн шугам.\n- Нэг эх сурвалж: план, огтлол, фасад, тоо хэмжээ бүгд нэг загвараас гардаг; зурагт тэдгээр тус тусдаа файл.\n- Уялдаа: нэг газар засахад бүх харагдац шинэчлэгдэнэ; зурагт хуудас бүрийг гараар засна.\n\n**Юунд тустай вэ**\n- Салбар хоорондын мөргөлдөөнийг (систем ханаар дайрах) урьдчилан олох.\n- Тоо хэмжээг загвараас шууд гаргах — гараар тоолох алдаа багасна.\n- Хувилбар, өөрчлөлтийн түүх нэг загварт хадгалагдана.\n\n**Хязгаар**\nЗагварын чанар нь оруулсан мэдээллээс хамаарна: буруу шинжтэй элемент буруу тоо, буруу зураг гаргана.',
      en: 'A BIM model represents the building as data-carrying 3D elements; ordinary drawings are views produced from it.\n\n**Differences**\n- Elements with data: every wall, slab and door is an object with thickness, material and level — in a drawing it is just lines.\n- Single source: plans, sections, elevations and quantities all come from one model; with drawings they are separate files.\n- Consistency: change something once and every view updates; with drawings each sheet is edited by hand.\n\n**What it is good for**\n- Finding clashes between disciplines (a duct through a wall) before construction.\n- Taking quantities straight from the model — fewer manual counting errors.\n- Keeping versions and change history in one model.\n\n**Limits**\nThe model is only as good as its data: wrongly attributed elements produce wrong quantities and wrong drawings.',
    },
  },
  {
    key: 'progress-rollup',
    q: ['Төслийн явц яаж тооцогдож, юунаас хамаардаг вэ?', 'tosliin yavts yaj tootsogdoj, yunaas hamaardag ve', 'How is project progress calculated and what does it depend on?', 'Төслийн явц яаж тооцогдож юунаас хамаардг вэ', 'tosliin yavts yaj tootsogdoj yunas hamaardag ve'],
    short: {
      mn: 'Төслийн явц нь даалгаврын хувиудыг жингээр нь зураг → блок → баг → төсөл гэсэн шатлалаар нэгтгэсэн жинлэсэн нийлбэр.',
      en: 'Project progress is a weighted roll-up of task percentages through drawing → block → team → project.',
    },
    normal: {
      mn: 'Төслийн явц нь даалгавар бүрийн хувийг жингээр нь нэгтгэсэн жинлэсэн нийлбэр.\n\nДаалгаврын хувь × жин нь зургийн явц болно, зургууд блок дотроо, блокууд баг дотроо, багууд төслийн хувиараа нийлнэ. Тиймээс явц нь даалгаврын хувиас гадна жин, багийн хувь зөв тавигдсан эсэхээс шууд хамаарна — жин 100-д хүрэхгүй бол явц бодитоос доогуур харагдана.',
      en: 'Project progress is a weighted sum of every task\'s percentage.\n\nTask percentage × weight gives the drawing\'s progress; drawings roll up within their block, blocks within their team, and teams by their share of the project. So progress depends not only on task percentages but on whether weights and team shares are set correctly — weights that do not reach 100 make progress read low.',
    },
    detailed: {
      mn: 'Төслийн явц нь даалгаврын хувиудыг жингээр нь дөрвөн шатлалаар нэгтгэсэн жинлэсэн нийлбэр.\n\n**Шатлал**\n1. Даалгавар → зураг: даалгавар бүрийн хувь × жин, зургийн зарласан жинд хуваана.\n2. Зураг → блок: зургийн жин × зургийн явц.\n3. Блок → баг: блокийн жин × блокийн явц.\n4. Баг → төсөл: багийн төслийн хувь × багийн явц.\n\n**Юунаас хамаардаг вэ**\n- Даалгаврын батлагдсан сүүлийн хувь.\n- Шат бүрийн жин: зарласан жинд хуваадаг тул хуваарилагдаагүй жин «дуусаагүй ажил» гэж тоологдоно.\n- Багийн хувь: 100-д хүрэхгүй бол төсөл бодитоос доогуур, хэтэрвэл дээгүүр харагдана — энэ зориудын шинж, буруу жинг нуухгүй.\n\n**Практик дүгнэлт**\nЯвц хачирхалтай харагдвал эхлээд жин, хувийн нийлбэрийг шалга; дараа нь батлагдаагүй 100%-ийн илгээлт байгаа эсэхийг.',
      en: 'Project progress is a weighted roll-up of task percentages through four levels.\n\n**The levels**\n1. Task → drawing: each task\'s percentage × weight, divided by the drawing\'s declared weight.\n2. Drawing → block: drawing weight × drawing progress.\n3. Block → team: block weight × block progress.\n4. Team → project: the team\'s project share × team progress.\n\n**What it depends on**\n- The latest approved percentage of each task.\n- Weights at every level: division is by the declared weight, so unallocated weight counts as unfinished work.\n- Team shares: below 100 the project reads low, above 100 it reads high — deliberately, so bad weights stay visible.\n\n**Practical takeaway**\nIf progress looks odd, check the weight and share sums first, then look for 100% submissions still waiting for approval.',
    },
  },
  {
    key: 'bim-worksharing',
    q: ['Revit-ийн worksharing гэж юу вэ, багаар яаж ажилладаг вэ?', 'Revit-iin worksharing gej yu ve, bagaar yaj ajilladag ve', 'What is Revit worksharing and how does a team use it?', 'Ревитийн worksharing гэж юу вэ багаар яаж ажилладг вэ', 'revitiin worksharing gej yu ve bagaar yaj ajilladg ve'],
    short: {
      mn: 'Worksharing нь нэг Revit загвар дээр олон хүн зэрэг ажиллах горим: төв файл нэг, хүн бүр локал хувь дээрээ ажиллаад синк хийнэ.',
      en: 'Worksharing lets several people work on one Revit model at once: one central file, each person on a local copy that syncs back.',
    },
    normal: {
      mn: 'Worksharing нь нэг Revit загвар дээр олон хүн зэрэг ажиллах горим.\n\nТөв файл нэг байна; ажилтан бүр өөрийн локал хувь дээр ажиллаад тодорхой давтамжтай синк хийж өөрчлөлтөө нэгтгэнэ. Элементүүд workset-ээр бүлэглэгдэж, хэн аль хэсгийг засаж байгааг систем хянадаг тул зэрэг засах мөргөлдөөн багасна.',
      en: 'Worksharing lets several people work on one Revit model at the same time.\n\nThere is one central file; each person works on a local copy and synchronises regularly to merge changes. Elements are grouped into worksets and the system tracks who is editing what, which keeps editing conflicts down.',
    },
    detailed: {
      mn: 'Worksharing нь нэг Revit загвар дээр олон хүн зэрэг ажиллах горим.\n\n**Бүтэц**\n- Төв файл (central) нэг — сервер эсвэл хуваалцсан хавтас дээр.\n- Ажилтан бүр локал хувь (local) үүсгэж, түүн дээрээ ажиллана.\n- Synchronize with Central нь локал өөрчлөлтийг төв рүү, төвийн өөрчлөлтийг локал руу нэгтгэнэ.\n\n**Workset ба эзэмшил**\n- Элементүүд workset-ээр бүлэглэгдэнэ (жишээ нь тэнхлэг, гадна хана, интерьер).\n- Элементийг засахад систем түүнийг таны нэр дээр түр эзэмшүүлнэ; өөр хүн тэр элементийг засах гэвэл хүсэлт илгээнэ.\n- Синк хийхэд эзэмшил чөлөөлөгдөнө — удаан синк хийхгүй байх нь багийн гол зовлон.\n\n**Багийн дүрэм**\n- Тогтмол синк (жишээ нь цаг тутам) ба ажлын өдрийн төгсгөлд заавал.\n- Төв файлыг шууд нээж ажиллахгүй.\n- Workset-ийг салбар, бүсээр цэгцтэй нэрлэх.',
      en: 'Worksharing lets several people work on one Revit model at the same time.\n\n**Structure**\n- One central file on a server or shared folder.\n- Each person creates a local copy and works there.\n- Synchronize with Central merges local changes into the central file and pulls others\' changes down.\n\n**Worksets and ownership**\n- Elements are grouped into worksets (grids, exterior walls, interiors, and so on).\n- Editing an element temporarily makes you its owner; someone else wanting to edit it sends a request.\n- Synchronising releases ownership — people who rarely sync are the team\'s main pain point.\n\n**Team rules**\n- Sync regularly (for example hourly) and always at the end of the day.\n- Never work directly in the central file.\n- Name worksets consistently by discipline and zone.',
    },
  },
  {
    key: 'approval-rejection',
    q: ['Явцын илгээлт буцаагдвал юу болдог вэ?', 'yavtsiin ilgeelt butsaagdval yu boldog ve', 'What happens when a progress submission is rejected?', 'Явцын илгээлт буцаагдвал юу болдг вэ', 'yavtsin ilgeelt butsaagdval yu boldog ve'],
    short: {
      mn: 'Буцаагдсан 100%-ийн илгээлт даалгаврыг хаахгүй; батлагч тайлбар бичиж буцаана, ажилтан засаад дахин илгээнэ.',
      en: 'A rejected 100% submission does not close the task; the approver returns it with a note and the employee resubmits after fixing.',
    },
    normal: {
      mn: 'Буцаалт зөвхөн 100%-д хүрсэн илгээлтэд байдаг — түүнээс доош хувь шууд батлагддаг.\n\nБатлагч буцаахдаа тайлбар заавал бичнэ; даалгавар хаагдахгүй, оноо олгогдохгүй. Ажилтан тайлбарын дагуу засаад дахин илгээж, батлагдсаны дараа л даалгавар хаагдаж оноо бодогдоно.',
      en: 'Rejection only exists for submissions that reach 100% — anything below is approved automatically.\n\nThe approver must write a note when rejecting; the task stays open and no points are awarded. The employee fixes the work, resubmits, and only after approval does the task close and points get calculated.',
    },
    detailed: {
      mn: 'Буцаалт нь зөвхөн 100%-д хүрсэн илгээлтэд хамаарна; түүнээс доош хувь хяналтгүй батлагддаг.\n\n**Буцаахад юу болдог вэ**\n- Батлагч тайлбар заавал бичнэ — тайлбаргүй буцаалт систем хүлээж авахгүй.\n- Даалгавар нээлттэй хэвээр, явц өмнөх батлагдсан хувь дээрээ үлдэнэ.\n- Оноо олгогдохгүй: оноо зөвхөн батлагдсан явцын өөрчлөлтөөс бодогдоно.\n\n**Дараа нь**\n1. Ажилтан тайлбарыг уншиж засна.\n2. Дуусгалтын асуултуудад дахин хариулж 100%-ийг дахин илгээнэ.\n3. Админ эсвэл тухайн багийн senior батлана.\n\n**Хэн батлах эрхтэй вэ**\nАдмин, эсвэл тухайн даалгаврын багийн гишүүн senior; багийн ахлагч байх шаардлагагүй — ахлагч зөвхөн мэдэгдэл хүлээж авдаг.',
      en: 'Rejection applies only to submissions that reach 100%; lower percentages are approved without review.\n\n**What happens on rejection**\n- The approver must write a note — the system does not accept a rejection without one.\n- The task stays open and progress remains at the previously approved percentage.\n- No points are awarded: points come only from approved progress changes.\n\n**What happens next**\n1. The employee reads the note and fixes the work.\n2. They answer the completion questions again and resubmit 100%.\n3. An admin or a senior on that team approves.\n\n**Who can approve**\nAn admin, or a senior who is a member of the task\'s team; being the team lead is not required — the lead only receives the notification.',
    },
  },
  {
    key: 'sketch-stage',
    q: ['Эскиз зургийн шат юуг шийддэг вэ, ажлын зургаас юугаараа ялгаатай вэ?', 'eskiz zurgiin shat yug shiiddeg ve, ajliin zurgaas yugaaraa yalgaatai ve', 'What does the sketch-design stage decide, and how does it differ from working drawings?', 'Эскиз зургийн шат юуг шийддг вэ ажлын зурагнаас юугаар ялгаатай вэ', 'eskiz zurgiin shat yug shiiddeg ve ajlin zurgaas yugaar yalgaatai ve'],
    short: {
      mn: 'Эскизийн шат барилгын санааг (эзлэхүүн, план, фасад) тогтоож захиалагчаар батлуулдаг; ажлын зураг тэр санааны хэмжээ бүрийг тогтооно.',
      en: 'The sketch stage fixes the idea — massing, plans, elevations — for client approval; working drawings then fix every dimension of that idea.',
    },
    normal: {
      mn: 'Эскизийн шат барилгын үндсэн санааг тогтооно: эзлэхүүн, давхрын план, фасад, талбай дээрх байршил. Үр дүнг захиалагч баталдаг тул энэ шат нь «юу барих вэ» гэсэн асуултын хариу.\n\nАжлын зураг нь батлагдсан санааг барих боломжтой болгож хэмжээ, хийц, материал, инженерийн системийг нарийвчилна — «яаж барих вэ». Эскиз дээр өөрчлөлт хямд, ажлын зураг дээр өөрчлөлт бүх салбарын зургийг дагуулдаг.',
      en: 'The sketch stage fixes the building\'s core idea: massing, floor plans, elevations, placement on the site. The client approves the result, so this stage answers "what will be built".\n\nWorking drawings turn the approved idea into something buildable — dimensions, structure, materials, services — answering "how it will be built". A change at sketch level is cheap; a change at working-drawing level ripples through every discipline.',
    },
    detailed: {
      mn: 'Эскизийн шат барилгын санааг тогтоож захиалагчаар батлуулдаг; ажлын зураг тэр санааг барих боломжтой хэмжээ, хийц болгоно.\n\n**Эскиз юуг шийддэг вэ**\n- Талбай дээрх байршил, орц, чиглэл.\n- Эзлэхүүн, давхрын тоо, давхар бүрийн план.\n- Фасадын шийдэл, гол материалын өнгө төрх.\n- Талбайн ерөнхий үзүүлэлт — захиалагчийн даалгавартай тулгах суурь.\n\n**Ажлын зураг юугаараа ялгаатай вэ**\n- Хэмжээ бүр тогтсон: тэнхлэг, өндөр, зузаан, нээлхий.\n- Салбар бүр өөрийн багцтай: хийц, ус, халаалт, цахилгаан.\n- Зангилаа, эдлэлийн жагсаалт, материалын тодорхойлолт орно.\n\n**Яагаад дараалал чухал вэ**\nЭскиз батлагдахаас өмнө ажлын зураг эхлүүлбэл захиалагчийн нэг өөрчлөлт бүх салбарын зургийг дахин хийлгэнэ. Тиймээс эскиз → батлах → ажлын зураг гэсэн дараалал нь цаг, зардлын хамгаалалт.',
      en: 'The sketch stage fixes the building idea and gets it approved by the client; working drawings turn that idea into buildable dimensions and structure.\n\n**What the sketch stage decides**\n- Placement on the site, access, orientation.\n- Massing, number of storeys, the plan of each floor.\n- Facade concept and the look of the main materials.\n- Headline areas — the basis for checking against the client\'s brief.\n\n**How working drawings differ**\n- Every dimension is fixed: grids, heights, thicknesses, openings.\n- Each discipline has its own set: structure, water, heating, electrical.\n- Details, schedules and material specifications are included.\n\n**Why the order matters**\nStarting working drawings before the sketch is approved means one client change redoes every discipline\'s drawings. Sketch → approval → working drawings protects both time and cost.',
    },
  },
];

/**
 * ХАРЬЦУУЛСАН ХОС — ижил сэдэвт ил гүний хүсэлт.  Кернел `decideDepth`-ээр
 * ил хүсэлтийг таньж зааварт «ГҮН: ТОВЧ/ДЭЛГЭРЭНГҮЙ» өгнө; зорилт нь тэр мөрийг
 * дагана.  [кирилл, латин, англи] — товч/дэлгэрэнгүй тус бүр.
 */
export const CONTRAST_SUFFIX = {
  short: [' — товчхон хэлээч', ' tovchhon heleech', ' — briefly'],
  detailed: [' — дэлгэрэнгүй тайлбарла', ' delgerengui tailbarla', ' — explain in detail'],
};

/**
 * ERP ШИНЖИЛГЭЭНИЙ ЗОРИЛТ — `analyze_project` баримтаас (тоо бүр хайрцгаас) бүтэцтэй
 * шинжилгээ.  Төслийн нэр ЭХНИЙ өгүүлбэрт (C2-ийн сургамж: нэр хадгалагдана).
 */
export function analysisDetailed(f, L, _contract, toolResults = []) {
  const name = f.project_name;
  const rows = [];
  const add = (cond, mn, en) => { if (cond) rows.push(L === 'en' ? en : mn); };
  // ⚠️ v.5 — БҮТЭН хайрцгийг уншина.  Бодит `analyze_project` нь `days_since_last_progress`,
  //    `days_remaining`, `overdue_by_team`-ийг ч өгдөг (analytics.ts); 4 талбар л үзсэн адаптер
  //    бодит хайрцагт төөрч байв (0.2a, C2).  Тоо бүр хайрцгаас — гэрээний allowedNumbers-т байна.
  const ap = toolResults.find((t) => t.tool === 'analyze_project' && t.ok)?.data ?? null;
  const af = ap?.facts ?? {};
  const daysSince = Number.isFinite(Number(af.days_since_last_progress)) && af.days_since_last_progress !== null ? Number(af.days_since_last_progress) : null;
  const daysLeft = ap?.project && Number.isFinite(Number(ap.project.days_remaining)) && ap.project.days_remaining !== null ? Number(ap.project.days_remaining) : null;
  const topTeam = Array.isArray(af.overdue_by_team) && af.overdue_by_team[0] ? af.overdue_by_team[0] : null;
  add(Number(f.tasks_overdue) > 0, `- **Хугацаа хэтэрсэн даалгавар ${f.tasks_overdue}** — deadline өнгөрсөн ажил шууд явцыг барьж байна.`, `- **${f.tasks_overdue} overdue tasks** — work past its deadline is holding progress directly.`);
  add(Number(f.tasks_stale_14d) > 0, `- **${f.tasks_stale_14d} даалгавар хоёр долоо хоногоос дээш хөдөлгөөнгүй** — эхэлсэн ч явц оруулаагүй ажил; хамгийн том дохио.`, `- **${f.tasks_stale_14d} tasks idle for over two weeks** — started but no progress logged; the strongest signal.`);
  add(Number(f.tasks_unassigned_open) > 0, `- **${f.tasks_unassigned_open} хариуцагчгүй нээлттэй даалгавар** — эзэнгүй ажил хэн ч хөдөлгөхгүй.`, `- **${f.tasks_unassigned_open} open tasks with no assignee** — nobody moves unowned work.`);
  add(Number(f.pending_approvals) > 0, `- **${f.pending_approvals} дууссан илгээлт батлагдахаа хүлээж байна** — ажил дууссан ч явцад тусаагүй.`, `- **${f.pending_approvals} finished submissions awaiting approval** — done, but not yet counted.`);
  add(daysSince !== null && daysSince > 7, `- **Сүүлийн батлагдсан явц ${daysSince} хоногийн өмнө** — түүнээс хойш явц бүртгэгдээгүй.`, `- **Last approved progress was ${daysSince} days ago** — nothing has been logged since.`);
  add(daysLeft !== null && daysLeft <= 14 && Number(f.project_progress) < 80, daysLeft < 0 ? `- **Дуусах хугацаа ${-daysLeft} хоногийн өмнө өнгөрсөн** атлаа явц ${f.project_progress}% — хуваарь бодитой биш.` : `- **Дуусахад ${daysLeft} хоног үлдсэн** атлаа явц ${f.project_progress}% — хуваарь бодитой биш.`, daysLeft < 0 ? `- **The finish date passed ${-daysLeft} days ago** while progress is ${f.project_progress}% — the schedule is not realistic.` : `- **${daysLeft} days to the finish date** while progress is ${f.project_progress}% — the schedule is not realistic.`);
  add(topTeam && Number(topTeam.overdue) > 0, `- Хоцролт хамгийн их баг: **${topTeam?.team_code}** (${topTeam?.overdue}).`, `- Team with the most overdue work: **${topTeam?.team_code}** (${topTeam?.overdue}).`);
  const head = L === 'en' ? `${name} is at ${f.project_progress}% — the delay comes from task status, not from missing work alone.` : `${name} төслийн явц ${f.project_progress}% — удаашрал даалгаврын төлөвөөс харагдаж байна.`;
  const body = rows.length ? rows.join('\n') : (L === 'en' ? '- The tool shows no overdue, idle or unassigned tasks — the slowdown is not visible in task status.' : '- Хоцорсон, зогссон, хариуцагчгүй даалгавар алга — удаашрал даалгаврын төлөвт харагдахгүй.');
  const biggest = Number(f.tasks_stale_14d) >= Math.max(Number(f.tasks_overdue), Number(f.tasks_unassigned_open), Number(f.pending_approvals)) && Number(f.tasks_stale_14d) > 0
    ? (L === 'en' ? 'The idle tasks dominate: assign a date to each and review them first.' : 'Хөдөлгөөнгүй даалгаврууд голлож байна — тус бүрд хугацаа тавьж эхэлж шалга.')
    : Number(f.pending_approvals) > 0
      ? (L === 'en' ? 'Approving the pending submissions would move progress immediately.' : 'Хүлээгдэж буй илгээлтүүдийг батлахад явц шууд хөдөлнө.')
      : (L === 'en' ? 'Start with the overdue tasks — they are the visible blockers.' : 'Хоцорсон даалгавраас эхэл — тэдгээр нь ил саад.');
  return `${head}\n\n${L === 'en' ? '**What is holding it**' : '**Юу барьж байна**'}\n${body}\n\n${biggest}`;
}
