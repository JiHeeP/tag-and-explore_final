import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { Analytics } from "@vercel/analytics/react";
import {
  ArrowLeft,
  Box,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Copy,
  DoorOpen,
  Eye,
  FileImage,
  Globe2,
  Info,
  Layers,
  Link as LinkIcon,
  LogOut,
  MapPinned,
  Plus,
  Save,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GoogleStreetViewImportModal from "./components/GoogleStreetViewImportModal";
import {
  STREETVIEW_BACKGROUND_TYPE,
  STREETVIEW_DYNAMIC_PROVIDER,
  STREETVIEW_PROVIDER,
  emptyStreetViewSource,
  fovToStreetViewZoom,
  loadGoogleMapsJavascript,
  projectStreetViewHotspot,
  streetViewPointFromScreen,
} from "./lib/streetview";
import "./styles.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://bnpxshdnckyubwgkwmpx.supabase.co";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_b9uy6XuIZHKou9z89suVLA_EkOgnGtO";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
});

const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const googleMapsBrowserKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
const publicGalleryOwnerId =
  import.meta.env.VITE_PUBLIC_GALLERY_OWNER_ID || "90276ea9-4119-4067-ace3-6da725d9f885";

const defaultColor = "#7c3aed";
const markerColors = ["#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#111827"];
const icons = [
  { value: "info", label: "Info", icon: Info },
  { value: "link", label: "Link", icon: LinkIcon },
  { value: "sparkle", label: "Sparkle", icon: Sparkles },
  { value: "target", label: "Target", icon: CircleDot },
  { value: "door", label: "장면 이동", icon: DoorOpen },
];

function normalizeHotspots(hotspots = []) {
  return hotspots.map((hotspot, index) => {
    const mediaItems = Array.isArray(hotspot.mediaItems)
      ? hotspot.mediaItems.flatMap((item) =>
          item && typeof item.url === "string"
            ? [{ id: item.id || crypto.randomUUID(), type: "image", url: item.url, caption: item.caption || "" }]
            : [],
        )
      : [];
    if (!mediaItems.length && hotspot.mediaType === "image" && hotspot.mediaUrl) {
      mediaItems.push({ id: `${hotspot.id}-image`, type: "image", url: hotspot.mediaUrl, caption: "" });
    }
    return {
      ...hotspot,
      id: hotspot.id || crypto.randomUUID(),
      x: Number.isFinite(hotspot.x) ? hotspot.x : 50,
      y: Number.isFinite(hotspot.y) ? hotspot.y : 50,
      title: hotspot.title || "",
      description: hotspot.description || "",
      icon: hotspot.icon || "info",
      markerColor: hotspot.markerColor || defaultColor,
      markerMode: hotspot.markerMode === "number" ? "number" : "icon",
      markerNumber: hotspot.markerNumber ?? index + 1,
      contentType:
        hotspot.contentType ||
        (hotspot.embedCode ? "embed" : mediaItems.length ? "gallery" : hotspot.mediaType === "video" ? "video" : "text"),
      mediaType: hotspot.mediaType || "none",
      targetSceneId: typeof hotspot.targetSceneId === "string" && hotspot.targetSceneId ? hotspot.targetSceneId : null,
      mediaItems,
    };
  });
}

const SOURCE_FIELDS = [
  "sourceProvider",
  "sourceQuery",
  "sourceLat",
  "sourceLng",
  "sourceHeading",
  "sourcePitch",
  "sourceFov",
  "sourcePanoId",
  "sourceImageUrl",
  "sourceCopyright",
];

function pickSourceMetadata(scene = {}) {
  const source = emptyStreetViewSource();
  SOURCE_FIELDS.forEach((field) => {
    source[field] = scene[field] ?? null;
  });
  return source;
}

function sourceFromRow(row) {
  return {
    sourceProvider: row.source_provider || null,
    sourceQuery: row.source_query || null,
    sourceLat: row.source_lat == null ? null : Number(row.source_lat),
    sourceLng: row.source_lng == null ? null : Number(row.source_lng),
    sourceHeading: row.source_heading == null ? null : Number(row.source_heading),
    sourcePitch: row.source_pitch == null ? null : Number(row.source_pitch),
    sourceFov: row.source_fov == null ? null : Number(row.source_fov),
    sourcePanoId: row.source_pano_id || null,
    sourceImageUrl: row.source_image_url || null,
    sourceCopyright: row.source_copyright || null,
  };
}

function createScene(overrides = {}, index = 0) {
  return {
    id: crypto.randomUUID(),
    name: `장면 ${index + 1}`,
    backgroundType: "image",
    imageUrl: null,
    hotspots: [],
    ...emptyStreetViewSource(),
    ...overrides,
  };
}

function normalizeScene(scene = {}, index = 0) {
  return {
    ...createScene({}, index),
    ...scene,
    id: typeof scene.id === "string" && scene.id ? scene.id : crypto.randomUUID(),
    name: typeof scene.name === "string" && scene.name.trim() ? scene.name : `장면 ${index + 1}`,
    backgroundType: scene.backgroundType || "image",
    imageUrl: scene.imageUrl || null,
    hotspots: normalizeHotspots(Array.isArray(scene.hotspots) ? scene.hotspots : []),
    ...pickSourceMetadata(scene),
  };
}

// A project is an ordered list of scenes. Hotspots with contentType "scene"
// point at another scene through targetSceneId (ThingLink-style transitions).
function normalizeScenes(scenes) {
  const list = Array.isArray(scenes) ? scenes.filter((scene) => scene && typeof scene === "object") : [];
  if (!list.length) return [createScene()];
  const normalized = list.map(normalizeScene);
  const ids = new Set(normalized.map((scene) => scene.id));
  return normalized.map((scene) => ({
    ...scene,
    hotspots: scene.hotspots.map((hotspot) =>
      hotspot.targetSceneId && !ids.has(hotspot.targetSceneId) ? { ...hotspot, targetSceneId: null } : hotspot,
    ),
  }));
}

function cloneScenes(scenes) {
  const idMap = new Map(scenes.map((scene) => [scene.id, crypto.randomUUID()]));
  return scenes.map((scene) => ({
    ...scene,
    id: idMap.get(scene.id),
    hotspots: normalizeHotspots(scene.hotspots).map((hotspot) => ({
      ...hotspot,
      id: crypto.randomUUID(),
      targetSceneId: hotspot.targetSceneId ? idMap.get(hotspot.targetSceneId) || null : null,
    })),
  }));
}

function scenesFromRow(row) {
  if (Array.isArray(row.scenes) && row.scenes.length) return normalizeScenes(row.scenes);
  // Legacy single-scene rows: the flat columns become scene 1.
  return normalizeScenes([
    {
      id: row.id ? `${row.id}-scene-1` : undefined,
      name: "장면 1",
      backgroundType: row.background_type || "image",
      imageUrl: row.image_url,
      hotspots: row.hotspots || [],
      ...sourceFromRow(row),
    },
  ]);
}

function countHotspots(scenes) {
  return scenes.reduce((total, scene) => total + scene.hotspots.length, 0);
}

function projectFromRow(row) {
  const scenes = scenesFromRow(row);
  const first = scenes[0];
  return {
    id: row.id,
    name: row.name,
    scenes,
    // The flat fields mirror scene 1 so cards, thumbnails and older code keep working.
    imageUrl: first.imageUrl,
    hotspots: first.hotspots,
    backgroundType: first.backgroundType,
    ownerId: row.owner_id || null,
    createdAt: new Date(row.created_at).getTime(),
    viewCount: Number(row.view_count) || 0,
    lastViewedAt: row.last_viewed_at ? new Date(row.last_viewed_at).getTime() : null,
    ...pickSourceMetadata(first),
  };
}

const SCENES_COLUMN_HELP =
  "여러 장면을 저장하려면 Supabase SQL 편집기에서 supabase/project-scenes.sql 을 먼저 실행해 주세요.";

function isMissingScenesColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  if (!/scenes/i.test(message)) return false;
  return error?.code === "PGRST204" || error?.code === "42703" || /column|schema cache/i.test(message);
}

function rowFromProject(project, userId, { includeScenes = true } = {}) {
  const scenes = normalizeScenes(project.scenes);
  const first = scenes[0];
  const row = {
    id: project.id,
    name: project.name,
    image_url: first.imageUrl,
    hotspots: first.hotspots,
    background_type: first.backgroundType,
    owner_id: userId,
    source_provider: first.sourceProvider || null,
    source_query: first.sourceQuery || null,
    source_lat: first.sourceLat ?? null,
    source_lng: first.sourceLng ?? null,
    source_heading: first.sourceHeading ?? null,
    source_pitch: first.sourcePitch ?? null,
    source_fov: first.sourceFov ?? null,
    source_pano_id: first.sourcePanoId || null,
    source_image_url: first.sourceImageUrl || null,
    source_copyright: first.sourceCopyright || null,
  };
  if (includeScenes) row.scenes = scenes;
  return row;
}

// Writes with the scenes column first. If the database has not received
// supabase/project-scenes.sql yet, single-scene projects fall back to the
// legacy columns so nothing is lost; multi-scene projects refuse to save
// silently truncated.
async function runWithSceneFallback(sceneLists, run) {
  const first = await run(true);
  if (!first.error) return { ...first, scenesPersisted: true };
  if (!isMissingScenesColumn(first.error)) throw new Error(first.error.message);
  if (sceneLists.some((scenes) => scenes.length > 1)) throw new Error(SCENES_COLUMN_HELP);
  const retry = await run(false);
  if (retry.error) throw new Error(retry.error.message);
  return { ...retry, scenesPersisted: false };
}

async function listProjects(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("projects").select("*").eq("owner_id", userId).order("created_at", { ascending: false });
  if (error) return [];
  const projects = (data || []).map(projectFromRow);
  return withProjectViewCounts(projects);
}

async function listPublicGalleryProjects() {
  if (!publicGalleryOwnerId) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", publicGalleryOwnerId)
    .order("created_at", { ascending: false });
  if (error) return [];
  const projects = (data || []).map(projectFromRow);
  return withProjectViewCounts(projects);
}

async function loadProject(id) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  return error || !data ? null : projectFromRow(data);
}

async function saveProject(project, userId) {
  if (!userId) throw new Error("Please log in before saving.");
  const scenes = normalizeScenes(project.scenes);
  const result = await runWithSceneFallback([scenes], (includeScenes) =>
    supabase.from("projects").upsert(rowFromProject({ ...project, scenes }, userId, { includeScenes })),
  );
  return { scenesPersisted: result.scenesPersisted };
}

async function deleteProjects(ids, userId) {
  if (!userId) throw new Error("Please log in before deleting.");
  if (!ids.length) return;
  const { error } = await supabase.from("projects").delete().eq("owner_id", userId).in("id", ids);
  if (error) throw new Error(error.message);
}

async function duplicateProjects(projects, userId) {
  if (!userId) throw new Error("Please log in before copying.");
  if (!projects.length) return [];
  const copies = projects.map((project) => ({
    ...project,
    id: crypto.randomUUID(),
    name: `${project.name || "Untitled Project"} 복사본`,
    scenes: cloneScenes(normalizeScenes(project.scenes)),
  }));
  const result = await runWithSceneFallback(
    copies.map((project) => project.scenes),
    (includeScenes) =>
      supabase
        .from("projects")
        .insert(copies.map((project) => rowFromProject(project, userId, { includeScenes })))
        .select("*"),
  );
  return (result.data || []).map(projectFromRow);
}

async function withProjectViewCounts(projects) {
  if (!projects.length) return projects;
  const ids = projects.map((project) => project.id);
  const { data, error } = await supabase.from("project_view_counts").select("*").in("project_id", ids);
  if (error) return projects;
  const counts = new Map((data || []).map((row) => [row.project_id, row]));
  return projects.map((project) => {
    const count = counts.get(project.id);
    return {
      ...project,
      viewCount: Number(count?.view_count) || 0,
      lastViewedAt: count?.last_viewed_at ? new Date(count.last_viewed_at).getTime() : null,
    };
  });
}

function getViewerKey() {
  const key = "tag-and-explore-viewer-key";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

async function recordProjectView(projectId) {
  const viewedKey = `tag-and-explore-viewed:${projectId}`;
  const lastViewedAt = Number(localStorage.getItem(viewedKey)) || 0;
  if (Date.now() - lastViewedAt < VIEW_DEDUPE_WINDOW_MS) return false;

  localStorage.setItem(viewedKey, String(Date.now()));
  const { error } = await supabase.from("project_views").insert({
    project_id: projectId,
    viewer_key: getViewerKey(),
  });
  if (error) {
    localStorage.removeItem(viewedKey);
    return false;
  }
  return true;
}

const DIRECT_UPLOAD_THRESHOLD = 3 * 1024 * 1024;
const MIN_UPLOAD_BYTES = 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_GUIDANCE = {
  image: {
    title: "이미지 업로드",
    description: "업로드 후 이미지를 클릭해 핫스팟을 추가하세요.",
    note: "선명한 배경은 2560x1440 이상이 좋아요.",
    details: ["최적: 3000x1688~3840x2160", "권장 용량: 10MB 이하", "업로드 가능: 1KB~100MB"],
  },
  "360": {
    title: "360° 이미지 업로드",
    description: "2:1 비율의 파노라마 이미지를 올려주세요.",
    note: "360 사진은 4096x2048 이상이면 안정적이에요.",
    details: ["형식: JPG/PNG/WebP", "권장 용량: 20MB 이하", "업로드 가능: 1KB~100MB"],
  },
  glb: {
    title: "3D 모델 업로드",
    description: ".glb 또는 .gltf 파일을 올려 3D 배경을 만드세요.",
    note: "가벼운 모델일수록 학생 화면에서 빠르게 열려요.",
    details: ["권장: 50MB 이하", "텍스처: 2048px 이하 권장", "업로드 가능: 1KB~100MB"],
  },
  [STREETVIEW_BACKGROUND_TYPE]: {
    title: "Street View 가져오기",
    description: "장소를 검색해 움직이는 Street View 배경을 선택하세요.",
    note: "파일 업로드 없이 Google API 사용량만 계산됩니다.",
    details: ["검색 후 파노라마 선택", "핫스팟은 기존 방식 그대로 추가", "파일 용량 제한 없음"],
  },
};

function getUploadContentType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "model/gltf-binary";
  if (name.endsWith(".gltf")) return "model/gltf+json";
  return file.type || "application/octet-stream";
}

async function uploadFile(file) {
  const contentType = getUploadContentType(file);
  const shouldUploadDirectly = file.size > DIRECT_UPLOAD_THRESHOLD || /\.(glb|gltf)$/i.test(file.name);

  if (shouldUploadDirectly) {
    const ticketResponse = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType,
        size: file.size,
      }),
    });
    const ticket = await ticketResponse.json().catch(() => ({}));
    if (!ticketResponse.ok || !ticket.uploadUrl || !ticket.url) {
      throw new Error(ticket.error || "Could not prepare upload.");
    }

    const uploadResponse = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!uploadResponse.ok) throw new Error("Upload failed while sending the file. Please check the R2 CORS settings.");
    return ticket.url;
  }

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      base64,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) throw new Error(result.error || "Upload failed.");
  return result.url;
}

function parseEmbed(code) {
  if (!code?.trim()) return null;
  const value = code.trim();
  const iframe = new DOMParser().parseFromString(value, "text/html").querySelector("iframe");
  const rawSrc = iframe?.getAttribute("src")?.trim() || value;
  const src = toEmbeddableUrl(rawSrc);
  if (!src || !/^https:\/\//i.test(src) || /javascript:/i.test(src)) return null;
  return {
    src,
    title: iframe?.getAttribute("title") || "Embedded content",
    allow:
      iframe?.getAttribute("allow") ||
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    allowFullScreen: true,
  };
}

function toEmbeddableUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const start = getYouTubeStart(url);
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? withYouTubeStart(`https://www.youtube.com/embed/${id}`, start) : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname.startsWith("/embed/")) return url.toString();
      if (url.pathname.startsWith("/shorts/")) {
        const id = url.pathname.split("/").filter(Boolean)[1];
        return id ? withYouTubeStart(`https://www.youtube.com/embed/${id}`, start) : null;
      }
      const id = url.searchParams.get("v");
      return id ? withYouTubeStart(`https://www.youtube.com/embed/${id}`, start) : url.toString();
    }
    return url.toString();
  } catch {
    return null;
  }
}

function getYouTubeStart(url) {
  const raw = url.searchParams.get("start") || url.searchParams.get("t");
  if (!raw) return null;
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (match && (match[1] || match[2] || match[3])) {
    return String((Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0));
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? String(seconds) : null;
}

function withYouTubeStart(src, start) {
  if (!start) return src;
  const url = new URL(src);
  url.searchParams.set("start", start);
  return url.toString();
}

function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}

function SourceAttribution({ project }) {
  if (![STREETVIEW_PROVIDER, STREETVIEW_DYNAMIC_PROVIDER].includes(project?.sourceProvider)) return null;
  return (
    <p className="source-attribution">
      Google Street View
      {project.sourceCopyright ? ` · ${project.sourceCopyright}` : ""}
    </p>
  );
}

function ShareLinkModal({ title = "공유 링크", url, onClose }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [url]);

  async function copyLink() {
    setStatus("");
    const input = inputRef.current;
    input?.focus();
    input?.select();
    input?.setSelectionRange?.(0, url.length);
    try {
      const commandCopied = document.execCommand("copy");
      const clipboardCopied = navigator.clipboard?.writeText
        ? await navigator.clipboard.writeText(url).then(() => true).catch(() => false)
        : false;
      if (!commandCopied && !clipboardCopied) {
        throw new Error("Copy command failed");
      }
      setStatus("복사 완료");
    } catch {
      input?.focus();
      input?.select();
      input?.setSelectionRange?.(0, url.length);
      setStatus("자동 복사가 막혔습니다. 선택된 링크를 직접 복사해 주세요.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal share-modal" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" className="close" onClick={onClose}>
          <X size={18} />
        </Button>
        <div className="modal-copy">
          <h2>{title}</h2>
          <p>아래 주소를 학생이나 동료에게 보내면 보기 화면으로 바로 열립니다.</p>
        </div>
        <div className="share-link-box">
          <input ref={inputRef} value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
          <Button variant="primary" onMouseDown={(event) => event.preventDefault()} onClick={copyLink}>
            <Copy size={16} /> 복사
          </Button>
        </div>
        {status && <p className={`share-status ${status === "복사 완료" ? "success" : "warning"}`}>{status}</p>}
      </article>
    </div>
  );
}

function useRuntimeGoogleMapsBrowserKey(accessToken) {
  const [apiKey, setApiKey] = useState(googleMapsBrowserKey);
  const [error, setError] = useState("");

  useEffect(() => {
    if (apiKey) return;
    let cancelled = false;
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    fetch("/api/maps-browser-key", { headers })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Google Maps key를 불러오지 못했습니다.");
        if (!cancelled) setApiKey(payload.apiKey || "");
      })
      .catch((keyError) => {
        if (!cancelled) setError(keyError instanceof Error ? keyError.message : "Google Maps key를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, apiKey]);

  return { apiKey, error };
}

function credentialToEmail(value) {
  return value.trim().toLowerCase();
}

function authErrorMessage(error, isSignup) {
  const message = error?.message || "";
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 맞지 않습니다. 이미 있는 계정이면 Supabase에서 비밀번호를 직접 다시 설정해 주세요.";
  }
  if (lower.includes("already registered") || lower.includes("already exists") || lower.includes("user already")) {
    return "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 다시 설정해 주세요.";
  }
  if (lower.includes("email not confirmed")) {
    return "이메일 확인이 아직 끝나지 않았습니다. Supabase 사용자 화면에서 Confirmed at 상태를 확인해 주세요.";
  }
  if (lower.includes("rate limit")) {
    return "메일 발송이 잠시 제한되었습니다. 조금 기다린 뒤 다시 시도해 주세요.";
  }
  return message || (isSignup ? "가입에 실패했습니다." : "로그인에 실패했습니다.");
}

function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user || null, loading };
}

function AuthPanel({ user, loading }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
  }

  if (loading) return <p className="muted">로그인 확인 중...</p>;
  if (user) {
    return (
      <div className="auth-status">
        <User size={16} />
        <span>{user.email || "Logged in"}</span>
        <Button variant="secondary" type="button" onClick={signOut} disabled={busy}>
          <LogOut size={16} /> 로그아웃
        </Button>
      </div>
    );
  }

  return (
    <nav className="auth-links" aria-label="인증">
      <Link className="button secondary" to="/login">로그인</Link>
      <Link className="button primary" to="/signup">가입</Link>
    </nav>
  );
}

function AuthPage({ mode, user, authLoading }) {
  const navigate = useNavigate();
  const isSignup = mode === "signup";
  const [credential, setCredential] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && user) navigate("/", { replace: true });
  }, [authLoading, navigate, user]);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    const email = credentialToEmail(credential);
    if (!email) {
      setMessage("이메일을 입력해 주세요.");
      return;
    }
    if (password.length < 6) {
      setMessage("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (isSignup && password !== passwordConfirm) {
      setMessage("비밀번호가 서로 다릅니다.");
      return;
    }
    setBusy(true);
    try {
      const result = isSignup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(result.error.message);
      if (isSignup && result.data.user && Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0) {
        setMessage("이미 가입된 이메일입니다. 로그인하거나 Supabase에서 비밀번호를 다시 설정해 주세요.");
        setPassword("");
        setPasswordConfirm("");
        return;
      }
      if (isSignup && !result.data.session) {
        setMessage("가입이 완료되었습니다. 이제 로그인해 주세요.");
        setPassword("");
        setPasswordConfirm("");
        navigate("/login", { replace: true });
        return;
      }
      navigate("/", { replace: true });
    } catch (error) {
      setMessage(authErrorMessage(error, isSignup));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <main className="centered muted">로그인 상태를 확인하는 중...</main>;

  return (
    <main className="auth-page">
      <Link to="/" className="brand auth-brand">
        <Sparkles size={22} />
        <span>Tag and Explore</span>
      </Link>
      <section className="auth-card">
        <div className="eyebrow">
          <Sparkles size={15} /> {isSignup ? "Create Account" : "Welcome Back"}
        </div>
        <h1>{isSignup ? "가입하기" : "로그인"}</h1>
        <p>{isSignup ? "내 학습 콘텐츠를 만들고 저장할 계정을 만듭니다." : "내 프로젝트를 이어서 만들고 수정합니다."}</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            이메일
            <input type="email" autoComplete="email" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="name@example.com" />
          </label>
          <label>
            비밀번호
            <input type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" />
          </label>
          {isSignup && (
            <label>
              비밀번호 확인
              <input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="한 번 더 입력" />
            </label>
          )}
          {message && <p className="auth-message">{message}</p>}
          <Button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "처리 중..." : isSignup ? "가입하기" : "로그인"}
          </Button>
        </form>
        <div className="auth-switch">
          {isSignup ? "이미 계정이 있나요?" : "아직 계정이 없나요?"}
          <Link to={isSignup ? "/login" : "/signup"}>{isSignup ? "로그인" : "가입하기"}</Link>
        </div>
      </section>
    </main>
  );
}

function AppHeader({ children }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        <Sparkles size={22} />
        <span>Tag and Explore</span>
      </Link>
      {children}
    </header>
  );
}

function Home({ user, authLoading }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageMessage, setManageMessage] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const galleryMode = !user;

  const refresh = useCallback(() => {
    if (authLoading) {
      setLoading(true);
      setManageMode(false);
      setSelectedIds([]);
      return;
    }
    setLoading(true);
    const loader = user ? listProjects(user.id) : listPublicGalleryProjects();
    loader.then((items) => {
      setProjects(items);
      setLoading(false);
    });
    if (!user) {
      setManageMode(false);
      setSelectedIds([]);
    }
  }, [authLoading, user]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => projects.some((project) => project.id === id)));
  }, [projects]);

  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedIds.includes(project.id)),
    [projects, selectedIds],
  );

  function toggleManageMode() {
    setManageMessage("");
    setDeletePending(false);
    setManageMode((current) => {
      if (current) setSelectedIds([]);
      return !current;
    });
  }

  function toggleSelected(id) {
    setManageMessage("");
    setDeletePending(false);
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function handleDuplicateSelected() {
    if (!user || !selectedProjects.length) return;
    setManageBusy(true);
    setManageMessage("");
    try {
      await duplicateProjects(selectedProjects, user.id);
      setManageMessage(`${selectedProjects.length}개 콘텐츠를 복사했습니다.`);
      setDeletePending(false);
      setSelectedIds([]);
      refresh();
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : "복사에 실패했습니다.");
    } finally {
      setManageBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (!user || !selectedProjects.length) return;
    if (!deletePending) {
      setDeletePending(true);
      setManageMessage("삭제할 콘텐츠를 확인한 뒤, 정말 삭제를 한 번 더 눌러 주세요.");
      return;
    }
    setManageBusy(true);
    setManageMessage("");
    try {
      await deleteProjects(selectedIds, user.id);
      setManageMessage(`${selectedProjects.length}개 콘텐츠를 삭제했습니다.`);
      setDeletePending(false);
      setSelectedIds([]);
      refresh();
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    } finally {
      setManageBusy(false);
    }
  }

  return (
    <main className="page">
      <AppHeader>
        <AuthPanel user={user} loading={authLoading} />
        {user && (
          <Button onClick={() => navigate("/editor")}>
            <Plus size={17} /> 새 프로젝트
          </Button>
        )}
      </AppHeader>
      <section className="hero">
        <div className="eyebrow">
          <Sparkles size={16} /> Teacher Interactive Builder
        </div>
        <h1>
          한 장의 이미지를 <span>interactive</span> 학습 공간으로
        </h1>
        <p>교사가 이미지, 360° 파노라마, 3D 모델 위에 핫스팟을 찍고 학생이 누른 만큼 깊어지는 자료를 만듭니다.</p>
        {user ? (
          <Button className="large" onClick={() => navigate("/editor")}>
            <Plus size={20} /> 새 학습 콘텐츠 만들기
          </Button>
        ) : (
          <div className="hero-actions">
            <Button className="large" onClick={() => navigate("/login")}>
              로그인하고 시작하기
            </Button>
            <Button className="large" variant="secondary" onClick={() => navigate("/signup")}>
              계정 만들기
            </Button>
          </div>
        )}
      </section>
      <section className="steps">
        {[
          ["1", "자료 올리기", "이미지, 360° 사진, 3D 모델을 업로드합니다."],
          ["2", "핫스팟 찍기", "학생이 눌러볼 지점에 설명과 자료를 붙입니다."],
          ["3", "공유하기", "학생에게는 보기 전용 링크를 전달합니다."],
        ].map(([step, title, text]) => (
          <article key={step}>
            <b>{step}</b>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="projects">
        <div className="projects-heading">
          <div>
            <h2>{galleryMode ? "갤러리" : "내 학습 콘텐츠"}</h2>
            {user && manageMessage && <p className="manage-message">{manageMessage}</p>}
          </div>
          {user && projects.length > 0 && (
            <Button variant={manageMode ? "secondary" : "ghost"} onClick={toggleManageMode} disabled={manageBusy}>
              {manageMode ? "관리 끝" : "관리"}
            </Button>
          )}
        </div>
        {user && manageMode && projects.length > 0 && (
          <div className="manage-toolbar">
            <span>{selectedIds.length}개 선택됨</span>
            <Button variant="secondary" onClick={handleDuplicateSelected} disabled={manageBusy || selectedIds.length === 0}>
              <Copy size={16} /> 복사
            </Button>
            <Button variant="danger" onClick={handleDeleteSelected} disabled={manageBusy || selectedIds.length === 0}>
              <Trash2 size={16} /> {deletePending ? "정말 삭제" : "삭제"}
            </Button>
            {deletePending && (
              <Button variant="ghost" onClick={() => setDeletePending(false)} disabled={manageBusy}>
                취소
              </Button>
            )}
          </div>
        )}
        {loading ? (
          <p className="muted">프로젝트를 불러오는 중...</p>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className={`project-card ${manageMode ? "managing" : ""}`} key={project.id}>
                {manageMode && (
                  <label className="project-check">
                    <input
                      checked={selectedIds.includes(project.id)}
                      onChange={() => toggleSelected(project.id)}
                      type="checkbox"
                    />
                    <span>선택</span>
                  </label>
                )}
                <img src={project.imageUrl || "/placeholder.svg"} alt="" />
                <div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.scenes.length > 1
                      ? `장면 ${project.scenes.length}개 · 핫스팟 ${countHotspots(project.scenes)}개`
                      : `${project.hotspots.length}개 핫스팟 · ${project.backgroundType}`}
                  </p>
                  <p className="project-views">조회 {project.viewCount.toLocaleString("ko-KR")}회</p>
                  {!manageMode && (
                    <div className="row">
                      {user && (
                        <Button variant="secondary" onClick={() => navigate(`/editor?id=${project.id}`)}>
                          수정
                        </Button>
                      )}
                      <Button variant={user ? "ghost" : "secondary"} onClick={() => navigate(`/view/${project.id}`)}>
                        보기
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">{galleryMode ? "갤러리에 표시할 콘텐츠가 없습니다." : "아직 프로젝트가 없습니다."}</p>
        )}
      </section>
    </main>
  );
}

function HotspotMarker({ hotspot, selected, onClick, style, ...props }) {
  const Icon = icons.find((item) => item.value === hotspot.icon)?.icon || Info;
  return (
    <button
      className={`marker ${selected ? "selected" : ""}`}
      onClick={onClick}
      style={{ "--marker": hotspot.markerColor || defaultColor, ...style }}
      title={hotspot.title || "Hotspot"}
      {...props}
    >
      {hotspot.markerMode === "number" ? hotspot.markerNumber : <Icon size={18} />}
    </button>
  );
}

function ImageStage({ imageUrl, hotspots, selectedId, editing, onAdd, onSelect, onMove }) {
  const ref = useRef(null);
  const imageRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  function positionFromPoint(clientX, clientY) {
    const target = imageRef.current || ref.current;
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }

  function handleClick(event) {
    if (!editing || event.target.closest?.(".marker")) return;
    const { x, y } = positionFromPoint(event.clientX, event.clientY);
    onAdd(x, y);
  }

  function handleMarkerPointerDown(event, id) {
    if (!editing) return;
    event.stopPropagation();
    setDraggingId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleMarkerPointerMove(event, id) {
    if (!editing || draggingId !== id) return;
    event.stopPropagation();
    const { x, y } = positionFromPoint(event.clientX, event.clientY);
    onMove(id, x, y);
  }

  function handleMarkerPointerUp(event, id) {
    if (!editing || draggingId !== id) return;
    event.stopPropagation();
    setDraggingId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <div className="stage image-stage" ref={ref} onClick={handleClick}>
      {editing && <div className="stage-hint">이미지를 클릭해 핫스팟 추가</div>}
      <img ref={imageRef} src={imageUrl} alt="" draggable={false} />
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          selected={selectedId === hotspot.id}
          onPointerDown={(event) => handleMarkerPointerDown(event, hotspot.id)}
          onPointerMove={(event) => handleMarkerPointerMove(event, hotspot.id)}
          onPointerUp={(event) => handleMarkerPointerUp(event, hotspot.id)}
          onPointerCancel={() => setDraggingId(null)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hotspot.id);
          }}
          style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
        />
      ))}
    </div>
  );
}

function PanoramaStage(props) {
  return (
    <div>
      <ImageStage {...props} />
      <p className="hint">현재 360° 자료는 평면 미리보기로 표시됩니다.</p>
    </div>
  );
}

function GoogleStreetViewStage({ apiKey, project, hotspots, selectedId, editing, onAdd, onSelect }) {
  const stageRef = useRef(null);
  const mountRef = useRef(null);
  const panoramaRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const [pov, setPov] = useState({
    heading: Number.isFinite(project.sourceHeading) ? project.sourceHeading : 0,
    pitch: Number.isFinite(project.sourcePitch) ? project.sourcePitch : 0,
  });
  const [zoom, setZoom] = useState(fovToStreetViewZoom(project.sourceFov || 90));
  const [panoId, setPanoId] = useState(project.sourcePanoId || "");
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !apiKey) return;
    let cancelled = false;
    let resizeObserver;
    let listeners = [];

    loadGoogleMapsJavascript(apiKey)
      .then((maps) => {
        if (cancelled) return;
        const nextPov = {
          heading: Number.isFinite(project.sourceHeading) ? project.sourceHeading : 0,
          pitch: Number.isFinite(project.sourcePitch) ? project.sourcePitch : 0,
        };
        const panorama = new maps.StreetViewPanorama(mount, {
          addressControl: false,
          clickToGo: true,
          disableDefaultUI: false,
          fullscreenControl: true,
          linksControl: true,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: true,
          position:
            Number.isFinite(project.sourceLat) && Number.isFinite(project.sourceLng)
              ? { lat: project.sourceLat, lng: project.sourceLng }
              : undefined,
          pov: nextPov,
          showRoadLabels: false,
          visible: true,
          zoom: fovToStreetViewZoom(project.sourceFov || 90),
        });

        if (project.sourcePanoId) panorama.setPano(project.sourcePanoId);
        panoramaRef.current = panorama;

        const syncView = () => {
          setPov(panorama.getPov() || nextPov);
          setZoom(Number(panorama.getZoom()) || 0);
          setPanoId(panorama.getPano() || "");
        };

        listeners = ["pov_changed", "zoom_changed", "pano_changed", "position_changed"].map((eventName) =>
          panorama.addListener(eventName, syncView),
        );
        syncView();

        resizeObserver = new ResizeObserver(() => {
          const rect = mount.getBoundingClientRect();
          setStageSize({ width: rect.width || 1, height: rect.height || 1 });
          maps.event.trigger(panorama, "resize");
        });
        resizeObserver.observe(mount);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "동적 Street View를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      resizeObserver?.disconnect();
      panoramaRef.current = null;
      mount.replaceChildren();
    };
  }, [apiKey, project.sourceFov, project.sourceHeading, project.sourceLat, project.sourceLng, project.sourcePanoId, project.sourcePitch]);

  const markerPositions = useMemo(() => {
    const next = {};
    hotspots.forEach((hotspot) => {
      const projected = projectStreetViewHotspot({
        hotspot,
        pov,
        zoom,
        width: stageSize.width,
        height: stageSize.height,
      });
      next[hotspot.id] = {
        ...projected,
        hidden: projected.hidden || (!!hotspot.streetPanoId && !!panoId && hotspot.streetPanoId !== panoId),
      };
    });
    return next;
  }, [hotspots, panoId, pov, stageSize.height, stageSize.width, zoom]);

  function addHotspotAt(clientX, clientY) {
    const mount = mountRef.current;
    const panorama = panoramaRef.current;
    if (!editing || !mount || !panorama) return;
    const rect = mount.getBoundingClientRect();
    const point = streetViewPointFromScreen({
      clientX,
      clientY,
      rect,
      pov: panorama.getPov(),
      zoom: Number(panorama.getZoom()) || zoom,
    });
    onAdd(
      Math.max(0, Math.min(100, ((clientX - rect.left) / Math.max(rect.width, 1)) * 100)),
      Math.max(0, Math.min(100, ((clientY - rect.top) / Math.max(rect.height, 1)) * 100)),
      undefined,
      undefined,
      undefined,
      { ...point, streetPanoId: panorama.getPano() || project.sourcePanoId || null },
    );
  }

  function addHotspotAtCenter() {
    const mount = mountRef.current;
    if (!mount) return;
    const rect = mount.getBoundingClientRect();
    addHotspotAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function handleDoubleClick(event) {
    if (!editing || event.target.closest?.(".marker") || event.target.closest?.(".streetview-stage-actions")) return;
    addHotspotAt(event.clientX, event.clientY);
  }

  return (
    <div className="stage streetview-dynamic-stage" ref={stageRef} onDoubleClick={handleDoubleClick}>
      <div ref={mountRef} className="streetview-canvas" />
      {!apiKey && <div className="streetview-overlay-message">Google Maps key를 불러오는 중입니다.</div>}
      {loadError && <div className="streetview-overlay-message error">{loadError}</div>}
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          selected={selectedId === hotspot.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hotspot.id);
          }}
          style={{
            left: `${markerPositions[hotspot.id]?.x ?? hotspot.x}%`,
            top: `${markerPositions[hotspot.id]?.y ?? hotspot.y}%`,
            opacity: markerPositions[hotspot.id]?.hidden ? 0 : 1,
            pointerEvents: markerPositions[hotspot.id]?.hidden ? "none" : "auto",
          }}
        />
      ))}
      {editing && (
        <div className="streetview-stage-actions">
          <button className="button secondary" type="button" onClick={addHotspotAtCenter}>
            <Plus size={16} /> 화면 중앙에 핫스팟
          </button>
          <span>더블클릭해도 현재 시야에 핫스팟을 추가할 수 있습니다.</span>
        </div>
      )}
    </div>
  );
}

function ModelStage({ modelUrl, hotspots, selectedId, editing, onAdd, onSelect }) {
  const stageRef = useRef(null);
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const modelRef = useRef(null);
  const rendererRef = useRef(null);
  const hotspotsRef = useRef(hotspots);
  const markerPositionsRef = useRef({});
  const [markerPositions, setMarkerPositions] = useState({});
  const [modelStatus, setModelStatus] = useState("loading");
  const [modelMessage, setModelMessage] = useState("");

  useEffect(() => {
    hotspotsRef.current = hotspots;
  }, [hotspots]);

  function positionFromEvent(event) {
    const rect = stageRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function addHotspotFromClientPoint(clientX, clientY) {
    const camera = cameraRef.current;
    const model = modelRef.current;
    const renderer = rendererRef.current;
    if (!camera || !model || !renderer) return false;

    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit) return false;

    const { x, y } = positionFromEvent({ clientX, clientY });
    onAdd(x, y, hit.point.x, hit.point.y, hit.point.z);
    setModelMessage("");
    return true;
  }

  function handleDoubleClick(event) {
    if (!editing || event.target.closest?.(".marker") || event.target.closest?.(".model-stage-actions")) return;
    const added = addHotspotFromClientPoint(event.clientX, event.clientY);
    if (!added) setModelMessage("모델 표면을 더블클릭해야 핫스팟을 추가할 수 있습니다.");
  }

  function addHotspotAtCenter() {
    const renderer = rendererRef.current;
    if (!editing || !renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const added = addHotspotFromClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!added) setModelMessage("화면 중앙에 모델 표면이 오도록 돌린 뒤 다시 눌러주세요.");
  }

  useEffect(() => {
    setModelStatus("loading");
    setModelMessage("");
    setMarkerPositions({});
    markerPositionsRef.current = {};
    const mount = mountRef.current;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 480;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f7);
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 0.8, 4);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 7;
    const loader = new GLTFLoader();
    const visibilityRaycaster = new THREE.Raycaster();
    const cameraPosition = new THREE.Vector3();
    let frame;

    const projectHotspots = () => {
      const next = {};
      camera.getWorldPosition(cameraPosition);
      hotspotsRef.current.forEach((hotspot) => {
        if (
          Number.isFinite(hotspot.worldX) &&
          Number.isFinite(hotspot.worldY) &&
          Number.isFinite(hotspot.worldZ)
        ) {
          const world = new THREE.Vector3(hotspot.worldX, hotspot.worldY, hotspot.worldZ);
          const projected = world.clone().project(camera);
          const visible = projected.z >= -1 && projected.z <= 1;
          let occluded = false;

          if (visible && modelRef.current) {
            const direction = world.clone().sub(cameraPosition);
            const distance = direction.length();
            visibilityRaycaster.set(cameraPosition, direction.normalize());
            const hit = visibilityRaycaster.intersectObject(modelRef.current, true)[0];
            occluded = !!hit && hit.distance < distance - 0.03;
          }

          next[hotspot.id] = {
            x: ((projected.x + 1) / 2) * 100,
            y: ((1 - projected.y) / 2) * 100,
            hidden: !visible || occluded,
          };
          return;
        }

        next[hotspot.id] = {
          x: Number.isFinite(hotspot.x) ? hotspot.x : 50,
          y: Number.isFinite(hotspot.y) ? hotspot.y : 50,
          hidden: false,
        };
      });
      const previous = markerPositionsRef.current;
      const keys = Object.keys(next);
      const changed =
        keys.length !== Object.keys(previous).length ||
        keys.some((id) => {
          const before = previous[id];
          const after = next[id];
          return (
            !before ||
            before.hidden !== after.hidden ||
            Math.abs(before.x - after.x) > 0.1 ||
            Math.abs(before.y - after.y) > 0.1
          );
        });

      if (changed) {
        markerPositionsRef.current = next;
        setMarkerPositions(next);
      }
    };

    const render = () => renderer.render(scene, camera);
    const fitModel = (target) => {
      const box = new THREE.Box3().setFromObject(target);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z) || 1;
      const scale = 2.4 / maxAxis;
      const fittedSize = size.clone().multiplyScalar(scale);
      const viewRadius = Math.max(fittedSize.length() / 2, 1);

      target.scale.setScalar(scale);
      target.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      controls.target.set(0, 0, 0);
      controls.minDistance = Math.max(viewRadius * 0.4, 0.8);
      controls.maxDistance = Math.max(viewRadius * 6, 7);
      camera.near = Math.max(viewRadius / 100, 0.01);
      camera.far = Math.max(viewRadius * 100, 1000);
      camera.position.set(0, fittedSize.y > fittedSize.x ? viewRadius * 0.35 : viewRadius * 0.15, viewRadius * 2.5);
      camera.updateProjectionMatrix();
      controls.update();
    };
    loader.load(
      modelUrl,
      (gltf) => {
        modelRef.current = gltf.scene;
        fitModel(modelRef.current);
        scene.add(modelRef.current);
        setModelStatus("ready");
        projectHotspots();
        render();
      },
      undefined,
      () => {
        setModelStatus("error");
        setModelMessage("3D 모델을 불러오지 못했습니다. GLB/GLTF 파일과 업로드 상태를 확인해주세요.");
      },
    );
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      projectHotspots();
      render();
    };
    animate();
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = mount.clientWidth || 800;
      const nextHeight = mount.clientHeight || 480;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
      projectHotspots();
      render();
    });
    resizeObserver.observe(mount);
    render();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.replaceChildren();
      cameraRef.current = null;
      modelRef.current = null;
      rendererRef.current = null;
    };
  }, [modelUrl]);

  return (
    <div className="stage model-stage" ref={stageRef} onDoubleClick={handleDoubleClick}>
      <div ref={mountRef} className="model-canvas" />
      {modelStatus !== "ready" && (
        <div className={`model-overlay-message ${modelStatus === "error" ? "error" : ""}`}>
          {modelStatus === "error" ? modelMessage : "3D 모델을 불러오는 중입니다..."}
        </div>
      )}
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          selected={selectedId === hotspot.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hotspot.id);
          }}
          style={{
            left: `${markerPositions[hotspot.id]?.x ?? hotspot.x}%`,
            top: `${markerPositions[hotspot.id]?.y ?? hotspot.y}%`,
            opacity: markerPositions[hotspot.id]?.hidden ? 0 : 1,
            pointerEvents: markerPositions[hotspot.id]?.hidden ? "none" : "auto",
          }}
        />
      ))}
      {editing && (
        <div className="model-stage-actions">
          <button className="button secondary" type="button" onClick={addHotspotAtCenter} disabled={modelStatus !== "ready"}>
            <Plus size={16} /> 화면 중앙에 핫스팟
          </button>
          <span>{modelMessage || "모델을 돌리고, 표면을 더블클릭해 핫스팟을 추가하세요."}</span>
        </div>
      )}
      {!editing && <p className="hint">Drag to rotate and scroll to zoom.</p>}
    </div>
  );
}

function HotspotModal({ hotspot, onClose }) {
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const embed = parseEmbed(hotspot.embedCode);
  const videoEmbed = hotspot.contentType === "video" ? parseEmbed(hotspot.mediaUrl) : null;
  const mediaItems = hotspot.mediaItems || [];
  const activeMedia = mediaItems[activeMediaIndex] || null;
  const hasManyMedia = mediaItems.length > 1;

  useEffect(() => {
    setActiveMediaIndex(0);
  }, [hotspot.id]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (hotspot.contentType !== "gallery" || !hasManyMedia) return;
      if (event.key === "ArrowLeft") setActiveMediaIndex((index) => (index - 1 + mediaItems.length) % mediaItems.length);
      if (event.key === "ArrowRight") setActiveMediaIndex((index) => (index + 1) % mediaItems.length);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasManyMedia, hotspot.contentType, mediaItems.length, onClose]);

  function showPreviousMedia() {
    setActiveMediaIndex((index) => (index - 1 + mediaItems.length) % mediaItems.length);
  }

  function showNextMedia() {
    setActiveMediaIndex((index) => (index + 1) % mediaItems.length);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" className="close" onClick={onClose}>
          <X size={18} />
        </Button>
        <div className="modal-body">
          <div className="modal-copy">
            <h2>{hotspot.title || "제목 없는 핫스팟"}</h2>
            {hotspot.description && <p>{hotspot.description}</p>}
            {hotspot.link && (
              <a className="external" href={hotspot.link} target="_blank" rel="noreferrer">
                링크 열기
              </a>
            )}
          </div>
          {hotspot.contentType === "video" &&
            (videoEmbed ? (
              <div className="embed-frame">
                <iframe title={videoEmbed.title} src={videoEmbed.src} allow={videoEmbed.allow} allowFullScreen />
              </div>
            ) : (
              hotspot.mediaUrl && <video controls src={hotspot.mediaUrl} />
            ))}
          {hotspot.contentType === "embed" && embed && (
            <div className="embed-frame">
              <iframe title={embed.title} src={embed.src} allow={embed.allow} allowFullScreen />
            </div>
          )}
          {hotspot.contentType === "gallery" && activeMedia && (
            <div className="carousel" aria-label="이미지 자료">
              <figure>
                <img src={activeMedia.url} alt={activeMedia.caption || hotspot.title || ""} />
                {activeMedia.caption && <figcaption>{activeMedia.caption}</figcaption>}
              </figure>
              {hasManyMedia && (
                <>
                  <button className="carousel-arrow prev" onClick={showPreviousMedia} aria-label="이전 이미지">
                    <ChevronLeft size={24} />
                  </button>
                  <button className="carousel-arrow next" onClick={showNextMedia} aria-label="다음 이미지">
                    <ChevronRight size={24} />
                  </button>
                  <div className="carousel-count">
                    {activeMediaIndex + 1} / {mediaItems.length}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

function Inspector({ hotspot, scenes = [], currentSceneId = null, onChange, onDelete }) {
  const fileRef = useRef(null);
  if (!hotspot) return <div className="empty-panel">이미지를 클릭해 핫스팟을 만들거나 왼쪽 목록에서 선택하세요.</div>;
  const otherScenes = scenes.filter((scene) => scene.id !== currentSceneId);

  function selectContentType(type) {
    if (type === "scene") {
      onChange({
        ...hotspot,
        contentType: "scene",
        icon: hotspot.icon === "info" ? "door" : hotspot.icon,
        targetSceneId: hotspot.targetSceneId || (otherScenes.length === 1 ? otherScenes[0].id : null),
      });
      return;
    }
    onChange({ ...hotspot, contentType: type });
  }

  async function addGalleryImages(files) {
    const urls = await Promise.all(Array.from(files).map(uploadFile));
    onChange({
      ...hotspot,
      contentType: "gallery",
      mediaItems: [
        ...hotspot.mediaItems,
        ...urls.map((url) => ({ id: crypto.randomUUID(), type: "image", url, caption: "" })),
      ],
    });
  }

  function updateMediaCaption(id, caption) {
    onChange({ ...hotspot, mediaItems: hotspot.mediaItems.map((item) => (item.id === id ? { ...item, caption } : item)) });
  }

  function moveMedia(id, direction) {
    const index = hotspot.mediaItems.findIndex((item) => item.id === id);
    const next = direction === "up" ? index - 1 : index + 1;
    if (next < 0 || next >= hotspot.mediaItems.length) return;
    const mediaItems = [...hotspot.mediaItems];
    const [item] = mediaItems.splice(index, 1);
    mediaItems.splice(next, 0, item);
    onChange({ ...hotspot, mediaItems });
  }

  return (
    <div className="inspector-form">
      <div className="panel-heading">
        <div>
          <h3>선택한 핫스팟</h3>
          <p>마커 모양과 학생에게 보여줄 내용을 편집합니다.</p>
        </div>
        <Button variant="danger" onClick={() => onDelete(hotspot.id)}>
          <Trash2 size={16} />
        </Button>
      </div>
      <label>마커 아이콘</label>
      <div className="choice-grid">
        {icons.map(({ value, label, icon: Icon }) => (
          <button className={hotspot.icon === value ? "active" : ""} title={label} key={value} onClick={() => onChange({ ...hotspot, icon: value })}>
            <Icon size={17} />
          </button>
        ))}
      </div>
      <label>마커 색상</label>
      <div className="swatches">
        {markerColors.map((color) => (
          <button
            className={(hotspot.markerColor || defaultColor) === color ? "active" : ""}
            key={color}
            style={{ backgroundColor: color }}
            onClick={() => onChange({ ...hotspot, markerColor: color })}
          />
        ))}
      </div>
      <label>마커 방식</label>
      <div className="segmented">
        <button className={hotspot.markerMode !== "number" ? "active" : ""} onClick={() => onChange({ ...hotspot, markerMode: "icon" })}>
          아이콘
        </button>
        <button className={hotspot.markerMode === "number" ? "active" : ""} onClick={() => onChange({ ...hotspot, markerMode: "number" })}>
          번호
        </button>
      </div>
      {hotspot.markerMode === "number" && (
        <input type="number" min="1" max="999" value={hotspot.markerNumber || 1} onChange={(event) => onChange({ ...hotspot, markerNumber: Number(event.target.value) || 1 })} />
      )}
      <label>콘텐츠 타입</label>
      <div className="segmented wrap">
        {[
          ["text", "텍스트"],
          ["video", "영상"],
          ["embed", "임베드"],
          ["gallery", "갤러리"],
          ["scene", "장면 이동"],
        ].map(([type, label]) => (
          <button className={hotspot.contentType === type ? "active" : ""} key={type} onClick={() => selectContentType(type)}>
            {label}
          </button>
        ))}
      </div>
      {hotspot.contentType === "scene" && (
        <>
          <label>이동할 장면</label>
          <select
            value={hotspot.targetSceneId || ""}
            onChange={(event) => onChange({ ...hotspot, targetSceneId: event.target.value || null })}
          >
            <option value="">장면을 선택하세요</option>
            {otherScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
                {scene.imageUrl ? "" : " (배경 없음)"}
              </option>
            ))}
          </select>
          <p className="field-note">
            {otherScenes.length
              ? "학생이 이 핫스팟을 누르면 선택한 장면으로 이동합니다. 미리보기에서 바로 확인할 수 있어요."
              : "왼쪽 장면 목록에서 장면을 추가하면 여기서 연결할 수 있습니다."}
          </p>
        </>
      )}
      <label>제목</label>
      <input
        value={hotspot.title}
        onChange={(event) => onChange({ ...hotspot, title: event.target.value })}
        placeholder={hotspot.contentType === "scene" ? "예: 교실 안으로 들어가기" : "제목을 입력하세요"}
      />
      <label>설명</label>
      <textarea value={hotspot.description} onChange={(event) => onChange({ ...hotspot, description: event.target.value })} placeholder="학생에게 보여줄 설명을 입력하세요" />
      <label>링크 URL</label>
      <input value={hotspot.link || ""} onChange={(event) => onChange({ ...hotspot, link: event.target.value })} placeholder="https://..." />
      {hotspot.contentType === "video" && (
        <>
          <label>영상 URL</label>
          <input value={hotspot.mediaUrl || ""} onChange={(event) => onChange({ ...hotspot, mediaUrl: event.target.value, mediaType: "video" })} placeholder="https://example.com/video.mp4" />
        </>
      )}
      {hotspot.contentType === "embed" && (
        <>
          <label>임베드 코드</label>
          <textarea className="mono" value={hotspot.embedCode || ""} onChange={(event) => onChange({ ...hotspot, embedCode: event.target.value })} placeholder='<iframe src="https://..."></iframe>' />
        </>
      )}
      {hotspot.contentType === "gallery" && (
        <div className="gallery-editor">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => addGalleryImages(event.target.files || [])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> 업로드
          </Button>
          {hotspot.mediaItems.map((item, index) => (
            <div className="gallery-row" key={item.id}>
              <img src={item.url} alt="" />
              <div>
                <span>이미지 {index + 1}</span>
                <input value={item.caption || ""} onChange={(event) => updateMediaCaption(item.id, event.target.value)} placeholder="캡션" />
              </div>
              <Button variant="ghost" onClick={() => moveMedia(item.id, "up")}><ChevronUp size={15} /></Button>
              <Button variant="ghost" onClick={() => moveMedia(item.id, "down")}><ChevronDown size={15} /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SCENE_TYPE_LABELS = {
  image: "이미지",
  "360": "360°",
  glb: "3D",
  [STREETVIEW_BACKGROUND_TYPE]: "Street View",
};

function SceneThumb({ scene }) {
  const isPicture =
    ["image", "360"].includes(scene.backgroundType) && scene.imageUrl && !scene.imageUrl.startsWith("google-streetview:");
  if (isPicture) {
    return (
      <span className="scene-thumb">
        <img src={scene.imageUrl} alt="" />
      </span>
    );
  }
  const Icon =
    scene.backgroundType === "glb"
      ? Box
      : scene.backgroundType === "360"
        ? Globe2
        : scene.backgroundType === STREETVIEW_BACKGROUND_TYPE
          ? MapPinned
          : FileImage;
  return (
    <span className="scene-thumb">
      <Icon size={20} />
    </span>
  );
}

function ScenePanel({ scenes, activeSceneId, canEdit, onSelect, onAdd, onRename, onMove, onRemove }) {
  return (
    <section className="scene-panel">
      <div className="panel-heading">
        <div>
          <h3>
            <Layers size={15} /> 장면
          </h3>
          <p>{canEdit ? "장면을 여러 개 만들고 핫스팟으로 이어 보세요." : `${scenes.length}개 장면`}</p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={onAdd} title="새 장면 추가">
            <Plus size={15} /> 장면
          </Button>
        )}
      </div>
      <div className="scene-list">
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId;
          return (
            <div className={`scene-row ${active ? "active" : ""}`} key={scene.id}>
              <button className="scene-select" type="button" onClick={() => onSelect(scene.id)}>
                <SceneThumb scene={scene} />
                <span className="scene-meta">
                  <strong>
                    {index + 1}. {scene.name}
                  </strong>
                  <small>
                    {SCENE_TYPE_LABELS[scene.backgroundType] || scene.backgroundType} · 핫스팟 {scene.hotspots.length}개
                    {scene.imageUrl ? "" : " · 배경 없음"}
                  </small>
                </span>
              </button>
              {canEdit && active && (
                <div className="scene-actions">
                  <input
                    aria-label="장면 이름"
                    value={scene.name}
                    onChange={(event) => onRename(scene.id, event.target.value)}
                    placeholder="장면 이름"
                  />
                  <Button variant="ghost" title="위로" onClick={() => onMove(scene.id, -1)} disabled={index === 0}>
                    <ChevronUp size={15} />
                  </Button>
                  <Button variant="ghost" title="아래로" onClick={() => onMove(scene.id, 1)} disabled={index === scenes.length - 1}>
                    <ChevronDown size={15} />
                  </Button>
                  <Button variant="danger" title="장면 삭제" onClick={() => onRemove(scene.id)} disabled={scenes.length <= 1}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Editor({ user, authLoading, accessToken }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idParam = params.get("id");
  const isExistingProject = Boolean(idParam);
  const [projectId, setProjectId] = useState(idParam || crypto.randomUUID());
  const [name, setName] = useState("Untitled Project");
  const [ownerId, setOwnerId] = useState(null);
  const [scenes, setScenes] = useState(() => [createScene()]);
  const [activeSceneId, setActiveSceneId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [activeContentId, setActiveContentId] = useState(null);
  const [editing, setEditing] = useState(true);
  const [streetViewImportOpen, setStreetViewImportOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectLoading, setProjectLoading] = useState(isExistingProject);
  const [projectMissing, setProjectMissing] = useState(false);
  const fileRef = useRef(null);
  const lastIdParamRef = useRef(idParam);
  const mapsKey = useRuntimeGoogleMapsBrowserKey(accessToken);

  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || scenes[0];
  const activeSceneRef = useRef(activeScene.id);
  activeSceneRef.current = activeScene.id;
  const { imageUrl, backgroundType, hotspots } = activeScene;
  const sourceMetadata = useMemo(() => pickSourceMetadata(activeScene), [activeScene]);
  const hasAnyBackground = scenes.some((scene) => scene.imageUrl);

  const canEdit = !!user && !authLoading && !projectLoading && (!isExistingProject || ownerId === user.id);
  const editingEnabled = canEdit && editing;

  // Every background/hotspot edit is scoped to one scene. The scene id is
  // captured at call time so async work (uploads) lands in the right scene.
  const patchScene = useCallback((patch, sceneId = activeSceneRef.current) => {
    setScenes((items) =>
      items.map((scene) => (scene.id === sceneId ? { ...scene, ...(typeof patch === "function" ? patch(scene) : patch) } : scene)),
    );
  }, []);
  const setHotspots = useCallback(
    (updater) => patchScene((scene) => ({ hotspots: typeof updater === "function" ? updater(scene.hotspots) : updater })),
    [patchScene],
  );

  useEffect(() => {
    const previousIdParam = lastIdParamRef.current;
    lastIdParamRef.current = idParam;
    if (idParam) {
      setProjectId(idParam);
      setProjectLoading(true);
      setProjectMissing(false);
      loadProject(idParam).then((project) => {
        if (!project) {
          setProjectMissing(true);
          setProjectLoading(false);
          return;
        }
        setName(project.name);
        setOwnerId(project.ownerId);
        setScenes(project.scenes);
        setActiveSceneId((current) => (project.scenes.some((scene) => scene.id === current) ? current : project.scenes[0].id));
        setProjectLoading(false);
      });
      return;
    }
    if (previousIdParam) {
      // Moved from an existing project to "new project": start clean.
      setProjectId(crypto.randomUUID());
      setName("Untitled Project");
      setScenes([createScene()]);
      setActiveSceneId(null);
      setSelectedId(null);
      setActiveContentId(null);
    }
    setOwnerId(user?.id || null);
    setProjectLoading(false);
    setProjectMissing(false);
  }, [idParam, user]);

  const selected = hotspots.find((hotspot) => hotspot.id === selectedId) || null;

  function switchScene(id) {
    if (!scenes.some((scene) => scene.id === id)) return;
    setActiveSceneId(id);
    setSelectedId(null);
    setActiveContentId(null);
  }

  function addScene() {
    const scene = createScene({}, scenes.length);
    setScenes((items) => [...items, scene]);
    setActiveSceneId(scene.id);
    setSelectedId(null);
    setActiveContentId(null);
    setEditing(true);
  }

  function renameScene(id, sceneName) {
    patchScene({ name: sceneName }, id);
  }

  function moveScene(id, direction) {
    setScenes((items) => {
      const index = items.findIndex((scene) => scene.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= items.length) return items;
      const reordered = [...items];
      const [scene] = reordered.splice(index, 1);
      reordered.splice(next, 0, scene);
      return reordered;
    });
  }

  function removeScene(id) {
    if (scenes.length <= 1) return;
    const target = scenes.find((scene) => scene.id === id);
    const hotspotCount = target?.hotspots.length || 0;
    const message = hotspotCount
      ? `"${target.name}" 장면과 그 안의 핫스팟 ${hotspotCount}개를 삭제할까요? 이 장면으로 이어지는 핫스팟은 연결이 해제됩니다.`
      : `"${target?.name || "장면"}" 장면을 삭제할까요?`;
    if (!window.confirm(message)) return;
    const remaining = scenes.filter((scene) => scene.id !== id);
    setScenes(
      remaining.map((scene) => ({
        ...scene,
        hotspots: scene.hotspots.map((hotspot) => (hotspot.targetSceneId === id ? { ...hotspot, targetSceneId: null } : hotspot)),
      })),
    );
    if (activeScene.id === id) {
      setActiveSceneId(remaining[0].id);
      setSelectedId(null);
      setActiveContentId(null);
    }
  }

  function openHotspotContent(id) {
    const hotspot = hotspots.find((item) => item.id === id);
    if (hotspot?.contentType === "scene") {
      if (hotspot.targetSceneId && scenes.some((scene) => scene.id === hotspot.targetSceneId)) {
        switchScene(hotspot.targetSceneId);
      } else {
        alert("이동할 장면이 아직 지정되지 않았습니다. 편집 모드에서 인스펙터의 '이동할 장면'을 선택해 주세요.");
      }
      return;
    }
    setActiveContentId(id);
  }

  function addHotspot(x, y, worldX, worldY, worldZ, extra = {}) {
    const hotspot = {
      id: crypto.randomUUID(),
      x,
      y,
      ...(Number.isFinite(worldX) &&
        Number.isFinite(worldY) &&
        Number.isFinite(worldZ) && {
          worldX,
          worldY,
          worldZ,
        }),
      ...extra,
      title: "",
      description: "",
      icon: "info",
      markerColor: defaultColor,
      markerMode: "icon",
      markerNumber: hotspots.length + 1,
      contentType: "text",
      mediaType: "none",
      mediaItems: [],
    };
    setHotspots((items) => [...items, hotspot]);
    setSelectedId(hotspot.id);
  }

  function updateHotspot(next) {
    setHotspots((items) => normalizeHotspots(items.map((item) => (item.id === next.id ? next : item))));
  }

  function removeHotspot(id) {
    setHotspots((items) => normalizeHotspots(items.filter((item) => item.id !== id)));
    if (selectedId === id) setSelectedId(null);
  }

  function moveHotspot(id, x, y) {
    setHotspots((items) => items.map((item) => (item.id === id ? { ...item, x, y } : item)));
  }

  function resetSceneBackground(nextType) {
    patchScene({
      backgroundType: nextType,
      imageUrl: null,
      hotspots: [],
      ...emptyStreetViewSource(),
    });
    setSelectedId(null);
    setActiveContentId(null);
  }

  async function handleUpload(file) {
    if (!file) return;
    const sceneId = activeScene.id;
    const uploadBackgroundType = backgroundType === STREETVIEW_BACKGROUND_TYPE ? "image" : backgroundType;
    if (!canEdit) {
      alert("Log in with the owner account before uploading.");
      return;
    }
    if (file.size < MIN_UPLOAD_BYTES) {
      alert("1KB 이상인 파일을 업로드해주세요.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("파일은 최대 100MB까지 업로드할 수 있습니다.");
      return;
    }
    if (uploadBackgroundType === "glb" && !/\.(glb|gltf)$/i.test(file.name)) {
      alert("Please upload a .glb or .gltf 3D model.");
      return;
    }
    if (uploadBackgroundType !== "glb" && !file.type.startsWith("image/")) {
      alert("Please upload an image file.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file);
      patchScene(
        {
          imageUrl: url,
          backgroundType: uploadBackgroundType,
          hotspots: [],
          ...emptyStreetViewSource(),
        },
        sceneId,
      );
      setSelectedId(null);
      setEditing(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave({ silent = false } = {}) {
    if (!canEdit || !hasAnyBackground || !user || saving) return false;
    if (!scenes[0].imageUrl) {
      alert("첫 번째 장면에 배경을 넣어야 저장할 수 있습니다. 학생은 첫 장면부터 보게 됩니다.");
      return false;
    }
    setSaving(true);
    try {
      const result = await saveProject({ id: projectId, name, scenes }, user.id);
      setOwnerId(user.id);
      if (!idParam) navigate(`/editor?id=${projectId}`, { replace: true });
      if (!silent) {
        alert(
          result.scenesPersisted
            ? "프로젝트를 저장했습니다."
            : `프로젝트를 저장했습니다. (장면 정보는 아직 저장되지 않습니다. ${SCENES_COLUMN_HELP})`,
        );
      }
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장에 실패했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyViewLink() {
    if (!hasAnyBackground) return;
    const saved = await handleSave({ silent: true });
    if (!saved) return;
    setShareUrl(`${window.location.origin}/view/${projectId}`);
  }

  function applyStreetViewBackground(nextSource) {
    patchScene({
      backgroundType: nextSource.backgroundType || "image",
      imageUrl: nextSource.imageUrl,
      hotspots: [],
      ...pickSourceMetadata(nextSource),
    });
    setSelectedId(null);
    setActiveContentId(null);
    setEditing(true);
    setStreetViewImportOpen(false);
  }

  const stage = useMemo(() => {
    if (!imageUrl) return null;
    const projectSource = { imageUrl, backgroundType, ...sourceMetadata };
    const props = {
      key: activeScene.id,
      hotspots,
      selectedId,
      editing: editingEnabled,
      onAdd: addHotspot,
      onSelect: (id) => (editingEnabled ? setSelectedId(id) : openHotspotContent(id)),
      onMove: moveHotspot,
    };
    if (backgroundType === "360") return <PanoramaStage imageUrl={imageUrl} {...props} />;
    if (backgroundType === "glb") return <ModelStage modelUrl={imageUrl} {...props} />;
    if (backgroundType === STREETVIEW_BACKGROUND_TYPE) {
      return <GoogleStreetViewStage apiKey={mapsKey.apiKey} project={projectSource} {...props} />;
    }
    return <ImageStage imageUrl={imageUrl} {...props} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScene.id, backgroundType, editingEnabled, hotspots, imageUrl, mapsKey.apiKey, scenes, selectedId, sourceMetadata]);

  const activeContent = hotspots.find((hotspot) => hotspot.id === activeContentId);
  const uploadGuidance = UPLOAD_GUIDANCE[backgroundType] || UPLOAD_GUIDANCE.image;
  const sceneNameById = (id) => scenes.find((scene) => scene.id === id)?.name || "";

  return (
    <main className="editor-page">
      <header className="editor-header">
        <div className="row">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft size={17} />
          </Button>
          <Sparkles size={21} />
          <input className="title-input" value={name} disabled={!canEdit} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="toolbar">
          <AuthPanel user={user} loading={authLoading} />
          <div className="segmented compact">
            {[
              ["image", "이미지", FileImage],
              ["360", "360", Globe2],
              [STREETVIEW_BACKGROUND_TYPE, "Street View", MapPinned],
              ["glb", "3D", Box],
            ].map(([value, label, Icon]) => (
              <button
                className={backgroundType === value ? "active" : ""}
                disabled={!canEdit}
                key={value}
                onClick={() => {
                  if (value === STREETVIEW_BACKGROUND_TYPE) {
                    setStreetViewImportOpen(true);
                    return;
                  }
                  resetSceneBackground(value);
                }}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          {hasAnyBackground && canEdit && (
            <div className="segmented compact">
              <button className={editing ? "active" : ""} onClick={() => setEditing(true)}>
                편집
              </button>
              <button className={!editing ? "active" : ""} onClick={() => setEditing(false)}>
                <Eye size={15} /> 미리보기
              </button>
            </div>
          )}
          {hasAnyBackground && canEdit && (
            <>
              <Button variant="secondary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? "저장 중..." : "저장"}</Button>
              <Button variant="secondary" onClick={copyViewLink} disabled={saving}><Share2 size={16} /> 공유</Button>
            </>
          )}
          {canEdit && (
            <>
              <Button variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> {uploading ? "업로드 중..." : imageUrl ? "이미지 교체" : "업로드"}
              </Button>
                <input
                  hidden
                  ref={fileRef}
                  type="file"
                  accept={backgroundType === "glb" ? ".glb,.gltf" : "image/*"}
                  onChange={(event) => {
                    handleUpload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
            </>
          )}
        </div>
      </header>
      {projectLoading && <div className="readonly">프로젝트를 불러오는 중입니다.</div>}
      {projectMissing && <div className="readonly">프로젝트를 찾을 수 없습니다. 링크가 잘못되었을 수 있습니다.</div>}
      {!user && <div className="readonly">로그인하면 프로젝트를 만들고 수정할 수 있습니다. 공유 보기 링크는 읽기 전용입니다.</div>}
      {user && ownerId && ownerId !== user.id && <div className="readonly">다른 계정의 프로젝트라 보기만 가능합니다.</div>}
      <div className="editor-grid">
        <aside className="sidebar">
          <ScenePanel
            scenes={scenes}
            activeSceneId={activeScene.id}
            canEdit={canEdit}
            onSelect={switchScene}
            onAdd={addScene}
            onRename={renameScene}
            onMove={moveScene}
            onRemove={removeScene}
          />
          <h3>핫스팟</h3>
          <p>
            {editingEnabled
              ? `"${activeScene.name}" 장면의 핫스팟입니다. 배경을 클릭해 새 핫스팟을 찍고, 목록에서 선택해 편집하세요.`
              : `"${activeScene.name}" 장면의 핫스팟입니다.`}
          </p>
          {hotspots.length ? (
            hotspots.map((hotspot, index) => (
              <button
                className={`hotspot-row ${selectedId === hotspot.id ? "active" : ""}`}
                key={hotspot.id}
                onClick={() => (editingEnabled ? setSelectedId(hotspot.id) : openHotspotContent(hotspot.id))}
              >
                <span>
                  #{index + 1} {hotspot.title || "제목 없는 핫스팟"}
                  {hotspot.contentType === "scene" && (
                    <small className="hotspot-scene-link">
                      → {hotspot.targetSceneId ? sceneNameById(hotspot.targetSceneId) || "삭제된 장면" : "장면 미지정"}
                    </small>
                  )}
                </span>
                <i style={{ backgroundColor: hotspot.markerColor || defaultColor }} />
              </button>
            ))
          ) : (
            <div className="empty-panel">아직 핫스팟이 없습니다.</div>
          )}
        </aside>
        <section className="canvas-area">
          {imageUrl ? (
            <div className="stage-stack">
              {scenes.length > 1 && (
                <div className="scene-badge">
                  <Layers size={14} /> {scenes.findIndex((scene) => scene.id === activeScene.id) + 1} / {scenes.length} · {activeScene.name}
                </div>
              )}
              {stage}
              <SourceAttribution project={sourceMetadata} />
              {mapsKey.error && backgroundType === STREETVIEW_BACKGROUND_TYPE && <p className="streetview-error">{mapsKey.error}</p>}
            </div>
          ) : (
            <button
              className="upload-empty"
              disabled={!canEdit}
              onClick={() => (backgroundType === STREETVIEW_BACKGROUND_TYPE ? setStreetViewImportOpen(true) : fileRef.current?.click())}
            >
              {backgroundType === STREETVIEW_BACKGROUND_TYPE ? <MapPinned size={34} /> : <Upload size={34} />}
              <strong>{uploadGuidance.title}</strong>
              <span>
                {canEdit
                  ? `"${activeScene.name}" 장면 · ${uploadGuidance.description}`
                  : "이 링크에서는 편집하거나 업로드할 수 없습니다."}
              </span>
              {canEdit && (
                <span className="upload-guidance" aria-label="업로드 권장 조건">
                  <span className="upload-guidance-note">{uploadGuidance.note}</span>
                  <span className="upload-guidance-list">
                    {uploadGuidance.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </span>
                </span>
              )}
            </button>
          )}
        </section>
        <aside className="inspector">
          <h3>인스펙터</h3>
          <p>학생이 눌렀을 때 볼 내용을 이곳에서 편집합니다.</p>
          {canEdit ? (
            <Inspector
              hotspot={selected}
              scenes={scenes}
              currentSceneId={activeScene.id}
              onChange={updateHotspot}
              onDelete={removeHotspot}
            />
          ) : (
            <div className="empty-panel">소유자 계정으로 로그인하면 편집할 수 있습니다.</div>
          )}
        </aside>
      </div>
      {!editingEnabled && activeContent && <HotspotModal hotspot={activeContent} onClose={() => setActiveContentId(null)} />}
      {streetViewImportOpen && (
        <GoogleStreetViewImportModal
          accessToken={accessToken}
          browserKey={mapsKey.apiKey}
          onApply={applyStreetViewBackground}
          onClose={() => setStreetViewImportOpen(false)}
        />
      )}
      {shareUrl && <ShareLinkModal title="프로젝트 공유" url={shareUrl} onClose={() => setShareUrl("")} />}
    </main>
  );
}

function ViewProject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [activeSceneId, setActiveSceneId] = useState(null);
  const [shareUrl, setShareUrl] = useState("");
  const mapsKey = useRuntimeGoogleMapsBrowserKey();

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      return;
    }
    loadProject(id).then((loaded) => {
      if (loaded) setProject(loaded);
      else setNotFound(true);
    });
  }, [id]);

  useEffect(() => {
    if (!project?.id) return;
    recordProjectView(project.id);
  }, [project?.id]);

  if (notFound) {
    return (
      <main className="centered">
        <h1>프로젝트를 찾을 수 없습니다</h1>
        <p>삭제되었거나 링크가 잘못되었을 수 있습니다.</p>
        <Button variant="secondary" onClick={() => navigate("/")}>홈으로</Button>
      </main>
    );
  }
  if (!project) return <main className="centered muted">불러오는 중...</main>;

  const scenes = project.scenes;
  const scene = scenes.find((item) => item.id === activeSceneId) || scenes[0];
  const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
  const active = scene.hotspots.find((hotspot) => hotspot.id === activeId);
  const viewShareUrl = `${window.location.origin}/view/${project.id}`;

  function goToScene(nextId) {
    if (!scenes.some((item) => item.id === nextId)) return;
    setActiveId(null);
    setActiveSceneId(nextId);
  }

  function handleHotspotSelect(hotspotId) {
    const hotspot = scene.hotspots.find((item) => item.id === hotspotId);
    if (hotspot?.contentType === "scene") {
      if (hotspot.targetSceneId) goToScene(hotspot.targetSceneId);
      return;
    }
    setActiveId(hotspotId);
  }

  const props = {
    key: scene.id,
    hotspots: scene.hotspots,
    editing: false,
    selectedId: null,
    onAdd: () => {},
    onSelect: handleHotspotSelect,
    onMove: () => {},
  };

  return (
    <main className="viewer-page">
      <header className="viewer-header">
        <div className="row">
          <Sparkles size={21} />
          <strong>{project.name}</strong>
          {scenes.length > 1 && (
            <span className="viewer-scene-label">
              {sceneIndex + 1} / {scenes.length} · {scene.name}
            </span>
          )}
        </div>
        <div className="viewer-actions">
          {scenes.length > 1 && sceneIndex > 0 && (
            <Button variant="ghost" onClick={() => goToScene(scenes[0].id)}>
              <Layers size={16} /> 첫 장면
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShareUrl(viewShareUrl)}>
            <Share2 size={16} /> 공유
          </Button>
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft size={16} /> 홈
          </Button>
        </div>
      </header>
      <section className="view-canvas">
        <div className="stage-stack">
          {!scene.imageUrl ? (
            <div className="stage empty-scene">이 장면에는 아직 배경이 없습니다.</div>
          ) : scene.backgroundType === "360" ? (
            <PanoramaStage imageUrl={scene.imageUrl} {...props} />
          ) : scene.backgroundType === "glb" ? (
            <ModelStage modelUrl={scene.imageUrl} {...props} />
          ) : scene.backgroundType === STREETVIEW_BACKGROUND_TYPE ? (
            <GoogleStreetViewStage apiKey={mapsKey.apiKey} project={scene} {...props} />
          ) : (
            <ImageStage imageUrl={scene.imageUrl} {...props} />
          )}
          <SourceAttribution project={scene} />
          {mapsKey.error && scene.backgroundType === STREETVIEW_BACKGROUND_TYPE && <p className="streetview-error">{mapsKey.error}</p>}
          {scenes.length > 1 && (
            <nav className="scene-nav" aria-label="장면 이동">
              {scenes.map((item, index) => (
                <button
                  className={item.id === scene.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  onClick={() => goToScene(item.id)}
                  aria-current={item.id === scene.id ? "page" : undefined}
                >
                  {index + 1}. {item.name}
                </button>
              ))}
            </nav>
          )}
        </div>
      </section>
      {active && <HotspotModal hotspot={active} onClose={() => setActiveId(null)} />}
      {shareUrl && <ShareLinkModal title="보기 링크 공유" url={shareUrl} onClose={() => setShareUrl("")} />}
    </main>
  );
}

function NotFound() {
  return (
    <main className="centered">
      <h1>404</h1>
      <p>Oops! Page not found</p>
      <Link to="/">Return to Home</Link>
    </main>
  );
}

function App() {
  const auth = useAuth();
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home user={auth.user} authLoading={auth.loading} />} />
          <Route path="/login" element={<AuthPage mode="login" user={auth.user} authLoading={auth.loading} />} />
          <Route path="/signup" element={<AuthPage mode="signup" user={auth.user} authLoading={auth.loading} />} />
          <Route path="/editor" element={<Editor user={auth.user} authLoading={auth.loading} accessToken={auth.session?.access_token || ""} />} />
          <Route path="/view/:id" element={<ViewProject />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
