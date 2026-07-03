import React, { createContext, useContext, useReducer, useCallback } from 'react';

const VideoContext = createContext(null);

const initialState = {
  videos: [],
  images: [],
  tracks: [
    { id: 'track-video-1', type: 'video', name: 'Video', clips: [], collapsed: false },
    { id: 'track-overlay-1', type: 'overlay', name: 'Overlay', clips: [], collapsed: false },
  ],
  selectedElementId: null,
  currentTime: 0,
  isPlaying: false,
  duration: 30,
  tool: 'select', // select | rect | circle | triangle | arrow | line | text | image
  zoom: 1,
  nextId: 1,
  isExporting: false,
  exportProgress: 0,
  exportFormat: null, // 'webm' | 'mp4'
};

let clipIdCounter = 1;
let trackIdCounter = 2;

function generateId() {
  return `el-${Date.now()}-${clipIdCounter++}`;
}

function generateTrackId() {
  return `track-${Date.now()}-${trackIdCounter++}`;
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_VIDEO': {
      const video = {
        id: generateId(),
        name: action.payload.name,
        url: action.payload.url,
        duration: action.payload.duration || 10,
        width: action.payload.width || 1920,
        height: action.payload.height || 1080,
      };
      return { ...state, videos: [...state.videos, video] };
    }

    case 'ADD_IMAGE': {
      const image = {
        id: generateId(),
        name: action.payload.name,
        url: action.payload.url,
        width: action.payload.width || 300,
        height: action.payload.height || 300,
      };
      return { ...state, images: [...state.images, image] };
    }

    case 'ADD_CLIP_TO_TRACK': {
      const { trackId, clipData } = action.payload;
      const clip = {
        id: generateId(),
        ...clipData,
      };
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, clip] }
            : track
        ),
        selectedElementId: clip.id,
      };
    }

    case 'ADD_OVERLAY_CLIP': {
      const p = action.payload;
      const clip = {
        id: generateId(),
        type: p.type,
        name: p.name || p.type,
        startTime: p.startTime || state.currentTime,
        endTime: p.endTime || state.currentTime + 5,
        x: p.x !== undefined ? p.x : 50,
        y: p.y !== undefined ? p.y : 50,
        width: p.width || 20,
        height: p.height || 20,
        rotation: p.rotation || 0,
        text: p.text || '',
        fontSize: p.fontSize || 24,
        fontFamily: p.fontFamily || 'Arial',
        color: p.color || '#ffffff',
        fillColor: p.fillColor || 'rgba(255, 0, 0, 0.3)',
        strokeColor: p.strokeColor || '#ff0000',
        strokeWidth: p.strokeWidth || 2,
        borderRadius: p.borderRadius || 0,
        imageId: p.imageId || null,
        opacity: p.opacity ?? 1,
        // Line/arrow endpoints (actual start & end coords)
        x1: p.x1,
        y1: p.y1,
        x2: p.x2,
        y2: p.y2,
        directionX: p.directionX,
        directionY: p.directionY,
      };
      const overlayTrack = state.tracks.find((t) => t.type === 'overlay');
      const targetTrackId = overlayTrack ? overlayTrack.id : state.tracks[1]?.id;
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === targetTrackId
            ? { ...track, clips: [...track.clips, clip] }
            : track
        ),
        selectedElementId: clip.id,
        tool: 'select',
      };
    }

    case 'UPDATE_CLIP': {
      const { clipId, updates } = action.payload;
      return {
        ...state,
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === clipId ? { ...clip, ...updates } : clip
          ),
        })),
      };
    }

    case 'DELETE_CLIP': {
      const { clipId } = action.payload;
      return {
        ...state,
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => clip.id !== clipId),
        })),
        selectedElementId:
          state.selectedElementId === clipId ? null : state.selectedElementId,
      };
    }

    case 'DELETE_VIDEO': {
      const { videoId } = action.payload;
      return {
        ...state,
        videos: state.videos.filter((v) => v.id !== videoId),
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter(
            (clip) => !(clip.type === 'video' && clip.videoId === videoId)
          ),
        })),
      };
    }

    case 'DELETE_IMAGE': {
      const { imageId } = action.payload;
      return {
        ...state,
        images: state.images.filter((img) => img.id !== imageId),
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter(
            (clip) => !(clip.type === 'image' && clip.imageId === imageId)
          ),
        })),
      };
    }

    case 'SELECT_ELEMENT': {
      return { ...state, selectedElementId: action.payload.id };
    }

    case 'DESELECT_ALL': {
      return { ...state, selectedElementId: null };
    }

    case 'SET_EXPORTING': {
      return {
        ...state,
        isExporting: action.payload.isExporting,
        exportProgress: action.payload.progress ?? 0,
        // Only override format when explicitly provided (not undefined/null)
        exportFormat: action.payload.format != null ? action.payload.format : state.exportFormat,
      };
    }

    case 'SET_CURRENT_TIME': {
      return { ...state, currentTime: action.payload.time };
    }

    case 'SET_PLAYING': {
      return { ...state, isPlaying: action.payload.isPlaying };
    }

    case 'SET_TOOL': {
      return { ...state, tool: action.payload.tool };
    }

    case 'SET_DURATION': {
      return { ...state, duration: action.payload.duration };
    }

    case 'SET_ZOOM': {
      return { ...state, zoom: action.payload.zoom };
    }

    case 'RENAME_TRACK': {
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.trackId
            ? { ...t, name: action.payload.name }
            : t
        ),
      };
    }

    case 'ADD_TRACK': {
      const newTrack = {
        id: generateTrackId(),
        type: action.payload.type || 'overlay',
        name: action.payload.name || `${state.tracks.length + 1}`,
        clips: [],
        collapsed: false,
      };
      return { ...state, tracks: [...state.tracks, newTrack] };
    }

    case 'REMOVE_TRACK': {
      // Prevent removing the last video track
      const targetTrack = state.tracks.find(t => t.id === action.payload.trackId);
      if (targetTrack && targetTrack.type === 'video') {
        const videoTrackCount = state.tracks.filter(t => t.type === 'video').length;
        if (videoTrackCount <= 1) return state;
      }
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.payload.trackId),
      };
    }

    case 'REORDER_TRACKS': {
      const { fromIndex, toIndex } = action.payload;
      const newTracks = [...state.tracks];
      const [moved] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, moved);
      return { ...state, tracks: newTracks };
    }

    case 'TOGGLE_TRACK_COLLAPSE': {
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.trackId ? { ...t, collapsed: !t.collapsed } : t
        ),
      };
    }

    case 'MOVE_CLIP_TO_TRACK': {
      const { clipId, fromTrackId, toTrackId, newStartTime } = action.payload;
      let movedClip = null;
      let newTracks = state.tracks.map((track) => {
        if (track.id === fromTrackId) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            movedClip = { ...track.clips[clipIndex] };
            if (newStartTime !== undefined) {
              const duration = movedClip.endTime - movedClip.startTime;
              movedClip.startTime = newStartTime;
              movedClip.endTime = newStartTime + duration;
            }
            return {
              ...track,
              clips: track.clips.filter((c) => c.id !== clipId),
            };
          }
        }
        return track;
      });
      if (movedClip) {
        newTracks = newTracks.map((track) => {
          if (track.id === toTrackId) {
            return { ...track, clips: [...track.clips, movedClip] };
          }
          return track;
        });
      }
      return { ...state, tracks: newTracks };
    }

    case 'SPLIT_CLIP': {
      const { clipId, trackId, splitTime } = action.payload;
      let newClips = [];
      state.tracks.forEach((track) => {
        if (track.id === trackId) {
          track.clips.forEach((clip) => {
            if (clip.id === clipId) {
              if (splitTime > clip.startTime && splitTime < clip.endTime) {
                const sourceDuration = clip.sourceEnd - clip.sourceStart;
                const splitRatio =
                  (splitTime - clip.startTime) / (clip.endTime - clip.startTime);
                const sourceSplit =
                  clip.sourceStart + sourceDuration * splitRatio;
                newClips.push(
                  {
                    ...clip,
                    id: clip.id,
                    endTime: splitTime,
                    sourceEnd: sourceSplit,
                  },
                  {
                    ...clip,
                    id: generateId(),
                    startTime: splitTime,
                    sourceStart: sourceSplit,
                  }
                );
              } else {
                newClips.push(clip);
              }
            } else {
              newClips.push(clip);
            }
          });
        }
      });
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === trackId ? { ...track, clips: newClips } : track
        ),
      };
    }

    case 'TRIM_CLIP_START': {
      const { clipId, trackId, newStartTime } = action.payload;
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id === trackId) {
            return {
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id === clipId && newStartTime < clip.endTime) {
                  // For video clips, use the original source video duration as the absolute cap
                  // so the user can always trim back to full length.
                  const timeScale = clip.playbackRate || 1;
                  const srcVideo = state.videos.find(v => v.id === clip.videoId);
                  const originalDuration = srcVideo ? srcVideo.duration : (clip.sourceEnd - clip.sourceStart);
                  const maxTimelineDuration = originalDuration / timeScale;
                  const minStart = Math.max(0, clip.endTime - maxTimelineDuration);
                  const cappedStart = clip.type === 'video' ? Math.max(newStartTime, minStart) : newStartTime;
                  if (cappedStart >= clip.endTime) return clip;
                  const duration = clip.sourceEnd - clip.sourceStart;
                  const totalDuration = clip.endTime - clip.startTime;
                  const ratio = (cappedStart - clip.startTime) / totalDuration;
                  return {
                    ...clip,
                    startTime: cappedStart,
                    sourceStart: clip.sourceStart + duration * ratio,
                  };
                }
                return clip;
              }),
            };
          }
          return track;
        }),
      };
    }

    case 'TRIM_CLIP_END': {
      const { clipId, trackId, newEndTime } = action.payload;
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id === trackId) {
            return {
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id === clipId && newEndTime > clip.startTime) {
                  // For video clips, use the original source video duration as the absolute cap
                  // so the user can always trim back to full length.
                  const timeScale = clip.playbackRate || 1;
                  const srcVideo = state.videos.find(v => v.id === clip.videoId);
                  const originalDuration = srcVideo ? srcVideo.duration : (clip.sourceEnd - clip.sourceStart);
                  const maxTimelineDuration = originalDuration / timeScale;
                  const maxEndTime = clip.startTime + maxTimelineDuration;
                  const cappedEnd = clip.type === 'video' ? Math.min(newEndTime, maxEndTime) : newEndTime;
                  const duration = clip.sourceEnd - clip.sourceStart;
                  const totalDuration = clip.endTime - clip.startTime;
                  const ratio = (cappedEnd - clip.startTime) / totalDuration;
                  return {
                    ...clip,
                    endTime: cappedEnd,
                    sourceEnd: clip.sourceStart + duration * ratio,
                  };
                }
                return clip;
              }),
            };
          }
          return track;
        }),
      };
    }

    default:
      return state;
  }
}

export function VideoProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addVideo = useCallback(
    (name, url, duration, width, height) =>
      dispatch({ type: 'ADD_VIDEO', payload: { name, url, duration, width, height } }),
    []
  );

  const addImage = useCallback(
    (name, url, width, height) =>
      dispatch({ type: 'ADD_IMAGE', payload: { name, url, width, height } }),
    []
  );

  const addClipToTrack = useCallback(
    (trackId, clipData) =>
      dispatch({ type: 'ADD_CLIP_TO_TRACK', payload: { trackId, clipData } }),
    []
  );

  const addOverlayClip = useCallback(
    (data) => dispatch({ type: 'ADD_OVERLAY_CLIP', payload: data }),
    []
  );

  const updateClip = useCallback(
    (clipId, updates) =>
      dispatch({ type: 'UPDATE_CLIP', payload: { clipId, updates } }),
    []
  );

  const deleteClip = useCallback(
    (clipId) => dispatch({ type: 'DELETE_CLIP', payload: { clipId } }),
    []
  );

  const deleteVideo = useCallback(
    (videoId) => dispatch({ type: 'DELETE_VIDEO', payload: { videoId } }),
    []
  );

  const deleteImage = useCallback(
    (imageId) => dispatch({ type: 'DELETE_IMAGE', payload: { imageId } }),
    []
  );

  const selectElement = useCallback(
    (id) => dispatch({ type: 'SELECT_ELEMENT', payload: { id } }),
    []
  );

  const deselectAll = useCallback(
    () => dispatch({ type: 'DESELECT_ALL' }),
    []
  );

  const setCurrentTime = useCallback(
    (time) => dispatch({ type: 'SET_CURRENT_TIME', payload: { time } }),
    []
  );

  const setIsPlaying = useCallback(
    (isPlaying) => dispatch({ type: 'SET_PLAYING', payload: { isPlaying } }),
    []
  );

  const setTool = useCallback(
    (tool) => dispatch({ type: 'SET_TOOL', payload: { tool } }),
    []
  );

  const setDuration = useCallback(
    (duration) => dispatch({ type: 'SET_DURATION', payload: { duration } }),
    []
  );

  const setZoom = useCallback(
    (zoom) => dispatch({ type: 'SET_ZOOM', payload: { zoom } }),
    []
  );

  const setExporting = useCallback(
    (isExporting, progress, format = null) =>
      dispatch({ type: 'SET_EXPORTING', payload: { isExporting, progress, format } }),
    []
  );

  const addTrack = useCallback(
    (type, name) => dispatch({ type: 'ADD_TRACK', payload: { type, name } }),
    []
  );

  const removeTrack = useCallback(
    (trackId) => dispatch({ type: 'REMOVE_TRACK', payload: { trackId } }),
    []
  );

  const toggleTrackCollapse = useCallback(
    (trackId) =>
      dispatch({ type: 'TOGGLE_TRACK_COLLAPSE', payload: { trackId } }),
    []
  );

  const reorderTracks = useCallback(
    (fromIndex, toIndex) =>
      dispatch({ type: 'REORDER_TRACKS', payload: { fromIndex, toIndex } }),
    []
  );

  const renameTrack = useCallback(
    (trackId, name) =>
      dispatch({ type: 'RENAME_TRACK', payload: { trackId, name } }),
    []
  );

  const moveClipToTrack = useCallback(
    (clipId, fromTrackId, toTrackId, newStartTime) =>
      dispatch({
        type: 'MOVE_CLIP_TO_TRACK',
        payload: { clipId, fromTrackId, toTrackId, newStartTime },
      }),
    []
  );

  const splitClip = useCallback(
    (clipId, trackId, splitTime) =>
      dispatch({ type: 'SPLIT_CLIP', payload: { clipId, trackId, splitTime } }),
    []
  );

  const trimClipStart = useCallback(
    (clipId, trackId, newStartTime) =>
      dispatch({
        type: 'TRIM_CLIP_START',
        payload: { clipId, trackId, newStartTime },
      }),
    []
  );

  const trimClipEnd = useCallback(
    (clipId, trackId, newEndTime) =>
      dispatch({
        type: 'TRIM_CLIP_END',
        payload: { clipId, trackId, newEndTime },
      }),
    []
  );

  const getSelectedElement = useCallback(() => {
    if (!state.selectedElementId) return null;
    for (const track of state.tracks) {
      const found = track.clips.find(
        (clip) => clip.id === state.selectedElementId
      );
      if (found) return { ...found, trackId: track.id };
    }
    return null;
  }, [state.selectedElementId, state.tracks]);

  const value = {
    state,
    dispatch,
    addVideo,
    addImage,
    addClipToTrack,
    addOverlayClip,
    updateClip,
    deleteClip,
    deleteVideo,
    deleteImage,
    selectElement,
    deselectAll,
    setCurrentTime,
    setIsPlaying,
    setTool,
    setDuration,
    setZoom,
    addTrack,
    removeTrack,
    toggleTrackCollapse,
    reorderTracks,
    renameTrack,
    moveClipToTrack,
    splitClip,
    trimClipStart,
    trimClipEnd,
    getSelectedElement,
    setExporting,
  };

  return (
    <VideoContext.Provider value={value}>{children}</VideoContext.Provider>
  );
}

export function useVideo() {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideo must be used within a VideoProvider');
  }
  return context;
}
