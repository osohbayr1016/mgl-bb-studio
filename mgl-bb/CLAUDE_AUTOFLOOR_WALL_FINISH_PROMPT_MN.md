# Claude-д өгөх prompt — хануудаас автомат шал, хана бүрээс үүсгэх

Доорх prompt-ыг `osohbayr1016/mgl-e-c` репог нээсэн Claude Code session-д бүтнээр нь өг.

---

Чи энэ репогийн Revit add-in дээр ажиллах senior Revit API engineer, computational geometry engineer, WPF UX engineer, QA engineer байна. Доорх хоёр хэрэгслийг одоо байгаа add-in-д бүрэн хэрэгжүүл. Зөвхөн төлөвлөгөө, pseudocode, UI mockup гаргаад зогсохгүй: production code, тохиргоо, tool registration, геометрийн тест, хувилбарын build, хэрэглэгчийн заавар, шалгалтын тайланг хий.

## 1. Хэрэглэгчийн хүссэн үр дүн

### А. «Шал автоматаар хийх»

Хэрэглэгч 2D Floor Plan дээр бүх хэрэгтэй хануудаа сонгоно → tool дарна → ямар шал, ямар материал/хийц, ямар түвшин ба өндөрт хийхийг нэг цонхонд сонгоно → tool сонгосон хануудаар хүрээлэгдсэн талбайнуудыг өөрөө олно → урьдчилан харуулна → «Үүсгэх» дарахад жинхэнэ Revit Floor элементүүд үүснэ.

Хэрэглэгч шалны хүрээг ханын дагуу дахин нэг нэгээр нь зурж өгөх шаардлагагүй. Нэг сонголтоор олон өрөөний шал үүсгэж чадна. Өрөө бүрийн шалыг тусад нь үүсгэх нь өгөгдмөл; ижил төрлөөр нэгтгэхийг хэрэглэгч тусгайлан сонгоно.

### Б. «Хана бүрэх»

Хэрэглэгч план дээр хана эсвэл өрөөний хануудаа сонгоно → «Хана бүрэх» дарна → бүрээсний төрөл, материал/үе, аль тал, суурийн түвшин, өндөр зэргийг сонгоно → preview → жинхэнэ зузаантай бүрээс үүснэ.

Өрөө сонгосон бол тухайн өрөө рүү харсан ханын гадаргууд бүрнэ. Нэг хана сонгосон бол аль талд хийхийг тодорхой, зурагтай сонгуулна. Хаалга, цонх, бодит нээлхийг бүрээсээр таглаж болохгүй.

Хоёр tool ижил ойлгомжтой урсгалтай байна:

**Сонголт → хүрээ/гадаргуу таних → төрөл ба тохиргоо → preview → үүсгэх/шинэчлэх → үр дүн.**

Энд «2D» гэдэг нь Revit Floor Plan дээр харагдаж буй native Wall элементүүдийг хэлнэ. Эцсийн үр дүн нь 3D BIM Floor болон бүрээс байна. FilledRegion, DetailLine, зөвхөн харагдацын өнгөөр шалыг орлуулахгүй. CAD/PDF зураг, raster image-ээс хана таних нь энэ ажлын шаардлага биш.

## 2. Эхлээд одоогийн кодыг шалга

Repository: `https://github.com/osohbayr1016/mgl-e-c`

Prompt бэлдэхэд шалгасан snapshot: `main` commit `e993deb49de827c5e75ffbfa6429f1bd1963e7a2`, 2026-10-16. Энэ нь чиглүүлэх snapshot. Чи local checkout, одоогийн main болон session-ийн uncommitted өөрчлөлтийг дахин уншиж байж засварлана.

Заавал шалгах:

- Root `AGENTS.md`, `CLAUDE.md`, `revit-mcp/CLAUDE.md`, тухайн хавтасны нэмэлт заавар. Хуучин баримт кодтой зөрвөл одоогийн кодыг шалгаж шийд.
- `revit-mcp/addin/RevitMcpAddin.csproj`: build configuration, compile exclusions, API package, deploy target.
- `revit-mcp/addin/Ui/Core/ToolCatalogData.cs`, `ToolMeta.cs`, `ToolAvailability.cs`, `RibbonPlan.cs`.
- `revit-mcp/addin/Ui/Revit/RibbonBuilder.cs`, `RibbonDisciplines.cs`, `ToolLauncher.cs`, `ToolContextProbe.cs`.
- `revit-mcp/addin/Ui/MglWindow.cs`, `MglTheme.cs`, бусад shared WPF styles.
- `revit-mcp/addin/Smart/Revit/SmartExecutor.cs`, `ModelChangeCounter.cs`.
- `revit-mcp/addin/CloneDrawings/` доторх `CdJobHost`, `IMglJob`, цуцлалт ба явцын самбарын хэрэгжилт.
- `revit-mcp/addin/WallElevation/WallElevationCommand.cs`, `WallElevationWorkflow.cs`, `WeJob.cs`.
- `revit-mcp/addin/WallElevation/Core/WeRoomBoundary.cs` болон `Revit/GeneratedElevationRepository.cs`, `WeRoomRef.cs`, `WeLinkRef.cs`, `WeLivePreview.cs`.
- `revit-mcp/addin/RoomPlan/ExistingFloorBoundary.cs`, `Units.cs`, `Licensing/LicenseGate.cs`.
- Одоогийн `revit-mcp/tests/`, `revit-mcp/release-gate/`, add-in packaging, versioning workflow.

`rg` ашиглан `floor`, `finish`, `cladding`, `cover`, `Шал`, `бүрэх`, `Floor.Create`, `Wall.Create` зэрэг нэрээр одоо байгаа хэрэгжилтийг ол. Хэрэв хоёр tool-ийн аль нэг нь local branch дээр аль хэдийн байгаа бол түүнийг сайжруул; хоёр дахь өрсөлдөгч implementation үүсгэхгүй.

Snapshot-оос баталгаажсан чухал зүйлс:

1. Tool нэр, tooltip, help, availability, ribbon мэдээлэл нэгдсэн каталогтой. `App.cs` дээр тусад нь ribbon нэмж давхар бүртгэл үүсгэхгүй.
2. `ExistingFloorBoundary` нь байгаа ганц тэгш өнцөгт Floor болон дөрвөн ханыг таних хязгаарлагдмал detector. Үүнийг шинэ tool-ийн бүх геометрийн хөдөлгүүр гэж ашиглаж болохгүй. Шинэ хэрэгсэлд урьдчилан Floor байх шаардлагагүй.
3. `WeRoomBoundary` нь Room-ийн талуудыг дэлгээсийн зорилгоор нэгтгэдэг. Floor polygon, opening, материалын хэмжээг гаргахдаа түүний хялбаршуулсан гадаргууг шууд үнэн гэж үзэхгүй. Reuse хийх зүйлээ зориулалтаар нь шалга.
4. R24 = `net48`; R25/R26 = `net8.0-windows`; R27 = `net10.0-windows` гэж энэ snapshot-ийн csproj-д байна. R27-ийг автоматаар .NET 8 гэж бүү үз.
5. `Smart/**` нь R24 build-ээс хасагдсан; `MGL_SMART` мөн R24-д идэвхгүй. Шинэ shared code-оо зөвхөн SmartExecutor-оос шууд хамааралтай болгож R24 дээр эвдэж болохгүй.
6. WallElevation нь CloneDrawings-ийн `CdJobHost`/`IMglJob` замаар ажил явуулдаг. Энэ замын R24/R27 support-ыг шалгаж ашигла. Шаардлагатай бол зөвхөн энэ feature-д зориулсан жижиг, хувилбаруудад ажиллах API-context adapter гарга. R24-д бүх Smart модулийг идэвхжүүлж асуудлыг тойрохгүй.
7. Build хийснийг Revit дотор зөв үүссэний баталгаа гэж үзэхгүй.

Бусдын өөрчлөлтийг reset, restore, reformat, stage хийхгүй. Одоогийн ажилтай мөргөлдөхгүй isolated branch/worktree хэрэгтэй эсэхийг өөрөө шийд. Backend, ERP, AI, лицензийн бизнес дүрэмд энэ feature-ээс хамаарахгүй өөрчлөлт хийхгүй.

## 3. UX — нэг цонх, ажил хийхэд бэлэн утгууд

Хоёр тусдаа entry point байна: **«Шал автоматаар хийх»**, **«Хана бүрэх»**. Shared settings/preview component ашиглаж болно. Суулгасан Revit-ийн энгийн сонголтыг ашигладаг, Монгол үндсэн хэлтэй, одоогийн light/dark theme-д тохирно.

### Сонголт

- Урьдчилан сонгосон зөв Wall/Room байвал шууд ашигла.
- Сонголтгүй бол «Хана сонгох» үйлдлээр plan дээр rectangle/multi-select хийлгэ. Preselection, Ctrl нэмэх/хасах, дахин сонгох ажиллана.
- Room болон RoomTag сонголтыг нэмэлт хялбар entry point болгон дэмж; Room байх нь үндсэн горимын урьдчилсан шаардлага биш.
- Холимог сонголтын зөв элементүүдийг ашиглаж, үлдсэнийг тоо ба шалтгаантай харуул. Зөвхөн буруу сонголттой бол хоосон success үзүүлэхгүй.
- Сонгосон ханын тоо, олдсон талбай, түвшин, бэлэн/анхааруулгатай/боломжгүй тоог харуул.
- Хөрш хануудыг автоматаар нэмэх шаардлагатай бол хүрээг нь preview-д ялгаж, «Дутуу хануудыг нэмэх» гэсэн ил үйлдэл болго. Хэрэглэгчийн сонголтыг чимээгүй тэлэхгүй.

### Шалны энгийн тохиргоо

- **Шалны төрөл**: одоогийн документын FloorType-аас хайж сонгоно. Нэр, нийт зузаан, үеийн товч мэдээллийг үзүүл.
- **Хийц/материал**: одоогийн төрлөө ашиглах эсвэл хэрэглэгчийн сонголтоор шинэ төрлийн хуулбар үүсгэх. Жишээ нь плитка, паркет, бетон гэх нэрс нь UI preset байж болох боловч бодит материал/төрлийг хэрэглэгчийн документаас сонгоно.
- **Түвшин**: active plan-ийн GenLevel-ийг санал болгож, давхар холилдсон сонголтыг бүлэглэ. Ганц давхарт чимээгүй нэгтгэхгүй.
- **Шалны дээд өндөр**: сонгосон Level-ээс хэдэн мм гэдгийг тодорхой харуул. «Дээд гадаргуу Level + … мм; хийцийн зузаан … мм доош» гэсэн ойлгомжтой тайлбар/жижиг огтлолын дүрслэлтэй байж болно.
- **Хүрээ**: ханын өрөө рүү харсан бодит finish face хүртэл — өгөгдмөл. Wall centerline/core boundary зэрэг ахисан горим байвал нэр ба үр нөлөөг нь тусад нь харуул.
- **Өрөө бүрээр тусдаа** — өгөгдмөл.
- **Нээлхий/шахтыг хасах** — өгөгдмөл. Багана, нээлхий, existing structural slab-ийг ялга.
- **Хаалганы босго оруулах** — ил сонголт; өгөгдмөл унтраалттай. Идэвхжүүлсэн үед хоёр өрөөний дундах өмчлөл/зааг давхардахгүй deterministic дүрэмтэй байна.
- **Давхар үүсгэхгүй / өмнөхөө шинэчлэх** — өгөгдмөл.
- Region бүрт төрөл/өндрийн override хийх боломжтой жижиг хүснэгт. Бүх өрөөнд нэг төрлийг заавал тулгахгүй.

### Хана бүрээсний энгийн тохиргоо

- **Хийх арга**: өгөгдмөл «Зузаантай бүрээс»; тусдаа non-structural native Basic Wall элементээр үүсгэнэ.
- **Бүрээсний төрөл**: одоогийн Basic WallType-аас хайлт, материал ба нийт зузааны тайлбартай.
- **Тал**: «Өрөөний дотор тал», «Нөгөө тал», «Хоёр тал». Нэг ханын хувьд plan preview дээр сум, тодорсон гадаргуу, нэг товч flip ашигла. Нэг утгаар тогтоох боломжгүй бол тал/өрөөний дотор цэг сонгуул.
- **Суурь**: Level ба offset; хэрэв энэ үйлдлээр шал давхар хийх бол үүсэх шалны дээд өндөртэй нэг эх сурвалжаас тааруул.
- **Өндөр**: «Өрөөний өндөр хүртэл», «Ханын бодит дээд хүртэл», «Тогтмол … мм», боломжтой үед «Дараагийн Level хүртэл + offset».
- **Нээлхий хадгалах** — үргэлж шаардлагатай. Үүнийг унтрааж алдаа нуух сонголт хийхгүй.
- **Давхар үүсгэхгүй / өмнөхөө шинэчлэх**.
- «Paint» арга хэрэгжүүлбэл тусдаа ил сонголт, тусдаа үр дүн байна. Paint нь бодит зузаан, Wall schedule, эзлэхүүнтэй бүрээс үүсгэхгүй гэдгийг UI тайлбарлана. Зузаантай бүрээсний алдааг Paint-аар чимээгүй орлуулахгүй.

Эхний удаа чухал сонголтоо нэг цонхонд сонгоно. Дараагийн удаа өмнөх утгыг сэргээхдээ document дахь type/material/level одоо байгаа эсэхийг шалгана. Нэрээр ижил өөр type-ийг чимээгүй орлуулахгүй. Хязгааргүй дараалсан TaskDialog-уудаар асуухгүй.

Товчнууд: «Хана сонгох», «Дахин тооцоолох», «Урьдчилан харах», «Үүсгэх»/«Шинэчлэх», «Цуцлах».

Хос үйлдэл хэрэгтэй хэрэглэгчид зориулж «Шал + хана бүрээс» тохируулгыг shared workflow дээр нэмж болно; энэ нь хоёр үндсэн tool-ийн ажиллагааг хойшлуулахгүй. Хос горимд эхлээд шалны дээд өндөр, дараа бүрээсний base-ийг нэг төлөвлөгөөнөөс бодно.

## 4. Шалны хүрээ олох — гол инженерийн шаардлага

### 4.1 Room байгаа үед

Зөв байрласан, хүрээ нь хаалттай, тухайн phase/design option/level-д таарах Room байвал түүний boundary-ийг ашиглаж болно. `SpatialElementBoundaryOptions`-ийн boundary location-ийг ил тогтоож, finish face горимд унш. Outer loop ба inner loop-уудыг тусад нь хадгал.

Гэхдээ сонгосон ганц ханатай шүргэлцсэн бүх Room-ийг автоматаар бүү хамруул. Сонголтын scope-д үнэхээр орж байгаа region-уудыг шалга; өрөө дутуу хүрээлэгдсэн бол нэмэлт сонголт/анхааруулга гарга. Room separation line, column, shaft зэрэг boundary contributor-уудыг preview-д тайлбарла.

Unplaced, unenclosed, redundant, zero-area Room-ийг нэр, ID, шалтгаантай тайлагна. Дээд давхрын, өөр phase-ийн Room ашиглахгүй. Room-ийн нэг өндөр дээрх boundary бүх өндрийн огтлолд ижил гэж үзэхгүй.

### 4.2 Room байхгүй үед — заавал ажиллана

Сонгосон хануудын байршил, бодит зузаан, join болон тухайн өндрийн 2D огтлол/finish face-ээс хаалттай дотор region-уудыг олдог deterministic хөдөлгүүр хэрэгжүүл.

Зөвшөөрөхгүй хялбаршуулалт:

- Бүх ханын bounding box-оор нэг тэгш өнцөгт Floor хийх.
- Бүх ханын үзүүрийг convex hull-д хийгээд дотор хана, ниш, хашаалсан хөндийг алдах.
- Сонгосон хануудыг дарааллаар нь холбосон polygon хийх.
- Бүх wall centerline-ийг зүгээр width/2 offset хийгээд join, flip, олон зузаан, L/T уулзварыг үл тоох.

Бодит pipeline:

1. Scope, level, phase, option-оор хана болон хэрэгтэй obstacle-уудыг resolve хий.
2. Revit API context-д бодит wall geometry/curve/зузаан/нээлхийн мэдээллийг уншиж immutable plain DTO болго.
3. Numeric endpoint normalization, intersection splitting, joined face reconciliation хий.
4. Planar arrangement/half-edge graph/polygonization зэрэг сонгосон аргаараа bounded face-уудыг ол; гаднах unbounded face-ийг хас.
5. Wall-solid-оор дүүрсэн талбайг floor region гэж бүү тооц. Room interior, occupied wall footprint, holes, disconnected regions-ийг ялга.
6. Region бүрийн boundary provenance-ийг хадгал: аль source wall, аль тал, ямар сегментээс ирсэн.
7. Outer/inner loop containment tree, deterministic orientation, self-intersection болон overlap validation хий.
8. FloorType, өндөр, босго, нээлхийн сонголтыг хэрэглэж эцсийн candidate-уудыг үүсгэ.

Геометрийн яг аргаа одоогийн код, dependencies, R24 compatibility-г шалгаж сонго. Existing dependency тохирвол ашигла. Шинээр polygon library авах бол net48 болон R27 target-д нийцэх эсэхийг батал; хэт том runtime нэмж болохгүй. Library хэрэглэсэн ч wall face, source identity, opening, height-ийн логикийг орлохгүй.

### 4.3 Заавал шийдэх нөхцөлүүд

- Шулуун, диагональ, эргэлттэй план; тэгш өнцөгтөөр хязгаарлахгүй.
- L/U хэлбэр, ниш, ханын цухуйлт, T/L уулзвар, өөр зузаантай хана.
- Олон өрөө, shared partition, олон тусдаа хаалттай блок.
- Arc ханатай шалны хүрээ: native arc-ийг боломжтой үед хадгал; tessellation хэрэглэвэл chord error, area error-ийг хэмжиж тайлагна.
- Inner courtyard, shaft, бодит slab opening; inner loop-ийг бүхэлд нь floor болгож дүүргэхгүй.
- Багана planned floor solid-той огтлолцож байвал хасах дүрмийг хэрэгжүүл; зүгээр XY projection давхцсан бүх баганыг бүх давхраас хасахгүй.
- Шатны bounding box-ийг шууд нээлхий гэж бүү үз. Үнэхээр баталгаатай opening boundary байвал хас; эс бөгөөс хэрэглэгчид тодорхой сонгуул.
- Хаалга wall network-д эвдэрсэн нээлттэй хүрээ мэт нөлөөлж болох тул host wall-ийн бодит үргэлжлэл/нээлхийн өгөгдлөөр region separation-ийг тогтоо. Бүх gap-ийг хаалга гэж үзэж хааж болохгүй.
- Өөр давхар, бага өндөр partition, stacked/slanted/curtain wall зэргийг capability-аар ялга. Дэмждэггүй geometry-г тодорхой тайлагнаж тухайн candidate-ийг зогсоо; түүнийг шулуун basic wall болгож чимээгүй өөрчлөхгүй.
- Finish face boundary нь шинэ floor/finish бий болсноор дахин багасаж давтагддаг feedback loop үүсгэхгүй. Өөрийн generated finish-ийг source boundary extraction-оос хас.

### 4.4 Gap ба tolerance

Numeric epsilon, endpoint snap tolerance, хэрэглэгчийн зөвшөөрөх gap bridge нь гурван тусдаа ойлголт байна. Revit `Application.ShortCurveTolerance`, geometric scale, unit conversion-ийг зөв ашигла.

Зөвхөн floating-point алдааны хэмжээтэй засварыг автоматаар хий. Үүнээс том нээлттэй хүрээнд gap-ийн хоёр үзүүр, хэмжээ, source wall-ийг preview дээр харуулж «Завсрыг нөхөх» үйлдлээр шийдүүл. Нөхсөн нь зөвхөн floor boundary-ийн virtual segment; source wall-ийг сунгахгүй. Тэр segment-ийг бүрэх бодит хана гэж үзэхгүй.

Invalid loop-ийг хүчлэн хааж, өрөөнөөс гадагш шал асгаруулж болохгүй. Нэг region invalid байвал бусад region-ийн төлөвийг тусад нь харуул; эцсийн Apply нь урьдчилан зөвшөөрсөн valid set дээр л ажиллана.

## 5. Floor үүсгэх ба өндөр/материалын үнэн зөв байдал

- `Floor.Create` болон тухайн version-д тохирох `BoundaryValidation` хэрэглэ. API signature-ийг local target references-тай тулга.
- Profile нь хаалттай, planar, хэвтээ; self-intersection, хоорондын intersection, short edge, invalid nested loop байхгүйг шалга.
- Нэг outer region ба түүний holes-ийг нэг candidate болгож, тусдаа outer region-уудыг тусдаа Floor болго.
- `Floor.Create`-д profile-ийн Z тавих нь эцсийн өндрийг тогтооно гэж бүү үз. Level болон `FLOOR_HEIGHTABOVELEVEL_PARAM`-ийг ил тохируулж, үүссэн бодит top/bottom geometry-г шалга.
- UI-ийн «шалны дээд өндөр», бодит Floor top, type-ийн thickness гурвыг хооронд нь андуурахгүй. Thickness-ийг хоёр удаа нэмэх/хасахгүй.
- Үе, материал, function, wrapping болон variable layer байгаа эсэхийг compound structure-оос унш. Бодит variable/sloped type-ийн өндөр тооцоолол баталгаагүй бол нэрлэж reject хий; нэг тоон Width гэж худал тайлбарлахгүй.
- Existing FloorType-ийг глобалаар засахгүй. Шинэ хийц хэрэгтэй бол хэрэглэгчийн хүсэлтээр duplicate хийж үе/material-ийг тохируул; ижил layer signature-тай tool-owned type-ийг дахин ашиглаж болно.
- Structural slab дээрх шинэ өнгөлгөө нь зөвхөн XY давхцсан шалтгаанаар duplicate биш. Existing element-ийн зориулалт, category, Z interval, type/layer, ownership-ийг харьцуул.
- Existing finish Floor-той эзлэхүүнээр давхцах бол conflict харуул. Өөр хүний Floor-ийг дур мэдэн устгаж/солихгүй.
- Шинэ floor нь non-structural finish байдлаар үүсэх өгөгдмөлтэй. Structural creation-ийг тусдаа ил сонголтгүй хийхгүй.
- Sloped, shape-edited Floor үүсгэх нь эхний release-ийн үндсэн горим биш. UI тэгш шал гэдгийг тодорхой хэлж, дэмжээгүй налуу горим санал болгохгүй.

## 6. Хана бүрэх — гадаргуу, тал, уулзвар, нээлхий

### 6.1 Бодит байрлал

- Host wall-ийн room-facing бодит finish surface-ээс бүрээсийг өрөө рүү зөв offset хий.
- Wall orientation/flip, curve direction-ийг дангаар нь «өрөөний дотор» гэж бүү тайлбарла. Region interior probe/Room containment эсвэл explicit side pick ашигла.
- Straight wall-д шинэ бүрээсний location line, type width, reference plane-ийг тааруулж host face-тэй зөв шүргэлцэхийг шалга. Бүх type-д centerline + width/2 формула шууд бүү хэрэглэ.
- Өрөөний тал бүрт segment-үүдийг зөв хувааж, хоёр хөрш өрөө нэг host wall-ийн эсрэг хоёр талд өөр материалтай байж болно.
- Shared wall-ийн ижил тал, ижил interval-д давхар бүрээс үүсгэхгүй. Хоёр талын бүрээс бол хоёр тусдаа, зөв source key-тэй output.
- Generated finish wall нь structural биш, room-bounding=false байна. Бусад host/room bounding мэдээллийг өөрчлөхгүй.
- L/T corner-уудын join/miter/butt дүрэм deterministic байна. Бүрээс хооронд бодит overlap, завсар, сөрөг урт үүсгэхгүй; join нь host wall-ийг өөрчилж байвал тийм арга хэрэглэхгүй.
- Нэг шулуунд байгаа хэд хэдэн host-ийг topology/source mapping алдалгүй нэгтгэж болно. Нээлхий, material boundary, height change-ийг давуулж нэгтгэхгүй.

### 6.2 Суурь ба өндөр

Бүрээсний base, top, height нь model-ийн бодит нөхцөлд таарна. Floor+wall хос горимд wall finish-ийн base нь planned finished-floor top-той таарна. Тусдаа wall finish горимд existing floor-ийг зөвшөөрөлгүй, олон candidate-тай үед тааж сонгохгүй.

Room height, host wall height, дараагийн Level нь өөр ойлголт. Хэрэглэгчийн сонгосон mode-оор тооц. Top attached wall, profile-edited wall, partial-height partition, slanted surface-ийг зөв таньж capability check хий. Ханын бодит өндрөөс хэтрүүлсэн бүрээсийг чимээгүй үүсгэхгүй.

### 6.3 Хаалга, цонх, opening — release blocker

Host wall-д opening байгаа нь хажууд үүсгэсэн finish wall-ийг автоматаар зүснэ гэж бүү үз. Зүсэлтүүдийг шинэ output дээр тусад нь хэрэгжүүлж баталгаажуул.

- Door/window-ийн нэрлэсэн Width/Height эсвэл global bounding box дангаараа actual opening биш. Family-ийн cut geometry, host wall-ийн resulting geometry, rectangular Opening, wall profile cut зэргийг ялган унш.
- `SpatialElementGeometryCalculator`-ийн room faces дээр door/window cut заавал байна гэж бүү үз. Нээлхийн өгөгдлийг тусдаа extraction pipeline-ээр авч тулга.
- Шулуун босоо basic wall + стандарт тэгш өнцөгт door/window opening-ийн end-to-end support заавал хий.
- Native Wall + supported opening API, profile-based wall, эсвэл нээлхийн эргэн тойронд хэсэгчилсэн native finish panel үүсгэх аргуудаас бодит API capability, schedule, join, rerun behavior-д тохирохыг сонго.
- `Wall.Create`-д nested profile өгөөд бүх hole автоматаар дэмжигдэнэ гэж бүү таамагла. Сонгосон арга бодит Revit version дээр ажиллаж байгааг шалга.
- Арх хэлбэртэй, irregular, curved host дээрх cut-уудыг capability matrix-д ил тусга. Дэмжсэн гэж зарлах бол geometry QA хийнэ. Дэмжээгүй candidate-ийг тайлантай skip/block хий; нээлхийг тагласан бүрээс үүсгэж success болгохгүй.
- Бүрээсний эргэн тойронд reveal/jamb/sill/head хийх нь тусдаа option. Өгөгдмөл нь үндсэн гадаргууг зөв зүсэх; амлагаа заавал хийсэн мэт тоо хэмжээнд нэмэхгүй.
- Хаалга/цонхны FamilyInstance-ийг duplicate хийж finish wall-д дахин суулгахгүй. Host, door/window instance, parameter, constraint-ийг өөрчлөхгүй.
- Бодит нээлхийгээр finish solid тасарсан, нээлхий дотор finish solid үлдээгүй, дээд/доод хэсэг зөв байгаа эсэхийг host integration test-ээр шалга.

Бодит зузаантай бүрээсийг DirectShape/GenericModel-аар чимээгүй орлуулж болохгүй. Тусгай geometry-д ийм mode зайлшгүй бол хэрэглэгчийн ил сонголт, category/schedule-ийн тайлбар, тусдаа capability-тай байна; стандарт үндсэн mode нь native Basic Wall хэвээр.

## 7. Linked model, phase, option, editability

Host model-ийн native walls нь эхний ээлжийн үндсэн зам. Linked walls/rooms-ийг ижил чанартай нэмэлт зам болгон хэрэгжүүл; feature flag-аар хэзээ ч ажиллахгүй нууц stub үлдээхгүй.

- Linked source-ийг `RevitLinkInstance` ба linked Element unique identity-тай нь resolve хий.
- Нэг linked document хоёр өөр instance-аар орсон бол хоёр өөр source гэж тань.
- Translation/rotation/mirror transform-ийг зөв хэрэглэж host coordinate-д хувирга; loops-ийн handedness/orientation-ийг дахин шалга.
- Linked element-ийг өөрчлөхгүй. Output Floor/finish wall зөвхөн host document-д үүснэ.
- Unloaded link, unresolved source, invalid transform, phase mismatch, level mapping ambiguity-д тодорхой message харуул.
- Дэмжихгүй nested link эсвэл тусгай wall geometry-г хийсвэрээр дэмжсэн гэж бүү үз.
- Phase/design option-ийг source болон active view context-оос шалга; өөр option-ийн ханыг нэг region-д холихгүй.
- Source wall-ийг уншихад edit ownership шаардахгүй. Output creation/update-д хэрэгтэй workset/checkout-ийг шалгаж, lock-ийг хүчээр авахгүй.
- Family document, perspective/unsupported view, read-only document, failure mode, edit sketch/group, document closing зэргийг урьдчилан шалга.
- Crop/view range-ийг сонгосон source-ийн физик хүрээг таслах geometry гэж ашиглахгүй. View context нь floor plan ба level/phase сонгоход л үндсэн чиглэл өгнө.

Linked source-ийн бүх хүнд тохиолдол шууд баталгаажих боломжгүй бол native хоёр tool-ийг бүрэн дуусгаад linked capability ба бодитоор шалгасан/шалгаагүй нөхцөлийг тодорхой тайлагна. Дэмжсэн үндсэн workflow-ийг дутуу stub-ээр сольж болохгүй.

## 8. Preview — үүсгэхээс өмнө яг юу болохыг харуул

Preview-д:

- Region бүрийн outline, holes, нэр/түр дугаар, талбай, FloorType, thickness, top elevation.
- Wall finish хийх surface/side, base/top, thickness, openings, material.
- Green = үүсгэхэд бэлэн; amber = шалгах зүйлтэй; red = үүсгэхгүй; өнгөнөөс гадна icon ба текст.
- Хэт том region, нээлттэй gap, ambiguous side, overlapping output, unowned existing finish conflict, дэмжээгүй geometry-г эх үүсвэртэй нь заа.
- Мөрийг сонгоход Revit дээр source-ийг highlight/zoom хийж болно; preview дуусахад түр override-ийг бүрэн цэвэрлэ.
- Checkbox-аар region/face-ийг хасах, per-region type/height override, side flip хийж болно.
- Хэрэглэгч зөвхөн боломжтой candidate-уудаа ил сонгож Apply хийдэг байна. Чимээгүй хэсэгчлэн үүсгэж «Бүгд амжилттай» гэж болохгүй.

Preview нь model-д persistent Floor, Wall, ModelLine, FilledRegion үлдээхгүй. In-memory 2D preview болон одоогийн transient overlay-г тохирохоор ашигла. Түр geometry хэрэгтэй бол тусгаарласан, үргэлж rollback хийдэг scope ашиглаж document өөрчлөлтийн side effect-ийг бодитоор шалга.

Preview plan ба Apply хоёр НЭГ immutable CreationPlan-аас ажиллана. Apply дээр бүхнийг өөр логикоор дахин бодож өөр үр дүн үүсгэхгүй. Source өөрчлөгдсөн бол revalidate/replan хийж хэрэглэгчийн харсан preview-тэй таарсны дараа үргэлжил.

## 9. Дахин ажиллуулах, шинэчлэх, гараар зассан output

Энэ feature-г нэг удаа ажилладаг script болгож болохгүй.

Tool-owned Floor/Wall болон хэрэгтэй manifest дээр versioned Extensible Storage эсвэл existing тохирох ownership mechanism ашигла. Existing WallElevation schema GUID-ийг шинэ зорилгод дахин ашиглахгүй.

Хадгалах үндсэн ойлголт:

- `SchemaVersion`, `ToolKind`, source document identity.
- Host/link instance identity, source Room/Wall UniqueId-ууд, side ба interval/region identity.
- `SourceKey` — логик эх үүсвэрийн тогтвортой identity.
- `InputFingerprint` — одоогийн boundary/geometry/settings/type/material/height-ийн fingerprint.
- Generated output unique IDs, job identity, өмнөх output geometry/settings fingerprint.

SourceKey ба geometry hash хоёр өөр байна. Хана жаахан хөдлөхөд SourceKey бүрэн өөрчлөгдөж хуучин output үлдээд шинэ output давхардах ёсгүй. Room байхгүй region split/merge болсон үед canonical source-boundary mapping-аар reconcile хийж, ambiguous бол preview-д хэрэглэгчид шийдүүл.

Дахин ажиллуулахад:

1. Ижил input, output хөндөөгүй → «Өөрчлөлтгүй», шинэ элемент 0.
2. Source/settings өөрчлөгдсөн, output хөндөөгүй → өөрийн output-ийг шинэчлэх.
3. Output-ийг хэрэглэгч гараар зассан → «Гараар өөрчилсөн» conflict; хадгалах/тусгайлан дахин үүсгэх сонголт. Чимээгүй overwrite хийхгүй.
4. Source устсан, region салсан/нэгдсэн → obsolete output-ийг preview-д нэрлэж, зөвхөн tool-owned, хэрэглэгч зөвшөөрсөн output-ийг цэвэрлэ.
5. Metadata хуулбарлагдсан, ownership хоёрдмол → хоёуланг нь устгахгүй; conflict болго.

Update боломжтой параметрийг in-place өөрчил. Recreate зайлшгүй үед өмнөх output-ийг устгасны дараа creation алдахад хуучин нь алга болдог дараалал хийхгүй; transaction rollback-оор бүрэн хамгаал. Existing references/dimensions, user parameters-д нөлөөлөхийг preview/report-д тодорхой харуул.

ModelChanged event бүр дээр шал/бүрээсийг автоматаар өөрчилдөг updater хийх шаардлагагүй. Эхний release-д explicit rerun/update байна; stale detection байж болно. Бүх generated geometry-г server руу илгээх шаардлагагүй.

## 10. Revit API context, responsiveness, Undo

Бүх Revit API read/write, Element/Document/Geometry access нь зөвшөөрөгдсөн Revit API context, үндсэн thread дээр ажиллана. `Task.Run` дотор `Document`, `Element`, `Solid`, `Face`, `Curve`, Revit XYZ object ашиглахгүй. Background-д зөвхөн copy хийсэн primitive coordinate DTO, plain topology, hashing, pure polygon calculation явуул.

Modeless UI ашиглавал event гарцыг valid context-д үүсгэж, existing host эсвэл feature-scoped `ExternalEvent`/Idling adapter-аар API ажил явуул. `.Wait()`/`.Result`-ээр UI thread-ээ түгжихгүй. Event бүрийн дараа lifecycle cleanup хий.

**Undo ба background-ийн гэрээг ил сонго:**

- Өгөгдмөл жижиг/дунд ажил: extraction/planning нь үе шаттай байж болно; эцсийн Apply нэг хязгаарлагдсан API execution дотор TransactionGroup + transactions-аар хийгдэж нэг Undo болно. Алдаанд group бүхэлдээ rollback.
- Нэг Apply хэт удаан блоклож байгааг хэмжсэн тохиолдолд том batch-д existing job host-оор хэсэгчлэн Apply хийх горим нэмж болно. Алхам хооронд transaction/group нээлттэй байлгахгүй. Энэ горим нэг Undo биш гэдгийг UI, tool help, report-д үнэнээр хэл.
- Нэг TransactionGroup-ийг олон ExternalEvent/Idling tick дамжуулан нээлттэй барьж, хэрэглэгчийн model edit-тэй зэрэгцүүлэхгүй.
- «Бүгдийг буцаах» cleanup нэмбэл зөвхөн тухайн job-ийн tool-owned, дараа нь гараар өөрчлөөгүй output дээр ажиллана. Энэ нь бүх model history-г rollback хийсэнтэй адил биш.

Cancel нь preview/planning-д үр дүнгүй цуцална. Atomic Apply дундах cancel-ийг зөвхөн аюулгүй шалгах цэгт хүлээн авч rollback хий. Chunked горимд одоогийн chunk дуусах/rollback болох хүртэл хүлээж, өмнө commit хийсэн output-ын тоог тодорхой харуул.

UI дээр «Тооцоолж байна», «Хүрээ шалгаж байна», «Үүсгэж байна», «Дууслаа» гэсэн үе шат/тоотой progress харуул. Phase хооронд Revit-д хариу өгөх боломж олго. Бодит write execution-ийн үед model-ийг зэрэг өөрчлөхийг амлахгүй.

Modeless operation-ийн stale guard:

- Original document identity, source UniqueId, link transform, level/type validity-г Apply-гийн өмнө дахин шалга.
- Preview-гийн дараа source хана хөдөлсөн, type өөрчлөгдсөн, document хаагдсан/солигдсон, Undo/Redo болсон бол хуучин plan-ийг хэрэгжүүлэхгүй.
- Тухайн feature-д огт хамаагүй өөрчлөлт бүрээр бүх preview-г шаардлагагүй invalid болгохгүй; dependencies-ийг тодорхой хяна.

Failure handling нь warning бүрийг сохроор устгадаг байж болохгүй. Allowlist-д орсон, тайлбарлаж болох warning-ийг бүртгэж болно; бусад error/geometry failure-г rollback ба Монгол шалтгаантай буцаа.

## 11. Кодын зохион байгуулалт

Existing conventions өөр байвал түүнд тааруул. Шинэ модуль хэрэгтэй бол жишээ бүтэц:

```text
revit-mcp/addin/InteriorFinishes/
  Core/       # Revit/WPF-гүй DTO, topology, validation, plan, source keys
  Revit/      # source extraction, API adapter, floor/wall creation, storage
  Ui/         # settings, region/face list, preview, progress/report
  AutoFloorCommand.cs
  WallFinishCommand.cs
  FinishWorkflow.cs
```

Энэ нэрс бол санал, репонд аль хэдийн стандарт бүтэц байвал түүнийг ашигла. Нэг том command файлд selection, WPF, polygonization, storage, transaction бүхнийг багцлахгүй.

Хоёр tool shared extraction/normalization/identity/preview/validation logic ашиглана. Floor ба wall finish нь өөрийн domain planner, creation adapter-тай байна. Floor polygon-ийг wall finish-ийн height/opening логиктой хольж болохгүй.

`CreationPlan` нь дараахыг ил агуулна: context fingerprint, source dependencies, floor candidates, wall finish candidates, type definitions, holes/cuts, validation issues, update/create/skip/delete decisions. ViewModel-оос Element.Create шууд дуудахгүй.

Revit units-ийг boundary дээр `UnitUtils`/existing units service-ээр хөрвүүл. Core дотор unit convention-оо нэрлэж баримтжуул; UI-ийн мм ба Revit internal feet-ийг хольж болохгүй. NaN/Infinity, zero/negative thickness/height-ийг үүсгэхээс өмнө хоригло.

R24-д байхгүй .NET API, WPF dependency, JSON/collection convenience method-ийг shared core-д санамсаргүй нэмж болохгүй. Шинэ модулийг `MGL_SMART` дотор бүхэлд нь хийж R24 дээр алга болгохгүй.

Existing `LicenseGate.Ensure()` болон tool usage tracking-ийн хэв маягийг баримтал. Лицензийн шалгалтыг тойрохгүй; шинэ network dependency, AI/model/Python service шаардахгүй. Энэ feature deterministic C# geometry ба Revit API-гаар ажиллана.

Tool metadata-д нэр, Монгол tooltip, зорилго, алхам, model effect, availability, үнэн Undo тайлбар, aliases (`шал`, `хана бүрэх`, `floor`, `finish`, `cladding`) нэм. Интерьер/архитектур ribbon mapping-ийг existing catalog-оор шийд.

## 12. Шалгалт — core ба бодит Revit тусдаа

Meaningful core tests хий. Implementation-ийг хуулбарласан, зөвхөн mock `Floor.Create` дуудсан эсэхийг шалгадаг тестээр чанарын баталгаа бүү хий.

### Core geometry/plan tests

| Нөхцөл | Шалгах бодит үр дүн |
| --- | --- |
| 4 ханатай ганц өрөө, Room байхгүй | Дотор finish face хүртэл зөв нэг region |
| Ижил өрөө өөр эргэлт/координаттай | Ижил topology, зөв талбай |
| L/U хэлбэр, ниш | Ниш хадгалагдана; bounding rectangle үүсэхгүй |
| Олон өрөө + T уулзвар | Өрөө тус бүр; partition доогуур нийлж асгарахгүй |
| Олон тусдаа блок | Block бүр тусдаа output |
| Холимог зузаан, flipped walls | Дотор хүрээ ба side зөв |
| Arc boundary | Геометр ба талбай зөв; error budget хэмжигдсэн |
| Courtyard/shaft/column | Зөв hole; нийт талбайгаас зөв хассан |
| Tiny numerical gap | Зөвхөн тогтоосон tolerance-д normalization |
| Жинхэнэ нээлттэй gap | Өөрөө дүүргэхгүй; gap diagnostic |
| Duplicate/overlapping segments | Double edge/negative sliver үүсэхгүй |
| Region split/merge, rerun | Stable identity ба ил update decision |
| Door threshold хоёр өрөөний дунд | Хоёр floor overlap хийхгүй |
| Material/type өөрчлөх | Existing global type өөрчлөгдөхгүй |
| Manual edit conflict | Output overwrite/delete хийхгүй |
| Source order өөрчлөх | Plan/key deterministic |

### Revit host integration tests — R24 ба R27

Шинэ synthetic жижиг test model-ийг тусгаарласан document-д үүсгэж, production workflow/planner/creator-ийг ажиллуул. Хэрэглэгчийн project-ийг destructive test-д бүү ашигла. Одоо байгаа live harness-ийн тохирох pattern-ийг reuse хийж болно.

Заавал бодитоор шалгах:

1. Native Floor count, FloorType, level, top/bottom elevation, area/volume, holes.
2. Room байхгүй үед selected walls-аас зөв Floor үүсэх.
3. Олон өрөөнд source wall/door/window geometry ба count өөрчлөгдөөгүй байх.
4. Floor+finish хамт хийсэн үед wall finish base нь floor top-той таарах.
5. Finish wall-ийн host face-ээс зай, зөв тал, thickness, base/top, room-bounding=false.
6. Door/window нээлхий дээр finish solid үлдээгүй, native host elements давхардаагүй байх.
7. L/T уулзварт finish-finishing solid overlap ба gap тогтоосон хүлцэлд байх.
8. Rerun дээр шинэ output 0; source move/material/height өөрчлөхөд зөв update.
9. Гараар зассан finish-ийг чимээгүй overwrite хийхгүй.
10. Preview/Cancel дараа persistent element/temporary override үлдээгүй байх.
11. Atomic Apply-д injected creation failure → өмнөх model state бүрэн сэргэсэн байх.
12. Atomic mode-ийн нэг Undo/Redo geometry ба metadata-г зөв буцаах.
13. Source/document/link transform өөрчлөгдсөн stale plan хэрэгжихгүй байх.
14. Rotated/mirrored linked test source → host-д зөв байрласан output, link өөрчлөгдөөгүй байх.
15. Phase/design option mismatch, unloaded link, unsupported wall/opening, locked output-д ойлгомжтой failure.
16. Монгол WPF цонх, light/dark, 100%/150%/200% scaling, keyboard navigation дээр гол товч тасрахгүй байх.

Талбай/урт/өндрийн хүлцлийг fixture бүрд урьдчилан нэрлэ. Revit-ийн numerical tolerance, arc approximation, join behavior-тэй уялдуул; алдаа гарсны дараа тестийг ногоон болгохоор tolerance-оо сулруулахгүй.

Performance: жижиг өрөө, 20 өрөө, 100 өрөөний fixture дээр extraction, planning, validation, apply хугацаа ба UI stall-ийг тусад нь хэмж. Хэмжээгүй «маш хурдан» гэж бүү тайлагна. Atomic apply-гийн хугацаанаас хамаарч том batch mode хэрэгтэй эсэхийг шийд.

## 13. Build ба compatibility

Одоогийн csproj-ийг эхлээд шалгаж, configuration-ууд хэвээр байвал доорх build-уудыг ажиллуул:

```powershell
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64 -p:DeployToRevit=false
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64 -p:DeployToRevit=false
```

Shared code өөрчилсөн бол R25/R26 compile regression-ийг бас шалга. Existing relevant test command-уудыг төсөл бүрийн бодит csproj/README-ээс олж ажиллуул; байхгүй команд зохиохгүй.

Build хийхдээ working Revit add-in folder-ийг автоматаар overwrite хийхгүй. DeployToRevit-ийн өнөөгийн semantics-ийг csproj-оос батал. Live test-д isolated candidate build/deploy зам болон одоогийн release-gate pattern хэрэглэ.

Runtime version/references алдаатай бол R27-ийг R24 reference-ээр build хийж «pass» гэж бүү гарга. Revit API runtime DLL-уудыг буруу target-ын package-д оруулахгүй.

Хэрэв тухайн орчинд Windows/Revit/шаардлагатай SDK байхгүй бол боломжтой core tests, static review, build preparation, reproducible harness/зааврыг бүрэн хий. Дараа нь яг ямар шалгалт blocked байгааг бич. Host test ажиллуулаагүй байж R24/R27 дээр баталгаажсан гэж бүү хэл.

## 14. Хэрэгжүүлэх дараалал

1. Одоогийн tool, lifecycle, type system, UI catalog, version split-ийг шалгаж богино gap map гарга. Үүний дараа шууд implementation рүү ор.
2. Shared DTO, selected-source resolver, units, context validation, source ownership-ийг хий.
3. Room boundary зам ба Room-гүй polygonization замыг core tests-тай хий.
4. Floor plan/validation/creator, төрөл/өндрийн тохиргоо, preview-г end-to-end ажиллуул.
5. Wall side/height/finish geometry, стандарт door/window opening cut-ыг end-to-end ажиллуул.
6. Rerun/update/manual-edit protection, rollback, stale guard-ийг холбо.
7. Shared UI, ribbon/catalog, settings, progress/report-ийг дуусга.
8. Arc/multi-region/holes, linked sources болон capability matrix-ийг бодит дэмжлэгтэй холбо.
9. Core tests → R24/R27 builds → боломжтой host tests → visual QA → docs/report.

Техникийн энгийн сонголт бүр дээр хэрэглэгчээс асуугаад зогсохгүй. Одоогийн repo хэв маягаар хамгийн найдвартай хувилбарыг сонгоод үргэлжил. Материал, thickness, хийх тал зэрэг хэрэглэгч бүрийн project-specific сонголтыг tool UI дотор асуудаг болго; хөгжүүлэлтийн session-оос hardcode хийж бүү шийд.

Үндсэн хоёр workflow ажиллаагүй байхад advanced UI, AI, backend, analytics feature рүү хүрээг тэлэхгүй. TODO/placeholder үлдээж full implementation гэж тайлагнахгүй. Бодит API хязгаарлалт байвал түүнийг capability matrix ба UI-д ил хэлээд дэмжсэн үндсэн ажлыг бүрэн дуусга.

## 15. Acceptance criteria

Дараахыг хангаагүй бол ажил дууссан гэж бүү үз:

- [ ] Floor Plan дээр native walls сонгоод type/height сонгоход хүрээ гараар зурахгүйгээр жинхэнэ Floor үүснэ.
- [ ] Room урьдчилан үүсгэсэн байх шаардлагагүй.
- [ ] Олон өрөө, диагональ/L/U хүрээ, inner holes зөв; нэг том гаднах rectangle болж дүүрэхгүй.
- [ ] FloorType/material/layers/thickness ба top elevation нь UI-д сонгосонтой таарна.
- [ ] Wall finish зөв талд, бодит зузаантай, base/top зөв, стандарт door/window-ийг таглахгүй.
- [ ] Нэг ханын хоёр тал өөр материалтай ажиллана; ижил талд duplicate үүсэхгүй.
- [ ] Source host wall/door/window, structural floor болон linked model өөрчлөгдөхгүй.
- [ ] Preview зөв output-той таарна; Cancel model-д үр дүн үлдээхгүй.
- [ ] Нэг input-ээр давтахад duplicate output/type үүсэхгүй.
- [ ] Source өөрчлөгдвөл зөв update; manual output edit-д conflict гарна.
- [ ] Invalid/open/unsupported geometry-г бүтсэн мэт харуулахгүй.
- [ ] Atomic mode failure/Undo бүрэн зөв; chunked mode байвал өөр Undo гэрээ нь ил.
- [ ] R24 ба R27 build-ууд, version-aware behavior шалгагдсан; host execution-ийн нотолгоо тусдаа байна.
- [ ] Revit API context/threading зөв; Smart нь R24-д хасагддаг байдлыг тооцсон.
- [ ] UI нэг нэгдсэн каталогтой, Монгол нэр/тайлбар ба existing theme-тэй.
- [ ] Network/AI/model/Python dependency шинээр шаардахгүй.

## 16. Эцэст нь надад өгөх зүйлс

1. Яг хэрэгжсэн workflow, өөрчилсөн файлууд, гол geometry/creation аргын товч тайлбар.
2. `revit-mcp/docs/` дотор хоёр tool-ийн Монгол хэрэглэгчийн заавар; нэрийг repo convention-д тааруул.
3. Дэмжсэн/дэмжээгүй source, wall/opening, link, version, Undo mode-ийн capability matrix.
4. Core tests, version builds, host tests-ийн commands ба бодит үр дүн. `PASS`, `FAIL`, `NOT RUN`, `BLOCKED`-ийг ялга.
5. Бодитоор шалгасан fixture-үүдийн expected/actual тоо, талбай, өндөр, opening/overlap шалгалт, timing.
6. Host test боломжгүй бол үлдсэн яг аль live check, яаж ажиллуулахыг давтагдах байдлаар бэлд.
7. Review хийхэд бэлэн diff. Зөвхөн энэ ажлын файлуудыг хамруул; production ERP/add-in release-ийг энэ prompt-оор автоматаар түгээхгүй.

Эцсийн тайлан Монгол хэлээр, нотолгоотой, товч байна. «Бүрэн ажиллана» гэсэн мэдэгдэл нь бодитоор хийсэн тестээс хэтрэхгүй.

Одоо репогийн одоогийн кодыг шалгаад хэрэгжүүлж эхэл.

---

## Техникийн лавлагаа

Эдгээр нь API-ийн зарим үндсэн нөхцөлийг шалгасан Autodesk-ийн эх сурвалж. Local R24/R27 reference ба бодит host behavior-ийг тусад нь шалгах шаардлагатай хэвээр.

- [Autodesk — Floor.Create](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/a9c74a9f-46eb-a1b7-608e-2039f06be579.htm): boundary validation, profile-ийн Z нь өндрийг тогтоохгүй байх болон explicit offset.
- [Autodesk — Room and Space Geometry](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API/files/Revit_API_Developers_Guide/Revit_Geometric_Elements/Geometry/Revit_API_Revit_API_Developers_Guide_Revit_Geometric_Elements_Geometry_Room_and_Space_Geometry_html.html): boundary location, spatial subfaces, door/window cut-ийн хязгаарлалт.
- [Autodesk — External Events](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API/files/Revit_API_Developers_Guide/Advanced_Topics/Revit_API_Revit_API_Developers_Guide_Advanced_Topics_External_Events_html.html): modeless UI-аас valid API context-д ажил явуулах.
- [Autodesk Developer Blog — Modeless Add-Ins and PDF Printing Speed](https://blog.autodesk.io/modeless-add-ins-and-pdf-printing-speed/): Revit API single-thread/context нөхцөл.

