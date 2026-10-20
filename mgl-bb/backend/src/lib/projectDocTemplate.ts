/**
 * Төсөл бүрийн стандарт 00–12 хавтас + «00»/«07»/«11»-ийн дэд хавтас.
 *
 * ⚠️ 2026-09-03-аас хойш ЭДГЭЭР НЬ ЗӨВХӨН ЖАГСААЛТ.  Баримт бичгийн модуль
 * төслөөс салж, серверээс импортолсон «архив» дээр түшиглэсэн (migration
 * 0249-0251) тул хавтас автоматаар тарихаа больсон — `seedProjectFolders`
 * болон түүний туслахуудыг устгав (`document_folders`-д `project_id` багана
 * байхаа больсон тул тэдгээр нь ажиллахаа ч байсан).
 *
 * Жагсаалт нь кодод үлдсэн: `frontend/.../documents/template.ts` нь хавтасны
 * `code`-оор тайлбар харуулахдаа ижил өгөгдлийг барьдаг, мөн хэрэв ирээдүйд
 * «архивт загвар тарих» хэрэгтэй болвол эх сурвалж нь энэ.
 */

export const PROJECT_DOC_FOLDERS = [
  { code: '00', sort_order: 0, name: '00 БИЧИГ БАРИМТ', hint_mn: 'Ерөнхий гэрээ, журам, гарын авлага', hint_en: 'Contracts, procedures, manuals' },
  { code: '01', sort_order: 1, name: '01 PROJECT DESCRIPTION', hint_mn: 'Төслийн тодорхойлолт, хамрах хүрээ, passport', hint_en: 'Project brief, scope, passport' },
  { code: '02', sort_order: 2, name: '02 ТАЙЛАН', hint_mn: 'Явцын/гүйцэтгэлийн тайлан', hint_en: 'Progress and performance reports' },
  { code: '03', sort_order: 3, name: '03 АКТ', hint_mn: 'Гарын үсэгтэй акт, хүлээлгэн өгөх баримт', hint_en: 'Signed acts and handover records' },
  { code: '04', sort_order: 4, name: '04 МЭДЭЭЛЭЛ ТОДРУУЛГЫН ХҮСЭЛТ (RFI)', hint_mn: 'RFI хүсэлт, хариу', hint_en: 'Requests for information' },
  { code: '05', sort_order: 5, name: '05 ЗУРАГ ӨӨРЧЛӨЛТИЙН ХҮСЭЛТ (CR)', hint_mn: 'Зураг өөрчлөлтийн хүсэлт', hint_en: 'Drawing change requests' },
  { code: '06', sort_order: 6, name: '06 ХУРЛЫН ТЭМДЭГЛЭЛ (MR)', hint_mn: 'Хурлын тэмдэглэл', hint_en: 'Meeting records' },
  { code: '07', sort_order: 7, name: '07 АЛБАН БИЧИГ (OL)', hint_mn: 'Албан бичиг', hint_en: 'Official letters' },
  { code: '08', sort_order: 8, name: '08 EMAIL COMMUNICATION', hint_mn: 'Имэйл харилцаа (screenshot/PDF)', hint_en: 'Email correspondence' },
  { code: '09', sort_order: 9, name: '09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ', hint_mn: 'Захиалагчаас ирсэн материал', hint_en: 'Materials received from the client' },
  { code: '10', sort_order: 10, name: '10 ЗАХИАЛАГЧААР БАТАЛГААЖСАН ЗУРАГ', hint_mn: 'Батлагдсан зураг', hint_en: 'Client-approved drawings' },
  { code: '11', sort_order: 11, name: '11 ЗОХИОГЧИЙН ХЯНАЛТ', hint_mn: 'DASR / зохиогчийн хяналт', hint_en: 'Design author supervision (DASR)' },
  { code: '12', sort_order: 12, name: '12 ТӨСЛИЙН ГҮЙЦЭТГЭЛ', hint_mn: 'Гүйцэтгэл, явцын график', hint_en: 'Progress charts and execution records' },
] as const;

/** `00 БИЧИГ БАРИМТ` доторх стандарт дэд хавтас. code нь `00-NN` — root-той давхцахгүй. */
export const PROJECT_DOC_00_FOLDERS = [
  { code: '00-01', sort_order: 1, name: '01 А ДААЛГАВАР,ЭСКИЗ,КАДАСТР, ГАЗРЫН ГЭРЧИЛГЭЭ', hint_mn: 'А даалгавар, эскиз, кадастр, газрын гэрчилгээ', hint_en: 'Assignment, sketch, cadastre, land certificate' },
  { code: '00-02', sort_order: 2, name: '02 ГЕОЛОГИ, ДЭВСГЭР ЗУРАГ', hint_mn: 'Геологийн дүгнэлт, дэвсгэр зураг', hint_en: 'Geology and site survey drawings' },
  { code: '00-03', sort_order: 3, name: '03 ТЕХНИКИЙН НӨХЦӨЛ', hint_mn: 'Техникийн нөхцөл', hint_en: 'Technical conditions' },
  { code: '00-04', sort_order: 4, name: '04 МАГАДЛАЛЫН ЕРӨНХИЙ ДҮГНЭЛТ', hint_mn: 'Магадлалын ерөнхий дүгнэлт', hint_en: 'General expert review' },
  { code: '00-05', sort_order: 5, name: '05 ОНЦГОЙ ДҮГНЭЛТ', hint_mn: 'Онцгой дүгнэлт', hint_en: 'Special conclusion' },
  { code: '00-06', sort_order: 6, name: '06 ЭРҮҮЛ АХУЙН ДҮГНЭЛТ', hint_mn: 'Эрүүл ахуйн дүгнэлт', hint_en: 'Sanitary conclusion' },
  { code: '00-07', sort_order: 7, name: '07 ЗУРГИЙН БАТЛАГДСАН НҮҮР', hint_mn: 'Зургийн батлагдсан нүүр', hint_en: 'Approved drawing cover' },
  { code: '00-08', sort_order: 8, name: '08 ӨНДӨР БАРИЛГЫН ХУРЛЫН ДҮГНЭЛТ', hint_mn: 'Өндөр барилгын хурлын дүгнэлт', hint_en: 'High-rise meeting conclusion' },
] as const;

/** `07 АЛБАН БИЧИГ (OL)` доторх стандарт дэд хавтас. code нь `07-NN`. */
export const PROJECT_DOC_07_FOLDERS = [
  { code: '07-01', sort_order: 1, name: '01 ИРСЭН АЛБАН БИЧИГ (Incoming_letters)', hint_mn: 'Ирсэн албан бичиг', hint_en: 'Incoming official letters' },
  { code: '07-02', sort_order: 2, name: '02 ЯВСАН АЛБАН БИЧИГ (Outgoing_Letters)', hint_mn: 'Явсан албан бичиг', hint_en: 'Outgoing official letters' },
] as const;

/** `11 ЗОХИОГЧИЙН ХЯНАЛТ` доторх стандарт дэд хавтас. code нь `11-NN`. */
export const PROJECT_DOC_11_FOLDERS = [
  { code: '11-00', sort_order: 0, name: '00 НЭГДСЭН ТАЙЛАН', hint_mn: 'Нэгдсэн тайлан', hint_en: 'Consolidated report' },
  { code: '11-01', sort_order: 1, name: '01 БАРИЛГА АРХИТЕКТУР', hint_mn: 'Барилга архитектур', hint_en: 'Architecture' },
  { code: '11-02', sort_order: 2, name: '02 БАРИЛГА БҮТЭЭЦ', hint_mn: 'Барилга бүтэц', hint_en: 'Structure' },
  { code: '11-03', sort_order: 3, name: '03 ХАЛААЛТ АГААР СЭЛГЭЛТ', hint_mn: 'Халаалт агаар сэлгэлт', hint_en: 'Heating and ventilation' },
  { code: '11-04', sort_order: 4, name: '04 ЦЭВЭР БОХИР УС', hint_mn: 'Цэвэр бохир ус', hint_en: 'Water and sewage' },
  { code: '11-05', sort_order: 5, name: '05 ЦАХИЛГААН', hint_mn: 'Цахилгаан', hint_en: 'Electrical' },
  { code: '11-06', sort_order: 6, name: '06 ХОЛБОО ДОХИОЛОЛ', hint_mn: 'Холбоо дохиолол', hint_en: 'Communications and signaling' },
  { code: '11-07', sort_order: 7, name: '07 АВТОМАТИК', hint_mn: 'Автоматик', hint_en: 'Automation' },
] as const;
