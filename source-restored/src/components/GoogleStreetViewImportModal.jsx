import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, RefreshCw, Search, X } from "lucide-react";
import {
  STREETVIEW_DEFAULTS,
  STREETVIEW_BACKGROUND_TYPE,
  STREETVIEW_DYNAMIC_PROVIDER,
  STREETVIEW_PREVIEW_LIMIT,
  STREETVIEW_PROVIDER,
  buildStreetViewUrl,
  clampStreetViewParams,
  getStreetViewPreviewCount,
  incrementStreetViewPreviewCount,
} from "../lib/streetview";

const geocodeCache = new Map();

async function postJson(url, body, accessToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청에 실패했습니다.");
  return payload;
}

function coordinateLabel(result) {
  if (!Number.isFinite(result?.lat) || !Number.isFinite(result?.lng)) return "";
  return `${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
}

export default function GoogleStreetViewImportModal({ accessToken, browserKey, onApply, onClose }) {
  const [runtimeBrowserKey, setRuntimeBrowserKey] = useState(browserKey || "");
  const [importMode, setImportMode] = useState("dynamic");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [draftParams, setDraftParams] = useState(STREETVIEW_DEFAULTS);
  const [previewParams, setPreviewParams] = useState(STREETVIEW_DEFAULTS);
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [previewCount, setPreviewCount] = useState(getStreetViewPreviewCount);
  const debounceRef = useRef(null);

  const previewUrl = useMemo(() => {
    if (!selected || !runtimeBrowserKey || metadata?.ok === false) return "";
    return buildStreetViewUrl({
      lat: metadata?.lat ?? selected.lat,
      lng: metadata?.lng ?? selected.lng,
      key: runtimeBrowserKey,
      ...previewParams,
    });
  }, [metadata, previewParams, runtimeBrowserKey, selected]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (runtimeBrowserKey || !accessToken) return;
    let cancelled = false;
    fetch("/api/maps-browser-key", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Google Maps key를 불러오지 못했습니다.");
        if (!cancelled) setRuntimeBrowserKey(payload.apiKey || "");
      })
      .catch((keyError) => {
        if (!cancelled) setError(keyError instanceof Error ? keyError.message : "Google Maps key를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, runtimeBrowserKey]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (!accessToken) {
        setError("로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
        return;
      }
      const cacheKey = trimmed.toLowerCase();
      if (geocodeCache.has(cacheKey)) {
        setResults(geocodeCache.get(cacheKey));
        return;
      }
      setSearching(true);
      setError("");
      try {
        const payload = await postJson("/api/maps-geocode", { query: trimmed }, accessToken);
        geocodeCache.set(cacheKey, payload.results || []);
        setResults(payload.results || []);
      } catch (searchError) {
        setResults([]);
        setError(searchError instanceof Error ? searchError.message : "장소 검색에 실패했습니다.");
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [accessToken, query]);

  async function selectResult(result) {
    setSelected(result);
    setMetadata(null);
    setError("");
    if (!accessToken) {
      setError("로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      return;
    }
    setChecking(true);
    try {
      const payload = await postJson("/api/maps-streetview-metadata", { lat: result.lat, lng: result.lng }, accessToken);
      setMetadata(payload);
      if (!payload.ok) setError(payload.error || "이 위치에는 Street View 이미지가 없습니다.");
      else refreshPreview(result);
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : "Street View 정보를 확인하지 못했습니다.");
    } finally {
      setChecking(false);
    }
  }

  function updateParam(name, value) {
    setDraftParams((current) => clampStreetViewParams({ ...current, [name]: value }));
  }

  function refreshPreview(target = selected) {
    if (!target) return;
    if (!runtimeBrowserKey) {
      setError("GOOGLE_MAPS_BROWSER_KEY가 설정되어 있지 않습니다.");
      return;
    }
    if (getStreetViewPreviewCount() >= STREETVIEW_PREVIEW_LIMIT) {
      setError(`오늘 미리보기 한도 ${STREETVIEW_PREVIEW_LIMIT}회에 도달했습니다.`);
      return;
    }
    setPreviewParams(clampStreetViewParams(draftParams));
    setPreviewCount(incrementStreetViewPreviewCount());
  }

  function applyBackground(mode = importMode) {
    if (!selected || !metadata?.ok || !previewUrl) return;
    const baseSource = {
      sourceQuery: query.trim() || selected.formattedAddress,
      sourceLat: metadata.lat ?? selected.lat,
      sourceLng: metadata.lng ?? selected.lng,
      sourceHeading: previewParams.heading,
      sourcePitch: previewParams.pitch,
      sourceFov: previewParams.fov,
      sourcePanoId: metadata.panoId || null,
      sourceCopyright: metadata.copyright || null,
    };

    if (mode === "dynamic") {
      onApply({
        backgroundType: STREETVIEW_BACKGROUND_TYPE,
        imageUrl: `google-streetview:${metadata.panoId || `${baseSource.sourceLat},${baseSource.sourceLng}`}`,
        sourceProvider: STREETVIEW_DYNAMIC_PROVIDER,
        ...baseSource,
        sourceImageUrl: null,
      });
      return;
    }

    onApply({
      backgroundType: "image",
      imageUrl: previewUrl,
      sourceProvider: STREETVIEW_PROVIDER,
      ...baseSource,
      sourceImageUrl: previewUrl,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal streetview-modal" onClick={(event) => event.stopPropagation()}>
        <button className="button ghost close" onClick={onClose} type="button">
          <X size={18} />
        </button>
        <div className="modal-copy">
          <h2>Google Street View 가져오기</h2>
          <p>장소를 검색하고 움직이는 Street View 뷰어 또는 정적 이미지를 프로젝트 배경으로 사용합니다.</p>
        </div>
        <div className="segmented compact streetview-mode-switch">
          <button className={importMode === "dynamic" ? "active" : ""} onClick={() => setImportMode("dynamic")} type="button">
            동적 뷰어
          </button>
          <button className={importMode === "static" ? "active" : ""} onClick={() => setImportMode("static")} type="button">
            정적 이미지
          </button>
        </div>
        <div className="streetview-import-grid">
          <section className="streetview-search-panel">
            <label className="field-label" htmlFor="streetview-search">장소 검색</label>
            <div className="search-box">
              <Search size={17} />
              <input
                id="streetview-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="예: 에펠탑, 광화문, 제주 성산일출봉"
              />
            </div>
            {searching && <p className="hint">검색 중...</p>}
            <div className="streetview-results">
              {results.map((result) => (
                <button
                  className={selected?.placeId === result.placeId ? "active" : ""}
                  key={result.placeId || `${result.lat}-${result.lng}`}
                  onClick={() => selectResult(result)}
                  type="button"
                >
                  <MapPin size={16} />
                  <span>
                    <strong>{result.formattedAddress}</strong>
                    <small>{coordinateLabel(result)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="streetview-preview-panel">
            <div className="streetview-preview">
              {previewUrl ? (
                <img src={previewUrl} alt={selected?.formattedAddress || "Google Street View preview"} />
              ) : (
                <div className="streetview-preview-empty">{checking ? "Street View 확인 중..." : "장소를 선택하면 미리보기가 표시됩니다."}</div>
              )}
            </div>
            {metadata?.copyright && <p className="source-note">{metadata.copyright}</p>}
            {importMode === "dynamic" && (
              <p className="source-note">동적 뷰어는 적용 후 화면을 드래그해 둘러볼 수 있고, 현재 시야 기준으로 핫스팟을 찍습니다.</p>
            )}
            <div className="streetview-controls">
              {[
                ["heading", "방향", 0, 360],
                ["pitch", "기울기", -90, 90],
                ["fov", "화각", 10, 120],
              ].map(([name, label, min, max]) => (
                <label key={name}>
                  <span>{label} {draftParams[name]}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={draftParams[name]}
                    onChange={(event) => updateParam(name, event.target.value)}
                    onMouseUp={() => refreshPreview()}
                    onTouchEnd={() => refreshPreview()}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
        {error && <p className="streetview-error">{error}</p>}
        <div className="modal-actions">
          <span className="source-note">미리보기 {previewCount}/{STREETVIEW_PREVIEW_LIMIT}</span>
          <button className="button secondary" onClick={refreshPreview} disabled={!selected || checking} type="button">
            <RefreshCw size={16} /> 미리보기 갱신
          </button>
          <button className="button primary" onClick={() => applyBackground()} disabled={!metadata?.ok || !previewUrl} type="button">
            {importMode === "dynamic" ? "동적 배경으로 사용" : "이미지 배경으로 사용"}
          </button>
        </div>
      </article>
    </div>
  );
}
