import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, ApiError, ApiNetworkError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { toast } from '@/shared/components/Toast';
import { devAutoLogin, suspendDevAutoLogin } from '@/shared/lib/devAutoLogin';
import { applyOrgSettings, type OrgSettingsDto } from '@/shared/config/brand';
import { applyModules, type ModulesDto } from '@/shared/config/modules';
import type { UserProfile, AuthResponse } from '@/shared/types';

/**
 * Байгууллагын брэнд/локал тохиргоог серверээс татаж тусгана.
 *
 * Нэвтрэлтийг БЛОКЛОХГҮЙ (await хийхгүй) — брэнд хожуу ирсэн ч апп ажиллана,
 * учир нь `shared/config/brand.ts` нь build үеийн утга + өмнөх сессийн
 * cache-тэй.  Алдаа гарвал ЧИМЭЭГҮЙ өнгөрнө: хуучин backend дээр
 * `/settings/org` байхгүй байж болно, тэр үед брэнд өөрчлөгдөхгүй.
 */
function hydrateBrand(): void {
  void apiFetch<OrgSettingsDto>('/settings/org')
    .then(applyOrgSettings)
    .catch(() => {
      /* тохиргоо татагдаагүй — build үеийн утга хэвээр */
    });
  // Модулийн эрх — цэс шүүхэд хэрэгтэй.  Мөн адил блоклохгүй; алдаа гарвал
  // ХЯЗГААРЛАЛТГҮЙ хэвээр үлдэнэ (цэс алга болохоос хамгаална).
  void apiFetch<ModulesDto>('/settings/modules')
    .then(applyModules)
    .catch(() => {
      /* хуучин backend дээр энэ гарц байхгүй — бүх модуль нээлттэй */
    });
}

/** `localStorage.auth_token`-ийг аюулгүй уншина (private mode / хаалттай storage → null). */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  /**
   * Сессийг ШАЛГАЖ ЧАДААГҮЙ (сервер дуугарсангүй) үед л утгатай.
   *
   * ⚠️ `user === null`-ээс ЗОРИУДААР тусдаа: `null` нь «нэвтрээгүй нь
   * баталгаатай» (→ /login), харин энэ нь «мэдэхгүй» гэсэн үг.  Хоёуланг
   * нэг гэж үзвэл сүлжээ түр саатахад хэрэглэгчийг нэвтрэх хуудас руу
   * шидэж, ажлаа алдуулна.
   */
  authError: string | null;
  setUser: (user: UserProfile | null) => void;
  checkAuth: () => Promise<void>;
  /** Сүлжээний алдааны дэлгэц дээрх «Дахин оролдох» товч дуудна. */
  retryAuth: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  /* =================================================================
   * ЭНЭ TAB-ЫН СЕССИЙГ ТОГТООСОН ТОКЕН (2026-09-17)
   *
   * `apiFetch` нь хүсэлт БҮРД `localStorage.auth_token`-ийг шинээр уншдаг,
   * харин `user` нь энэ tab `/auth/me`-г уншсан тэр агшны хүн.  Хоёр нь
   * ЗӨРЖ болно: өөр tab дээр өөр хэрэглэгчээр нэвтрэх (захиалагчийн порталыг
   * шалгах, урилгын холбоос, mglenc.com-ын `#access_token` handoff), эсвэл
   * өөр tab дээр гарах нь `auth_token`-ийг ЧИМЭЭГҮЙ дарж бичдэг.  Тэр
   * мөчөөс энэ tab admin-ы хуудсыг зурсаар атлаа ХҮСЭЛТ БҮРЭЭ client-ийн
   * токеноор явуулж, сервер `role === 'client'` хаалтаар «Access denied»
   * (403) буцаадаг — «Бүх ажлууд заримдаа харагдахгүй» гэсэн гажиг.
   *
   * Тиймээс сессийг тогтоосон токеныг санаж, storage өөрчлөгдөх бүрд
   * (өөр tab-ын `storage` event, эсвэл энэ tab буцаж идэвхжихэд) тулгана.
   * Зөрвөл кэшийг цэвэрлээд `/auth/me`-г дахин уншина — tab нь одоогийн
   * токены ЖИНХЭНЭ эзнээр өөрийгөө дахин таньж, `ProtectedRoute` зөв
   * хайрцаг руу нь хүргэнэ (client → /client, токенгүй → /login).
   * ================================================================= */
  const sessionTokenRef = useRef<string | null>(null);

  const setUser = useCallback((next: UserProfile | null) => {
    // Нэвтрэх хуудас токеноо localStorage-д бичсэний ДАРАА дууддаг тул энэ
    // агшинд уншсан утга нь яг энэ хэрэглэгчийн токен.
    sessionTokenRef.current = readStoredToken();
    setUserState(next);
  }, []);

  /* =================================================================
   * Аппын АНХНЫ хүсэлт.  Энэ шийдэгдэх хүртэл `ProtectedRoute` нь
   * `BrandLoader` үзүүлдэг тул энд гацвал бүх апп гацна.
   *
   * ⚠️ ТИЙМ УЧРААС ЭНД ЯВУУЛАХ `apiFetch` НЬ ЗААВАЛ ХУГАЦААНЫ
   *    ХЯЗГААРТАЙ БАЙХ ЁСТОЙ.  2026-08-24 хүртэл timeout байхгүй
   *    байсан бөгөөд API worker-ийн хүйтэн эхлэлт 9-20 секунд үргэлжлэх
   *    үед апп «Уншиж байна…» дэлгэц дээр МӨНХӨД зогсдог байв.
   *
   * 7 с × 3 оролдлого: ердийн тохиолдолд эхний оролдлого 20-100 мс-д
   * шийдэгдэнэ; хүйтэн эхлэлтэд 2-3 дахь оролдлого дулаарсан машинд
   * тохиох магадлалтай; бүгд бүтэлгүйтвэл ~21 секундэд ойлгомжтой
   * алдааны дэлгэц гарна — хязгааргүй гацахын оронд.
   * ================================================================= */
  const checkAuth = useCallback(async () => {
    setAuthError(null);
    // Хүсэлт явуулахын ӨМНӨ тэмдэглэнэ: хариу ирэх хооронд өөр tab токеныг
    // солибол доорх тулгалт ялгааг барьж дахин шалгана.
    sessionTokenRef.current = readStoredToken();
    try {
      const data = await apiFetch<AuthResponse>('/auth/me', { timeoutMs: 7_000, attempts: 3 });
      setUser(data.user);
      hydrateBrand();
    } catch (err) {
      // Сервер ДУУГАРСАНГҮЙ — «нэвтрээгүй» гэж ҮЗЭХГҮЙ.  Хэрэглэгчийг
      // /login руу шидэхийн оронд дахин оролдох боломжтой алдаа үзүүлнэ.
      if (err instanceof ApiNetworkError) {
        setAuthError(err.message);
        setUser(null);
        return;
      }
      // Токены role нь DB-ийн role-оос зөрсөн (админ эрх сольсон) — сервер
      // энэ токеныг сессид тооцохгүй.  Хуучин токеныг хаяж нэвтрэх хуудас
      // руу очно; шалтгааныг нь хэлэхгүй бол хэрэглэгч «яагаад гаргачихав»
      // гэж гайхна.
      if (err instanceof ApiError && err.code === 'ROLE_CHANGED') {
        try {
          localStorage.removeItem('auth_token');
        } catch {
          /* ignore */
        }
        toast.info('Таны эрх өөрчлөгдсөн байна', 'Шинэ эрхээр ажиллахын тулд дахин нэвтэрнэ үү.');
      }
      // Локал хөгжүүлэлт: session олдоогүй бол нэвтрэх дэлгэц үзүүлэхийн
      // оронд `admin`-аар чимээгүй нэвтэрнэ.  Prod build-д энэ мөр бүхэлдээ
      // хасагдана (see shared/lib/devAutoLogin.ts).
      if (await devAutoLogin()) {
        try {
          const data = await apiFetch<AuthResponse>('/auth/me', { timeoutMs: 7_000, attempts: 3 });
          setUser(data.user);
          hydrateBrand();
          return;
        } catch {
          /* авто-нэвтрэлт ажиллаагүй — ердийн замаар үргэлжилнэ */
        }
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  const retryAuth = useCallback(() => {
    setLoading(true);
    setAuthError(null);
    setRetryTick((n) => n + 1);
  }, []);

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('auth_token');
      // Локалд гараар гарсны дараа таб хаагдтал авто-нэвтрэлт ажиллахгүй.
      suspendDevAutoLogin();
      // Өмнөх хүний өгөгдөл дараагийн нэвтрэгчид кэшээс гарч ирэх ёсгүй.
      queryClient.clear();
      setUser(null);
    }
  };

  useEffect(() => {
    checkAuth();
  }, [checkAuth, retryTick]);

  /* Токен доороос нь солигдсон эсэхийг ХОЁР сувгаар барина:
   *   • `storage` event — ӨӨР tab localStorage-ийг өөрчлөхөд л хөөрдөг;
   *   • `visibilitychange`/`focus` — энэ tab буцаж идэвхжихэд тулгана
   *     (`storage` event нь tab унтаа байхад ч ирдэг ч, зарим хөтөч
   *     дээр алдагддаг тул хоёр дахь давхарга).
   * Ижил бол юу ч хийхгүй — хямд харьцуулалт, сүлжээ рүү хүрэхгүй. */
  useEffect(() => {
    let resyncing = false;
    const resync = () => {
      if (resyncing) return;
      resyncing = true;
      // Хуучин хүний хариунууд шинэ хүнд харагдах ёсгүй; мөн явж буй
      // хүсэлтүүд хуучин токеноор ирсэн 403-оо кэшэд бичих ёсгүй.
      void queryClient.cancelQueries();
      queryClient.clear();
      setLoading(true);
      void checkAuth().finally(() => {
        resyncing = false;
      });
    };
    const compare = () => {
      if (readStoredToken() !== sessionTokenRef.current) resync();
    };
    const onStorage = (e: StorageEvent) => {
      // `key === null` = `localStorage.clear()`.
      if (e.key === 'auth_token' || e.key === null) compare();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') compare();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', compare);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', compare);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkAuth]);

  return (
    <AuthContext.Provider
      value={{ user, loading, authError, setUser, checkAuth, retryAuth, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
