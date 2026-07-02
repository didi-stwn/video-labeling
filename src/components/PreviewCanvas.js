import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useVideo } from '../context/VideoContext';
import { webmToMp4 } from '../utils/ffmpeg';

const HANDLE_SIZE = 8;
const ROTATE_HANDLE_OFFSET = 28;

export default function PreviewCanvas() {
  const {
    state,
    selectElement,
    deselectAll,
    updateClip,
    addOverlayClip,
    setCurrentTime,
    setIsPlaying,
    setExporting,
  } = useVideo();

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRefs = useRef({});
  const animFrameRef = useRef(null);
  const drawRafRef = useRef(null);
  const exportResRef = useRef(null); // sets canvas size during export
  const [containerSize, setContainerSize] = useState({ width: 640, height: 360 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });
  const [interaction, setInteraction] = useState(null);

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
  const drawStateRef = useRef({ isDrawing, drawStart, drawCurrent });
  drawStateRef.current = { isDrawing, drawStart, drawCurrent };
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;

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
        // Should be playing naturally — start it if it's not already
        if (videoEl.paused) {
          const rel = s.currentTime - clip.startTime;
          const srcTime = clip.sourceStart + rel;
          // Only seek when NOT exporting — seekToStart() already pre-positioned
          // all videos before export capture began. Seeking during export would
          // invalidate the decoder buffer and cause flicker.
          if (!s.isExporting && Math.abs(videoEl.currentTime - srcTime) > 0.1) {
            videoEl.currentTime = srcTime;
          }
          // Install auto-pause listener for clip end
          const endSrcTime = clip.sourceStart + (clip.endTime - clip.startTime);
          const onTimeUpdate = () => {
            if (videoEl.currentTime >= endSrcTime) {
              videoEl.pause();
            }
          };
          videoEl.addEventListener('timeupdate', onTimeUpdate);
          videoEl._onTimeUpdate = onTimeUpdate;
          videoEl.play().catch(() => {});
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
          if (rel >= 0 && rel <= clip.endTime - clip.startTime) {
            const srcTime = clip.sourceStart + rel;
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

      // === Draw active video frames ===
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
          try { ctx.drawImage(video, dx, dy, dw, dh); } catch (_) {}
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
              ctx.lineWidth = clip.strokeWidth || 2;
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
              ctx.lineWidth = clip.strokeWidth || 2;
              ctx.beginPath();
              ctx.ellipse(cx + cw2 / 2, cy + ch2 / 2, cw2 / 2, ch2 / 2, 0, 0, Math.PI * 2);
              if (isFill) { ctx.fillStyle = clip.fillColor || 'rgba(255,0,0,0.2)'; ctx.fill(); }
              ctx.stroke();
              break;
            case 'triangle':
              ctx.strokeStyle = clip.strokeColor || '#ff0000';
              ctx.lineWidth = clip.strokeWidth || 2;
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
              ctx.lineWidth = clip.strokeWidth || 2;
              ctx.fillStyle = clip.strokeColor || '#ff0000';
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              const ang = Math.atan2((by - ay), (bx - ax));
              const hl = Math.max(8, Math.hypot(bx - ax, by - ay) * 0.12);
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
              ctx.lineWidth = clip.strokeWidth || 2;
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              break;
            }
            case 'text':
              ctx.fillStyle = clip.color || '#ffffff';
              ctx.font = `${clip.fontSize || 24}px ${clip.fontFamily || 'Arial'}`;
              ctx.fillText(clip.text || 'Text', cx, cy + (clip.fontSize || 24));
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
          }

          ctx.restore();

          // === Selection handles ===
          if (clip.id === s.selectedElementId) {
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

      // === In-progress drawing ===
      if (id && s.tool !== 'select') {
        const dx2 = ds.x;
        const dy2 = ds.y;
        const dw2 = dc.x - dx2;
        const dh2 = dc.y - dy2;

        ctx.save();
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
        }
        ctx.setLineDash([]);
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
      { id: 'n',  x: sx + shw / 2, y: sy },
      { id: 'ne', x: sx + shw, y: sy },
      { id: 'e',  x: sx + shw, y: sy + shh / 2 },
      { id: 'se', x: sx + shw, y: sy + shh },
      { id: 's',  x: sx + shw / 2, y: sy + shh },
      { id: 'sw', x: sx, y: sy + shh },
      { id: 'w',  x: sx, y: sy + shh / 2 },
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

  // --- Mouse events ---
  const handleMouseDown = useCallback((e) => {
    // Auto-focus canvas so keyboard Delete/Backspace works after click
    canvasRef.current?.focus();
    const pos = getCanvasPos(e);
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
        selectElement(found.clip.id);
        setInteraction({
          type: 'drag',
          clipId: found.clip.id,
          trackId: found.trackId,
          startX: pos.x,
          startY: pos.y,
          startClip: { ...found.clip },
        });
      } else {
        deselectAll();
      }
    } else {
      setIsDrawing(true);
      setDrawStart(pos);
      setDrawCurrent(pos);
    }
  }, [state.tool, getCanvasPos, getSelected, findHandle, findClipAtPos, selectElement, deselectAll]);

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e);
    if (isDrawing) { setDrawCurrent(pos); return; }
    if (!interaction) return;

    if (interaction.type === 'drag') {
      const { pw, ph } = computeLayout();
      const dx = ((pos.x - interaction.startX) / pw) * 100;
      const dy = ((pos.y - interaction.startY) / ph) * 100;
      const sc = interaction.startClip;
      const nx = Math.max(0, Math.min(100 - sc.width, sc.x + dx));
      const ny = Math.max(0, Math.min(100 - sc.height, sc.y + dy));
      const patch = { x: nx, y: ny };
      // Keep line/arrow endpoints in sync with bounding box
      if (sc.x1 !== undefined) patch.x1 = (sc.x1 ?? 0) + (nx - sc.x);
      if (sc.y1 !== undefined) patch.y1 = (sc.y1 ?? 0) + (ny - sc.y);
      if (sc.x2 !== undefined) patch.x2 = (sc.x2 ?? 0) + (nx - sc.x);
      if (sc.y2 !== undefined) patch.y2 = (sc.y2 ?? 0) + (ny - sc.y);
      updateClip(interaction.clipId, patch);
    } else if (interaction.type === 'resize') {
      const { pw, ph } = computeLayout();
      const dx = ((pos.x - interaction.startX) / pw) * 100;
      const dy = ((pos.y - interaction.startY) / ph) * 100;
      const sc = interaction.startClip;
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

      // For video/image overlays, optionally lock aspect ratio so source appears unstretched.
      // Overlay coords are % of a 16:9 preview area, so rendered pixels are:
      //   pixelW = (width%/100) * pw,  pixelH = (height%/100) * ph,  pw/ph = 16/9
      // For unstretched: pixelW/pixelH = mediaAspect  →  width/height = mediaAspect / (16/9)
      const lockAR = sc.lockAspectRatio !== false;
      if (lockAR && (sc.type === 'video' || sc.type === 'image')) {
        const frameAspect = 16 / 9;
        const ref = sc.type === 'video'
          ? state.videos.find(v => v.id === sc.videoId)
          : state.images.find(v => v.id === sc.imageId);
        const mw = ref?.width  || 1920;
        const mh = ref?.height || 1080;
        if (mw && mh) {
          const mediaAspect = mw / mh;
          const ratio = mediaAspect / frameAspect;
          const isCorner = (h.includes('n') || h.includes('s')) && (h.includes('e') || h.includes('w'));
          if (isCorner) {
            const dwAbs = Math.abs(nw - sc.width);
            const dhAbs = Math.abs(nh - sc.height);
            if (dwAbs / Math.max(sc.width, 1) > dhAbs / Math.max(sc.height, 1)) {
              nh = nw / ratio;
            } else {
              nw = nh * ratio;
            }
          } else if (h.includes('e') || h.includes('w')) {
            nh = nw / ratio;
          } else if (h.includes('n') || h.includes('s')) {
            nw = nh * ratio;
          }
        }
      }
      const patch = { x: nx, y: ny, width: nw, height: nh };
      // Keep line/arrow endpoints in sync with resized bounding box
      if (sc.x1 !== undefined && sc.width > 0 && sc.height > 0) {
        const rx1 = (sc.x1 - sc.x) / sc.width;
        const ry1 = (sc.y1 - sc.y) / sc.height;
        const rx2 = (sc.x2 - sc.x) / sc.width;
        const ry2 = (sc.y2 - sc.y) / sc.height;
        patch.x1 = nx + rx1 * nw;
        patch.y1 = ny + ry1 * nh;
        patch.x2 = nx + rx2 * nw;
        patch.y2 = ny + ry2 * nh;
      }
      updateClip(interaction.clipId, patch);
    } else if (interaction.type === 'rotate') {
      const sc = interaction.startClip;
      const { pw, ph, ox, oy } = computeLayout();
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
  }, [isDrawing, interaction, getCanvasPos, computeLayout, updateClip]);

  const handleMouseUp = useCallback((e) => {
    if (isDrawing) {
      const pos = getCanvasPos(e);
      const startPct = canvasToPct(drawStart.x, drawStart.y);
      const endPct = canvasToPct(pos.x, pos.y);
      const wPct = Math.abs(endPct.x - startPct.x);
      const hPct = Math.abs(endPct.y - startPct.y);

      if (wPct > 0.5 || hPct > 0.5) {
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
  }, [isDrawing, drawStart, getCanvasPos, canvasToPct, state.tool, addOverlayClip]);

  // --- Cursor ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e) => {
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
  }, [state.tool, state.tracks, getCanvasPos, getSelected, findHandle, findClipAtPos, interaction]);

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
        onMouseLeave={() => { setIsDrawing(false); setInteraction(null); }}
      />

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
