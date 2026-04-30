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
  Plus,
  Save,
  Share2,
  Sparkles,
  Trash2,
  Upload,
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
const tokenStorageKey = "tag-and-explore:project-edit-tokens";
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

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(tokenStorageKey) || "{}");
  } catch {
    return {};
  }
}

function rememberToken(id, token) {
  const tokens = readTokens();
  tokens[id] = token;
  localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function forgetToken(id) {
  const tokens = readTokens();
  delete tokens[id];
  localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function getToken(id) {
  const token = readTokens()[id];
  return typeof token === "string" ? token : null;
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    hotspots: normalizeHotspots(row.hotspots || []),
    backgroundType: row.background_type || "image",
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function listProjects() {
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  return error ? [] : (data || []).map(projectFromRow);
}

async function loadProject(id) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  return error || !data ? null : projectFromRow(data);
}

async function saveProject(project) {
  const { error } = await supabase.from("projects").upsert({
    id: project.id,
    name: project.name,
    image_url: project.imageUrl,
    hotspots: normalizeHotspots(project.hotspots),
    background_type: project.backgroundType,
  });
  if (error) throw new Error(error.message);
}

async function deleteProject(id) {
  await supabase.from("projects").delete().eq("id", id);
}

async function uploadFile(file) {
  const extension = file.name.split(".").pop() || "bin";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("project-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from("project-images").getPublicUrl(path).data.publicUrl;
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

function Home() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    listProjects().then((items) => {
      setProjects(items);
      setLoading(false);
    });
  }, []);

  useEffect(refresh, [refresh]);

  async function handleDelete(id) {
    await deleteProject(id);
    forgetToken(id);
    refresh();
  }

  return (
    <main className="page">
      <AppHeader>
        <Button onClick={() => navigate("/editor")}>
          <Plus size={17} /> New Project
        </Button>
      </AppHeader>
      <section className="hero">
        <div className="eyebrow">
          <Sparkles size={16} /> Interactive Experience Builder
        </div>
        <h1>
          Make any image <span>interactive</span>
        </h1>
        <p>Upload images, 360 panoramas, or 3D models. Add clickable hotspots with text, links, embeds, and galleries.</p>
        <Button className="large" onClick={() => navigate("/editor")}>
          <Plus size={20} /> Create Now
        </Button>
      </section>
      <section className="steps">
        {[
          ["1", "Upload", "Drop an image, panorama, or .glb 3D model."],
          ["2", "Tag", "Place hotspots and attach rich content."],
          ["3", "Share", "Share a read-only view link and keep edit access private."],
        ].map(([step, title, text]) => (
          <article key={step}>
            <b>{step}</b>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="projects">
        <h2>Projects</h2>
        {loading ? (
          <p className="muted">Loading projects...</p>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <img src={project.imageUrl || "/placeholder.svg"} alt="" />
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.hotspots.length} hotspots · {project.backgroundType}</p>
                  <div className="row">
                    <Button variant="secondary" onClick={() => navigate(`/editor?id=${project.id}`)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => navigate(`/view/${project.id}`)}>
                      View
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(project.id)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No projects yet.</p>
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

  function positionFromEvent(event) {
    const rect = ref.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function handleClick(event) {
    if (!editing || event.target !== ref.current) return;
    const { x, y } = positionFromEvent(event);
    onAdd(x, y);
  }

  function handleDragEnd(event, id) {
    if (!editing) return;
    const { x, y } = positionFromEvent(event);
    onMove(id, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
  }

  return (
    <div className="stage image-stage" ref={ref} onClick={handleClick}>
      <img src={imageUrl} alt="" />
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          selected={selectedId === hotspot.id}
          draggable={editing}
          onDragEnd={(event) => handleDragEnd(event, hotspot.id)}
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
      <p className="hint">360 preview restored as an interactive flat panorama. The original bundle used a spherical viewer.</p>
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
      <p className="hint">Double-click to add a 3D hotspot. Exact world-position recovery needs the original source map.</p>
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
        <h2>{hotspot.title || "Untitled hotspot"}</h2>
        {hotspot.description && <p>{hotspot.description}</p>}
        {hotspot.link && (
          <a className="external" href={hotspot.link} target="_blank" rel="noreferrer">
            Open link
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
  if (!hotspot) return <div className="empty-panel">Select a hotspot from the list or click the canvas to create one.</div>;

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
          <h3>Selected hotspot</h3>
          <p>Configure marker style and hotspot content.</p>
        </div>
        <Button variant="danger" onClick={() => onDelete(hotspot.id)}>
          <Trash2 size={16} />
        </Button>
      </div>
      <label>Marker Icon</label>
      <div className="choice-grid">
        {icons.map(({ value, label, icon: Icon }) => (
          <button className={hotspot.icon === value ? "active" : ""} title={label} key={value} onClick={() => onChange({ ...hotspot, icon: value })}>
            <Icon size={17} />
          </button>
        ))}
      </div>
      <label>Marker Color</label>
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
      <label>Marker Mode</label>
      <div className="segmented">
        <button className={hotspot.markerMode !== "number" ? "active" : ""} onClick={() => onChange({ ...hotspot, markerMode: "icon" })}>
          Icon
        </button>
        <button className={hotspot.markerMode === "number" ? "active" : ""} onClick={() => onChange({ ...hotspot, markerMode: "number" })}>
          Number
        </button>
      </div>
      {hotspot.markerMode === "number" && (
        <input type="number" min="1" max="999" value={hotspot.markerNumber || 1} onChange={(event) => onChange({ ...hotspot, markerNumber: Number(event.target.value) || 1 })} />
      )}
      <label>Content Type</label>
      <div className="segmented wrap">
        {["text", "video", "embed", "gallery"].map((type) => (
          <button className={hotspot.contentType === type ? "active" : ""} key={type} onClick={() => onChange({ ...hotspot, contentType: type })}>
            {type}
          </button>
        ))}
      </div>
      <label>Title</label>
      <input value={hotspot.title} onChange={(event) => onChange({ ...hotspot, title: event.target.value })} placeholder="Enter title..." />
      <label>Description</label>
      <textarea value={hotspot.description} onChange={(event) => onChange({ ...hotspot, description: event.target.value })} placeholder="Enter description..." />
      <label>Link URL</label>
      <input value={hotspot.link || ""} onChange={(event) => onChange({ ...hotspot, link: event.target.value })} placeholder="https://..." />
      {hotspot.contentType === "video" && (
        <>
          <label>Video URL</label>
          <input value={hotspot.mediaUrl || ""} onChange={(event) => onChange({ ...hotspot, mediaUrl: event.target.value, mediaType: "video" })} placeholder="https://example.com/video.mp4" />
        </>
      )}
      {hotspot.contentType === "embed" && (
        <>
          <label>Embed Code</label>
          <textarea className="mono" value={hotspot.embedCode || ""} onChange={(event) => onChange({ ...hotspot, embedCode: event.target.value })} placeholder='<iframe src="https://..."></iframe>' />
        </>
      )}
      {hotspot.contentType === "gallery" && (
        <div className="gallery-editor">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => addGalleryImages(event.target.files || [])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Upload
          </Button>
          {hotspot.mediaItems.map((item, index) => (
            <div className="gallery-row" key={item.id}>
              <img src={item.url} alt="" />
              <div>
                <span>Image {index + 1}</span>
                <input value={item.caption || ""} onChange={(event) => updateMediaCaption(item.id, event.target.value)} placeholder="Optional caption" />
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

function Editor() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idParam = params.get("id");
  const tokenParam = params.get("token");
  const [projectId, setProjectId] = useState(idParam || crypto.randomUUID());
  const [token, setToken] = useState(tokenParam || "");
  const [name, setName] = useState("Untitled Project");
  const [imageUrl, setImageUrl] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeContentId, setActiveContentId] = useState(null);
  const [editing, setEditing] = useState(true);
  const [backgroundType, setBackgroundType] = useState("image");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const canEdit = !!token;
  const editingEnabled = canEdit && editing;

  useEffect(() => {
    if (idParam) {
      const remembered = getToken(idParam);
      const nextToken = tokenParam || remembered || "";
      setProjectId(idParam);
      setToken(nextToken);
      setEditing(!!nextToken);
      if (nextToken) rememberToken(idParam, nextToken);
      loadProject(idParam).then((project) => {
        if (!project) return;
        setName(project.name);
        setImageUrl(project.imageUrl);
        setHotspots(project.hotspots);
        setBackgroundType(project.backgroundType);
      });
      return;
    }
    const nextToken = tokenParam || crypto.randomUUID();
    setToken(nextToken);
    rememberToken(projectId, nextToken);
    if (!tokenParam) navigate(`/editor?id=${projectId}&token=${nextToken}`, { replace: true });
  }, [idParam, tokenParam, projectId, navigate]);

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
    if (!canEdit || !imageUrl) return;
    await saveProject({ id: projectId, name, imageUrl, hotspots, backgroundType });
    rememberToken(projectId, token);
    alert("Project saved successfully.");
  }

  async function copyViewLink() {
    if (!imageUrl) return;
    await handleSave();
    await navigator.clipboard.writeText(`${window.location.origin}/view/${projectId}`);
    alert("View link copied.");
  }

  async function copyEditLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/editor?id=${projectId}&token=${token}`);
    alert("Edit link copied.");
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
          <div className="segmented compact">
            {[
              ["image", "Image", FileImage],
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
                Edit
              </button>
              <button className={!editing ? "active" : ""} onClick={() => setEditing(false)}>
                <Eye size={15} /> Preview
              </button>
            </div>
          )}
          {imageUrl && canEdit && (
            <>
              <Button variant="secondary" onClick={handleSave}><Save size={16} /> Save</Button>
              <Button variant="secondary" onClick={copyViewLink}><Share2 size={16} /> Share</Button>
              <Button variant="secondary" onClick={copyEditLink}><LinkIcon size={16} /> Edit Link</Button>
            </>
          )}
          {canEdit && (
            <>
              <Button variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> {uploading ? "Uploading..." : imageUrl ? "Change" : "Upload"}
              </Button>
              <input
                hidden
                ref={fileRef}
                type="file"
                accept={backgroundType === "glb" ? ".glb,.gltf" : "image/*"}
                onChange={(event) => handleUpload(event.target.files?.[0])}
              />
            </>
          )}
        </div>
      </header>
      {!canEdit && <div className="readonly">This editor link is read-only. Use your private edit link to make changes.</div>}
      <div className="editor-grid">
        <aside className="sidebar">
          <h3>Hotspots</h3>
          <p>{editingEnabled ? "Select a hotspot to edit it. Click the canvas to place a new one." : "This shared project is view-only."}</p>
          {hotspots.length ? (
            hotspots.map((hotspot, index) => (
              <button className={`hotspot-row ${selectedId === hotspot.id ? "active" : ""}`} key={hotspot.id} onClick={() => setSelectedId(hotspot.id)}>
                <span>#{index + 1} {hotspot.title || "Untitled hotspot"}</span>
                <i style={{ backgroundColor: hotspot.markerColor || defaultColor }} />
              </button>
            ))
          ) : (
            <div className="empty-panel">No hotspots yet.</div>
          )}
        </aside>
        <section className="canvas-area">
          {imageUrl ? (
            stage
          ) : (
            <button className="upload-empty" disabled={!canEdit} onClick={() => fileRef.current?.click()}>
              <Upload size={34} />
              <strong>Upload {backgroundType === "glb" ? "a 3D model (.glb)" : backgroundType === "360" ? "a 360 image" : "an image"}</strong>
              <span>{canEdit ? "Add hotspots to make it interactive." : "This link does not allow editing or uploads."}</span>
            </button>
          )}
        </section>
        <aside className="inspector">
          <h3>Inspector</h3>
          <p>Hotspot content is added and configured here.</p>
          <Inspector hotspot={selected} onChange={updateHotspot} onDelete={removeHotspot} />
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
        <h1>Project not found</h1>
        <p>This project may have been deleted or the link is invalid.</p>
        <Button variant="secondary" onClick={() => navigate("/")}>Back to home</Button>
      </main>
    );
  }
  if (!project) return <main className="centered muted">Loading...</main>;

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
          <ArrowLeft size={16} /> Home
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
        <p className="hint">This shared view is read-only.</p>
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
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/view/:id" element={<ViewProject />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<App />);
