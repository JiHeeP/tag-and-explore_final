export const STREETVIEW_PROVIDER = "google_streetview";
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
