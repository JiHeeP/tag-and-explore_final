import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Eye,
  FileImage,
  Globe2,
  Info,
  Link as LinkIcon,
  LogOut,
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
import "./styles.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://bnpxshdnckyubwgkwmpx.supabase.co";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_b9uy6XuIZHKou9z89suVLA_EkOgnGtO";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
});

const defaultColor = "#7c3aed";
const markerColors = ["#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#111827"];
const icons = [
  { value: "info", label: "Info", icon: Info },
  { value: "link", label: "Link", icon: LinkIcon },
  { value: "sparkle", label: "Sparkle", icon: Sparkles },
  { value: "target", label: "Target", icon: CircleDot },
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
      mediaItems,
    };
  });
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    hotspots: normalizeHotspots(row.hotspots || []),
    backgroundType: row.background_type || "image",
    ownerId: row.owner_id || null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function listProjects(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("projects").select("*").eq("owner_id", userId).order("created_at", { ascending: false });
  return error ? [] : (data || []).map(projectFromRow);
}

async function loadProject(id) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  return error || !data ? null : projectFromRow(data);
}

async function saveProject(project, userId) {
  if (!userId) throw new Error("Please log in before saving.");
  const { error } = await supabase.from("projects").upsert({
    id: project.id,
    name: project.name,
    image_url: project.imageUrl,
    hotspots: normalizeHotspots(project.hotspots),
    background_type: project.backgroundType,
    owner_id: userId,
  });
  if (error) throw new Error(error.message);
}

async function uploadFile(file) {
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
      contentType: file.type || "application/octet-stream",
      base64,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) throw new Error(result.error || "Upload failed.");
  return result.url;
}

function parseEmbed(code) {
  if (!code?.trim()) return null;
  const iframe = new DOMParser().parseFromString(code, "text/html").querySelector("iframe");
  const src = iframe?.getAttribute("src")?.trim();
  if (!src || !/^https:\/\//i.test(src) || /javascript:/i.test(src)) return null;
  return {
    src,
    title: iframe.getAttribute("title") || "Embedded content",
    allow: iframe.getAttribute("allow") || undefined,
    allowFullScreen:
      iframe.hasAttribute("allowfullscreen") ||
      iframe.hasAttribute("mozallowfullscreen") ||
      iframe.hasAttribute("webkitallowfullscreen"),
  };
}

function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}

function credentialToEmail(value) {
  return value.trim().toLowerCase();
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
      if (isSignup && !result.data.session) {
        setMessage("가입이 완료되었습니다. 이제 로그인해 주세요.");
        setPassword("");
        setPasswordConfirm("");
        navigate("/login", { replace: true });
        return;
      }
      navigate("/", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증에 실패했습니다.");
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

  const refresh = useCallback(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    listProjects(user.id).then((items) => {
      setProjects(items);
      setLoading(false);
    });
  }, [user]);

  useEffect(refresh, [refresh]);

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
        <h2>내 학습 콘텐츠</h2>
        {!user ? (
          <p className="muted">로그인하면 내 프로젝트가 여기에 표시됩니다. 공유받은 보기 링크는 로그인 없이도 열립니다.</p>
        ) : loading ? (
          <p className="muted">프로젝트를 불러오는 중...</p>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <img src={project.imageUrl || "/placeholder.svg"} alt="" />
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.hotspots.length}개 핫스팟 · {project.backgroundType}</p>
                  <div className="row">
                    <Button variant="secondary" onClick={() => navigate(`/editor?id=${project.id}`)}>
                      수정
                    </Button>
                    <Button variant="ghost" onClick={() => navigate(`/view/${project.id}`)}>
                      보기
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">아직 프로젝트가 없습니다.</p>
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

function ModelStage({ modelUrl, hotspots, selectedId, editing, onAdd, onSelect }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 480;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f7);
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const loader = new GLTFLoader();
    let model;
    loader.load(modelUrl, (gltf) => {
      model = gltf.scene;
      scene.add(model);
    });
    let frame;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (model) model.rotation.y += 0.006;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [modelUrl]);

  return (
    <div className="stage model-stage" onDoubleClick={() => editing && onAdd(50, 50)}>
      <div ref={mountRef} className="model-canvas" />
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          selected={selectedId === hotspot.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hotspot.id);
          }}
          style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
        />
      ))}
      <p className="hint">3D 자료는 더블클릭으로 핫스팟을 추가합니다.</p>
    </div>
  );
}

function HotspotModal({ hotspot, onClose }) {
  const embed = parseEmbed(hotspot.embedCode);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" className="close" onClick={onClose}>
          <X size={18} />
        </Button>
        <h2>{hotspot.title || "제목 없는 핫스팟"}</h2>
        {hotspot.description && <p>{hotspot.description}</p>}
        {hotspot.link && (
          <a className="external" href={hotspot.link} target="_blank" rel="noreferrer">
            링크 열기
          </a>
        )}
        {hotspot.contentType === "video" && hotspot.mediaUrl && <video controls src={hotspot.mediaUrl} />}
        {hotspot.contentType === "embed" && embed && <iframe title={embed.title} src={embed.src} allow={embed.allow} allowFullScreen={embed.allowFullScreen} />}
        {hotspot.contentType === "gallery" && (
          <div className="gallery">
            {hotspot.mediaItems.map((item) => (
              <figure key={item.id}>
                <img src={item.url} alt={item.caption || ""} />
                {item.caption && <figcaption>{item.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function Inspector({ hotspot, onChange, onDelete }) {
  const fileRef = useRef(null);
  if (!hotspot) return <div className="empty-panel">이미지를 클릭해 핫스팟을 만들거나 왼쪽 목록에서 선택하세요.</div>;

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
        ].map(([type, label]) => (
          <button className={hotspot.contentType === type ? "active" : ""} key={type} onClick={() => onChange({ ...hotspot, contentType: type })}>
            {label}
          </button>
        ))}
      </div>
      <label>제목</label>
      <input value={hotspot.title} onChange={(event) => onChange({ ...hotspot, title: event.target.value })} placeholder="제목을 입력하세요" />
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

function Editor({ user, authLoading }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idParam = params.get("id");
  const isExistingProject = Boolean(idParam);
  const [projectId, setProjectId] = useState(idParam || crypto.randomUUID());
  const [name, setName] = useState("Untitled Project");
  const [imageUrl, setImageUrl] = useState(null);
  const [ownerId, setOwnerId] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeContentId, setActiveContentId] = useState(null);
  const [editing, setEditing] = useState(true);
  const [backgroundType, setBackgroundType] = useState("image");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectLoading, setProjectLoading] = useState(isExistingProject);
  const [projectMissing, setProjectMissing] = useState(false);
  const fileRef = useRef(null);

  const canEdit = !!user && !authLoading && !projectLoading && (!isExistingProject || ownerId === user.id);
  const editingEnabled = canEdit && editing;

  useEffect(() => {
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
        setImageUrl(project.imageUrl);
        setOwnerId(project.ownerId);
        setHotspots(project.hotspots);
        setBackgroundType(project.backgroundType);
        setProjectLoading(false);
      });
      return;
    }
    setOwnerId(user?.id || null);
    setProjectLoading(false);
    setProjectMissing(false);
  }, [idParam, user]);

  const selected = hotspots.find((hotspot) => hotspot.id === selectedId) || null;

  function addHotspot(x, y) {
    const hotspot = {
      id: crypto.randomUUID(),
      x,
      y,
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

  async function handleUpload(file) {
    if (!file) return;
    if (!canEdit) {
      alert("Log in with the owner account before uploading.");
      return;
    }
    if (backgroundType !== "glb" && !file.type.startsWith("image/")) {
      alert("Please upload an image file.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file);
      setImageUrl(url);
      setHotspots([]);
      setSelectedId(null);
      setEditing(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!canEdit || !imageUrl || !user || saving) return false;
    setSaving(true);
    try {
      await saveProject({ id: projectId, name, imageUrl, hotspots, backgroundType }, user.id);
      setOwnerId(user.id);
      if (!idParam) navigate(`/editor?id=${projectId}`, { replace: true });
      alert("프로젝트를 저장했습니다.");
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장에 실패했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyViewLink() {
    if (!imageUrl) return;
    const saved = await handleSave();
    if (!saved) return;
    await navigator.clipboard.writeText(`${window.location.origin}/view/${projectId}`);
    alert("보기 링크를 복사했습니다.");
  }

  const stage = useMemo(() => {
    if (!imageUrl) return null;
    const props = {
      hotspots,
      selectedId,
      editing: editingEnabled,
      onAdd: addHotspot,
      onSelect: (id) => (editingEnabled ? setSelectedId(id) : setActiveContentId(id)),
      onMove: moveHotspot,
    };
    if (backgroundType === "360") return <PanoramaStage imageUrl={imageUrl} {...props} />;
    if (backgroundType === "glb") return <ModelStage modelUrl={imageUrl} {...props} />;
    return <ImageStage imageUrl={imageUrl} {...props} />;
  }, [imageUrl, hotspots, selectedId, editingEnabled, backgroundType]);

  const activeContent = hotspots.find((hotspot) => hotspot.id === activeContentId);

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
              ["glb", "3D", Box],
            ].map(([value, label, Icon]) => (
              <button
                className={backgroundType === value ? "active" : ""}
                disabled={!canEdit}
                key={value}
                onClick={() => {
                  setBackgroundType(value);
                  setImageUrl(null);
                  setHotspots([]);
                  setSelectedId(null);
                }}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          {imageUrl && canEdit && (
            <div className="segmented compact">
              <button className={editing ? "active" : ""} onClick={() => setEditing(true)}>
                편집
              </button>
              <button className={!editing ? "active" : ""} onClick={() => setEditing(false)}>
                <Eye size={15} /> 미리보기
              </button>
            </div>
          )}
          {imageUrl && canEdit && (
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
          <h3>핫스팟</h3>
          <p>{editingEnabled ? "이미지를 클릭해 새 핫스팟을 찍고, 목록에서 선택해 편집하세요." : "이 프로젝트는 보기 전용입니다."}</p>
          {hotspots.length ? (
            hotspots.map((hotspot, index) => (
              <button
                className={`hotspot-row ${selectedId === hotspot.id ? "active" : ""}`}
                key={hotspot.id}
                onClick={() => (canEdit ? setSelectedId(hotspot.id) : setActiveContentId(hotspot.id))}
              >
                <span>#{index + 1} {hotspot.title || "제목 없는 핫스팟"}</span>
                <i style={{ backgroundColor: hotspot.markerColor || defaultColor }} />
              </button>
            ))
          ) : (
            <div className="empty-panel">아직 핫스팟이 없습니다.</div>
          )}
        </aside>
        <section className="canvas-area">
          {imageUrl ? (
            stage
          ) : (
            <button className="upload-empty" disabled={!canEdit} onClick={() => fileRef.current?.click()}>
              <Upload size={34} />
              <strong>{backgroundType === "glb" ? "3D 모델(.glb) 업로드" : backgroundType === "360" ? "360° 이미지 업로드" : "이미지 업로드"}</strong>
              <span>{canEdit ? "업로드 후 이미지를 클릭해 핫스팟을 추가하세요." : "이 링크에서는 편집하거나 업로드할 수 없습니다."}</span>
            </button>
          )}
        </section>
        <aside className="inspector">
          <h3>인스펙터</h3>
          <p>학생이 눌렀을 때 볼 내용을 이곳에서 편집합니다.</p>
          {canEdit ? (
            <Inspector hotspot={selected} onChange={updateHotspot} onDelete={removeHotspot} />
          ) : (
            <div className="empty-panel">소유자 계정으로 로그인하면 편집할 수 있습니다.</div>
          )}
        </aside>
      </div>
      {!editingEnabled && activeContent && <HotspotModal hotspot={activeContent} onClose={() => setActiveContentId(null)} />}
    </main>
  );
}

function ViewProject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [activeId, setActiveId] = useState(null);

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

  const active = project.hotspots.find((hotspot) => hotspot.id === activeId);
  const props = {
    hotspots: project.hotspots,
    editing: false,
    selectedId: null,
    onAdd: () => {},
    onSelect: setActiveId,
    onMove: () => {},
  };

  return (
    <main className="editor-page">
      <header className="editor-header">
        <div className="row">
          <Sparkles size={21} />
          <strong>{project.name}</strong>
        </div>
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft size={16} /> 홈
        </Button>
      </header>
      <section className="view-canvas">
        {project.backgroundType === "360" ? (
          <PanoramaStage imageUrl={project.imageUrl} {...props} />
        ) : project.backgroundType === "glb" ? (
          <ModelStage modelUrl={project.imageUrl} {...props} />
        ) : (
          <ImageStage imageUrl={project.imageUrl} {...props} />
        )}
        <p className="hint">학생용 공유 화면입니다. 이 화면에서는 수정할 수 없습니다.</p>
      </section>
      {active && <HotspotModal hotspot={active} onClose={() => setActiveId(null)} />}
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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home user={auth.user} authLoading={auth.loading} />} />
        <Route path="/login" element={<AuthPage mode="login" user={auth.user} authLoading={auth.loading} />} />
        <Route path="/signup" element={<AuthPage mode="signup" user={auth.user} authLoading={auth.loading} />} />
        <Route path="/editor" element={<Editor user={auth.user} authLoading={auth.loading} />} />
        <Route path="/view/:id" element={<ViewProject />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<App />);
