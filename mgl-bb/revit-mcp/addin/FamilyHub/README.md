# Family Hub — POC (2026-09-15)

Search → Preview → Add to Revit → Duplicate check → Load → Place, `.rfa`-г Downloads-д гараар
татахгүйгээр.  **Нэвтрэлт, CSRF, signed URL, anti-bot — юуг ч тойрдоггүй.**

## BIMobject — anonymous discovery (хэмжсэн, нэвтрэлт/cookie/токенгүй)

| URL | HTTP | Тэмдэглэл |
|---|---|---|
| `https://www.bimobject.com/en-us/api/v1/config` | **403** | `Cf-Mitigated: challenge` (Cloudflare anti-bot), Chrome UA-тай ч ижил |
| `https://www.bimobject.com/en-us` | 403 | challenge |
| `https://www.bimobject.com/en-us/{brand}/product/{slug}` ×3 | 403 | challenge |
| `https://www.bimobject.com/en-us/product?searchText=office%20chair` | 403 | challenge |
| `https://www.bimobject.com/robots.txt` | 200 | `Sitemap:` → Azure blob |
| `https://stbimobjectportalsitemap.blob.core.windows.net/sitemap/sitemap_index.xml` | 200 | 690 sitemap |
| `…/sitemap/sitemap_product_en-us_01.xml` | 200 | зөвхөн `<loc>` + `lastmod`, нэр/зураг/формат байхгүй |

| Capability | Result |
|---|---|
| Anonymous product metadata | **NO** — хуудас бүр challenge; sitemap-д зөвхөн URL |
| Anonymous thumbnail | **NO** — thumbnail хост баталгаажаагүй (таамаглаагүй) |
| Anonymous search | **NO** — 403 challenge |
| Anonymous RFA download | **NO** — метадата хүртэл хүрэхгүй; BIMobject өөрөө нэвтрэлт шаарддаг гэж мэдэгддэг |
| Authentication required | **YES** |
| Can one-click load anonymously | **NO** |

**BIMOBJECT_ANONYMOUS_DOWNLOAD_NOT_AVAILABLE.**  `BimObjectProvider` нь метадата / AUTH_REQUIRED
л: сүлжээ рүү хандахгүй, буулгасан бүтээгдэхүүний URL-аас (`/{locale}/{brand}/product/{slug}`)
brand/slug гаргаж, татах хүсэлт бүрд AUTH_REQUIRED буцаана.

## Fallback provider — GitHub public `.rfa` (хэмжсэн)

- `GET https://api.github.com/repos/StudioLE/RevitFamilies/git/trees/main?recursive=1` → 200, 16 `.rfa`
  (anonymous rate limit 60/цаг → 15 мин кэш, санах ой + `%LOCALAPPDATA%\MGL\RevitMcpAddin\FamilyHubCache`)
- `GET https://raw.githubusercontent.com/StudioLE/RevitFamilies/main/LE%20Chair.rfa` → 200,
  `application/octet-stream`, 307 200 B, redirect 0, OLE магик, «Revit Build: Autodesk Revit 2018»,
  SHA-256 `2c768906…5d91`.
- ⚠️ Repo-д LICENSE алга — POC-ийн туршилтын файл болгон л хэрэглэнэ, тараахгүй (UI-д мэдэгдэл гарна).
- Нэмэлт эх сурвалж (тестэд): `FAMILYHUB_GITHUB_SOURCES=owner/repo@ref;…`

## Бүтэц

```
FamilyHub/
  Core/        Revit төрөлгүй: Models, IFamilyProvider, SafeDownloader, FamilyPackageInspector,
               RevitCompatibilityCheck, FamilyHubRegistry, FamilyHubPipeline, TempFiles
  Providers/   BimObjectProvider (AUTH_REQUIRED), GitHubPublicRfaProvider (anonymous)
  Revit/       FamilyHubExternalEvent, RevitGateway (+ ExtensibleStorage registry), FamilyHubCommand
  Ui/          FamilyHubWindow (WPF, модальгүй)
tests/FamilyHub.Tests   dotnet run  (43 тест; FAMILYHUB_LIVE=1 → +1 бодит сүлжээний E2E)
```

Давхардал: A) `providerId:externalId:assetId` (ZIP доторх файл `asset#entry`) → B) SHA-256 →
C) family нэр (зөрчил бол «Use existing / Cancel», нэр өөрчлөхгүй, дарж бичихгүй).  Бүртгэл нь
`DataStorage` «MGL.FamilyHub.Registry», schema `b3f1e6c2-4a7d-4f0e-9c1b-7d2a8e5f6a01` (JSON).

Түр файл: `%LOCALAPPDATA%\MGL\RevitMcpAddin\TempFamilies\<session>\` — амжилт/алдаа аль ч үед устгагдана.
