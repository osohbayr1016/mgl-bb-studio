import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { LazyMotion, domMax, MotionConfig } from 'motion/react';

import { queryClient } from '@/shared/api/queryClient';
import { AuthProvider } from '@/shared/context/AuthContext';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { LanguageProvider } from '@/shared/i18n';
import { TooltipProvider } from '@/ui/tooltip';
import { Toaster } from '@/shared/components/Toast';
import { ConfirmDialogOutlet } from '@/shared/components/ConfirmDialog';

/**
 * App-wide provider stack. Order matters: ThemeProvider applies the per-user
 * accent override on :root, QueryClient backs all data fetching, Auth resolves
 * the session, Language drives i18n, and Tooltip is the Radix portal root.
 * The global <Toaster> lives here (inside TooltipProvider, outside the router)
 * so `showToast(...)` works from anywhere.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LanguageProvider>
            <TooltipProvider delayDuration={150}>
              {/* Motion: LazyMotion + `m` компонентоор bundle-ийг хязгаарлана
                  (strict → motion.* хориглож m.* шаардана). domMax нь layout
                  animation (tab indicator layoutId г.м.)-ийг агуулна. MotionConfig
                  reducedMotion="user" нь OS-ийн prefers-reduced-motion-ийг
                  баримталж transform animation-ийг унтраана. */}
              <LazyMotion features={domMax} strict>
                <MotionConfig reducedMotion="user">
                  {children}
                  {/* Global toast outlet — call `showToast(...)` from anywhere. */}
                  <Toaster />
                  {/* Global confirm outlet — call `confirmDialog(...)` from anywhere. */}
                  <ConfirmDialogOutlet />
                </MotionConfig>
              </LazyMotion>
            </TooltipProvider>
          </LanguageProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
