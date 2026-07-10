import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useVideo } from '../context/VideoContext';
import { webmToMp4 } from '../utils/ffmpeg';
import { Check, X } from 'lucide-react';

const HANDLE_SIZE = 8;
const ROTATE_HANDLE_OFFSET = 28;

export default function PreviewCanvas() {
  const {
    state,
    selectElement,
    deselectAll,
    setSelectedIds,
    deleteSelectedClips,
    updateClip,
    deleteClip,
    addOverlayClip,
    setCurrentTime,
    setIsPlaying,
    setExporting,
    // enterCropMode,
    updateCropRect,
    exitCropMode,
    applyCrop,
  } = useVideo();

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRefs = useRef({});
  const animFrameRef = useRef(null);
  const drawRafRef = useRef(null);
  const exportResRef = useRef(null); // sets canvas size during export
  const shiftRef = useRef(false);    // tracks Shift key state
  const penPointsRef = useRef([]);   // freehand pen points during drawing
  const guidesRef = useRef([]);      // alignment guide lines { type: 'v'|'h', x/y: px }
  const [containerSize, setContainerSize] = useState({ width: 640, height: 360 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });
  const [interaction, setInteraction] = useState(null);
  const [, setGuides] = useState([]); // guide lines drawn on canvas during interaction
  const [multiRect, setMultiRect] = useState(null); // { x, y, w, h } canvas pixels
  const multiDragRef = useRef(null); // { startClipSnapshots: [{ clipId, x, y, ... }] }
  const [cropInteraction, setCropInteraction] = useState(null); // for crop rect resize

  // Track Shift key for constrained dragging/resizing
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Shift') shiftRef.current = true;
    };
    const onKeyUp = (e) => {
      if (e.key === 'Shift') shiftRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Refs to latest state for the draw loop (avoids re-creating the loop)
  const stateRef = useRef(state);
  stateRef.current = state;
  const drawStateRef = useRef({ isDrawing, drawStart, drawCurrent, penPoints: [] });
  drawStateRef.current = { isDrawing, drawStart, drawCurrent, penPoints: penPointsRef.current };
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const multiRectRef = useRef(null);
  multiRectRef.current = multiRect;
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;
  const cropInteractionRef = useRef(cropInteraction);
  cropInteractionRef.current = cropInteraction;

  // Playback loop — uses ref to avoid resetting on every time change
  useEffect(() => {
    if (!state.isPlaying) return;
    let lastTime = performance.now();
    const tick = (now) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      const next = stateRef.current.currentTime + delta;
      if (next >= stateRef.current.duration) {
        setCurrentTime(stateRef.current.duration);
        setIsPlaying(false);
      } else {
        setCurrentTime(next);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isPlaying]);

  // Unified video sync: manages play/pause/seek for all video elements.
  // During playback AND export: videos in range play naturally at 1× speed (no seeking),
  //   keeping the decoder buffer full so drawImage() never gets a stale frame.
  // When paused (and not exporting): videos are paused and seeked for accurate scrubbing.
  useEffect(() => {
    const s = stateRef.current;
    const playing = s.isPlaying || s.isExporting;

    Object.entries(videoRefs.current).forEach(([clipId, entry]) => {
      const { videoEl, clip } = entry;
      if (!videoEl || videoEl.readyState < 2) return;

      const inRange = s.currentTime >= clip.startTime && s.currentTime <= clip.endTime;

      if (playing && inRange) {
        // Apply playback rate from clip properties (can change via user editing)
        const rate = clip.playbackRate || 1;
        if (videoEl.playbackRate !== rate) {
          videoEl.playbackRate = rate;
        }
        // Should be playing naturally — start it if it's not already
        if (videoEl.paused) {
          const rel = s.currentTime - clip.startTime;
          // Source time accounts for playback rate: e.g. at 2x speed, 1s on timeline = 2s in source
          const srcTime = clip.sourceStart + rel * rate;
          // Only seek when NOT exporting — seekToStart() already pre-positioned
          // all videos before export capture began. Seeking during export would
          // invalidate the decoder buffer and cause flicker.
          if (!s.isExporting && Math.abs(videoEl.currentTime - srcTime) > 0.1) {
            videoEl.currentTime = srcTime;
          }
          // Install auto-pause listener for clip end — use sourceEnd directly
          // (already accounts for speed-adjusted duration)
          const endSrcTime = clip.sourceEnd;
          const onTimeUpdate = () => {
            if (videoEl.currentTime >= endSrcTime) {
              videoEl.pause();
            }
          };
          videoEl.addEventListener('timeupdate', onTimeUpdate);
          videoEl._onTimeUpdate = onTimeUpdate;
          videoEl.play().catch(() => { });
        }
      } else {
        // Should NOT be playing — pause and clean up
        if (!videoEl.paused) {
          if (videoEl._onTimeUpdate) {
            videoEl.removeEventListener('timeupdate', videoEl._onTimeUpdate);
            videoEl._onTimeUpdate = null;
          }
          videoEl.pause();
        }

        // When paused (scrubbing), seek to the exact frame
        if (!playing) {
          const rel = s.currentTime - clip.startTime;
          const rate = clip.playbackRate || 1;
          if (rel >= 0 && rel <= clip.endTime - clip.startTime) {
            const srcTime = clip.sourceStart + rel * rate;
            if (Math.abs(videoEl.currentTime - srcTime) > 0.15) {
              videoEl.currentTime = srcTime;
            }
          } else {
            if (Math.abs(videoEl.currentTime - clip.sourceStart) > 0.15) {
              videoEl.currentTime = clip.sourceStart;
            }
          }
        }
      }
    });
  }, [state.currentTime, state.isPlaying, state.isExporting]);

  // Export: uses natural playback (videos play at 1× speed — no per-frame seeking).
  // The canvas draw loop renders whatever frames the video decoder has ready, and
  // canvas.captureStream() records them at 30fps with zero flicker.
  // The export canvas size matches the preview container, so what you see is what you get.
  useEffect(() => {
    if (!state.isExporting) return;
    const canvas = canvasRef.current;
    if (!canvas) {
      setExporting(false, 0);
      return;
    }

    let cancelled = false;
    let monitorId = null;
    let recorder = null;
    const chunks = [];
    const fps = 30;
    const duration = state.duration;

    // Export at native resolution of the first video clip — this determines
    // both the canvas pixel size and aspect ratio for the entire export.
    // Any subsequent clips with different aspect ratios are centered within
    // this frame (handled by the per-clip letterboxing in the draw loop).
    const videoEntries = Object.values(videoRefs.current);
    const firstVideo = videoEntries.find(e => e.videoEl && e.videoEl.videoWidth > 0);
    const targetW = firstVideo ? firstVideo.videoEl.videoWidth : 1920;
    const targetH = firstVideo ? firstVideo.videoEl.videoHeight : 1080;
    const pixels = targetW * targetH;
    // Higher bitrate preserves more detail: ~15 bps per pixel, clamped 10–80 Mbps
    const bitrate = Math.max(10000000, Math.min(80000000, Math.round(pixels * 15)));
    // Lock canvas to native resolution so the draw loop renders at full quality
    exportResRef.current = { width: targetW, height: targetH };

    // Seek all videos to their clip start positions, then start natural playback
    const seekToStart = () => {
      return new Promise((resolve) => {
        let pending = 0;
        const entries = Object.values(videoRefs.current);
        if (entries.length === 0) {
          // No videos, just use a short delay
          setTimeout(resolve, 100);
          return;
        }
        pending = entries.length;
        entries.forEach(({ videoEl, clip }) => {
          if (!videoEl || videoEl.readyState < 2) {
            pending--;
            if (pending === 0) resolve();
            return;
          }
          videoEl.currentTime = clip.sourceStart;
          const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked);
            pending--;
            if (pending === 0) resolve();
          };
          videoEl.addEventListener('seeked', onSeeked);
          // Safety timeout
          setTimeout(() => {
            videoEl.removeEventListener('seeked', onSeeked);
            pending--;
            if (pending === 0) resolve();
          }, 2000);
        });
      });
    };

    const beginCapture = () => {
      if (cancelled) return;

      // Start natural playback FIRST so the canvas shows frame 0, then begin
      // recording. This avoids capturing the pre-seek stale frame.
      setCurrentTime(0);
      setIsPlaying(true);

      // Wait one RAF so React commits the state update and the draw loop
      // renders the first frame at the target export resolution.
      requestAnimationFrame(() => {
        if (cancelled) return;

        const stream = canvas.captureStream(fps);
        recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: bitrate,
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = async () => {
          if (cancelled) return;
          setIsPlaying(false);

          const webmBlob = new Blob(chunks, { type: 'video/webm' });
          // Read from stateRef (always fresh) to avoid stale closure
          const fmt = stateRef.current.exportFormat;

          if (fmt === 'mp4') {
            // Transcode WebM → MP4 client-side using FFmpeg.wasm
            try {
              setExporting(true, 101, 'mp4'); // 101 = "Converting to MP4…" signal
              const mp4Blob = await webmToMp4(webmBlob, fps);
              if (cancelled) return;
              const url = URL.createObjectURL(mp4Blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'exported-video.mp4';
              a.click();
              URL.revokeObjectURL(url);
            } catch (err) {
              // Fallback: download original WebM if transcoding fails
              console.error('MP4 conversion failed, falling back to WebM:', err);
              if (!cancelled) {
                const url = URL.createObjectURL(webmBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'exported-video.webm';
                a.click();
                URL.revokeObjectURL(url);
              }
            }
          } else {
            // WebM: direct download, no transcoding
            const url = URL.createObjectURL(webmBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'exported-video.webm';
            a.click();
            URL.revokeObjectURL(url);
          }

          if (!cancelled) setExporting(false, 100);
        };

        recorder.start();

        // Monitor progress via polling the ref (avoids per-frame React re-renders)
        let lastPct = -1;
        monitorId = setInterval(() => {
          if (cancelled) return;
          const t = stateRef.current.currentTime;
          const pct = Math.round(Math.min(100, (t / duration) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            setExporting(true, pct);
          }
          if (t >= duration && recorder && recorder.state === 'recording') {
            recorder.stop();
            clearInterval(monitorId);
          }
        }, 100);
      });
    };

    // Seek all videos to start, then begin
    seekToStart().then(() => {
      if (!cancelled) beginCapture();
    });

    return () => {
      cancelled = true;
      exportResRef.current = null;
      if (monitorId) clearInterval(monitorId);
      setIsPlaying(false);
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isExporting]);

  // --- Layout helpers ---
  const getLayout = (cw, ch, aspect = 16 / 9) => {
    const w = cw || 640;
    const h = ch || 360;
    let pw, ph, ox, oy;
    if (w / h > aspect) {
      ph = h;
      pw = ph * aspect;
      ox = (w - pw) / 2;
      oy = 0;
    } else {
      pw = w;
      ph = pw / aspect;
      ox = 0;
      oy = (h - ph) / 2;
    }
    return { w, h, pw, ph, ox, oy };
  };

  // --- Continuous RAF draw loop ---
  // Runs independently of React renders so video frames (async decode) render
  // on the next tick after a seek, eliminating flicker.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let running = true;

    const draw = () => {
      if (!running) return;
      drawRafRef.current = requestAnimationFrame(draw);

      const s = stateRef.current;
      const { isDrawing: id, drawStart: ds, drawCurrent: dc } = drawStateRef.current;
      const { width: cw, height: ch } = containerSizeRef.current;
      const ctx = canvas.getContext('2d');

      // During export the canvas uses the higher-resolution snapshot so the
      // output quality matches the source video.
      const er = exportResRef.current;
      const layoutW = er ? er.width : cw;
      const layoutH = er ? er.height : ch;

      // Scale factor for absolute pixel values (stroke width, font size, etc.)
      // so shapes look identical at any canvas resolution.
      // During preview (er === null): canvas.width ≈ container width → scale = 1
      // During export: canvas.width = native video width (e.g., 1920px) → scale > 1
      const pxScale = er ? (layoutW / Math.max(containerSizeRef.current.width, 1)) : 1;

      // Preview-area aspect matches the first video clip's native ratio.
      // Every video on the timeline gets letterboxed/pillarboxed within this
      // frame, so the export aspect ratio is consistent regardless of clip mix.
      const firstEntry = Object.values(videoRefs.current).find(
        e => e.videoEl && e.videoEl.videoWidth > 0
      );
      const layoutAspect = firstEntry
        ? firstEntry.videoEl.videoWidth / firstEntry.videoEl.videoHeight
        : 16 / 9;

      const { w, h, pw, ph, ox, oy } = getLayout(layoutW, layoutH, layoutAspect);

      // Resize canvas if needed
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Background
      ctx.fillStyle = '#e9ecef';
      ctx.fillRect(0, 0, w, h);
      // Preview area
      ctx.fillStyle = '#111';
      ctx.fillRect(ox, oy, pw, ph);

      // Determine if we're in active crop mode (to suppress clip.crop on that clip so full content shows)
      const activeCropClipId = stateRef.current.cropMode?.active ? stateRef.current.cropMode.clipId : null;

      // === Draw active video frames (with crop clipping if applicable) ===
      s.tracks.forEach((track) => {
        if (track.type !== 'video') return;
        track.clips.forEach((clip) => {
          if (clip.type !== 'video') return;
          if (s.currentTime < clip.startTime || s.currentTime > clip.endTime) return;
          const entry = videoRefs.current[clip.id];
          const video = entry?.videoEl;
          if (!video || video.readyState < 2) return;

          const vAspect = (video.videoWidth || 1920) / (video.videoHeight || 1080);
          const pAspect = pw / ph;
          let dw, dh, dx, dy;
          if (vAspect > pAspect) {
            dh = ph; dw = dh * vAspect;
            dx = ox - (dw - pw) / 2;
            dy = oy;
          } else {
            dw = pw; dh = dw / vAspect;
            dx = ox;
            dy = oy - (dh - ph) / 2;
          }

          ctx.save();
          // Apply crop clipping if the clip has a crop (skip during active crop mode for this clip)
          if (clip.crop && clip.id !== activeCropClipId) {
            const cropPx = {
              x: ox + (clip.crop.x / 100) * pw,
              y: oy + (clip.crop.y / 100) * ph,
              width: (clip.crop.width / 100) * pw,
              height: (clip.crop.height / 100) * ph,
            };
            ctx.beginPath();
            ctx.rect(cropPx.x, cropPx.y, cropPx.width, cropPx.height);
            ctx.clip();
          }
          try { ctx.drawImage(video, dx, dy, dw, dh); } catch (_) { }
          ctx.restore();
        });
      });

      // === Draw overlays — higher track index = higher z-index (drawn last, on top) ===
      const overlayTracks = [...s.tracks].filter(t => t.type === 'overlay');
      overlayTracks.forEach((track) => {
        track.clips.forEach((clip) => {
          if (s.currentTime < clip.startTime || s.currentTime > clip.endTime) return;

          const cx = ox + (clip.x / 100) * pw;
          const cy = oy + (clip.y / 100) * ph;
          const cw2 = (clip.width / 100) * pw;
          const ch2 = (clip.height / 100) * ph;
          const rot = clip.rotation || 0;

          ctx.save();
          ctx.globalAlpha = clip.opacity ?? 1;

          // Apply crop clipping for overlay image/video clips (skip during active crop mode for this clip)
          if (clip.crop && (clip.type === 'image' || clip.type === 'video') && clip.id !== activeCropClipId) {
            const cropPx = {
              x: cx + (clip.crop.x / 100) * cw2,
              y: cy + (clip.crop.y / 100) * ch2,
              width: (clip.crop.width / 100) * cw2,
              height: (clip.crop.height / 100) * ch2,
            };
            ctx.beginPath();
            ctx.rect(cropPx.x, cropPx.y, cropPx.width, cropPx.height);
            ctx.clip();
          }

          if (rot) {
            const ctrX = cx + cw2 / 2;
            const ctrY = cy + ch2 / 2;
            ctx.translate(ctrX, ctrY);
            ctx.rotate((rot * Math.PI) / 180);
            ctx.translate(-ctrX, -ctrY);
          }

          const isFill = clip.fillColor !== 'transparent';
          switch (clip.type) {
            case 'rect':
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
              if (isFill) ctx.fillStyle = clip.fillColor || 'rgba(255,0,0,0.2)';
              if (clip.borderRadius > 0) {
                roundRect(ctx, cx, cy, cw2, ch2, (clip.borderRadius / 20) * Math.min(cw2, ch2));
              } else {
                if (isFill) ctx.fillRect(cx, cy, cw2, ch2);
                ctx.strokeRect(cx, cy, cw2, ch2);
              }
              break;
            case 'circle':
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
              ctx.beginPath();
              ctx.ellipse(cx + cw2 / 2, cy + ch2 / 2, cw2 / 2, ch2 / 2, 0, 0, Math.PI * 2);
              if (isFill) { ctx.fillStyle = clip.fillColor || 'rgba(255,0,0,0.2)'; ctx.fill(); }
              ctx.stroke();
              break;
            case 'triangle':
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
              ctx.beginPath();
              ctx.moveTo(cx + cw2 / 2, cy);
              ctx.lineTo(cx + cw2, cy + ch2);
              ctx.lineTo(cx, cy + ch2);
              ctx.closePath();
              if (isFill) { ctx.fillStyle = clip.fillColor || 'rgba(255,0,0,0.2)'; ctx.fill(); }
              ctx.stroke();
              break;
            case 'arrow': {
              let ax, ay, bx, by;
              if (clip.x1 !== undefined && clip.y1 !== undefined && clip.x2 !== undefined && clip.y2 !== undefined) {
                ax = ox + (clip.x1 / 100) * pw;
                ay = oy + (clip.y1 / 100) * ph;
                bx = ox + (clip.x2 / 100) * pw;
                by = oy + (clip.y2 / 100) * ph;
              } else {
                // Backward compat: old direction-based system
                const dx = clip.directionX ?? 1;
                const dy = clip.directionY ?? 1;
                ax = cx + (dx < 0 ? cw2 : 0);
                ay = cy + (dy < 0 ? ch2 : 0);
                bx = cx + (dx < 0 ? 0 : cw2);
                by = cy + (dy < 0 ? 0 : ch2);
              }
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
              ctx.fillStyle = clip.strokeColor || '#ff0000';
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              const ang = Math.atan2((by - ay), (bx - ax));
              const hl = Math.max(8 * pxScale, Math.hypot(bx - ax, by - ay) * 0.12);
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(bx - hl * Math.cos(ang - Math.PI / 6), by - hl * Math.sin(ang - Math.PI / 6));
              ctx.lineTo(bx - hl * Math.cos(ang + Math.PI / 6), by - hl * Math.sin(ang + Math.PI / 6));
              ctx.closePath();
              ctx.fill();
              break;
            }
            case 'line': {
              let ax, ay, bx, by;
              if (clip.x1 !== undefined && clip.y1 !== undefined && clip.x2 !== undefined && clip.y2 !== undefined) {
                ax = ox + (clip.x1 / 100) * pw;
                ay = oy + (clip.y1 / 100) * ph;
                bx = ox + (clip.x2 / 100) * pw;
                by = oy + (clip.y2 / 100) * ph;
              } else {
                // Backward compat: old direction-based system
                const dx = clip.directionX ?? 1;
                const dy = clip.directionY ?? 1;
                ax = cx + (dx < 0 ? cw2 : 0);
                ay = cy + (dy < 0 ? ch2 : 0);
                bx = cx + (dx < 0 ? 0 : cw2);
                by = cy + (dy < 0 ? 0 : ch2);
              }
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              break;
            }
            case 'pen': {
              // Freehand drawing — stroke through all stored percentage points
              const pts = clip.points || [];
              if (pts.length > 1) {
                ctx.strokeStyle = clip.strokeColor || '#ff0000';
                ctx.lineWidth = (clip.strokeWidth || 2) * pxScale;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                // Points are stored normalized (relative to bounding box 0,0)
                // so add clip.x/clip.y offset
                const xOff = clip.x || 0;
                const yOff = clip.y || 0;
                ctx.moveTo(ox + ((xOff + pts[0].x) / 100) * pw, oy + ((yOff + pts[0].y) / 100) * ph);
                for (let i = 1; i < pts.length; i++) {
                  ctx.lineTo(ox + ((xOff + pts[i].x) / 100) * pw, oy + ((yOff + pts[i].y) / 100) * ph);
                }
                ctx.stroke();
              }
              break;
            }
            case 'text':
              ctx.fillStyle = clip.color || '#ffffff';
              ctx.font = `${(clip.fontSize || 24) * pxScale}px ${clip.fontFamily || 'Arial'}`;
              ctx.fillText(clip.text || 'Text', cx, cy + (clip.fontSize || 24) * pxScale);
              break;
            case 'image':
              const imgEl = document.getElementById(`overlay-img-${clip.id}`);
              if (imgEl?.complete && imgEl.naturalWidth) {
                ctx.drawImage(imgEl, cx, cy, cw2, ch2);
              } else {
                ctx.fillStyle = 'rgba(100,100,100,0.5)';
                ctx.fillRect(cx, cy, cw2, ch2);
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 1;
                ctx.strokeRect(cx, cy, cw2, ch2);
              }
              break;
            case 'video': {
              const entry = videoRefs.current[clip.id];
              const video = entry?.videoEl;
              if (video && video.readyState >= 2) {
                ctx.drawImage(video, cx, cy, cw2, ch2);
              } else {
                ctx.fillStyle = 'rgba(100,100,100,0.5)';
                ctx.fillRect(cx, cy, cw2, ch2);
              }
              break;
            }
            default:
              break;
          }

          ctx.restore();

          // === Selection handles (hidden during export) ===
          if (!er && clip.id === s.selectedElementId) {
            const pad = 4;
            const sx = cx - pad;
            const sy = cy - pad;
            const shw = cw2 + pad * 2;
            const shh = ch2 + pad * 2;
            const ctrX = cx + cw2 / 2;
            const ctrY = cy + ch2 / 2;

            ctx.save();
            if (rot) {
              ctx.translate(ctrX, ctrY);
              ctx.rotate((rot * Math.PI) / 180);
              ctx.translate(-ctrX, -ctrY);
            }

            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(sx, sy, shw, shh);
            ctx.setLineDash([]);

            const handles = [
              { x: sx, y: sy }, { x: sx + shw / 2, y: sy }, { x: sx + shw, y: sy },
              { x: sx + shw, y: sy + shh / 2 }, { x: sx + shw, y: sy + shh },
              { x: sx + shw / 2, y: sy + shh }, { x: sx, y: sy + shh }, { x: sx, y: sy + shh / 2 },
            ];
            handles.forEach((h) => {
              ctx.fillStyle = '#fff';
              ctx.strokeStyle = '#4a9eff';
              ctx.lineWidth = 1.5;
              ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
              ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            });

            const rotX = sx + shw / 2;
            const rotY = sy - ROTATE_HANDLE_OFFSET;
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(sx + shw / 2, sy);
            ctx.lineTo(rotX, rotY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(rotX, rotY, HANDLE_SIZE / 2 + 2, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#4a9eff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('↻', rotX, rotY);

            ctx.restore();
          }
        });
      });

      // === Multi-selection highlight ===
      const selIds = s.selectedElementIds || [];
      if (selIds.length > 1) {
        overlayTracks.forEach((track) => {
          track.clips.forEach((clip) => {
            if (!selIds.includes(clip.id)) return;
            if (s.currentTime < clip.startTime || s.currentTime > clip.endTime) return;
            const cx = ox + (clip.x / 100) * pw;
            const cy = oy + (clip.y / 100) * ph;
            const cw2 = (clip.width / 100) * pw;
            const ch2 = (clip.height / 100) * ph;
            ctx.save();
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(cx, cy, cw2, ch2);
            ctx.setLineDash([]);
            ctx.restore();
          });
        });
      }


      // === In-progress drawing ===
      if (id && s.tool !== 'select') {
        ctx.save();
        if (s.tool === 'pen') {
          // Draw freehand path from collected points
          const pts = drawStateRef.current.penPoints || [];
          if (pts.length > 1) {
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();
          }
        } else {
          const dx2 = ds.x;
          const dy2 = ds.y;
          const dw2 = dc.x - dx2;
          const dh2 = dc.y - dy2;

          ctx.strokeStyle = '#4a9eff';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.fillStyle = 'rgba(74,158,255,0.1)';
          switch (s.tool) {
            case 'rect': case 'text': case 'image':
              ctx.fillRect(dx2, dy2, dw2, dh2);
              ctx.strokeRect(dx2, dy2, dw2, dh2);
              break;
            case 'circle':
              ctx.beginPath();
              ctx.ellipse(dx2 + dw2 / 2, dy2 + dh2 / 2, Math.abs(dw2 / 2), Math.abs(dh2 / 2), 0, 0, Math.PI * 2);
              ctx.fill(); ctx.stroke();
              break;
            case 'triangle':
              ctx.beginPath();
              ctx.moveTo(dx2 + dw2 / 2, dy2);
              ctx.lineTo(dx2 + dw2, dy2 + dh2);
              ctx.lineTo(dx2, dy2 + dh2);
              ctx.closePath();
              ctx.fill(); ctx.stroke();
              break;
            case 'arrow': case 'line':
              ctx.beginPath();
              ctx.moveTo(dx2, dy2);
              ctx.lineTo(dx2 + dw2, dy2 + dh2);
              ctx.stroke();
              break;
            default:
              break;
          }
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // Thirds grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const gx = ox + (pw / 3) * i;
        const gy = oy + (ph / 3) * i;
        ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx, oy + ph); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, gy); ctx.lineTo(ox + pw, gy); ctx.stroke();
      }

      // === Alignment guide lines (solid bright cyan, drawn on top of everything) ===
      const activeGuides = guidesRef.current;
      if (activeGuides.length > 0) {
        ctx.save();
        // Use bright cyan with high opacity so it's unmistakable on dark bg
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        // Solid lines — dashes may be harder to spot
        ctx.setLineDash([]);
        // Draw on top by using source-over (default)
        ctx.globalCompositeOperation = 'source-over';
        activeGuides.forEach((g) => {
          if (g.type === 'v') {
            ctx.beginPath();
            ctx.moveTo(g.pos, oy);
            ctx.lineTo(g.pos, oy + ph);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(ox, g.pos);
            ctx.lineTo(ox + pw, g.pos);
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      // === Multi-select rectangle ===
      const mr = multiRectRef.current;
      if (mr && (mr.w > 2 || mr.h > 2)) {
        ctx.save();
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.fillStyle = 'rgba(74,158,255,0.08)';
        const rx = Math.min(mr.x, mr.x + mr.w);
        const ry = Math.min(mr.y, mr.y + mr.h);
        ctx.fillRect(rx, ry, mr.w, mr.h);
        ctx.strokeRect(rx, ry, mr.w, mr.h);
        ctx.setLineDash([]);
        ctx.restore();
      }

      // === Crop mode overlay (drawn on top of everything) ===
      const cropMode = stateRef.current.cropMode;
      if (cropMode && cropMode.active) {
        // Find the clip being cropped
        let cropClip = null;
        let cropTrackId = null;
        s.tracks.forEach((track) => {
          track.clips.forEach((clip) => {
            if (clip.id === cropMode.clipId) {
              cropClip = clip;
              cropTrackId = track.id;
            }
          });
        });

        if (cropClip) {
          const isOverlayTrack = s.tracks.find(t => t.id === cropTrackId)?.type === 'overlay';
          let bx, by, bw, bh;

          if (isOverlayTrack) {
            bx = ox + (cropClip.x / 100) * pw;
            by = oy + (cropClip.y / 100) * ph;
            bw = (cropClip.width / 100) * pw;
            bh = (cropClip.height / 100) * ph;
          } else {
            bx = ox; by = oy; bw = pw; bh = ph;
          }

          // Calculate crop rect in canvas pixels
          const cr = cropMode.cropRect || { x: 0, y: 0, width: 100, height: 100 };
          const cropPx = {
            x: bx + (cr.x / 100) * bw,
            y: by + (cr.y / 100) * bh,
            width: (cr.width / 100) * bw,
            height: (cr.height / 100) * bh,
          };

          // Draw dimmed overlay with "hole" — 4 rectangles around the crop area
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          // Top
          ctx.fillRect(0, 0, w, cropPx.y);
          // Bottom
          ctx.fillRect(0, cropPx.y + cropPx.height, w, h - (cropPx.y + cropPx.height));
          // Left
          ctx.fillRect(0, cropPx.y, cropPx.x, cropPx.height);
          // Right
          ctx.fillRect(cropPx.x + cropPx.width, cropPx.y, w - (cropPx.x + cropPx.width), cropPx.height);
          ctx.restore();

          // Crop rect border
          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(cropPx.x, cropPx.y, cropPx.width, cropPx.height);
          ctx.restore();

          // Crop resize handles (8 handles like regular resize)
          const handleSize = 10;
          const handles = [
            { id: 'nw', x: cropPx.x, y: cropPx.y },
            { id: 'n', x: cropPx.x + cropPx.width / 2, y: cropPx.y },
            { id: 'ne', x: cropPx.x + cropPx.width, y: cropPx.y },
            { id: 'e', x: cropPx.x + cropPx.width, y: cropPx.y + cropPx.height / 2 },
            { id: 'se', x: cropPx.x + cropPx.width, y: cropPx.y + cropPx.height },
            { id: 's', x: cropPx.x + cropPx.width / 2, y: cropPx.y + cropPx.height },
            { id: 'sw', x: cropPx.x, y: cropPx.y + cropPx.height },
            { id: 'w', x: cropPx.x, y: cropPx.y + cropPx.height / 2 },
          ];
          handles.forEach((h) => {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 1.5;
            ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
          });
        }
      }
    };

    drawRafRef.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(drawRafRef.current);
    };
  }, []); // Runs once — reads everything from refs

  // --- Mouse helpers ---
  const getCanvasPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const computeLayout = useCallback(() => {
    return getLayout(containerSize.width, containerSize.height);
  }, [containerSize]);

  const canvasToPct = useCallback((cx, cy) => {
    const { pw, ph, ox, oy } = computeLayout();
    return {
      x: ((cx - ox) / pw) * 100,
      y: ((cy - oy) / ph) * 100,
      pw, ph, ox, oy,
    };
  }, [computeLayout]);

  // Point-to-line-segment distance squared (avoids sqrt for perf)
  const ptSegDistSq = useCallback((px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) { const ddx = px - ax, ddy = py - ay; return ddx * ddx + ddy * ddy; }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nearX = ax + t * dx;
    const nearY = ay + t * dy;
    const ddx2 = px - nearX, ddy2 = py - nearY;
    return ddx2 * ddx2 + ddy2 * ddy2;
  }, []);

  // Find overlay clip at position (IGNORES time range — selectable anytime)
  const findClipAtPos = useCallback((cx, cy) => {
    const pct = canvasToPct(cx, cy);
    let found = [];
    state.tracks.forEach((track) => {
      if (track.type !== 'overlay') return;
      track.clips.forEach((clip) => {
        let hit = false;
        if (clip.type === 'line' || clip.type === 'arrow') {
          // Use point-to-segment distance for precise hit testing
          const ax = clip.x1 ?? (clip.directionX < 0 ? clip.x + clip.width : clip.x);
          const ay = clip.y1 ?? (clip.directionY < 0 ? clip.y + clip.height : clip.y);
          const bx = clip.x2 ?? (clip.directionX < 0 ? clip.x : clip.x + clip.width);
          const by = clip.y2 ?? (clip.directionY < 0 ? clip.y : clip.y + clip.height);
          // 1.5% of canvas = roughly 15px at 1000px — generous hit area
          const threshold = 1.5;
          hit = ptSegDistSq(pct.x, pct.y, ax, ay, bx, by) <= threshold * threshold;
        } else {
          hit = pct.x >= clip.x && pct.x <= clip.x + clip.width &&
            pct.y >= clip.y && pct.y <= clip.y + clip.height;
        }
        if (hit) {
          found.push({ clip, trackId: track.id });
        }
      });
    });
    return found.length > 0 ? found[found.length - 1] : null;
  }, [state.tracks, canvasToPct, ptSegDistSq]);

  // Find handle on a clip
  const findHandle = useCallback((cx, cy, clip) => {
    const { pw, ph, ox, oy } = computeLayout();
    const cCx = ox + (clip.x / 100) * pw;
    const cCy = oy + (clip.y / 100) * ph;
    const cw = (clip.width / 100) * pw;
    const ch = (clip.height / 100) * ph;
    const pad = 4;
    const sx = cCx - pad;
    const sy = cCy - pad;
    const shw = cw + pad * 2;
    const shh = ch + pad * 2;
    const ctrX = cCx + cw / 2;
    const ctrY = cCy + ch / 2;
    const rot = clip.rotation || 0;

    let tx = cx, ty = cy;
    if (rot) {
      const a = (-rot * Math.PI) / 180;
      const dx2 = cx - ctrX;
      const dy2 = cy - ctrY;
      tx = ctrX + dx2 * Math.cos(a) - dy2 * Math.sin(a);
      ty = ctrY + dx2 * Math.sin(a) + dy2 * Math.cos(a);
    }

    const rX = sx + shw / 2;
    const rY = sy - ROTATE_HANDLE_OFFSET;
    if (Math.hypot(tx - rX, ty - rY) <= HANDLE_SIZE + 5) return { type: 'rotate' };

    const hList = [
      { id: 'nw', x: sx, y: sy },
      { id: 'n', x: sx + shw / 2, y: sy },
      { id: 'ne', x: sx + shw, y: sy },
      { id: 'e', x: sx + shw, y: sy + shh / 2 },
      { id: 'se', x: sx + shw, y: sy + shh },
      { id: 's', x: sx + shw / 2, y: sy + shh },
      { id: 'sw', x: sx, y: sy + shh },
      { id: 'w', x: sx, y: sy + shh / 2 },
    ];
    for (const h of hList) {
      if (Math.hypot(tx - h.x, ty - h.y) <= HANDLE_SIZE + 4) return { type: 'resize', handleId: h.id };
    }
    return null;
  }, [computeLayout]);

  const getSelected = useCallback(() => {
    if (!state.selectedElementId) return null;
    for (const t of state.tracks) {
      const c = t.clips.find(cl => cl.id === state.selectedElementId);
      if (c) return { clip: c, trackId: t.id };
    }
    return null;
  }, [state.selectedElementId, state.tracks]);

  // --- Crop mode helpers ---
  const getCropClipLayout = useCallback(() => {
    if (!state.cropMode?.active) return null;
    const { pw, ph, ox, oy } = computeLayout();
    let cropClip = null;
    let cropTrackId = null;
    state.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip.id === state.cropMode.clipId) {
          cropClip = clip;
          cropTrackId = track.id;
        }
      });
    });
    if (!cropClip) return null;
    const isOverlayTrack = state.tracks.find(t => t.id === cropTrackId)?.type === 'overlay';
    let cx, cy, cw2, ch2;
    if (isOverlayTrack) {
      cx = ox + (cropClip.x / 100) * pw;
      cy = oy + (cropClip.y / 100) * ph;
      cw2 = (cropClip.width / 100) * pw;
      ch2 = (cropClip.height / 100) * ph;
    } else {
      cx = ox; cy = oy; cw2 = pw; ch2 = ph;
    }
    const cr = state.cropMode.cropRect || { x: 0, y: 0, width: 100, height: 100 };
    return {
      cx, cy, cw: cw2, ch: ch2, pw, ph, ox, oy, cropRect: cr,
      cropPx: {
        x: cx + (cr.x / 100) * cw2,
        y: cy + (cr.y / 100) * ch2,
        width: (cr.width / 100) * cw2,
        height: (cr.height / 100) * ch2,
      },
    };
  }, [state.cropMode, state.tracks, computeLayout]);

  const findCropHandle = useCallback((cx, cy, layout) => {
    if (!layout) return null;
    const { cropPx } = layout;
    const handleSize = 10;
    const handles = [
      { id: 'nw', x: cropPx.x, y: cropPx.y },
      { id: 'n', x: cropPx.x + cropPx.width / 2, y: cropPx.y },
      { id: 'ne', x: cropPx.x + cropPx.width, y: cropPx.y },
      { id: 'e', x: cropPx.x + cropPx.width, y: cropPx.y + cropPx.height / 2 },
      { id: 'se', x: cropPx.x + cropPx.width, y: cropPx.y + cropPx.height },
      { id: 's', x: cropPx.x + cropPx.width / 2, y: cropPx.y + cropPx.height },
      { id: 'sw', x: cropPx.x, y: cropPx.y + cropPx.height },
      { id: 'w', x: cropPx.x, y: cropPx.y + cropPx.height / 2 },
    ];
    for (const h of handles) {
      if (Math.hypot(cx - h.x, cy - h.y) <= handleSize + 4) return h.id;
    }
    return null;
  }, []);

  // --- Mouse events ---
  const handleMouseDown = useCallback((e) => {
    // If in crop mode, handle crop rect resizing
    if (state.cropMode?.active) {
      const pos = getCanvasPos(e);
      const layout = getCropClipLayout();
      if (layout) {
        const handleId = findCropHandle(pos.x, pos.y, layout);
        if (handleId) {
          setCropInteraction({
            handleId,
            startX: pos.x,
            startY: pos.y,
            startCropRect: { ...layout.cropRect },
            layout,
          });
          e.stopPropagation();
          return;
        }
      }
      canvasRef.current?.focus();
      e.stopPropagation();
      return;
    }

    // Auto-focus canvas so keyboard Delete/Backspace works after click
    canvasRef.current?.focus();
    const pos = getCanvasPos(e);
    const curSelIds = stateRef.current.selectedElementIds || [];
    const isMulti = curSelIds.length > 0;
    if (state.tool === 'select') {
      const sel = getSelected();
      if (sel) {
        const h = findHandle(pos.x, pos.y, sel.clip);
        if (h) {
          setInteraction({
            type: h.type,
            clipId: sel.clip.id,
            trackId: sel.trackId,
            handleId: h.handleId || null,
            startX: pos.x,
            startY: pos.y,
            startClip: { ...sel.clip },
          });
          e.stopPropagation();
          return;
        }
      }
      const found = findClipAtPos(pos.x, pos.y);
      if (found) {
        // Shift+click → additive toggle only, no drag start
        if (e.shiftKey) {
          selectElement(found.clip.id, true);
          e.stopPropagation();
          return;
        }
        // Click on an already-selected clip → keep multi-selection, drag all together
        if (isMulti && curSelIds.includes(found.clip.id)) {
          // Don't call selectElement — selection stays as-is
        } else {
          // Click on a non-selected clip → select just this one
          selectElement(found.clip.id);
        }
        // Snapshot all selected clip starting positions for consistent multi-drag
        const otherMultiIds = (isMulti && curSelIds.includes(found.clip.id))
          ? curSelIds.filter(id => id !== found.clip.id)
          : [];
        const snapshots = {};
        if (otherMultiIds.length > 0) {
          stateRef.current.tracks.forEach(t => {
            if (t.type !== 'overlay') return;
            t.clips.forEach(c => {
              if (otherMultiIds.includes(c.id)) {
                snapshots[c.id] = { x: c.x, y: c.y, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 };
              }
            });
          });
        }
        multiDragRef.current = snapshots;

        // Start drag interaction for this clip
        setInteraction({
          type: 'drag',
          clipId: found.clip.id,
          trackId: found.trackId,
          startX: pos.x,
          startY: pos.y,
          startClip: { ...found.clip },
          multiIds: otherMultiIds,
        });
      } else {
        // No clip hit → start multi-select rectangle
        deselectAll();
        setMultiRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      }
    } else {
      setIsDrawing(true);
      setDrawStart(pos);
      setDrawCurrent(pos);
      if (state.tool === 'pen') {
        penPointsRef.current = [pos];
      }
    }
  }, [state.tool, state.cropMode, getCanvasPos, getSelected, findHandle, findClipAtPos, selectElement, deselectAll, getCropClipLayout, findCropHandle]);

  // Snapping and guide generation for drag/resize alignment
  const SNAP_THRESHOLD_PX = 8;

  const computeSnap = useCallback((curBounds, pw, ph, ox, oy, interactingClipId) => {
    const guides = [];
    let bestDx = 0;
    let bestDy = 0;
    let snappedX = curBounds.x;
    let snappedY = curBounds.y;

    // Current element edges in percentage
    const cL = curBounds.x;
    const cR = curBounds.x + curBounds.width;
    const cC = curBounds.x + curBounds.width / 2;
    const cT = curBounds.y;
    const cB = curBounds.y + curBounds.height;
    const cM = curBounds.y + curBounds.height / 2;

    // Threshold in percentage (convert pixel threshold to percentage of preview area)
    const thX = (SNAP_THRESHOLD_PX / pw) * 100;
    const thY = (SNAP_THRESHOLD_PX / ph) * 100;

    // Collect overlay clips in preview area (exclude self)
    const overlays = [];
    const s = stateRef.current;
    s.tracks.forEach(t => {
      if (t.type !== 'overlay') return;
      t.clips.forEach(cl => {
        if (cl.id === interactingClipId) return;
        overlays.push(cl);
      });
    });

    // Candidate list: { delta, guidePx, type }
    const xCandidates = [];
    const yCandidates = [];

    // Check vertical alignment: our edge vs their edge/location
    const addX = (ourEdge, theirX) => {
      const d = theirX - ourEdge;
      if (Math.abs(d) < thX) {
        const guidePx = (theirX / 100) * pw + ox;
        xCandidates.push({ delta: d, guidePx });
      }
    };

    // Check horizontal alignment
    const addY = (ourEdge, theirY) => {
      const d = theirY - ourEdge;
      if (Math.abs(d) < thY) {
        const guidePx = (theirY / 100) * ph + oy;
        yCandidates.push({ delta: d, guidePx });
      }
    };

    // Check against canvas center
    addX(cL, 50); addX(cC, 50); addX(cR, 50);
    addY(cT, 50); addY(cM, 50); addY(cB, 50);

    // Check against all other overlays
    overlays.forEach(cl => {
      const oL = cl.x;
      const oR = cl.x + cl.width;
      const oC = cl.x + cl.width / 2;
      const oT = cl.y;
      const oB = cl.y + cl.height;
      const oM = cl.y + cl.height / 2;

      addX(cL, oL); addX(cL, oC); addX(cL, oR);
      addX(cC, oL); addX(cC, oC); addX(cC, oR);
      addX(cR, oL); addX(cR, oC); addX(cR, oR);

      addY(cT, oT); addY(cT, oM); addY(cT, oB);
      addY(cM, oT); addY(cM, oM); addY(cM, oB);
      addY(cB, oT); addY(cB, oM); addY(cB, oB);
    });

    // Pick the nearest snap in each axis
    if (xCandidates.length > 0) {
      xCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      bestDx = xCandidates[0].delta;
      snappedX = curBounds.x + bestDx;
      // Add guide for the nearest V snap
      guides.push({ type: 'v', pos: xCandidates[0].guidePx });
    }
    if (yCandidates.length > 0) {
      yCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      bestDy = yCandidates[0].delta;
      snappedY = curBounds.y + bestDy;
      // Add guide for the nearest H snap
      guides.push({ type: 'h', pos: yCandidates[0].guidePx });
    }

    return { sx: snappedX, sy: snappedY, guides };
  }, []);

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e);
    if (isDrawing) {
      setDrawCurrent(pos);
      if (penPointsRef.current) {
        penPointsRef.current = [...penPointsRef.current, pos];
      }
      return;
    }
    // Crop mode crop rect resize
    if (cropInteraction) {
      const { handleId, startX, startY, startCropRect, layout } = cropInteraction;
      const {
        // cx, cy, 
        cw, ch } = layout;
      const pctDx = ((pos.x - startX) / cw) * 100;
      const pctDy = ((pos.y - startY) / ch) * 100;

      let nx = startCropRect.x;
      let ny = startCropRect.y;
      let nw = startCropRect.width;
      let nh = startCropRect.height;

      const h = handleId || '';
      if (h.includes('n')) { ny = startCropRect.y + pctDy; nh = startCropRect.height - pctDy; }
      if (h.includes('s')) { nh = startCropRect.height + pctDy; }
      if (h.includes('w')) { nx = startCropRect.x + pctDx; nw = startCropRect.width - pctDx; }
      if (h.includes('e')) { nw = startCropRect.width + pctDx; }

      // Clamp
      if (nw < 5) nw = 5;
      if (nh < 5) nh = 5;
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      if (nx + nw > 100) nw = 100 - nx;
      if (ny + nh > 100) nh = 100 - ny;

      updateCropRect({ x: nx, y: ny, width: nw, height: nh });
      return;
    }
    // Multi-select rectangle drag
    if (multiRect && !interaction) {
      const mw = Math.abs(pos.x - multiRect.x);
      const mh = Math.abs(pos.y - multiRect.y);
      setMultiRect({ x: multiRect.x, y: multiRect.y, w: mw, h: mh });
      return;
    }
    if (!interaction) return;

    const { pw, ph, ox, oy } = computeLayout();
    const shift = shiftRef.current;

    if (interaction.type === 'drag') {
      const dx = ((pos.x - interaction.startX) / pw) * 100;
      const dy = ((pos.y - interaction.startY) / ph) * 100;
      const sc = interaction.startClip;

      // Shift-constrain: lock to the axis with larger movement
      let fx = dx, fy = dy;
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) {
          fy = 0;
        } else {
          fx = 0;
        }
      }

      const nx = Math.max(0, Math.min(100 - sc.width, sc.x + fx));
      const ny = Math.max(0, Math.min(100 - sc.height, sc.y + fy));

      // Alignment snap
      const { sx: snapX, sy: snapY, guides: newGuides } = computeSnap(
        { x: nx, y: ny, width: sc.width, height: sc.height },
        pw, ph, ox, oy, interaction.clipId
      );

      const finalX = Math.max(0, Math.min(100 - sc.width, snapX));
      const finalY = Math.max(0, Math.min(100 - sc.height, snapY));

      // Actual delta applied (after clamping/snapping)
      const appliedDx = finalX - sc.x;
      const appliedDy = finalY - sc.y;

      // Move the dragged clip
      const patch = { x: finalX, y: finalY };
      // Keep line/arrow endpoints in sync with bounding box
      if (sc.x1 !== undefined) patch.x1 = (sc.x1 ?? 0) + appliedDx;
      if (sc.y1 !== undefined) patch.y1 = (sc.y1 ?? 0) + appliedDy;
      if (sc.x2 !== undefined) patch.x2 = (sc.x2 ?? 0) + appliedDx;
      if (sc.y2 !== undefined) patch.y2 = (sc.y2 ?? 0) + appliedDy;
      updateClip(interaction.clipId, patch);

      // Move all other selected clips by the same delta (using snapshots from mousedown)
      const multiIds = interaction.multiIds || stateRef.current.selectedElementIds.filter(id => id !== interaction.clipId);
      if (multiIds.length > 0) {
        const snapshots = multiDragRef.current || {};
        multiIds.forEach(id => {
          const s = snapshots[id];
          if (!s) return;
          const cp = { x: s.x + appliedDx, y: s.y + appliedDy };
          // Clamp (need real clip width/height from current state)
          let clipData = null;
          stateRef.current.tracks.forEach(t => {
            if (t.type !== 'overlay') return;
            const c = t.clips.find(cl => cl.id === id);
            if (c) clipData = c;
          });
          if (clipData) {
            cp.x = Math.max(0, Math.min(100 - clipData.width, cp.x));
            cp.y = Math.max(0, Math.min(100 - clipData.height, cp.y));
          }
          // Sync endpoints from snapshot
          if (s.x1 !== undefined) cp.x1 = (s.x1 ?? 0) + appliedDx;
          if (s.y1 !== undefined) cp.y1 = (s.y1 ?? 0) + appliedDy;
          if (s.x2 !== undefined) cp.x2 = (s.x2 ?? 0) + appliedDx;
          if (s.y2 !== undefined) cp.y2 = (s.y2 ?? 0) + appliedDy;
          updateClip(id, cp);
        });
      }

      guidesRef.current = newGuides;
      setGuides(newGuides);
    } else if (interaction.type === 'resize') {
      let dx = ((pos.x - interaction.startX) / pw) * 100;
      let dy = ((pos.y - interaction.startY) / ph) * 100;
      const sc = interaction.startClip;

      // Shift-constrain resize: lock to dominant axis
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) {
          dy = 0;
        } else {
          dx = 0;
        }
      }

      let nx = sc.x, ny = sc.y, nw = sc.width, nh = sc.height;
      const h = interaction.handleId || '';
      if (h.includes('n')) { ny = sc.y + dy; nh = sc.height - dy; }
      if (h.includes('s')) { nh = sc.height + dy; }
      if (h.includes('w')) { nx = sc.x + dx; nw = sc.width - dx; }
      if (h.includes('e')) { nw = sc.width + dx; }
      if (nw < 2) nw = 2;
      if (nh < 2) nh = 2;
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      nw = Math.min(nw, 100 - nx);
      nh = Math.min(nh, 100 - ny);

      // Snap resize edges
      const { sx: snapX, sy: snapY, guides: newGuides } = computeSnap(
        { x: nx, y: ny, width: nw, height: nh },
        pw, ph, ox, oy, interaction.clipId
      );

      // Only apply snap to the edges that are being moved
      let fnx = nx, fny = ny, fnw = nw, fnh = nh;
      if (snapX !== nx) {
        if (h.includes('w')) {
          const oldR = nx + nw;
          fnx = snapX;
          fnw = Math.max(2, oldR - snapX);
        } else if (h.includes('e')) {
          fnw = Math.max(2, snapX + nw - nx);
        }
      }
      if (snapY !== ny) {
        if (h.includes('n')) {
          const oldB = ny + nh;
          fny = snapY;
          fnh = Math.max(2, oldB - snapY);
        } else if (h.includes('s')) {
          fnh = Math.max(2, snapY + nh - ny);
        }
      }

      // For video/image overlays, optionally lock aspect ratio
      const lockAR = sc.lockAspectRatio !== false;
      if (lockAR && (sc.type === 'video' || sc.type === 'image')) {
        const frameAspect = 16 / 9;
        const ref = sc.type === 'video'
          ? state.videos.find(v => v.id === sc.videoId)
          : state.images.find(v => v.id === sc.imageId);
        const mw = ref?.width || 1920;
        const mh = ref?.height || 1080;
        if (mw && mh) {
          const mediaAspect = mw / mh;
          const ratio = mediaAspect / frameAspect;
          const isCorner = (h.includes('n') || h.includes('s')) && (h.includes('e') || h.includes('w'));
          if (isCorner) {
            const dwAbs = Math.abs(fnw - sc.width);
            const dhAbs = Math.abs(fnh - sc.height);
            if (dwAbs / Math.max(sc.width, 1) > dhAbs / Math.max(sc.height, 1)) {
              fnh = fnw / ratio;
            } else {
              fnw = fnh * ratio;
            }
          } else if (h.includes('e') || h.includes('w')) {
            fnh = fnw / ratio;
          } else if (h.includes('n') || h.includes('s')) {
            fnw = fnh * ratio;
          }
        }
      }

      const patch = { x: fnx, y: fny, width: fnw, height: fnh };
      // Keep line/arrow endpoints in sync with resized bounding box
      if (sc.x1 !== undefined && sc.width > 0 && sc.height > 0) {
        const rx1 = (sc.x1 - sc.x) / sc.width;
        const ry1 = (sc.y1 - sc.y) / sc.height;
        const rx2 = (sc.x2 - sc.x) / sc.width;
        const ry2 = (sc.y2 - sc.y) / sc.height;
        patch.x1 = fnx + rx1 * fnw;
        patch.y1 = fny + ry1 * fnh;
        patch.x2 = fnx + rx2 * fnw;
        patch.y2 = fny + ry2 * fnh;
      }
      updateClip(interaction.clipId, patch);

      guidesRef.current = newGuides;
      setGuides(newGuides);
    } else if (interaction.type === 'rotate') {
      const sc = interaction.startClip;
      const ctrX = ox + (sc.x / 100) * pw + (sc.width / 100) * pw / 2;
      const ctrY = oy + (sc.y / 100) * ph + (sc.height / 100) * ph / 2;
      const startA = Math.atan2(interaction.startY - ctrY, interaction.startX - ctrX);
      const curA = Math.atan2(pos.y - ctrY, pos.x - ctrX);
      let deg = (interaction.startClip.rotation || 0) + ((curA - startA) * 180) / Math.PI;
      for (const snap of [-360, -315, -270, -225, -180, -135, -90, -45, 0, 45, 90, 135, 180, 225, 270, 315, 360]) {
        if (Math.abs(deg - snap) < 5) { deg = snap; break; }
      }
      updateClip(interaction.clipId, { rotation: deg });
    }
  }, [isDrawing, interaction, getCanvasPos, computeLayout, updateClip, computeSnap, state.videos, state.images, multiRect, cropInteraction, updateCropRect]);

  const handleMouseUp = useCallback((e) => {
    // Crop mode — just end crop interaction
    if (cropInteraction) {
      setCropInteraction(null);
      return;
    }

    // Finalize multi-select rectangle
    if (multiRect) {
      const mr = multiRect;
      setMultiRect(null);
      if (mr.w > 5 || mr.h > 5) {
        const { pw, ph, ox, oy } = computeLayout();
        const rLeft = ((mr.x - ox) / pw) * 100;
        const rTop = ((mr.y - oy) / ph) * 100;
        const rRight = ((mr.x + mr.w - ox) / pw) * 100;
        const rBottom = ((mr.y + mr.h - oy) / ph) * 100;
        // Find overlay clips that intersect the rectangle
        const hits = [];
        state.tracks.forEach(t => {
          if (t.type !== 'overlay') return;
          t.clips.forEach(c => {
            if (c.type === 'video') return;
            // Simple AABB overlap (only overlay shapes)
            const overlap = c.x < rRight && (c.x + c.width) > rLeft &&
              c.y < rBottom && (c.y + c.height) > rTop;
            if (overlap) hits.push(c.id);
          });
        });
        if (hits.length > 0) {
          setSelectedIds(hits);
        }
      }
      return;
    }

    if (isDrawing) {
      const pos = getCanvasPos(e);
      const startPct = canvasToPct(drawStart.x, drawStart.y);
      const endPct = canvasToPct(pos.x, pos.y);
      const wPct = Math.abs(endPct.x - startPct.x);
      const hPct = Math.abs(endPct.y - startPct.y);

      if (state.tool === 'pen') {
        // Create pen overlay from collected points
        const points = penPointsRef.current || [];
        penPointsRef.current = [];
        if (points.length > 1) {
          // Convert canvas-pixel points to percentage coordinates
          const pctPoints = points.map(p => {
            const pct = canvasToPct(p.x, p.y);
            return { x: pct.x, y: pct.y };
          });
          // Compute bounding box from all points
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          pctPoints.forEach(pt => {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          });
          const w = Math.max(maxX - minX, 1);
          const h = Math.max(maxY - minY, 1);
          // Normalize points relative to bounding box origin
          const normalizedPoints = pctPoints.map(pt => ({ x: pt.x - minX, y: pt.y - minY }));
          addOverlayClip({
            type: 'pen',
            x: minX, y: minY,
            width: w, height: h,
            points: normalizedPoints,
            strokeColor: '#ff0000',
            strokeWidth: 2,
          });
        }
      } else if (wPct > 0.5 || hPct > 0.5) {
        let shapeType = state.tool;
        if (shapeType === 'image') shapeType = 'rect';

        if (shapeType === 'line' || shapeType === 'arrow') {
          const x1 = startPct.x;
          const y1 = startPct.y;
          const x2 = endPct.x;
          const y2 = endPct.y;
          addOverlayClip({
            type: shapeType,
            x1, y1, x2, y2,
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.max(Math.abs(x2 - x1), 1),
            height: Math.max(Math.abs(y2 - y1), 1),
          });
        } else {
          addOverlayClip({
            type: shapeType,
            x: Math.min(startPct.x, endPct.x),
            y: Math.min(startPct.y, endPct.y),
            width: Math.max(wPct, 3),
            height: Math.max(hPct, 3),
          });
        }
      }
      setIsDrawing(false);
    }
    setInteraction(null);
    multiDragRef.current = null;
    setCropInteraction(null);
    guidesRef.current = [];
    setGuides([]);
  }, [isDrawing, drawStart, getCanvasPos, canvasToPct, state.tool, state.tracks, addOverlayClip, multiRect, computeLayout, setSelectedIds, cropInteraction]);

  // Keyboard: Delete/Backspace removes selected clip(s)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedElementIds.length > 0) {
          deleteSelectedClips();
          e.preventDefault();
        } else if (state.selectedElementId) {
          deleteClip(state.selectedElementId);
          e.preventDefault();
        }
      } else if (e.key === 'Escape' && state.cropMode?.active) {
        exitCropMode();
        e.preventDefault();
      } else if ((e.key === 'Enter' || e.key === ' ') && state.cropMode?.active) {
        e.preventDefault();
        if (state.cropMode.active) {
          applyCrop(state.cropMode.clipId, state.cropMode.cropRect);
        }
      }
    };
    canvas.addEventListener('keydown', onKey);
    return () => canvas.removeEventListener('keydown', onKey);
  }, [state.selectedElementIds, state.selectedElementId, deleteSelectedClips, deleteClip, state.cropMode, exitCropMode, applyCrop]);

  // --- Cursor ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e) => {
      if (state.cropMode?.active) {
        const pos = getCanvasPos(e);
        const layout = getCropClipLayout();
        if (layout) {
          const handleId = findCropHandle(pos.x, pos.y, layout);
          if (handleId) {
            const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
            canvas.style.cursor = map[handleId] || 'default';
          } else {
            canvas.style.cursor = 'crosshair';
          }
        }
        return;
      }
      if (state.tool !== 'select' || interaction) return;
      const pos = getCanvasPos(e);
      const sel = getSelected();
      if (sel) {
        const h = findHandle(pos.x, pos.y, sel.clip);
        if (h?.type === 'rotate') { canvas.style.cursor = 'grab'; return; }
        if (h?.type === 'resize') {
          const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
          canvas.style.cursor = map[h.handleId] || 'default';
          return;
        }
      }
      const found = findClipAtPos(pos.x, pos.y);
      canvas.style.cursor = found ? 'move' : 'default';
    };
    canvas.addEventListener('mousemove', onMove);
    return () => canvas.removeEventListener('mousemove', onMove);
  }, [state.tool, state.tracks, state.cropMode, getCanvasPos, getSelected, findHandle, findClipAtPos, interaction, getCropClipLayout, findCropHandle]);

  // Collect video clips from ALL tracks (video tracks + overlay tracks)
  const videoClips = [];
  state.tracks.forEach((t) => {
    t.clips.forEach((c) => { if (c.type === 'video') videoClips.push({ ...c, trackId: t.id }); });
  });

  return (
    <div
      className="preview-container"
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setIsDrawing(false); setInteraction(null); setCropInteraction(null); guidesRef.current = []; setGuides([]); setMultiRect(null); }}
      />

      {/* Crop mode toolbar with Check and X buttons */}
      {state.cropMode?.active && (
        <div className="crop-mode-toolbar">
          <button
            className="crop-mode-toolbar-btn cancel"
            onClick={() => exitCropMode()}
            title="Cancel crop (Esc)"
          >
            <X size={18} />
          </button>
          <button
            className="crop-mode-toolbar-btn confirm"
            onClick={() => applyCrop(state.cropMode.clipId, state.cropMode.cropRect)}
            title="Apply crop (Enter)"
          >
            <Check size={18} />
          </button>
        </div>
      )}

      {/* Video elements — invisible but positioned so the browser decodes frames */}
      {videoClips.map((clip) => (
        <video
          key={clip.id}
          ref={(el) => {
            if (el) {
              videoRefs.current[clip.id] = { videoEl: el, clip };
              el._logged = false;
            } else {
              delete videoRefs.current[clip.id];
            }
          }}
          src={clip.videoUrl}
          muted
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            left: 0, top: 0,
          }}
        />
      ))}

      {/* Overlay images */}
      {state.tracks
        .filter((t) => t.type === 'overlay')
        .flatMap((t) => t.clips)
        .filter((c) => c.type === 'image')
        .map((clip) => (
          <img
            key={`oi-${clip.id}`}
            id={`overlay-img-${clip.id}`}
            src={clip.imageUrl || clip.url}
            alt=""
            style={{ display: 'none' }}
            crossOrigin="anonymous"
          />
        ))}
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
