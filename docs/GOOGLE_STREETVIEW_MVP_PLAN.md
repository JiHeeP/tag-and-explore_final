# Google Street View Import MVP Plan

## Objective
Build a practical MVP so teachers can:
1. Search for a location
2. Select a Google Street View static image
3. Use it as project background
4. Add hotspots and publish for students

---

## Current Baseline (from this repository)
The app already has:
- Image background workflow
- Hotspot authoring/editing
- Save/load project
- Shareable view link

Therefore, Street View import is an additive feature, not a rewrite.

---

## Scope (MVP)
### In-scope
- Google-based location search
- Street View static image preview/selection
- Save selected Street View image URL as project background
- Preserve source metadata for later edits
- Quota-safe UI behavior

### Out-of-scope (for MVP)
- Live Street View panorama viewer inside app
- Multi-provider support (Kakao/Naver)
- Route/timeline tour authoring
- Advanced geospatial overlays

---

## Implementation Plan

## Phase 0 — Google Cloud Setup
1. Create/select Google Cloud project.
2. Enable billing.
3. Enable APIs:
   - Street View Static API
   - Geocoding API (or Places API if richer search is needed)
4. Create API key.
5. Restrict key:
   - HTTP referrers: production domain + localhost
   - API restrictions: only enabled APIs above
6. Configure billing budget + alerts.

**Environment variables**
- `GOOGLE_MAPS_API_KEY` for serverless proxy (preferred)
- `VITE_GOOGLE_MAPS_API_KEY` only if temporary client-side preview is needed

---

## Phase 1 — Data Model Additions
Add optional project-level fields:

- `sourceProvider: "google_streetview" | null`
- `sourceQuery: string | null`
- `sourceLat: number | null`
- `sourceLng: number | null`
- `sourceHeading: number | null`
- `sourcePitch: number | null`
- `sourceFov: number | null`
- `sourcePanoId: string | null`
- `sourceImageUrl: string | null`

These should be persisted with existing project save/load.

---

## Phase 2 — Backend Proxy Endpoints
Create serverless routes to avoid exposing unrestricted keys and to centralize policy/rate control.

### 1) `/api/maps/geocode`
**Request**
```json
{ "query": "Eiffel Tower" }
```

**Behavior**
- Validate `query` length (e.g., 2–120 chars)
- Call Google Geocoding API
- Return normalized results:
  - `formattedAddress`
  - `lat`
  - `lng`
  - `placeId`

**Failure handling**
- Return explicit errors for `ZERO_RESULTS`, quota errors, and invalid key.

### 2) `/api/maps/streetview-metadata`
**Request**
```json
{ "lat": 48.8584, "lng": 2.2945 }
```

**Behavior**
- Call Street View metadata endpoint
- Return:
  - `status`
  - `panoId`
  - nearest panorama coordinates (if available)

Use this to gate “Apply background” only when imagery exists.

### 3) (Optional) `/api/maps/streetview-url`
Generate canonical URL server-side if you want strict control.

---

## Phase 3 — Frontend UX (Editor)
Add a new action in editor toolbar:
- **Button:** `Google Street View 가져오기`

Open `GoogleStreetViewImportModal`.

### Modal layout
- Left panel:
  - Search input
  - Result list (top 5)
- Right panel:
  - Preview image
  - Controls:
    - Heading (0–360)
    - Pitch (-90 to 90)
    - FOV (10–120)
    - Size preset (max 640x640 for the Static Street View API)
- Footer actions:
  - `미리보기 갱신`
  - `배경으로 사용`

### User flow
1. Enter place name
2. Select result
3. Fetch metadata
4. Preview static image URL
5. Click `배경으로 사용`
6. Set project fields:
   - `backgroundType = "image"`
   - `imageUrl = generatedStreetViewUrl`
   - source metadata fields above

Hotspot workflow remains unchanged.

---

## Phase 4 — URL Builder Rules
Canonical URL pattern:

```txt
https://maps.googleapis.com/maps/api/streetview
  ?size={width}x{height}
  &location={lat},{lng}
  &heading={heading}
  &pitch={pitch}
  &fov={fov}
  &key={API_KEY}
```

### Validation defaults
- `heading`: default 0
- `pitch`: default 0
- `fov`: default 90
- `size`: default `640x640`

Google Street View Static API currently caps image dimensions at 640x640.

Clamp user values to valid ranges before URL generation.

---

## Phase 5 — Quota and Cost Controls
Implement these from day one:

1. Debounce search requests (500–700ms)
2. Cache search results per session
3. Trigger preview refresh on slider release (not every pixel move)
4. Add per-user soft daily cap in UI (example: 30 preview generations/day)
5. Show user-facing message on quota/billing errors

---

## Phase 6 — Compliance Checklist
Before production release:

1. Keep required Google attribution visible.
2. Do not remove logos/watermarks.
3. Follow Maps Platform ToS and Street View policies for storage/reuse/display.
4. Restrict keys and monitor abuse.

---

## Phase 7 — QA Checklist (Manual)
1. Search known landmark → results appear.
2. Select result with Street View coverage → preview loads.
3. Select location without coverage → clear error and disabled apply button.
4. Adjust heading/pitch/fov → image changes correctly.
5. Apply background → can place/move hotspots normally.
6. Save, reload editor → source metadata and image preserved.
7. Open share view → student sees same background + hotspots.
8. Mobile viewport sanity check.

---

## File/Module Suggestions (for this repo)
- Frontend editor logic: `source-restored/src/main.jsx`
- New modal component (recommended split):
  - `source-restored/src/components/GoogleStreetViewImportModal.jsx`
- New API routes:
  - `api/maps-geocode.js`
  - `api/maps-streetview-metadata.js`
- Shared helper:
  - `source-restored/src/lib/streetview.js`

---

## 1-Week Delivery Timeline
- **Day 1:** Cloud setup, key restrictions, env variables, model field wiring
- **Day 2:** Geocode proxy + modal search UI
- **Day 3:** Metadata check + preview controls + URL builder
- **Day 4:** Apply-to-project integration + save/load verification
- **Day 5:** Quota/error handling + QA pass + polish

---

## Success Criteria
- Teacher can go from keyword search to publishable hotspot lesson in under 3 minutes.
- No unexpected paid usage during pilot (caps + alerts active).
- Imported Street View background remains stable across save/share/open flows.

---

## Fast Start Checklist (1-hour prototype)
If you want the quickest possible first demo, follow only these steps:

1. Enable **Street View Static API** and **Geocoding API**.
2. Add one serverless endpoint: `/api/maps/geocode`.
3. Add one editor modal with:
   - search input
   - result picker
   - heading/pitch/fov sliders
   - preview image
   - "배경으로 사용" button
4. Save Street View URL into existing `imageUrl` and keep `backgroundType="image"`.
5. Reuse existing hotspot + publish flow as-is.

This is enough to validate teacher workflow before building metadata, rate limits, and advanced controls.
