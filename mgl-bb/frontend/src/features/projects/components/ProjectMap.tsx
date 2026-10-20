import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, Crosshair, Save, X, Link2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { OpenInGoogleMaps } from '@/features/projects/components/OpenInGoogleMaps';
import { MapsLinkDialog } from '@/features/projects/components/MapsLinkDialog';

// Ulaanbaatar fallback so admins always see a familiar starting view
// even when the project has no coords yet.
const UB_FALLBACK: [number, number] = [106.9177, 47.9184]; // [lng, lat]

// Esri World Imagery — free satellite raster tiles, no API key. We feed
// them into MapLibre as a raster source. MapLibre renders to a WebGL
// canvas (not <img> tags) so Tailwind's preflight `img { max-width:100% }`
// rule that broke Leaflet can never affect us here.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-sat': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS User Community',
      maxzoom: 19,
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'esri-sat' },
    { id: 'labels', type: 'raster', source: 'esri-labels', paint: { 'raster-opacity': 0.9 } },
  ],
};

interface ProjectMapProps {
  /** Project name shown inside the marker popup. */
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** When true, admin can click on the map to pick a new location and
   *  the parent receives `onChange(lat, lng)` once they hit "Save". */
  editable?: boolean;
  onSave?: (lat: number, lng: number) => Promise<void> | void;
  /** Optional free-text location string from the project record (e.g.
   *  "Ulaanbaatar SBD") shown above the map for context. */
  locationLabel?: string | null;
  className?: string;
  compact?: boolean;
}

export default function ProjectMap({
  name,
  latitude,
  longitude,
  editable = false,
  onSave,
  locationLabel,
  className,
  compact = false,
}: ProjectMapProps) {
  const { t } = useLanguage();
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<[number, number] | null>(null); // [lat, lng]
  const [saving, setSaving] = useState(false);
  // «Холбоос» — Google Maps холбоосоос пин тавих цонх (засах горимд л).
  const [linkOpen, setLinkOpen] = useState(false);

  const hasLocation = latitude != null && longitude != null;

  // Initialise the map once and keep the same instance across renders.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const initialCenter: [number, number] = hasLocation
      ? [longitude as number, latitude as number]
      : UB_FALLBACK;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: SATELLITE_STYLE,
      center: initialCenter,
      zoom: hasLocation ? 16 : 11,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    // Disable scroll-zoom by default — re-enabled only in edit mode so
    // page scrolling doesn't accidentally zoom the map.
    map.scrollZoom.disable();

    mapRef.current = map;

    // ResizeObserver — when the parent container size changes (sidebar
    // toggle, edit-mode height swap, etc.) MapLibre needs to re-measure
    // its canvas so it doesn't render at the old dimensions.
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(mapDivRef.current);

    // Some layouts mount the card while still animating in — make sure
    // we resize once on the next tick so the canvas matches the final
    // container size.
    const t = setTimeout(() => map.resize(), 100);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker / camera in sync with the latest props or draft.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const target: [number, number] | null = draft
      ? draft
      : hasLocation
        ? [latitude as number, longitude as number]
        : null;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (target) {
      // Build the marker DOM ourselves so we get a richer pin look than
      // MapLibre's default circle.
      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px; height: 42px;
        transform: translateY(-21px);
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        cursor: pointer;
      `;
      el.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
          <defs>
            <linearGradient id="pin-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#ef4444"/>
              <stop offset="1" stop-color="#b91c1c"/>
            </linearGradient>
          </defs>
          <path d="M16 0C7.2 0 0 7.2 0 16c0 10.5 16 26 16 26s16-15.5 16-26c0-8.8-7.2-16-16-16z" fill="url(#pin-grad)" stroke="#7f1d1d" stroke-width="1"/>
          <circle cx="16" cy="16" r="6" fill="white"/>
        </svg>
      `;

      const popup = new maplibregl.Popup({ offset: 28, closeButton: false }).setHTML(
        `<strong style="color:#0f172a">${escapeHtml(name)}</strong>`,
      );

      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([target[1], target[0]])
        .setPopup(popup)
        .addTo(map);

      map.flyTo({
        center: [target[1], target[0]],
        zoom: Math.max(map.getZoom(), 15),
        duration: 600,
      });
    } else {
      map.flyTo({ center: UB_FALLBACK, zoom: 11, duration: 400 });
    }
  }, [latitude, longitude, draft, name, hasLocation]);

  // Bind / unbind click handler when toggling edit mode so non-admin
  // viewers can never accidentally move the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      setDraft([e.lngLat.lat, e.lngLat.lng]);
    };

    if (editing) {
      map.on('click', onClick);
      map.scrollZoom.enable();
    } else {
      map.scrollZoom.disable();
    }
    return () => {
      map.off('click', onClick);
    };
  }, [editing]);

  const startEdit = () => {
    setEditing(true);
    setDraft(hasLocation ? [latitude as number, longitude as number] : null);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };
  const save = async () => {
    if (!draft || !onSave) return;
    setSaving(true);
    try {
      await onSave(draft[0], draft[1]);
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  // Try to centre on the user's current GPS position — admin convenience
  // when they happen to be physically on-site.
  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft([pos.coords.latitude, pos.coords.longitude]),
      () => {
        /* silently ignore */
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden',
        className,
      )}
    >
      {/* Compact title strip — just the address context. All interactive
          controls live as a floating toolbar over the map below so they
          can never be clipped or hidden by header layout issues. */}
      {!compact && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-card/40">
          <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
          <h3 className="text-sm font-semibold leading-tight whitespace-nowrap">
            {t('projectMap.buildingLocation')}
          </h3>
          {locationLabel ? (
            <>
              <span className="text-muted-subtle text-sm leading-none flex-shrink-0">·</span>
              <span
                className="text-base font-semibold text-foreground truncate min-w-0"
                title={locationLabel}
              >
                {locationLabel}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic flex-shrink-0">
              {t('projectMap.noAddress')}
            </span>
          )}
        </div>
      )}
      {/* Map + floating overlay container — `relative` so the toolbar can
          absolutely position over the map. The map div itself stays a
          plain block-level element MapLibre can take over. */}
      <div className="relative">
        <div
          ref={mapDivRef}
          className={cn(
            'w-full',
            compact ? 'h-[112px]' : 'h-[380px]',
            editing && 'cursor-crosshair',
          )}
          style={{ background: '#1f2937' }}
        />
        {/* Floating action toolbar — top-right of the map. `z-[400]`
            guarantees it sits above MapLibre's canvas + controls. The
            backdrop blur + dark panel keeps the buttons readable over
            any tile imagery. */}
        {editable && (
          <div
            className={cn(
              'absolute z-[400] flex items-center gap-2 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-white/10 shadow-lg',
              compact ? 'top-2 left-2 px-1.5 py-1' : 'top-3 left-3 px-2 py-1.5',
            )}
          >
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 gap-1 text-white hover:bg-white/10 hover:text-white whitespace-nowrap"
                  onClick={useMyLocation}
                  title={t('projectMap.myLocation')}
                >
                  <Crosshair className="h-4 w-4" />
                  <span className="hidden sm:inline">GPS</span>
                </Button>
                {/* Google Maps холбоос буулгаж пин тавих — оффис дээр
                    сууж байгаад утаснаас ирсэн «Хуваалцах» холбоосоор. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 gap-1 text-white hover:bg-white/10 hover:text-white whitespace-nowrap"
                  onClick={() => setLinkOpen(true)}
                  title={t('projectMap.linkDialogTitle')}
                  data-testid="maps-link-open"
                >
                  <Link2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('projectMap.linkButton')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 gap-1 text-white hover:bg-white/10 hover:text-white whitespace-nowrap"
                  onClick={cancelEdit}
                >
                  <X className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('common.cancel')}</span>
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-3 gap-1.5 whitespace-nowrap bg-success hover:bg-success text-white border-0"
                  disabled={!draft || saving}
                  onClick={save}
                >
                  <Save className="h-4 w-4" /> {saving ? t('common.saving') : t('common.save')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className={cn(
                    'gap-1.5 whitespace-nowrap bg-primary hover:bg-primary/90 text-white border-0',
                    compact ? 'h-7 px-2 text-micro' : 'h-8 px-3',
                  )}
                  onClick={startEdit}
                >
                  <MapPin className="h-4 w-4" />{' '}
                  {compact
                    ? t('projectMap.pin')
                    : hasLocation
                      ? t('projectMap.editLocation')
                      : t('projectMap.placePin')}
                </Button>
                <OpenInGoogleMaps
                  variant="toolbar"
                  project={{ location: locationLabel, latitude, longitude }}
                />
              </>
            )}
          </div>
        )}
        {/* Floating status pill — bottom-left of the map. Shows live
            draft coords while editing or a friendly hint otherwise. */}
        {editing && (
          <div className="absolute bottom-3 left-3 z-[400] rounded-md bg-slate-900/80 backdrop-blur-sm border border-white/10 px-3 py-1.5 shadow-lg">
            <p className="text-xs text-white">
              {draft ? (
                <>
                  <span className="text-success font-medium">●</span> {draft[0].toFixed(5)},{' '}
                  {draft[1].toFixed(5)}
                </>
              ) : (
                <span className="text-warning">{t('projectMap.clickMapToPlacePin')}</span>
              )}
            </p>
          </div>
        )}
        {!hasLocation && !editing && editable && (
          <div className="absolute bottom-3 left-3 z-[400] rounded-md bg-warning/90 backdrop-blur-sm px-3 py-1.5 shadow-lg">
            <p className="text-xs text-white font-medium">{t('projectMap.noCoordinates')}</p>
          </div>
        )}
        {/* «Google Maps» — ХЭН Ч дарж болно (засах эрх шаардахгүй).  Пин
            байвал яг цэг, үгүй бол хаягийн бичвэрээр (`shared/lib/mapsLink.ts`).
            Засах эрхтэй хүнд toolbar дотор («Тэмдэглэх»-ийн хажууд, дээр
            үз), бусдад зүүн дээд буланд ганцаараа — баруун доод булан
            MapLibre-ийн attribution-д, баруун дээд нь zoom-д. */}
        {!editable && (
          <OpenInGoogleMaps
            variant="overlay"
            project={{ location: locationLabel, latitude, longitude }}
            className={cn('absolute z-[400]', compact ? 'top-2 left-2' : 'top-3 left-3')}
          />
        )}
      </div>
      {editable && (
        <MapsLinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onPick={(lat, lng) => setDraft([lat, lng])}
        />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
