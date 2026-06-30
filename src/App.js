import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, Play, Pause, Type, Square, Trash2, Download, Scissors,
  Circle, Minus, ArrowRight, Pencil, MousePointer, Plus, X,
} from "lucide-react";

/* ================================================================
   CONSTANTS
   ================================================================ */
const ACCENT = "#FF5A36";
const INK = "#16140F";
const PAPER = "#F6F3EC";
const LINE_COLOR = "#D8D2C4";

const TRACK_COLORS = [
  "#FF5A36", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#EF4444",
];

/* ================================================================
   HELPERS
   ================================================================ */
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function fmt(t) {
  if (!isFinite(t)) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawArrowhead(ctx, fromX, fromY, toX, toY, color, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.translate(toX, toY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.4);
  ctx.lineTo(-size, size * 0.4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function hitTestOverlay(px, py, o, canvasW, canvasH) {
  const M = 10; // hit margin in px
  if (o.type === "text") {
    const x = (o.x / 100) * canvasW;
    const y = (o.y / 100) * canvasH;
    const sz = o.size || 32;
    const estW = (o.text || "").length * sz * 0.6;
    return px >= x - M && px <= x + estW + M && py >= y - M && py <= y + sz + M;
  }
  if (o.type === "rect") {
    const x = (o.x / 100) * canvasW;
    const y = (o.y / 100) * canvasH;
    const rw = ((o.w || 25) / 100) * canvasW;
    const rh = ((o.h || 18) / 100) * canvasH;
    return px >= x - M && px <= x + rw + M && py >= y - M && py <= y + rh + M;
  }
  if (o.type === "circle") {
    const x = (o.x / 100) * canvasW;
    const y = (o.y / 100) * canvasH;
    const rw = ((o.w || 25) / 100) * canvasW / 2;
    const rh = ((o.h || 18) / 100) * canvasH / 2;
    const cx = x + rw;
    const cy = y + rh;
    const dx = (px - cx) / (rw + M);
    const dy = (py - cy) / (rh + M);
    return dx * dx + dy * dy <= 1;
  }
  if (o.type === "line" || o.type === "arrow") {
    const x1 = ((o.x1 ?? 10) / 100) * canvasW;
    const y1 = ((o.y1 ?? 10) / 100) * canvasH;
    const x2 = ((o.x2 ?? 50) / 100) * canvasW;
    const y2 = ((o.y2 ?? 50) / 100) * canvasH;
    return distToSegment(px, py, x1, y1, x2, y2) <= M + (o.lineWidth || 4);
  }
  if (o.type === "freehand") {
    const pts = o.points || [];
    for (let i = 1; i < pts.length; i++) {
      const a1 = (pts[i - 1].x / 100) * canvasW;
      const b1 = (pts[i - 1].y / 100) * canvasH;
      const a2 = (pts[i].x / 100) * canvasW;
      const b2 = (pts[i].y / 100) * canvasH;
      if (distToSegment(px, py, a1, b1, a2, b2) <= M + (o.lineWidth || 4)) return true;
    }
    return false;
  }
  return false;
}

function moveOverlayBy(o, dxPct, dyPct) {
  const clamp = (v) => Math.max(0, Math.min(100, v));
  if (o.type === "text" || o.type === "rect" || o.type === "circle") {
    return { ...o, x: clamp(o.x + dxPct), y: clamp(o.y + dyPct) };
  }
  if (o.type === "line" || o.type === "arrow") {
    return {
      ...o,
      x1: clamp((o.x1 ?? 10) + dxPct),
      y1: clamp((o.y1 ?? 10) + dyPct),
      x2: clamp((o.x2 ?? 50) + dxPct),
      y2: clamp((o.y2 ?? 50) + dyPct),
    };
  }
  if (o.type === "freehand") {
    return {
      ...o,
      points: (o.points || []).map((p) => ({
        x: clamp(p.x + dxPct),
        y: clamp(p.y + dyPct),
      })),
    };
  }
  return o;
}

/* ================================================================
   APP COMPONENT
   ================================================================ */
export default function App() {
  /* ---- video state ---- */
  const [videoUrl, setVideoUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [dims, setDims] = useState({ w: 640, h: 360 });

  /* ---- track state ---- */
  const [tracks, setTracks] = useState(() => [
    { id: uid(), name: "Track 1", color: TRACK_COLORS[0] },
  ]);
  const [activeTrackId, setActiveTrackId] = useState(() => null);

  /* ---- overlay state ---- */
  const [overlays, setOverlays] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  /* ---- draw mode ---- */
  const [drawMode, setDrawMode] = useState("select");
  // "select" | "freehand" | "line" | "arrow" | "rect" | "circle"

  /* ---- export state ---- */
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportUrl, setExportUrl] = useState(null);

  /* ---- refs ---- */
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, overlay }
  const timelineDragRef = useRef(null); // { overlayId, origStart, origEnd, origTrackId, startX, startY, barRect }
  const drawingRef = useRef({
    active: false,
    type: null,
    points: null, // freehand points array
    preview: null, // shape preview object
    startX: 0,
    startY: 0,
    startTime: 0,
  });

  /* ---- boot active track ---- */
  useEffect(() => {
    if (tracks.length > 0 && (!activeTrackId || !tracks.find((t) => t.id === activeTrackId))) {
      setActiveTrackId(tracks[0].id);
    }
  }, [tracks, activeTrackId]);

  const activeTrack = tracks.find((t) => t.id === activeTrackId) || tracks[0];
  const selected = overlays.find((o) => o.id === selectedId) || null;

  /* ================================================================
     DRAW OVERLAY
     ================================================================ */
  function drawOverlay(ctx, o, w, h) {
    if (o.type === "text") {
      const x = (o.x / 100) * w;
      const y = (o.y / 100) * h;
      ctx.font = `700 ${o.size || 32}px Georgia, serif`;
      ctx.fillStyle = o.color;
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 6;
      ctx.fillText(o.text || "", x, y);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    } else if (o.type === "rect") {
      const x = (o.x / 100) * w;
      const y = (o.y / 100) * h;
      const rw = ((o.w || 25) / 100) * w;
      const rh = ((o.h || 18) / 100) * h;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth || 4;
      ctx.strokeRect(x, y, rw, rh);
    } else if (o.type === "circle") {
      const x = (o.x / 100) * w;
      const y = (o.y / 100) * h;
      const rw = ((o.w || 25) / 100) * w / 2;
      const rh = ((o.h || 18) / 100) * h / 2;
      ctx.beginPath();
      ctx.ellipse(x + rw, y + rh, rw, rh, 0, 0, Math.PI * 2);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth || 4;
      ctx.stroke();
    } else if (o.type === "line") {
      const x1 = ((o.x1 ?? 10) / 100) * w;
      const y1 = ((o.y1 ?? 10) / 100) * h;
      const x2 = ((o.x2 ?? 50) / 100) * w;
      const y2 = ((o.y2 ?? 50) / 100) * h;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth || 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (o.type === "arrow") {
      const x1 = ((o.x1 ?? 10) / 100) * w;
      const y1 = ((o.y1 ?? 10) / 100) * h;
      const x2 = ((o.x2 ?? 50) / 100) * w;
      const y2 = ((o.y2 ?? 50) / 100) * h;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth || 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      drawArrowhead(ctx, x1, y1, x2, y2, o.color, 14);
    } else if (o.type === "freehand") {
      const pts = o.points || [];
      if (pts.length < 2) return;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth || 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo((pts[0].x / 100) * w, (pts[0].y / 100) * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo((pts[i].x / 100) * w, (pts[i].y / 100) * h);
      }
      ctx.stroke();
    }
  }

  /* ================================================================
     MAIN DRAW LOOP
     ================================================================ */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyStage < 2) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    const ctx = canvas.getContext("2d");
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(video, 0, 0, cw, ch);

    const t = video.currentTime;

    // Draw finalized overlays
    overlays.forEach((o) => {
      if (t >= o.start && t <= o.end) drawOverlay(ctx, o, cw, ch);
    });

    // Draw in-progress freehand stroke
    const ds = drawingRef.current;
    if (ds.active && ds.type === "freehand" && ds.points && ds.points.length >= 2) {
      ctx.strokeStyle = activeTrack?.color || ACCENT;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo((ds.points[0].x / 100) * cw, (ds.points[0].y / 100) * ch);
      for (let i = 1; i < ds.points.length; i++) {
        ctx.lineTo((ds.points[i].x / 100) * cw, (ds.points[i].y / 100) * ch);
      }
      ctx.stroke();
    }

    // Draw preview shape
    if (ds.active && ds.preview) {
      const p = ds.preview;
      p.color = activeTrack?.color || ACCENT;
      drawOverlay(ctx, p, cw, ch);
    }

    // Highlight selected overlay
    if (selected && t >= selected.start && t <= selected.end) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      if (selected.type === "text") {
        const sx = (selected.x / 100) * cw;
        const sy = (selected.y / 100) * ch;
        const sz = selected.size || 32;
        const estW = (selected.text || "").length * sz * 0.6;
        ctx.strokeRect(sx - 4, sy - 4, estW + 8, sz + 8);
      } else if (selected.type === "rect") {
        const sx = (selected.x / 100) * cw;
        const sy = (selected.y / 100) * ch;
        ctx.strokeRect(sx - 3, sy - 3, ((selected.w || 25) / 100) * cw + 6, ((selected.h || 18) / 100) * ch + 6);
      } else if (selected.type === "circle") {
        const sx = (selected.x / 100) * cw;
        const sy = (selected.y / 100) * ch;
        const rw = ((selected.w || 25) / 100) * cw / 2 + 4;
        const rh = ((selected.h || 18) / 100) * ch / 2 + 4;
        ctx.beginPath();
        ctx.ellipse(sx + ((selected.w || 25) / 100) * cw / 2, sy + ((selected.h || 18) / 100) * ch / 2, rw, rh, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (selected.type === "line" || selected.type === "arrow") {
        const x1 = ((selected.x1 ?? 10) / 100) * cw;
        const y1 = ((selected.y1 ?? 10) / 100) * ch;
        const x2 = ((selected.x2 ?? 50) / 100) * cw;
        const y2 = ((selected.y2 ?? 50) / 100) * ch;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (selected.type === "freehand") {
        const pts = selected.points || [];
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo((pts[0].x / 100) * cw, (pts[0].y / 100) * ch);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo((pts[i].x / 100) * cw, (pts[i].y / 100) * ch);
          }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [overlays, selected, activeTrack]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  /* ---- sync currentTime ---- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrent(video.currentTime);
      if (video.currentTime >= trimEnd && trimEnd > 0) {
        video.pause();
        setPlaying(false);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [trimEnd]);

  /* ================================================================
     FILE HANDLING
     ================================================================ */
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setOverlays([]);
    setExportUrl(null);
    setSelectedId(null);
    setTracks([{ id: uid(), name: "Track 1", color: TRACK_COLORS[0] }]);
    setDrawMode("select");
    drawingRef.current = { active: false, type: null, points: null, preview: null, startX: 0, startY: 0, startTime: 0 };
  }

  function onLoadedMeta() {
    const video = videoRef.current;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    // Cap display size so preview fits comfortably on screen
    const DISPLAY_MAX = 960;
    const dScale = Math.min(DISPLAY_MAX / Math.max(vw, vh), 1);
    setDims({ w: Math.round(vw * dScale), h: Math.round(vh * dScale) });
    setDuration(video.duration);
    setTrimStart(0);
    setTrimEnd(video.duration);
  }

  /* ================================================================
     PLAYBACK
     ================================================================ */
  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
    } else {
      if (video.currentTime < trimStart || video.currentTime >= trimEnd) video.currentTime = trimStart;
      video.play();
    }
    setPlaying(!playing);
  }

  function seek(t) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    setCurrent(t);
  }

  /* ================================================================
     OVERLAY CRUD
     ================================================================ */
  function addTextOverlay() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    const end = Math.min(duration, t + 2);
    const trackId = activeTrack?.id || tracks[0]?.id;
    const overlay = {
      id: uid(),
      trackId,
      type: "text",
      start: t,
      end,
      x: 30,
      y: 30,
      color: activeTrack?.color || ACCENT,
      text: "Your label",
      size: 32,
    };
    setOverlays((prev) => [...prev, overlay]);
    setSelectedId(overlay.id);
  }

  function finalizeDrawing() {
    const ds = drawingRef.current;
    const video = videoRef.current;
    if (!ds.active || !video) return;
    const trackId = activeTrack?.id || tracks[0]?.id;
    const trackColor = activeTrack?.color || ACCENT;
    const startT = ds.startTime;
    const endT = Math.min(duration, startT + 2);

    if (ds.type === "freehand") {
      const pts = ds.points || [];
      if (pts.length < 2) {
        drawingRef.current = { active: false, type: null, points: null, preview: null, startX: 0, startY: 0, startTime: 0 };
        return;
      }
      const overlay = {
        id: uid(),
        trackId,
        type: "freehand",
        start: startT,
        end: endT,
        points: pts,
        color: trackColor,
        lineWidth: 4,
      };
      setOverlays((prev) => [...prev, overlay]);
      setSelectedId(overlay.id);
    } else if (ds.preview) {
      const p = ds.preview;
      let overlay;
      if (ds.type === "rect") {
        overlay = {
          id: uid(), trackId, type: "rect",
          start: startT, end: endT,
          x: p.x, y: p.y, w: p.w, h: p.h,
          color: trackColor, lineWidth: 4,
        };
      } else if (ds.type === "circle") {
        overlay = {
          id: uid(), trackId, type: "circle",
          start: startT, end: endT,
          x: p.x, y: p.y, w: p.w, h: p.h,
          color: trackColor, lineWidth: 4,
        };
      } else if (ds.type === "line") {
        overlay = {
          id: uid(), trackId, type: "line",
          start: startT, end: endT,
          x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
          color: trackColor, lineWidth: 4,
        };
      } else if (ds.type === "arrow") {
        overlay = {
          id: uid(), trackId, type: "arrow",
          start: startT, end: endT,
          x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
          color: trackColor, lineWidth: 4,
        };
      }
      if (overlay) {
        setOverlays((prev) => [...prev, overlay]);
        setSelectedId(overlay.id);
      }
    }

    drawingRef.current = { active: false, type: null, points: null, preview: null, startX: 0, startY: 0, startTime: 0 };
    if (ds.type !== "freehand") setDrawMode("select");
  }

  function updateOverlay(id, patch) {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function removeOverlay(id) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  /* ================================================================
     TIMELINE DRAG (move overlay between tracks & time)
     ================================================================ */
  function onBarPointerDown(e, overlay) {
    e.stopPropagation();
    setSelectedId(overlay.id);
    // use parent bar area width, NOT the bar element's own width
    const barArea = e.currentTarget.parentElement;
    const areaWidth = barArea.getBoundingClientRect().width;
    timelineDragRef.current = {
      overlayId: overlay.id,
      origStart: overlay.start,
      origEnd: overlay.end,
      origTrackId: overlay.trackId,
      startX: e.clientX,
      startY: e.clientY,
      areaWidth,
    };
  }

  function onBarPointerMove(e) {
    const dr = timelineDragRef.current;
    if (!dr) return;
    const dx = e.clientX - dr.startX;
    const dy = e.clientY - dr.startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 3) return;

    // horizontal: shift time — divide dx by bar AREA width, not bar width
    const ovDuration = dr.origEnd - dr.origStart;
    const deltaTime = (dx / dr.areaWidth) * duration;
    let newStart = dr.origStart + deltaTime;
    newStart = Math.max(0, Math.min(duration - ovDuration, newStart));
    updateOverlay(dr.overlayId, { start: newStart, end: newStart + ovDuration });

    // vertical: switch track
    const trackRows = document.querySelectorAll(".track-row");
    let targetId = dr.origTrackId;
    trackRows.forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetId = row.getAttribute("data-track-id") || targetId;
      }
    });
    if (targetId !== dr.origTrackId) {
      const target = tracks.find((t) => t.id === targetId);
      updateOverlay(dr.overlayId, { trackId: targetId, color: target?.color || ACCENT });
    }
  }

  function onBarPointerUp() {
    timelineDragRef.current = null;
  }

  /* ================================================================
     TRACK CRUD
     ================================================================ */
  function addTrack() {
    const usedColors = new Set(tracks.map((t) => t.color));
    const nextColor = TRACK_COLORS.find((c) => !usedColors.has(c)) || TRACK_COLORS[0];
    const t = {
      id: uid(),
      name: `Track ${tracks.length + 1}`,
      color: nextColor,
    };
    setTracks((prev) => [...prev, t]);
    setActiveTrackId(t.id);
  }

  function updateTrackName(id, name) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
  }

  function removeTrack(id) {
    if (tracks.length <= 1) return;
    setTracks((prev) => prev.filter((t) => t.id !== id));
    setOverlays((prev) => prev.filter((o) => o.trackId !== id));
    if (activeTrackId === id) {
      setActiveTrackId((prev) => {
        const remaining = tracks.filter((t) => t.id !== id);
        return remaining[0]?.id || null;
      });
    }
  }

  /* ================================================================
     CANVAS INTERACTION
     ================================================================ */
  function onCanvasPointerDown(e) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const xPct = (px / rect.width) * 100;
    const yPct = (py / rect.height) * 100;

    if (drawMode === "select") {
      // Hit-test overlays (reverse = topmost first)
      const hit = [...overlays].reverse().find((o) => {
        const t = video?.currentTime || 0;
        if (t < o.start || t > o.end) return false;
        return hitTestOverlay(px, py, o, canvas.width, canvas.height);
      });
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = { startX: e.clientX, startY: e.clientY, overlay: hit };
      } else {
        setSelectedId(null);
        dragRef.current = null;
      }
      return;
    }

    // --- drawing modes ---
    if (video) {
      video.pause();
      setPlaying(false);
    }

    if (drawMode === "freehand") {
      drawingRef.current = {
        active: true,
        type: "freehand",
        points: [{ x: xPct, y: yPct }],
        preview: null,
        startX: 0, startY: 0,
        startTime: video?.currentTime || current,
      };
    } else {
      // rect, circle, line, arrow
      drawingRef.current = {
        active: true,
        type: drawMode,
        points: null,
        preview: null,
        startX: xPct,
        startY: yPct,
        startTime: video?.currentTime || current,
      };
    }
  }

  function onCanvasPointerMove(e) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const xPct = (px / rect.width) * 100;
    const yPct = (py / rect.height) * 100;

    // Dragging in select mode
    if (drawMode === "select" && dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const dxPct = (dx / rect.width) * 100;
      const dyPct = (dy / rect.height) * 100;
      const moved = moveOverlayBy(dragRef.current.overlay, dxPct, dyPct);
      updateOverlay(dragRef.current.overlay.id, moved);
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
      dragRef.current.overlay = { ...dragRef.current.overlay, ...moved };
      return;
    }

    // Drawing in progress
    const ds = drawingRef.current;
    if (!ds.active) return;

    if (ds.type === "freehand") {
      ds.points.push({ x: xPct, y: yPct });
    } else {
      // Build preview
      const sx = ds.startX;
      const sy = ds.startY;
      let preview;
      if (ds.type === "rect") {
        preview = {
          type: "rect",
          x: Math.min(sx, xPct), y: Math.min(sy, yPct),
          w: Math.abs(xPct - sx), h: Math.abs(yPct - sy),
          color: activeTrack?.color || ACCENT, lineWidth: 4,
        };
      } else if (ds.type === "circle") {
        preview = {
          type: "circle",
          x: Math.min(sx, xPct), y: Math.min(sy, yPct),
          w: Math.abs(xPct - sx), h: Math.abs(yPct - sy),
          color: activeTrack?.color || ACCENT, lineWidth: 4,
        };
      } else if (ds.type === "line" || ds.type === "arrow") {
        preview = {
          type: ds.type,
          x1: sx, y1: sy, x2: xPct, y2: yPct,
          color: activeTrack?.color || ACCENT, lineWidth: 4,
        };
      }
      ds.preview = preview;
    }
  }

  function onCanvasPointerUp() {
    if (drawMode === "select") {
      dragRef.current = null;
      return;
    }
    if (drawingRef.current.active) {
      finalizeDrawing();
    }
  }

  /* ================================================================
     CURSOR STYLE
     ================================================================ */
  function canvasCursor() {
    if (drawMode === "select") return selected ? "grab" : "default";
    return "crosshair";
  }

  /* ================================================================
     EXPORT
     ================================================================ */
  async function handleExport() {
    const video = videoRef.current;
    const displayCanvas = canvasRef.current;
    if (!video || !displayCanvas) return;
    setExporting(true);
    setExportProgress(0);
    setExportUrl(null);

    // Offscreen export canvas — uses ORIGINAL video resolution
    const outW = video.videoWidth;
    const outH = video.videoHeight;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = outW;
    exportCanvas.height = outH;
    const ectx = exportCanvas.getContext("2d");
    ectx.imageSmoothingEnabled = true;
    ectx.imageSmoothingQuality = "high";

    const fps = 30;
    const stream = exportCanvas.captureStream(fps);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const megapixels = (outW * outH) / 1000000;
    const bitrate = Math.round(megapixels * 2500000); // ~5Mbps at 1080p
    const recOpts = {
      mimeType: mime,
      videoBitsPerSecond: Math.max(1500000, Math.min(12000000, bitrate)),
    };
    const recorder = new MediaRecorder(stream, recOpts);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        setExportUrl(URL.createObjectURL(blob));
        resolve();
      };
    });

    video.pause();
    video.currentTime = trimStart;
    await new Promise((r) => (video.onseeked = r));

    recorder.start();
    video.play();

    const drawExportFrame = () => {
      ectx.clearRect(0, 0, outW, outH);
      ectx.drawImage(video, 0, 0, outW, outH);
      const t = video.currentTime;
      overlays.forEach((o) => {
        if (t >= o.start && t <= o.end) drawOverlay(ectx, o, outW, outH);
      });
      setExportProgress(Math.min(100, ((t - trimStart) / (trimEnd - trimStart)) * 100));
      if (t < trimEnd && !video.paused) {
        requestAnimationFrame(drawExportFrame);
      } else {
        video.pause();
        recorder.stop();
      }
    };
    requestAnimationFrame(drawExportFrame);

    await done;
    setExporting(false);
    setPlaying(false);
  }

  /* ================================================================
     RENDER HELPERS
     ================================================================ */
  function toolButton(mode, icon, label) {
    const active = drawMode === mode;
    return (
      <button
        className={`btn${active ? " primary" : ""}`}
        style={{ flex: 1, justifyContent: "center", fontSize: 11, padding: "7px 6px" }}
        onClick={() => setDrawMode(active ? "select" : mode)}
        title={label}
      >
        {icon} {label}
      </button>
    );
  }

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <div style={{ background: PAPER, minHeight: "100%", fontFamily: "'Inter', system-ui, sans-serif", color: INK, padding: "28px 20px 60px" }}>
      <style>{`
        * { box-sizing: border-box; }
        .veb { font-family: Georgia, 'Times New Roman', serif; }
        input[type=range] { -webkit-appearance: none; height: 4px; background: ${LINE_COLOR}; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${ACCENT}; cursor: pointer; margin-top: -5px; }
        button { font-family: inherit; cursor: pointer; }
        .btn { display: flex; align-items: center; gap: 4px; padding: 8px 12px; border-radius: 6px; border: 1px solid ${INK}; background: transparent; color: ${INK}; font-size: 12px; font-weight: 600; letter-spacing: 0.01em; transition: all .15s; white-space: nowrap; }
        .btn:hover { background: ${INK}; color: ${PAPER}; }
        .btn.primary { background: ${ACCENT}; border-color: ${ACCENT}; color: white; }
        .btn.primary:hover { background: #E64A28; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .chip { padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .track-row { transition: background .12s; }
        .track-row:hover { background: #f0ece2; }
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* ---- HEADER ---- */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 22, borderBottom: `2px solid ${INK}`, paddingBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: ACCENT, textTransform: "uppercase" }}>Video Labeling</div>
            <h1 className="veb" style={{ fontSize: 28, margin: "2px 0 0", fontWeight: 700 }}>Trim & Label</h1>
          </div>
          {!videoUrl && (
            <button className="btn primary" onClick={() => fileInputRef.current.click()}>
              <Upload size={15} /> Load video
            </button>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display: "none" }} />

        {!videoUrl ? (
          /* ---- EMPTY STATE ---- */
          <div
            onClick={() => fileInputRef.current.click()}
            style={{
              border: `1.5px dashed ${LINE_COLOR}`,
              borderRadius: 10,
              padding: "80px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: "white",
            }}
          >
            <Upload size={28} color={ACCENT} style={{ marginBottom: 10 }} />
            <div className="veb" style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Drop a video to get started</div>
            <div style={{ fontSize: 13, color: "#8a8473" }}>Click to choose a video file from your device — nothing leaves your browser.</div>
          </div>
        ) : (
          /* ---- EDITOR LAYOUT ---- */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 22 }}>
            {/* ========== LEFT COLUMN ========== */}
            <div>
              {/* Canvas */}
              <div
                style={{
                  position: "relative",
                  width: dims.w,
                  maxWidth: "100%",
                  background: INK,
                  borderRadius: 8,
                  overflow: "hidden",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  onLoadedMetadata={onLoadedMeta}
                  style={{ display: "none" }}
                  playsInline
                />
                <canvas
                  ref={canvasRef}
                  width={dims.w}
                  height={dims.h}
                  style={{ width: "100%", display: "block", cursor: canvasCursor() }}
                  onPointerDown={onCanvasPointerDown}
                  onPointerMove={onCanvasPointerMove}
                  onPointerUp={onCanvasPointerUp}
                  onPointerLeave={onCanvasPointerUp}
                />
              </div>

              {/* Playback controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
                <button className="btn" onClick={togglePlay} style={{ padding: 9 }}>
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#8a8473", minWidth: 90 }}>
                  {fmt(current)} / {fmt(duration)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={current}
                  onChange={(e) => seek(parseFloat(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>

              {/* Trim */}
              <div style={{ marginTop: 18, background: "white", border: `1px solid ${LINE_COLOR}`, borderRadius: 8, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Scissors size={14} color={ACCENT} />
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Trim range</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8473" }}>{fmt(trimStart)} – {fmt(trimEnd)}</span>
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#8a8473" }}>Start</label>
                    <input type="range" min={0} max={duration || 0} step={0.01} value={trimStart}
                      onChange={(e) => setTrimStart(Math.min(parseFloat(e.target.value), trimEnd - 0.1))}
                      style={{ width: "100%" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#8a8473" }}>End</label>
                    <input type="range" min={0} max={duration || 0} step={0.01} value={trimEnd}
                      onChange={(e) => setTrimEnd(Math.max(parseFloat(e.target.value), trimStart + 0.1))}
                      style={{ width: "100%" }} />
                  </div>
                </div>
              </div>

              {/* Multi-track overlay timeline */}
              <div style={{ marginTop: 16, background: "white", border: `1px solid ${LINE_COLOR}`, borderRadius: 8, padding: "16px 16px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                  Overlay Timeline
                </div>

                {/* Time ruler row */}
                <div style={{ display: "flex" }}>
                  <div style={{ width: 85, flexShrink: 0 }} />
                  <div style={{ flex: 1, position: "relative", height: 18, marginBottom: 2 }}>
                    {[0, 25, 50, 75, 100].map((pct) => (
                      <div key={pct} style={{ position: "absolute", left: `${pct}%`, top: 0, fontSize: 8, color: "#b5af9b", transform: "translateX(-50%)" }}>
                        {fmt((pct / 100) * duration)}
                      </div>
                    ))}
                    {/* Playhead in ruler */}
                    <div
                      style={{
                        position: "absolute",
                        left: `${(current / (duration || 1)) * 100}%`,
                        top: 12, bottom: -2,
                        width: 1.5,
                        background: ACCENT,
                        zIndex: 5,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                </div>

                {/* Tracks container */}
                <div>
                  {/* Track rows */}
                  {tracks.map((track) => {
                    const trackOverlays = overlays.filter((o) => o.trackId === track.id);
                    return (
                      <div
                        key={track.id}
                        className="track-row"
                        data-track-id={track.id}
                        onClick={() => setActiveTrackId(track.id)}
                        style={{
                          display: "flex",
                          height: 28,
                          marginBottom: 4,
                          cursor: "pointer",
                        }}
                      >
                        {/* Fixed-width label column */}
                        <div
                          style={{
                            width: 85,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: 8,
                            background: activeTrackId === track.id ? "#f5f2e8" : "#EFEAE0",
                            borderRadius: "4px 0 0 4px",
                            border: activeTrackId === track.id ? `1.5px solid ${track.color}` : "1.5px solid transparent",
                            borderRight: "none",
                            gap: 6,
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: track.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#6b6350", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {track.name}
                          </span>
                        </div>

                        {/* Bar area */}
                        <div
                          style={{
                            flex: 1,
                            position: "relative",
                            background: activeTrackId === track.id ? "#f5f2e8" : "#EFEAE0",
                            borderRadius: "0 4px 4px 0",
                            border: activeTrackId === track.id ? `1.5px solid ${track.color}` : "1.5px solid transparent",
                            borderLeft: activeTrackId === track.id ? `1.5px solid ${track.color}` : `1px solid ${LINE_COLOR}`,
                            overflow: "hidden",
                          }}
                        >
                          {/* Playhead marker for this track row */}
                          <div
                            style={{
                              position: "absolute",
                              left: `${(current / (duration || 1)) * 100}%`,
                              top: 0, bottom: 0,
                              width: 1.5,
                              background: ACCENT,
                              zIndex: 4,
                              pointerEvents: "none",
                            }}
                          />
                          {trackOverlays.map((o) => (
                            <div
                              key={o.id}
                              onPointerDown={(e) => onBarPointerDown(e, o)}
                              onPointerMove={onBarPointerMove}
                              onPointerUp={onBarPointerUp}
                              onClick={(e) => { if (!timelineDragRef.current) { e.stopPropagation(); setSelectedId(o.id); } }}
                              style={{
                                position: "absolute",
                                left: `${(o.start / (duration || 1)) * 100}%`,
                                width: `${Math.max(0.5, ((o.end - o.start) / (duration || 1)) * 100)}%`,
                                top: 4, bottom: 4,
                                background: o.color,
                                opacity: selectedId === o.id ? 1 : 0.75,
                                borderRadius: 3,
                                fontSize: 9,
                                color: "white",
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: 5,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                cursor: "grab",
                                border: selectedId === o.id ? `1.5px solid white` : "none",
                                touchAction: "none",
                                userSelect: "none",
                              }}
                            >
                              {o.type === "text" ? o.text : o.type}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {overlays.length === 0 && (
                  <div style={{ fontSize: 12, color: "#8a8473", padding: "4px 0" }}>
                    No overlays yet — use the drawing tools or add a text label.
                  </div>
                )}
              </div>
            </div>

            {/* ========== RIGHT PANEL ========== */}
            <div>
              {/* ---- Drawing Tools ---- */}
              <div style={{ background: "white", border: `1px solid ${LINE_COLOR}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                  Drawing Tools
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                  {toolButton("select", <MousePointer size={13} />, "Select")}
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: "center", fontSize: 11, padding: "7px 6px" }}
                    onClick={addTextOverlay}
                    title="Add text label"
                  >
                    <Type size={13} /> Text
                  </button>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                  {toolButton("rect", <Square size={13} />, "Rect")}
                  {toolButton("circle", <Circle size={13} />, "Circle")}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {toolButton("line", <Minus size={13} />, "Line")}
                  {toolButton("arrow", <ArrowRight size={13} style={{ transform: "rotate(-45deg)" }} />, "Arrow")}
                  {toolButton("freehand", <Pencil size={13} />, "Draw")}
                </div>
                {drawMode !== "select" && (
                  <div style={{ fontSize: 10, color: ACCENT, marginTop: 8, fontWeight: 600 }}>
                    {drawMode === "freehand"
                      ? "Freehand mode active — draw on canvas. Click Select to exit."
                      : `${drawMode} mode active — click & drag on canvas.`}
                  </div>
                )}
              </div>

              {/* ---- Tracks ---- */}
              <div style={{ background: "white", border: `1px solid ${LINE_COLOR}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Tracks</span>
                  <button
                    className="btn"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={addTrack}
                    title="Add track"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    onClick={() => setActiveTrackId(track.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      marginBottom: 4,
                      cursor: "pointer",
                      background: activeTrackId === track.id ? "#f5f2e8" : "transparent",
                      border: activeTrackId === track.id ? `1px solid ${track.color}` : "1px solid transparent",
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: track.color, flexShrink: 0 }} />
                    <input
                      value={track.name}
                      onChange={(e) => updateTrackName(track.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        border: "none",
                        background: "transparent",
                        fontSize: 12,
                        fontWeight: 600,
                        outline: "none",
                        padding: "2px 0",
                      }}
                    />
                    {activeTrackId === track.id && (
                      <span className="chip" style={{ background: track.color, color: "white", fontSize: 9 }}>active</span>
                    )}
                    {tracks.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          padding: 2,
                          display: "flex",
                          opacity: 0.5,
                        }}
                        title="Delete track"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 10, color: "#8a8473", marginTop: 6 }}>
                  New overlays are added to the active track. Click a track to select it.
                </div>
              </div>

              {/* ---- Selected Overlay Properties ---- */}
              {selected ? (
                <div style={{ background: "white", border: `1px solid ${LINE_COLOR}`, borderRadius: 8, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span className="chip" style={{ background: selected.color, color: "white" }}>
                      {selected.type}
                    </span>
                    <button onClick={() => removeOverlay(selected.id)} className="btn" style={{ padding: 6, border: "none" }}>
                      <Trash2 size={14} color={ACCENT} />
                    </button>
                  </div>

                  {/* Track selector */}
                  <label style={lbl}>Track</label>
                  <select
                    value={selected.trackId || ""}
                    onChange={(e) => updateOverlay(selected.id, { trackId: e.target.value })}
                    style={{ ...inp, cursor: "pointer" }}
                  >
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>

                  {/* Text properties */}
                  {selected.type === "text" && (
                    <>
                      <label style={lbl}>Label text</label>
                      <input
                        value={selected.text || ""}
                        onChange={(e) => updateOverlay(selected.id, { text: e.target.value })}
                        style={inp}
                      />
                      <label style={lbl}>Size ({selected.size || 32}px)</label>
                      <input type="range" min={12} max={96} value={selected.size || 32}
                        onChange={(e) => updateOverlay(selected.id, { size: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                    </>
                  )}

                  {/* Rect / Circle properties */}
                  {(selected.type === "rect" || selected.type === "circle") && (
                    <>
                      <label style={lbl}>Width % ({selected.w || 25})</label>
                      <input type="range" min={2} max={90} value={selected.w || 25}
                        onChange={(e) => updateOverlay(selected.id, { w: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>Height % ({selected.h || 18})</label>
                      <input type="range" min={2} max={90} value={selected.h || 18}
                        onChange={(e) => updateOverlay(selected.id, { h: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>Line width ({selected.lineWidth || 4}px)</label>
                      <input type="range" min={1} max={16} value={selected.lineWidth || 4}
                        onChange={(e) => updateOverlay(selected.id, { lineWidth: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                    </>
                  )}

                  {/* Line / Arrow properties */}
                  {(selected.type === "line" || selected.type === "arrow") && (
                    <>
                      <label style={lbl}>Start X % ({Math.round(selected.x1 ?? 10)})</label>
                      <input type="range" min={0} max={100} value={selected.x1 ?? 10}
                        onChange={(e) => updateOverlay(selected.id, { x1: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>Start Y % ({Math.round(selected.y1 ?? 10)})</label>
                      <input type="range" min={0} max={100} value={selected.y1 ?? 10}
                        onChange={(e) => updateOverlay(selected.id, { y1: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>End X % ({Math.round(selected.x2 ?? 50)})</label>
                      <input type="range" min={0} max={100} value={selected.x2 ?? 50}
                        onChange={(e) => updateOverlay(selected.id, { x2: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>End Y % ({Math.round(selected.y2 ?? 50)})</label>
                      <input type="range" min={0} max={100} value={selected.y2 ?? 50}
                        onChange={(e) => updateOverlay(selected.id, { y2: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <label style={lbl}>Line width ({selected.lineWidth || 4}px)</label>
                      <input type="range" min={1} max={16} value={selected.lineWidth || 4}
                        onChange={(e) => updateOverlay(selected.id, { lineWidth: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                    </>
                  )}

                  {/* Freehand properties */}
                  {selected.type === "freehand" && (
                    <>
                      <label style={lbl}>Line width ({selected.lineWidth || 4}px)</label>
                      <input type="range" min={1} max={16} value={selected.lineWidth || 4}
                        onChange={(e) => updateOverlay(selected.id, { lineWidth: parseInt(e.target.value) })}
                        style={{ width: "100%" }} />
                      <div style={{ fontSize: 10, color: "#8a8473", marginTop: 6 }}>
                        {selected.points?.length || 0} points
                      </div>
                    </>
                  )}

                  {/* Common: Color */}
                  <label style={lbl}>Color</label>
                  <input type="color" value={selected.color || ACCENT}
                    onChange={(e) => updateOverlay(selected.id, { color: e.target.value })}
                    style={{ width: "100%", height: 32, border: `1px solid ${LINE_COLOR}`, borderRadius: 6, cursor: "pointer" }} />

                  {/* Common: Start / End time */}
                  <label style={lbl}>Start ({fmt(selected.start)})</label>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={selected.start}
                    onChange={(e) => updateOverlay(selected.id, { start: Math.min(parseFloat(e.target.value), selected.end - 0.1) })}
                    style={{ width: "100%" }} />

                  <label style={lbl}>End ({fmt(selected.end)})</label>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={selected.end}
                    onChange={(e) => updateOverlay(selected.id, { end: Math.max(parseFloat(e.target.value), selected.start + 0.1) })}
                    style={{ width: "100%" }} />

                  <div style={{ fontSize: 10, color: "#8a8473", marginTop: 8 }}>
                    {selected.type === "text"
                      ? "Drag the label on canvas to reposition."
                      : selected.type === "freehand"
                      ? "Draw on canvas in Freehand mode to add strokes."
                      : "Click & drag on canvas in draw mode to create."}
                  </div>
                </div>
              ) : (
                <div style={{ background: "white", border: `1px dashed ${LINE_COLOR}`, borderRadius: 8, padding: 16, fontSize: 12, color: "#8a8473", marginBottom: 12 }}>
                  Select an overlay from the timeline or click one on the canvas to edit its properties.
                </div>
              )}

              {/* ---- Export ---- */}
              <div style={{ borderTop: `1px solid ${LINE_COLOR}`, paddingTop: 12 }}>
                <button className="btn primary" onClick={handleExport} disabled={exporting} style={{ width: "100%", justifyContent: "center" }}>
                  <Download size={14} /> {exporting ? `Exporting ${Math.round(exportProgress)}%` : "Export WebM"}
                </button>
                {exportUrl && (
                  <a href={exportUrl} download="edited-video.webm" className="btn" style={{ marginTop: 8, width: "100%", justifyContent: "center", textDecoration: "none" }}>
                    Download result
                  </a>
                )}
                <div style={{ fontSize: 10, color: "#8a8473", marginTop: 6 }}>
                  Records the trimmed range with all overlays. Output is .webm — 100% browser-side.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   SHARED STYLES
   ================================================================ */
const lbl = { display: "block", fontSize: 11, color: "#8a8473", margin: "10px 0 4px" };
const inp = { width: "100%", padding: "7px 9px", border: `1px solid ${LINE_COLOR}`, borderRadius: 6, fontSize: 13, fontFamily: "inherit" };
