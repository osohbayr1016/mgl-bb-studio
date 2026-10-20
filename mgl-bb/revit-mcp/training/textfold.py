"""Кирилл↔латин НЭГ хэлбэрт буулгах — `backend/src/lib/textFold.ts`-ийн
`foldText` болон `frontend/.../search/normalize.ts`-ийн `foldSearchText`-ийн
ГУРАВ ДАХЬ ХОСЛОЛ (twin).

⚠️ ГУРВУУЛАА ЗЭРЭГ ӨӨРЧЛӨГДӨНӨ.  Зөрвөл вэб дээрх хайлт, Revit хуудасны
таарц, туслахын санаа таних гурав өөр өөр хариу өгнө.
`check_fold_parity.py` нь энэ файлыг TS эхтэй тулгана.

ЯАГААД САНАА ТАНИХАД ХЭРЭГТЭЙ ВЭ:
  «илгээе» → ilge      «ilgeeye» → ilge     «ilgeye» → ilge
  «хийснээ» → hisne    «hiisnee» → hisne    «khiisne» → hisne
Нэг жишээ бичихэд КИРИЛЛ, ЛАТИН, бүр АЛДААТАЙ хэлбэр нь хамт сурагдана.
Давхардсан үсэг хураадаг тул эгшиг нэмэх/хасах алдаа өөрөө арилна.

⚠️ ГЭХДЭЭ ЭНЭ НЬ ГАНЦААРАА ХАНГАЛТГҮЙ: `[^a-z0-9]+ → зай` дүрэм нь
АСУУЛТЫН ТЭМДЭГ (?)-ийг устгана.  Атал «70% болголоо» (илгээх) ба
«70% болсон уу?» (байдал шалгах) хоёрыг ялгах гол шинж нь тэр.  Тиймээс
загвар нь ТҮҮХИЙ ба ЭВХСЭН хоёуланг нь зэрэг хардаг (union) —
`analyzer_union()`-ийг үз.
"""

from __future__ import annotations

import re
import unicodedata

# ⚠️ `textFold.ts`-ийн CYRILLIC_TO_LATIN-тай ЯГ ИЖИЛ.
CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "j", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "ө": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ү": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "sh", "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DOUBLED = re.compile(r"([a-z])\1+")


def fold_text(text: str) -> str:
    """`foldText()` (TypeScript)-тэй ЯГ ИЖИЛ.  Хоосон мөр буцаж болно."""
    if not text:
        return ""

    # 1. жижиг үсэг + латин диакритик арилгах
    #    ⚠️ NFD нь кирилл «й»-г и + товчлол болгон задалдаг тул энэ алхам
    #    дараагийн газрын зурагт хүрэхээс ӨМНӨ «й»-г «и» болгоно.  JS тал
    #    ч мөн адил ажилладаг — дараалал нь гэрээний нэг хэсэг.
    lowered = unicodedata.normalize("NFD", text.lower())
    lowered = "".join(c for c in lowered if not unicodedata.combining(c))

    # 2. кирилл → латин
    out = "".join(CYRILLIC_TO_LATIN.get(ch, ch) for ch in lowered)

    # 3–7
    out = out.replace("kh", "h")
    out = out.replace("ts", "c")
    out = out.replace("y", "i")
    out = _NON_ALNUM.sub(" ", out)
    out = _DOUBLED.sub(r"\1", out)
    return out.strip()


def fold_code(text: str) -> str:
    """ШИФР-ийн хэлбэр — зайг бүрэн хасна.  'БА-01' → 'ba01'."""
    return fold_text(text).replace(" ", "")
