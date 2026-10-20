import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@/index.css';

import { bridgePrintToken } from '@/shared/lib/printAuth';
import { bridgeHandoffToken } from '@/shared/lib/handoffToken';
import { registerServiceWorker } from '@/shared/lib/serviceWorker';
// `beforeinstallprompt` нь React-ийн ямар ч effect mount болохоос өмнө
// хөөрдөг тул модулын түвшинд барих ёстой — зөвхөн импортлосон нь хангалттай.
import '@/shared/lib/installPrompt';

import { AppProviders } from './providers';
import { AppRoutes } from './routes';
import { reportWebVitals } from './reportWebVitals';

// mglenc.com-ын толгойн «Нэвтрэх» товчноос `#access_token=<jwt>`-тэй ирсэн
// хэрэглэгчийг хамгийн түрүүнд авна: токен нь `localStorage.auth_token`-д
// ороод AuthContext-ийн /auth/me шалгалт эхлэхээс ӨМНӨ байрандаа байх ёстой.
// Fragment-ийг өөрөө арчина.
bridgeHandoffToken();

// `/app/*` доторх print route-ууд (багийн тайлбар бичиг г.м.) ProtectedRoute-ийн
// АРД байдаг: ?t= токеныг зөвхөн lazy chunk доторх bridge хуулдаг байсан тул
// AuthContext-ийн auth/me токенгүй 401 аваад Browser Rendering /login дээр
// гацдаг байв. Тиймээс auth шалгахаас ӨМНӨ энд, app-ийн entry дээр bridge-лнэ.
bridgePrintToken();

// bridgePrintToken()-ийн ДАРАА: тэр нь `?t=` токеныг URL-ээс арчсан байх
// ёстой, эс тэгвэл service worker токонтой навигацийг харах эрсдэлтэй.
// Дотроо dev, хэвлэлтийн зам, `?nosw=1` kill-switch-ийг өөрөө шалгана.
registerServiceWorker();

reportWebVitals();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
