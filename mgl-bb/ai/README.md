# MGL AI

Монголын архитектур, барилгын компанийн AI давхарга. **Инференс нь ажилтны
компьютер дээр локалаар ажиллана — токен тутмын төлбөр байхгүй.**

> Архитектурын бүрэн тайлбар: [`docs/mgl-ai/ARCHITECTURE.md`](../docs/mgl-ai/ARCHITECTURE.md)
> Лиценз, атрибуци: [`registry/LICENSES.md`](registry/LICENSES.md)

---

## Юу гэсэн үг вэ

```
Хөтөч / Revit add-in
   │
   ├──► Cloudflare Worker  (/api/mgl-ai)      ◄── эрх, контекст, ERP хэрэгсэл,
   │       ХЭЗЭЭ Ч LLM ажиллуулахгүй              норм эшлэл, санал хүсэлт
   │
   └──► 127.0.0.1:39217   (mgl-ai-runtime)    ◄── llama.cpp, локал GGUF загвар
           ХЭЗЭЭ Ч эрх шийдэхгүй                  ЭНД токен үүснэ
```

Хоёрыг **холихгүй** байх нь бүх системийн гол дүрэм:

- Worker дунд нь орж инференс хийвэл → токен тутмын төлбөр (§3 зөрчигдөнө)
- Локал runtime эрх шийдвэл → нууцлалын шүүлт 40 машин дээр давхардана

---

## Хурдан эхлэх

```bash
cd ai
npm install

npm run ai:doctor      # энэ машин юу чадах вэ — хэмжинэ, таамаглахгүй
npm run ai:dev         # локал үйлчилгээг асаана (порт 39217)
npm run ai:check       # typecheck + тест
```

### Home laptop / macOS / Linux / portable mode

Developer machine дээр ERP installer-гүйгээр шууд inference шалгах бол:

```bash
cd ai
npm install
npm run ai:install:portable
npm run ai:start:portable
npm run ai:chat -- "Сайн уу"
```

macOS arm64/x64, Linux x64/arm64, Windows x64/arm64 дэмжинэ. Linux server/Docker болон SSH tunnel-ийн заавар: [`PORTABLE.md`](PORTABLE.md).

Загваргүйгээр ч **ажиллана**: `EchoEngine` нь өгүүлбэр зохиохгүй, харин
олдсон эх сурвалж, ERP-ийн хариуг эшлэлтэй нь дамжуулна — мөн хариу бүрдээ
«загвар суулгаагүй байна» гэдгийг **ил хэлнэ**.

### Загвар суулгах

```bash
npm run ai:setup                      # llama-server -г хаанаас авахыг заана
export MGLAI_TOKEN="<ERP сессийн JWT>"
npm run ai:model -- pull              # БИДНИЙ манифестаас, SHA-256 шалгана
npm run ai:model -- activate <uid>
npm run ai:benchmark                  # ХЭМЖИНЭ — баримтад бичихээс өмнө
```

⚠️ `ai:model -- pull` нь `license_cleared = 1` **бөгөөд** `eval_passed = 1`
релиз байхгүй бол юу ч татахгүй. Энэ нь алдаа биш — [хаалга](registry/LICENSES.md).

---

## Тушаалууд

| Тушаал | Юу хийдэг |
|---|---|
| `ai:doctor` | CPU/RAM/GPU/VRAM/CUDA, суулгац, загвар, холболтыг шалгана. Юу ч өөрчлөхгүй. |
| `ai:dev` | Локал үйлчилгээг 127.0.0.1:39217 дээр асаана |
| `ai:check` | `tsc --noEmit` + бүх тест |
| `ai:setup` | `llama-server` суулгах заавар (татахгүй — CUDA нийцийг далдлахгүй) |
| `ai:model -- <list\|pull\|activate\|rollback\|prune>` | Загварын хувилбарууд |
| `ai:benchmark` | Эхний токен, токен/сек — төхөөрөмжийн хурууны хээтэй хамт хадгална |
| `ai:export-feedback -- <хувилбар>` | БАТЛАГДСАН саналыг хувилбартай багц болгоно |
| `ai:train` | QLoRA (1.1-ийн ажил) |
| `ai:quantize` | адаптер → GGUF → Q4_K_M → SHA-256 |

---

## Хавтасны бүтэц

```
runtime/     mgl-ai-runtime — локал үйлчилгээ
  src/engine/  InferenceEngine (интерфейс) · LlamaCppEngine · EchoEngine
  src/         hardware · modelManager · auth · config · server
  test/        29 + 11 тест
registry/    models.json (лавлах) · LICENSES.md (ХААЛГА)
training/    QLoRA · dataset_lint (§35-ийн хаалга) · quantize
datasets/    хувилбартай багцууд (өгөгдөл нь gitignore)
evaluation/  benchmarks/ — ХЭМЖСЭН тоо, төхөөрөмжийн хээтэй
scripts/     ai:* тушаалууд
research/    tiny-transformer — СУРАЛЦАХ зорилготой, продакшнд ОРОХГҮЙ
```

---

## Аюулгүй байдал — локал үйлчилгээ

`revit-mcp/server/` нь баталгаажуулалтгүй localhost дээр Roslyn ажиллуулдаг
(репогийн мэдэгдэж буй эрсдэл #7). **MGL AI үүнийг давтахгүй** — дөрвөн давхарга:

1. Зөвхөн `127.0.0.1` (тохируулах боломжгүй)
2. Суулгацын нууц (32 байт, `%LOCALAPPDATA%\MglAi\secret.txt`)
3. `Origin` цагаан жагсаалт — **зөв нууцтай ч** хортой хуудас баригдана
4. Богино хугацаат сессийн токен

Гурав дахь давхарга нь `runtime/test/auth.test.ts`-д тестлэгдсэн: зөв нууцтай
боловч `https://evil.example.com` -аас ирсэн хүсэлт **401 bad_origin** авна.

---

## Юуг ХЭЗЭЭ Ч хийхгүй

- ❌ Төлбөртэй LLM API (Anthropic, OpenAI, Gemini, Groq, Workers AI…) дуудах
  — `runtime/test/engine.test.ts` нь эх кодыг grep-дэж барина
- ❌ `llama-server` -ийг 127.0.0.1-ээс өөр хаяг дээр сонсгох
- ❌ Динамик компанийн баримтыг (ажилтны тоо, хугацаа) жинд сургах
  — `training/dataset_lint.py` нь сургалтыг зогсооно
- ❌ Checksum-гүй артефакт суулгах
- ❌ Идэвхтэй загвар дээр дарж бичих (буцах хувилбар үлдэнэ)
- ❌ Хуурамч гүйцэтгэлийн тоо баримтжуулах — `ai:benchmark` -ээс Л
