import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useVideo } from '../context/VideoContext';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Scissors,
  Plus,
  Trash2,
  Video,
  Image as ImageIcon,
  Play,
  Pause,
  SkipBack,
  SkipForward,
} from 'lucide-react';

export default function Timeline() {
  const {
    state,
    setCurrentTime,
    setIsPlaying,
    selectElement,
    updateClip,
    deleteClip,
    deselectAll,
    addTrack,
    removeTrack,
    toggleTrackCollapse,
    reorderTracks,
    renameTrack,
    moveClipToTrack,
    splitClip,
    trimClipStart,
    trimClipEnd,
    setDuration,
    setZoom,
  } = useVideo();

  const scrollContainerRef = useRef(null);
  const timelineBodyRef = useRef(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingClip, setDraggingClip] = useState(null);
  const [trimEdge, setTrimEdge] = useState(null); // 'start' | 'end'
  const [trackDragOver, setTrackDragOver] = useState(null);
  const [draggingTrackIdx, setDraggingTrackIdx] = useState(null);
  const [dragTrackOverIdx, setDragTrackOverIdx] = useState(null);
  const [editingTrackId, setEditingTrackId] = useState(null);
  const [editName, setEditName] = useState('');

  // Refs for global keyboard handler (avoids stale closures in effect)
  const deleteClipRef = useRef(deleteClip);
  deleteClipRef.current = deleteClip;
  const selectedIdRef = useRef(state.selectedElementId);
  selectedIdRef.current = state.selectedElementId;

  // Global keyboard shortcut: Delete/Backspace removes selected clip
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if the user is typing in an input/textarea
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        if (selectedIdRef.current) {
          e.preventDefault();
          deleteClipRef.current(selectedIdRef.current);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const pixelsPerSecond = 60 * state.zoom;
  const totalWidth = state.duration * pixelsPerSecond;

  // Update playhead position based on current time
  // Shared click on ruler/tracks: use the unified scroll container
  const getTimeFromEvent = useCallback((e) => {
    const scrollEl = scrollContainerRef.current;
    const scrollLeft = scrollEl?.scrollLeft || 0;
    // Account for the 150px track-header offset in the ruler area
    const rect = scrollEl.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft - 150;
    return Math.max(0, Math.min(state.duration, x / pixelsPerSecond));
  }, [pixelsPerSecond, state.duration]);

  const handleTimelineClick = useCallback(
    (e) => {
      if (draggingClip || trimEdge) return;
      setCurrentTime(getTimeFromEvent(e));
    },
    [getTimeFromEvent, setCurrentTime, draggingClip, trimEdge]
  );

  const handlePlayheadDrag = useCallback(
    (e) => {
      if (!isDraggingPlayhead) return;
      setCurrentTime(getTimeFromEvent(e));
    },
    [isDraggingPlayhead, getTimeFromEvent, setCurrentTime]
  );

  const handlePlayheadMouseDown = useCallback((e) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      // On mouseup after a clip drag, check if we should move to another track
      if (draggingClip) {
        const overTrackId = trackDragOver;
        if (overTrackId && overTrackId !== draggingClip.trackId) {
          const duration = draggingClip.clipEnd - draggingClip.clipStart;
          const newStartTime = draggingClip.clipStart;
          moveClipToTrack(draggingClip.clipId, draggingClip.trackId, overTrackId, newStartTime);
        }
      }
      // On mouseup after track reorder drag
      if (draggingTrackIdx !== null && dragTrackOverIdx !== null && dragTrackOverIdx !== draggingTrackIdx) {
        reorderTracks(draggingTrackIdx, dragTrackOverIdx);
      }
      setIsDraggingPlayhead(false);
      setDraggingClip(null);
      setTrimEdge(null);
      setTrackDragOver(null);
      setDraggingTrackIdx(null);
      setDragTrackOverIdx(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [draggingClip, trackDragOver, moveClipToTrack, draggingTrackIdx, dragTrackOverIdx, reorderTracks]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      handlePlayheadDrag(e);
    };
    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [isDraggingPlayhead, handlePlayheadDrag]);

  const handleClipMouseDown = useCallback(
    (e, clip, trackId) => {
      e.stopPropagation();
      selectElement(clip.id);
      setCurrentTime(clip.startTime);

      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clipWidth = rect.width;
      const edgeThreshold = 8;

      if (e.shiftKey && clickX < edgeThreshold) {
        setTrimEdge({ clipId: clip.id, trackId, edge: 'start' });
      } else if (e.shiftKey && clickX > clipWidth - edgeThreshold) {
        setTrimEdge({ clipId: clip.id, trackId, edge: 'end' });
      } else {
        const srcTrack = state.tracks.find(t => t.id === trackId);
        setDraggingClip({
          clipId: clip.id,
          trackId,
          trackType: srcTrack?.type || 'overlay',
          startX: e.clientX,
          clipStart: clip.startTime,
          clipEnd: clip.endTime,
          didMove: false,
        });
      }
    },
    [selectElement, setCurrentTime]
  );

  // Get which track row the mouse Y is over for cross-track dragging (same-type only)
  const getTrackIdAtY = useCallback((clientY, allowedType) => {
    const rowEls = document.querySelectorAll('.track-row');
    for (const rowEl of rowEls) {
      const r = rowEl.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        const tid = rowEl.dataset.trackId || null;
        const ttype = rowEl.dataset.trackType || null;
        if (allowedType && ttype !== allowedType) continue; // skip non-matching track types
        return tid;
      }
    }
    return null;
  }, []);

  const handleClipDrag = useCallback(
    (e) => {
      if (!draggingClip) return;
      const dt = (e.clientX - draggingClip.startX) / pixelsPerSecond;
      const duration = draggingClip.clipEnd - draggingClip.clipStart;
      const newStart = Math.max(0, draggingClip.clipStart + dt);
      const dx = Math.abs(e.clientX - draggingClip.startX);
      const didMove = dx > 2 || draggingClip.didMove;
      if (didMove) {
        updateClip(draggingClip.clipId, {
          startTime: newStart,
          endTime: newStart + duration,
        });
      }
      // Highlight the track under the cursor for cross-track drop (only same type)
      const overTrackId = getTrackIdAtY(e.clientY, draggingClip.trackType);
      setTrackDragOver(overTrackId && overTrackId !== draggingClip.trackId ? overTrackId : null);
      setDraggingClip((prev) => ({
        ...prev,
        startX: e.clientX,
        clipStart: newStart,
        clipEnd: newStart + duration,
        didMove,
      }));
    },
    [draggingClip, pixelsPerSecond, updateClip, getTrackIdAtY]
  );

  const getTimeFromScrollEvent = useCallback((e) => {
    const scrollEl = scrollContainerRef.current;
    const scrollLeft = scrollEl?.scrollLeft || 0;
    const rect = scrollEl.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft - 150;
    return Math.max(0, Math.min(state.duration, x / pixelsPerSecond));
  }, [pixelsPerSecond, state.duration]);

  const handleClipTrimDrag = useCallback(
    (e) => {
      if (!trimEdge) return;
      const time = getTimeFromScrollEvent(e);
      if (trimEdge.edge === 'start') {
        const clip = state.tracks
          .find((t) => t.id === trimEdge.trackId)
          ?.clips.find((c) => c.id === trimEdge.clipId);
        if (clip && time < clip.endTime - 0.1) {
          trimClipStart(trimEdge.clipId, trimEdge.trackId, time);
        }
      } else {
        const clip = state.tracks
          .find((t) => t.id === trimEdge.trackId)
          ?.clips.find((c) => c.id === trimEdge.clipId);
        if (clip && time > clip.startTime + 0.1) {
          trimClipEnd(trimEdge.clipId, trimEdge.trackId, time);
        }
      }
    },
    [trimEdge, state.tracks, getTimeFromScrollEvent, trimClipStart, trimClipEnd]
  );

  useEffect(() => {
    const handleMouseMove = (e) => {
      handleClipDrag(e);
      handleClipTrimDrag(e);
    };
    if (draggingClip || trimEdge) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [draggingClip, trimEdge, handleClipDrag, handleClipTrimDrag]);

  // Track reorder: detect which track row the mouse Y is over
  const handleTrackReorderDrag = useCallback(
    (e) => {
      if (draggingTrackIdx === null) return;
      const rowEls = document.querySelectorAll('.track-row');
      let idx = 0;
      for (const rowEl of rowEls) {
        const r = rowEl.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          setDragTrackOverIdx(idx);
          return;
        }
        idx++;
      }
    },
    [draggingTrackIdx]
  );

  useEffect(() => {
    const handleMouseMove = (e) => {
      handleTrackReorderDrag(e);
    };
    if (draggingTrackIdx !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [draggingTrackIdx, handleTrackReorderDrag]);

  const handleTrackDragStart = useCallback(
    (e, trackIdx) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingTrackIdx(trackIdx);
    },
    []
  );

  const handleTrackNameClick = useCallback(
    (e, trackId, currentName) => {
      e.stopPropagation();
      setEditingTrackId(trackId);
      setEditName(currentName);
    },
    []
  );

  const commitTrackName = useCallback(() => {
    if (editingTrackId && editName.trim()) {
      renameTrack(editingTrackId, editName.trim());
    }
    setEditingTrackId(null);
    setEditName('');
  }, [editingTrackId, editName, renameTrack]);

  const handleTrackNameKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTrackName();
      } else if (e.key === 'Escape') {
        setEditingTrackId(null);
        setEditName('');
      }
    },
    [commitTrackName]
  );

  const handleSplitClick = useCallback(
    (e, clipId, trackId) => {
      e.stopPropagation();
      splitClip(clipId, trackId, state.currentTime);
    },
    [state.currentTime, splitClip]
  );

  const handleDeleteClick = useCallback(
    (e, clipId) => {
      e.stopPropagation();
      deleteClip(clipId);
    },
    [deleteClip]
  );

  // Generate time markers
  const timeMarkers = [];
  const interval = state.duration <= 10 ? 1 : state.duration <= 30 ? 2 : state.duration <= 60 ? 5 : 10;
  for (let t = 0; t <= state.duration; t += interval) {
    timeMarkers.push(t);
  }

  // Scroll playhead into view (accounting for 150px header offset)
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const playheadX = 150 + state.currentTime * pixelsPerSecond;
    const viewLeft = scrollEl.scrollLeft;
    const viewRight = viewLeft + scrollEl.clientWidth;
    if (playheadX < viewLeft + 150 || playheadX > viewRight) {
      scrollEl.scrollLeft = playheadX - scrollEl.clientWidth / 3;
    }
  }, [state.currentTime, pixelsPerSecond]);

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <span className="timeline-label">Timeline</span>
        <div className="timeline-transport">
          <button
            className="transport-btn"
            onClick={() => setCurrentTime(Math.max(0, state.currentTime - 1))}
            title="Skip Back"
          >
            <SkipBack size={14} />
          </button>
          <button
            className="transport-btn play-btn"
            onClick={() => setIsPlaying(!state.isPlaying)}
            title={state.isPlaying ? 'Pause' : 'Play'}
          >
            {state.isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="transport-btn"
            onClick={() =>
              setCurrentTime(Math.min(state.duration, state.currentTime + 1))
            }
            title="Skip Forward"
          >
            <SkipForward size={14} />
          </button>
          <span className="time-display">
            {formatTime(state.currentTime)} / {formatTime(state.duration)}
          </span>
          <input
            type="range"
            className="playback-scrubber"
            min={0}
            max={state.duration || 60}
            step={0.01}
            value={state.currentTime}
            onChange={(e) => setCurrentTime(Number(e.target.value))}
            title={`Seek: ${formatTime(state.currentTime)}`}
          />
        </div>
        <div className="timeline-toolbar-actions">
          <button
            className="timeline-tool-btn"
            onClick={() => addTrack('video', `Video ${state.tracks.filter(t => t.type === 'video').length + 1}`)}
            title="Add Video Track"
          >
            <Plus size={14} /> Video Track
          </button>
          <button
            className="timeline-tool-btn"
            onClick={() => addTrack('overlay', `Overlay ${state.tracks.filter(t => t.type === 'overlay').length + 1}`)}
            title="Add Overlay Track"
          >
            <Plus size={14} /> Overlay
          </button>
          <div className="timeline-zoom">
            <button
              className="timeline-zoom-btn"
              onClick={() => setZoom(Math.max(0.5, state.zoom - 0.5))}
            >
              -
            </button>
            <span className="timeline-zoom-val">{state.zoom.toFixed(1)}x</span>
            <button
              className="timeline-zoom-btn"
              onClick={() => setZoom(Math.min(5, state.zoom + 0.5))}
            >
              +
            </button>
          </div>
          <input
            type="number"
            className="duration-input"
            value={state.duration}
            min={1}
            max={600}
            onChange={(e) => setDuration(Number(e.target.value) || 30)}
            title="Duration (seconds)"
          />
          <span className="timeline-duration-label">s</span>
        </div>
      </div>

      <div className="timeline-body" ref={scrollContainerRef} onClick={handleTimelineClick}>
        <div className="timeline-body-inner" style={{ minWidth: totalWidth + 150 }}>
          {/* Ruler (inside scroll area so it scrolls with tracks) */}
          <div className="timeline-ruler" ref={timelineBodyRef}>
            <div className="timeline-ruler-spacer" />
            <div className="timeline-ruler-track" style={{ width: totalWidth }}>
              {timeMarkers.map((t) => (
                <div
                  key={t}
                  className="time-marker"
                  style={{ left: t * pixelsPerSecond }}
                >
                  <div className="time-marker-line" />
                  <span className="time-marker-label">{formatTime(t)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Playhead — spans from ruler top through all track rows */}
          <div
            className="playhead"
            style={{ left: 150 + state.currentTime * pixelsPerSecond }}
            onMouseDown={handlePlayheadMouseDown}
          >
            <div className="playhead-triangle" />
            <div className="playhead-line" />
          </div>

          {/* Tracks */}
          <div className="timeline-tracks-area">
            {state.tracks.map((track, trackIdx) => (
              <div
                key={track.id}
                data-track-id={track.id}
                data-track-type={track.type}
                className={`track-row ${trackDragOver === track.id ? 'drag-over' : ''
                  } ${dragTrackOverIdx === trackIdx ? 'track-reorder-over' : ''
                  } ${draggingTrackIdx === trackIdx ? 'track-reordering' : ''
                  } ${track.collapsed ? 'collapsed' : ''}`}
              >
                <div className="track-header">
                  <button
                    className="track-collapse-btn"
                    onClick={() => toggleTrackCollapse(track.id)}
                  >
                    {track.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <span className="track-type-icon">
                    {track.type === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
                  </span>
                  {editingTrackId === track.id ? (
                    <input
                      className="track-name-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitTrackName}
                      onKeyDown={handleTrackNameKeyDown}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="track-name"
                      onClick={(e) => handleTrackNameClick(e, track.id, track.name)}
                      title="Click to rename"
                    >
                      {track.name}
                    </span>
                  )}
                  <button
                    className="track-reorder-grip"
                    onMouseDown={(e) => handleTrackDragStart(e, trackIdx)}
                    title="Drag to reorder track"
                  >
                    <GripVertical size={12} />
                  </button>
                  {state.tracks.filter((t) => t.type === track.type).length > 1 && (
                    <button
                      className="track-remove-btn"
                      onClick={() => removeTrack(track.id)}
                      title="Remove Track"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                <div className={`track-clips-area ${track.collapsed ? 'hidden' : ''}`}>
                  <div
                    className="track-drop-zone"
                    onClick={(e) => {
                      e.stopPropagation();
                      const scrollEl = scrollContainerRef.current;
                      const scrollLeft = scrollEl?.scrollLeft || 0;
                      const rect = scrollEl.getBoundingClientRect();
                      const x = e.clientX - rect.left + scrollLeft - 150;
                      const time = Math.max(0, Math.min(state.duration, x / pixelsPerSecond));
                      setCurrentTime(time);
                    }}
                  />
                  {track.clips.map((clip) => (
                    <div
                      key={clip.id}
                      className={`timeline-clip ${clip.type} ${clip.id === state.selectedElementId ? 'selected' : ''
                        }`}
                      style={{
                        left: clip.startTime * pixelsPerSecond,
                        width: Math.max(
                          (clip.endTime - clip.startTime) * pixelsPerSecond,
                          4
                        ),
                      }}
                    >
                      <div className="clip-edge clip-edge-left" title="Shift+drag to trim start" />
                      <div className="clip-content"
                        onMouseDown={(e) => handleClipMouseDown(e, clip, track.id)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="clip-label">
                          {clip.type === 'video'
                            ? '🎬'
                            : clip.type === 'text'
                              ? '📝'
                              : clip.type === 'image'
                                ? '🖼️'
                                : clip.type === 'circle'
                                  ? '⭕'
                                  : clip.type === 'triangle'
                                    ? '🔺'
                                    : clip.type === 'arrow'
                                      ? '➡️'
                                      : clip.type === 'line'
                                        ? '📏'
                                        : '⬜'}{' '}
                          {clip.name || clip.type || clip.text?.slice(0, 10) || 'clip'}
                        </span>
                        <span className="clip-duration">
                          {(clip.endTime - clip.startTime).toFixed(1)}s
                        </span>
                      </div>
                      <div className="clip-edge clip-edge-right" title="Shift+drag to trim end" />
                      {clip.id === state.selectedElementId && (
                        <div className="clip-actions">
                          <button
                            className="clip-action-btn"
                            onClick={(e) => handleSplitClick(e, clip.id, track.id)}
                            title="Split at playhead"
                          >
                            <Scissors size={10} />
                          </button>
                          <button
                            className="clip-action-btn danger"
                            onClick={(e) => handleDeleteClick(e, clip.id)}
                            title="Delete clip"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
