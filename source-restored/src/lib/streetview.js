export const STREETVIEW_PROVIDER = "google_streetview";
export const STREETVIEW_DYNAMIC_PROVIDER = "google_streetview_dynamic";
export const STREETVIEW_BACKGROUND_TYPE = "streetview";
export const STREETVIEW_PREVIEW_LIMIT = 30;
export const STREETVIEW_DEFAULTS = {
  heading: 0,
  pitch: 0,
  fov: 90,
  width: 640,
  height: 360,
};

export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function clampStreetViewParams(params = {}) {
  return {
    heading: clampNumber(params.heading, 0, 360, STREETVIEW_DEFAULTS.heading),
    pitch: clampNumber(params.pitch, -90, 90, STREETVIEW_DEFAULTS.pitch),
    fov: clampNumber(params.fov, 10, 120, STREETVIEW_DEFAULTS.fov),
    width: clampNumber(params.width, 200, 640, STREETVIEW_DEFAULTS.width),
    height: clampNumber(params.height, 200, 640, STREETVIEW_DEFAULTS.height),
  };
}

export function buildStreetViewUrl({ lat, lng, key, heading, pitch, fov, width, height }) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng) || !key) return "";

  const params = clampStreetViewParams({ heading, pitch, fov, width, height });
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("size", `${Math.round(params.width)}x${Math.round(params.height)}`);
  url.searchParams.set("location", `${safeLat},${safeLng}`);
  url.searchParams.set("heading", String(Math.round(params.heading)));
  url.searchParams.set("pitch", String(Math.round(params.pitch)));
  url.searchParams.set("fov", String(Math.round(params.fov)));
  url.searchParams.set("key", key);
  return url.toString();
}

let googleMapsScriptPromise = null;

export function loadGoogleMapsJavascript(apiKey) {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error("Google Maps browser key가 설정되어 있지 않습니다."));
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const callbackName = `__tagExploreGoogleMapsReady_${Date.now()}`;
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("v", "weekly");
    url.searchParams.set("callback", callbackName);

    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    script.src = url.toString();
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      googleMapsScriptPromise = null;
      reject(new Error("Google Maps JavaScript API를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

export function fovToStreetViewZoom(fov = STREETVIEW_DEFAULTS.fov) {
  const safeFov = clampNumber(fov, 22.5, 180, STREETVIEW_DEFAULTS.fov);
  return Math.max(0, Math.min(4, Math.round(Math.log2(180 / safeFov))));
}

export function streetViewZoomToFov(zoom = 1) {
  const safeZoom = clampNumber(zoom, 0, 4, 1);
  return 180 / 2 ** safeZoom;
}

export function normalizeHeading(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % 360) + 360) % 360;
}

export function shortestHeadingDelta(target, current) {
  return ((normalizeHeading(target) - normalizeHeading(current) + 540) % 360) - 180;
}

export function streetViewPointFromScreen({ clientX, clientY, rect, pov, zoom }) {
  const horizontalFov = streetViewZoomToFov(zoom);
  const verticalFov = horizontalFov * (rect.height / Math.max(rect.width, 1));
  const xRatio = (clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
  const yRatio = (clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
  return {
    streetHeading: normalizeHeading((pov?.heading || 0) + xRatio * horizontalFov),
    streetPitch: clampNumber((pov?.pitch || 0) - yRatio * verticalFov, -90, 90, 0),
  };
}

export function projectStreetViewHotspot({ hotspot, pov, zoom, width, height }) {
  if (!Number.isFinite(hotspot.streetHeading) || !Number.isFinite(hotspot.streetPitch)) {
    return {
      x: Number.isFinite(hotspot.x) ? hotspot.x : 50,
      y: Number.isFinite(hotspot.y) ? hotspot.y : 50,
      hidden: false,
    };
  }

  const horizontalFov = streetViewZoomToFov(zoom);
  const verticalFov = horizontalFov * (height / Math.max(width, 1));
  const headingDelta = shortestHeadingDelta(hotspot.streetHeading, pov?.heading || 0);
  const pitchDelta = hotspot.streetPitch - (pov?.pitch || 0);
  const visible = Math.abs(headingDelta) <= horizontalFov / 2 && Math.abs(pitchDelta) <= verticalFov / 2;

  return {
    x: (0.5 + headingDelta / horizontalFov) * 100,
    y: (0.5 - pitchDelta / verticalFov) * 100,
    hidden: !visible,
  };
}

export function emptyStreetViewSource() {
  return {
    sourceProvider: null,
    sourceQuery: null,
    sourceLat: null,
    sourceLng: null,
    sourceHeading: null,
    sourcePitch: null,
    sourceFov: null,
    sourcePanoId: null,
    sourceImageUrl: null,
    sourceCopyright: null,
  };
}

export function getStreetViewUsageKey() {
  return `tag-and-explore-streetview-previews:${new Date().toISOString().slice(0, 10)}`;
}

export function getStreetViewPreviewCount() {
  return Number(localStorage.getItem(getStreetViewUsageKey())) || 0;
}

export function incrementStreetViewPreviewCount() {
  const next = getStreetViewPreviewCount() + 1;
  localStorage.setItem(getStreetViewUsageKey(), String(next));
  return next;
}
