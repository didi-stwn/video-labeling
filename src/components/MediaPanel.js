import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useVideo } from '../context/VideoContext';
import { Upload, Video, Image as ImageIcon, Monitor, Trash2, Plus, Square, Download } from 'lucide-react';
import ScreenRecorderPiP from './ScreenRecorderPiP';

export default function MediaPanel() {
  const { state, addVideo, addImage, deleteVideo, deleteImage, addClipToTrack } =
    useVideo();
  const videoInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [showRecorder, setShowRecorder] = useState(false);
  const [recordingState, setRecordingState] = useState({ isRecording: false, seconds: 0, stop: null });
  const stopRef = useRef(null);

  // Shared: process a list of File objects (from input change or drop)
  const processFiles = useCallback(
    (files) => {
      files.forEach((file) => {
        if (file.type.startsWith('video/')) {
          const url = URL.createObjectURL(file);
          const videoEl = document.createElement('video');
          videoEl.preload = 'metadata';
          videoEl.onloadedmetadata = () => {
            addVideo(
              file.name,
              url,
              videoEl.duration,
              videoEl.videoWidth || 1920,
              videoEl.videoHeight || 1080
            );
          };
          videoEl.src = url;
        } else if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          const img = new window.Image();
          img.onload = () => {
            addImage(file.name, url, img.naturalWidth, img.naturalHeight);
          };
          img.src = url;
        }
      });
    },
    [addVideo, addImage]
  );

  const handleVideoUpload = useCallback(
    (e) => {
      processFiles(Array.from(e.target.files));
      e.target.value = '';
    },
    [processFiles]
  );

  const handleImageUpload = useCallback(
    (e) => {
      // Filter: only images allowed via the image button
      const files = Array.from(e.target.files).filter((f) =>
        f.type.startsWith('image/')
      );
      processFiles(files);
      e.target.value = '';
    },
    [processFiles]
  );

  // --- Drag-and-drop handlers ---
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Set drop effect to copy so the OS shows the correct cursor
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith('video/') || f.type.startsWith('image/')
      );
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  const handleAddVideoAsOverlay = useCallback(
    (video) => {
      const overlayTrack = state.tracks.find((t) => t.type === 'overlay');
      if (!overlayTrack) return;
      const clipDuration = Math.min(video.duration, state.duration);
      // Calculate initial overlay size preserving source aspect ratio.
      // Overlay coords are % of the preview area (16:9), so a square % results in
      // a 16:9 rendered rect. We must compensate so the source video looks unstretched.
      const vw = video.width || 1920;
      const vh = video.height || 1080;
      const frameAspect = 16 / 9;      // preview area aspect (pw/ph)
      const videoAspect = vw / vh;
      const initW = 25;                 // 25% of preview width
      const initH = initW * (frameAspect / videoAspect);
      addClipToTrack(overlayTrack.id, {
        type: 'video',
        name: video.name,
        videoId: video.id,
        videoUrl: video.url,
        startTime: state.currentTime,
        endTime: Math.min(state.duration, state.currentTime + clipDuration),
        sourceStart: 0,
        sourceEnd: clipDuration,
        x: 20,
        y: 20,
        width: initW,
        height: initH,
        opacity: 1,
        rotation: 0,
        lockAspectRatio: true,
      });
    },
    [state.tracks, state.duration, state.currentTime, addClipToTrack]
  );

  const handleAddVideoToTrack = useCallback(
    (video) => {
      // Add to the last (most recently created) video track
      const videoTracks = state.tracks.filter((t) => t.type === 'video');
      const videoTrack = videoTracks[videoTracks.length - 1];
      if (videoTrack) {
        const clipDuration = Math.min(video.duration, state.duration);
        addClipToTrack(videoTrack.id, {
          type: 'video',
          name: video.name,
          videoId: video.id,
          videoUrl: video.url,
          startTime: 0,
          endTime: clipDuration,
          sourceStart: 0,
          sourceEnd: clipDuration,
          x: 0,
          y: 0,
          width: video.width || 1920,
          height: video.height || 1080,
        });
      }
    },
    [state.tracks, state.duration, addClipToTrack]
  );

  const handleAddImageToTrack = useCallback(
    (image) => {
      const overlayTrack = state.tracks.find((t) => t.type === 'overlay');
      if (overlayTrack) {
        // Calculate initial overlay size preserving source aspect ratio
        const vw = image.width || 1920;
        const vh = image.height || 1080;
        const frameAspect = 16 / 9;
        const imgAspect = vw / vh;
        const initW = 20;
        const initH = initW * (frameAspect / imgAspect);
        addClipToTrack(overlayTrack.id, {
          type: 'image',
          name: image.name,
          imageId: image.id,
          imageUrl: image.url,
          startTime: state.currentTime,
          endTime: state.currentTime + 5,
          x: 30,
          y: 30,
          width: initW,
          height: initH,
          opacity: 1,
          rotation: 0,
          lockAspectRatio: true,
        });
      }
    },
    [state.tracks, state.currentTime, addClipToTrack]
  );

  const handleRecordingChange = useCallback(({ isRecording, seconds, stop }) => {
    setRecordingState({ isRecording, seconds });
    stopRef.current = stop;
  }, []);

  const handleStopFromSidebar = useCallback(() => {
    if (stopRef.current) {
      stopRef.current();
    }
  }, []);

  // Handle paste: extract images from clipboard and add to media library
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData.items;
    const imageFiles = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Rename with a timestamp for clarity
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const renamed = new File([file], `Pasted Image ${ts}.png`, { type: file.type });
          imageFiles.push(renamed);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      processFiles(imageFiles);
    }
  }, [processFiles]);

  // Add paste listener on mount
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleDownloadVideo = useCallback((video) => {
    const a = document.createElement('a');
    a.href = video.url;
    a.download = video.name.endsWith('.webm') ? video.name : `${video.name}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const formatTimer = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`media-panel${isDragOver ? ' media-panel-drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h3 className="panel-title">Media Library</h3>

      <div className="media-upload-section">
        <div className="upload-buttons">
          <button
            className="upload-btn"
            onClick={() => videoInputRef.current?.click()}
          >
            <Upload size={14} /> Upload Video
          </button>
          <button
            className="upload-btn"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageIcon size={14} /> Upload Image
          </button>

          {recordingState.isRecording ? (
            <button
              className="upload-btn rec-btn rec-btn-recording"
              onClick={handleStopFromSidebar}
              title="Click to stop recording"
            >
              <span className="rec-sidebar-dot"></span>
              <span className="rec-sidebar-timer">{formatTimer(recordingState.seconds)}</span>
              <Square size={12} />
            </button>
          ) : (
            <button
              className="upload-btn rec-btn"
              onClick={() => setShowRecorder(true)}
              title="Record Screen"
            >
              <Monitor size={14} />
              <span>Record Screen</span>
            </button>
          )}

          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleVideoUpload}
            style={{ display: 'none' }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {state.videos.length > 0 && (
        <div className="media-section">
          <h4 className="media-section-title">
            <Video size={14} /> Videos ({state.videos.length})
          </h4>
          <div className="media-list">
            {state.videos.map((video) => (
              <div key={video.id} className="media-item">
                <div className="media-item-preview">
                  <video src={video.url} muted />
                </div>
                <div className="media-item-info">
                  <span className="media-item-name" title={video.name}>
                    {video.name}
                  </span>
                  <span className="media-item-meta">
                    {formatTime(video.duration)} | {video.width}x{video.height}
                  </span>
                </div>
                <div className="media-item-actions">
                  <button
                    className="media-action-btn"
                    onClick={() => handleAddVideoToTrack(video)}
                    title="Add to Video Track"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="media-action-btn overlay"
                    onClick={() => handleAddVideoAsOverlay(video)}
                    title="Add as Overlay"
                  >
                    <ImageIcon size={14} />
                  </button>
                  {video.name.startsWith('Screen Recording') && (
                    <button
                      className="media-action-btn"
                      onClick={() => handleDownloadVideo(video)}
                      title="Download as WebM"
                    >
                      <Download size={14} />
                    </button>
                  )}
                  <button
                    className="media-action-btn danger"
                    onClick={() => deleteVideo(video.id)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.images.length > 0 && (
        <div className="media-section">
          <h4 className="media-section-title">
            <ImageIcon size={14} /> Images ({state.images.length})
          </h4>
          <div className="media-list">
            {state.images.map((image) => (
              <div key={image.id} className="media-item">
                <div className="media-item-preview">
                  <img src={image.url} alt={image.name} />
                </div>
                <div className="media-item-info">
                  <span className="media-item-name" title={image.name}>
                    {image.name}
                  </span>
                  <span className="media-item-meta">
                    {image.width}x{image.height}
                  </span>
                </div>
                <div className="media-item-actions">
                  <button
                    className="media-action-btn"
                    onClick={() => handleAddImageToTrack(image)}
                    title="Add as Overlay"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="media-action-btn danger"
                    onClick={() => deleteImage(image.id)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.videos.length === 0 && state.images.length === 0 && (
        <div className="media-empty">
          <Upload size={32} />
          <p>Upload videos or images to get started</p>
        </div>
      )}

      {showRecorder && (
        <ScreenRecorderPiP
          addVideo={addVideo}
          onClose={() => setShowRecorder(false)}
          onRecordingChange={handleRecordingChange}
        />
      )}
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
