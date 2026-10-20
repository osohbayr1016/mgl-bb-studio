# ХӨЛДӨӨСӨН ХУУЧИН ХӨТЧИЙН ORCHESTRATOR — паритетын ОРАКУЛ (тестийн fixture)

`frontend/src/features/mgl-ai/lib/*.ts`-ийн **байт-ижил хуулбар, коммит `24694e7`** (хөтөч
`@mgl/mglai-common/turn` руу шилжихийн ӨМНӨХ сүүлийн төлөв).  `turn-parity.test.mjs` энэ
хуулбарыг «А зам» болгон ажиллуулж, шинэ хөтчийн adapter (B) ба runtime-ийн тээвэр (C)-тэй
ИЖИЛ хуурамч сүлжээгээр тулгана.

⚠️ ЭНЭ БОЛ ПРОДАКШНЫ ЗАМ БИШ.  `frontend/`, `backend/`, `ai/runtime`, `ai/deployment`,
`revit-mcp` — хэн ч эндээс импортлохгүй; `no-second-engine.test.mjs` үүнийг барина.
Засварлахгүй (оракул хөлддөг); хөдөлгүүрийн зан төлөв ЗОРИУД өөрчлөгдвөл
`turn-parity.test.mjs`-ийн `intentional` жагсаалтад зарлана, оракулыг биш.
