import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/Dialog';
import { useGetActivePopupsQuery } from '../../features/popups/popups.api';
import { useTrackEventMutation } from '../../features/analytics/analytics.api';
import { useAuth } from '../../hooks/common/layouts/useAuth';
import { buildCloudinaryUrl } from '../../utils/cloudinary';
import type { Popup } from '../../features/admin/popups.api';
import {
  getNextPopupExpiry,
  isPopupSnoozed,
  readPopupDismissals,
  withPopupDismissed,
  writePopupDismissals,
} from '../../features/popups/popupDismissals';

const POPUP_IMAGE_TRANSFORM = { width: 1280, height: 720, crop: 'fill' as const, gravity: 'auto' as const, quality: 'auto' as const, format: 'auto' as const };

/**
 * Shows the first active popup the visitor has not dismissed in the last six hours.
 *
 * The dismissal record is the only popup state — the popup on screen is derived from it, so
 * dismissing advances to the next popup in a single render — and a single timer re-checks
 * eligibility when the earliest dismissal expires, which is what makes a popup eligible again after
 * six hours without a reload.
 */
/**
 * URL prefixes of the operations consoles. Public-site overlays do not belong on top of them.
 */
const OPERATIONS_CONSOLES = ['/admin', '/moderator', '/staff'];

export function PopupDisplay() {
  const location = useLocation();
  const { isAdmin } = useAuth();
  const isInsideConsole = OPERATIONS_CONSOLES.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  );
  const shouldSkipPopups = isAdmin || isInsideConsole;

  const { data: popups, isSuccess } = useGetActivePopupsQuery(undefined, {
    skip: shouldSkipPopups,
  });
  const [trackEvent] = useTrackEventMutation();

  // One storage read per page load; the record is state so eligibility and the timer stay in step.
  const [dismissals, setDismissals] = useState(readPopupDismissals);
  const [now, setNow] = useState(() => Date.now());

  const currentPopup = useMemo<Popup | null>(() => {
    if (shouldSkipPopups || !isSuccess || !Array.isArray(popups)) return null;

    return (
      popups.find((popup) => {
        const popupId = String(popup?.id ?? '');
        return popupId !== '' && !isPopupSnoozed(dismissals, popupId, now);
      }) ?? null
    );
  }, [dismissals, isSuccess, now, popups, shouldSkipPopups]);

  // Exactly one timer, set for the earliest dismissal to expire. While nothing is snoozed there is no
  // timer at all, and the cleanup guarantees the previous timer is always cleared.
  useEffect(() => {
    if (shouldSkipPopups) return;

    const nextExpiry = getNextPopupExpiry(dismissals, now);
    if (nextExpiry === null) return;

    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [dismissals, now, shouldSkipPopups]);

  const dismissPopup = useCallback(() => {
    const popupId = String(currentPopup?.id ?? '');
    if (!popupId) return;

    const dismissedAt = Date.now();
    // A single pruned write, so the state and localStorage can never disagree about the six hours.
    setDismissals(writePopupDismissals(withPopupDismissed(dismissals, popupId, dismissedAt), dismissedAt));
    setNow(dismissedAt);
  }, [currentPopup, dismissals]);

  const handleLinkClick = () => {
    if (!currentPopup) return;

    trackEvent({ type: 'POPUP_CLICK', entityId: currentPopup.id });
    dismissPopup();
  };

  const popupImage = currentPopup?.imageUrl ? buildCloudinaryUrl(currentPopup.imageUrl, POPUP_IMAGE_TRANSFORM) : null;
  // Keyed on the popup so a failed image never leaks into the next popup's render.
  const [failedImagePopupId, setFailedImagePopupId] = useState<string | null>(null);
  const showImage = Boolean(popupImage) && failedImagePopupId !== currentPopup?.id;

  return (
    <Dialog open={currentPopup !== null} onOpenChange={(isOpen) => { if (!isOpen) dismissPopup(); }}>
      <DialogContent className="max-w-3xl gap-0 border-(--border) bg-(--surface)/95 p-0 shadow-[0_40px_100px_rgba(2,6,23,0.35)] backdrop-blur-xl">
        {/* Keyed so each popup animates in, and animated on the inner wrapper so it cannot override
            the dialog's own centering transform. */}
        <div key={currentPopup?.id ?? 'popup'} className="app-page-card">
          {showImage && (
            <div className="relative">
              <img
                src={popupImage ?? undefined}
                alt={currentPopup?.title ?? ''}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                // A broken or deleted asset is dropped once and the dialog closes up around it, so the
                // visitor never sees a stuck image slot. No retry: a 404 will not fix itself.
                onError={() => setFailedImagePopupId(currentPopup?.id ?? null)}
                className="aspect-video max-h-56 w-full object-cover object-center sm:max-h-80"
              />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-(--surface) to-transparent" />
            </div>
          )}

          <div className="space-y-5 p-5 sm:p-7">
            <div className="space-y-2 text-center sm:text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight text-(--text-primary) sm:text-2xl">
                {currentPopup?.title}
              </DialogTitle>
              <DialogDescription className="mx-auto max-w-2xl text-sm leading-6 text-(--text-muted) sm:mx-0 sm:text-base">
                {currentPopup?.message}
              </DialogDescription>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:justify-center lg:justify-start">
              <Button variant="secondary" onClick={dismissPopup} className="min-w-30">
                Dismiss
              </Button>
              {currentPopup?.link && (
                <Button asChild className="min-w-30">
                  <a href={currentPopup.link} target="_blank" rel="noreferrer" onClick={handleLinkClick}>
                    Learn more
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
