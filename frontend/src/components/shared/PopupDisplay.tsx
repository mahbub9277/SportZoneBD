import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useGetActivePopupsQuery } from '../../features/popups/popups.api';
import { useTrackEventMutation } from '../../features/analytics/analytics.api';
import { useAuth } from '../../hooks/common/layouts/useAuth';
import { buildCloudinaryUrl } from '../../utils/cloudinary';

const POPUP_TTL_MS = 6 * 60 * 60 * 1000;
const POPUP_STORAGE_KEY = 'sportzone_popup_dismissals';

function readPopupDismissals(): Record<string, number> {
  try {
    const raw = localStorage.getItem(POPUP_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const dismissals: Record<string, number> = {};

    for (const [popupId, timestamp] of Object.entries(parsed)) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        dismissals[popupId] = timestamp;
      }
    }

    return dismissals;
  } catch {
    return {};
  }
}

function isPopupAllowedAgain(popupId: string): boolean {
  const dismissals = readPopupDismissals();
  const dismissedAt = dismissals[popupId];
  if (!dismissedAt) return true;

  return Date.now() - dismissedAt >= POPUP_TTL_MS;
}

export function PopupDisplay() {
  const location = useLocation();
  const { isAdmin } = useAuth();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const shouldSkipPopups = isAdminRoute || isAdmin;
  const { data: popups, isSuccess } = useGetActivePopupsQuery(undefined, {
    skip: shouldSkipPopups,
  });
  const [trackEvent] = useTrackEventMutation();
  const [currentPopup, setCurrentPopup] = useState<any | null>(null);
  const [shownPopupIds, setShownPopupIds] = useState<Set<string>>(new Set());

  const validPopups = useMemo(() => {
    if (!isSuccess || !Array.isArray(popups)) {
      return [];
    }

    const filtered = popups.filter((popup: any) => {
      const popupId = String(popup.id ?? '');
      if (!popupId) return false;
      if (shownPopupIds.has(popupId)) return false;
      return isPopupAllowedAgain(popupId);
    });

    return filtered;
  }, [isSuccess, popups, shownPopupIds]);

  useEffect(() => {
    if (shouldSkipPopups) {
      return;
    }

    const dismissals = readPopupDismissals();
    const activeIds = new Set<string>();

    Object.keys(dismissals).forEach((popupId) => {
      const dismissedAt = dismissals[popupId];
      if (Date.now() - dismissedAt < POPUP_TTL_MS) {
        activeIds.add(popupId);
      }
    });

    setShownPopupIds(activeIds);
  }, [shouldSkipPopups]);

  useEffect(() => {
    if (!currentPopup && validPopups.length > 0) {
      setCurrentPopup(validPopups[0]);
    }
  }, [currentPopup, validPopups]);

  const dismissPopup = () => {
    if (!currentPopup) {
      return;
    }

    const popupId = String(currentPopup.id ?? '');
    const nextIds = new Set(shownPopupIds);

    if (popupId) {
      nextIds.add(popupId);
      const dismissals = readPopupDismissals();
      dismissals[popupId] = Date.now();
      localStorage.setItem(POPUP_STORAGE_KEY, JSON.stringify(dismissals));
    }

    setShownPopupIds(nextIds);
    setCurrentPopup(null);
  };

  const handleLinkClick = () => {
    if (!currentPopup) {
      return;
    }

    trackEvent({ type: 'POPUP_CLICK', entityId: currentPopup.id });
    dismissPopup();
  };

  if (shouldSkipPopups || !currentPopup) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={dismissPopup} />

      <div className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-4xl border border-(--border) bg-(--surface)/95 p-4 shadow-[0_40px_100px_rgba(2,6,23,0.3)] sm:p-7">
        {currentPopup.imageUrl && (
          <img
            src={buildCloudinaryUrl(currentPopup.imageUrl)}
            alt={currentPopup.title}
            className="mb-5 max-h-56 w-full rounded-3xl object-cover sm:h-72 sm:max-h-none"
          />
        )}

        <div className="space-y-4 text-center sm:text-left">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-(--text-primary)">{currentPopup.title}</h2>
            <p className="mx-auto max-w-2xl text-sm leading-6 text-(--text-muted) sm:mx-0 sm:text-base">
              {currentPopup.message}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:justify-center lg:justify-start">
            <Button variant="secondary" onClick={dismissPopup} className="min-w-30">
              Dismiss
            </Button>
            {currentPopup.link && (
              <Button asChild className="min-w-30">
                <a href={currentPopup.link} target="_blank" rel="noreferrer" onClick={handleLinkClick}>
                  Learn more
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
