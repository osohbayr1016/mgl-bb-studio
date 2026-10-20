# §12 · Конвенц & gotcha

Заавал мэдэх зан заншил ба хавхнууд.

## Ерөнхий конвенц

- **Strict TS хаа сайгүй** (`noUncheckedIndexedAccess` backend-д). Бүү сулруул.
- **UB timezone** — `backend/src/lib/time.ts` helper (`todayInUB`, `nowInUBIso`) ашигла, огноо тооцоход `new Date()` бүү бари. Ирц/календарь код timezone-д мэдрэг.
- **Монгол comment/identifier** хадгал — монгол баг. Public symbol дахин нэрлэхээс бусад тохиолдолд англи руу бүү орчуул.
- **`Env` interface** (`backend/src/types.ts`) нь binding-ийн source of truth. `worker-configuration.d.ts` нь авто-generate, gitignore — бүү засварла.
- **Edge cache footgun** — `withEdgeCache` (`lib/edgeCache.ts`) нь read-mostly GET-д. User-scoped зүйлийг cache хийх нь аюул; байгаа хэрэглээг эхлээд шалга.
- **Print route 2 контекст** — сервер Browser Rendering + хэрэглэгчийн `window.print()` хоёулаа ажиллах ёстой ([§06](06-pdf.md)). Auth-хамаарсан spinner үгүй, short-lived `?t=<jwt>`.
- **i18n** — шинэ user-facing string-ийг `en.json` ба `mn.json` **хоёуланд** нэм.

## Commit хавх — бусдын WIP

Shared файл дээр `git add <file>` хийхэд бусад агентын хадгалаагүй WIP-ийг commit руу **шүүрдэж** оруулдаг. Эхлээд `git diff`-ээ шалга; цэвэр commit хэрэгтэй бол index-only мэс засал (`git hash-object` / `git update-index`) ашигла.

## Build батлах — cache худал хэлдэг

Cache хийсэн `tsc -b` нь shared-type өөрчлөлтийн дараа буруугаар «цэвэр» гэж хэлж болно; `vite build` нь typecheck **огт алгасдаг**. Deploy-д гарах `dist` хийхээсээ өмнө `tsc -b --force` эсвэл бүтэн `npm run build`-ээр батал.

## PDF / Chromium table fragmentation

Chromium дээр хүснэгт хуудас алгасахад:

- `border-collapse: collapse` → footer цухуйна (**fix: `separate`**),
- бүтэн-avoid → хоосон хуудас,
- `tr` break-avoid → үл тоомсорлодог.

`?t=` print token-ыг `main.tsx`-д `ProtectedRoute`-**ээс өмнө** гүүрлэ (`bridgePrintToken`). Оношилгоо: puppeteer-core + Edge probe, pymupdf bbox хэмжилт.

## Weight өгөгдлийн аномали

Хуучин `PRESET_DRAWING_WEIGHTS`-аас болж «блок 11%» гэх мэт алдаатай жин үлдсэн төслүүд бий (project 31/37/39/40/42-т sums≠100 үлдэж болзошгүй). Scaffolder self-heal нэмэгдсэн. Жин засах бол data model ([§03](03-data-model.md))-оо эхлээд ойлго.
