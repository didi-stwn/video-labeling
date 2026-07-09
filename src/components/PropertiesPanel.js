import React, { useCallback, useRef } from 'react';
import { useVideo } from '../context/VideoContext';
import { Trash2, Copy } from 'lucide-react';

export default function PropertiesPanel() {
  const {
    state,
    getSelectedElement,
    updateClip,
    deleteClip,
    duplicateClip,
    // selectElement,
    // deselectAll,
  } = useVideo();

  const element = getSelectedElement();

  // Debounce refs: delay rapid-fire updates (color drag, range drag, etc.)
  const debounceTimers = useRef({});
  const pendingValues = useRef({});
  const elementIdRef = useRef(element?.id);
  elementIdRef.current = element?.id;

  // Pure trailing debounce: no dispatch during dragging — only flush the
  // final value after `delay` ms of silence. Eliminates lag from rapid
  // onChange events on color pickers, range sliders, etc.
  const debouncedUpdate = useCallback(
    (field, value, delay = 50) => {
      const id = elementIdRef.current;
      if (!id) return;

      // Store latest value for the trailing flush
      pendingValues.current[field] = value;

      // Reset the trailing timer: keep deferring until the user stops dragging
      if (debounceTimers.current[field]) {
        clearTimeout(debounceTimers.current[field]);
      }
      debounceTimers.current[field] = setTimeout(() => {
        const finalVal = pendingValues.current[field];
        if (finalVal !== undefined && elementIdRef.current === id) {
          updateClip(id, { [field]: finalVal });
        }
        delete debounceTimers.current[field];
        delete pendingValues.current[field];
      }, delay);
    },
    [updateClip]
  );

  const handleUpdate = useCallback(
    (field, value) => {
      if (element) {
        updateClip(element.id, { [field]: value });
      }
    },
    [element, updateClip]
  );

  const handleSpeedChange = useCallback(
    (rate) => {
      if (!element) return;
      const sourceDuration = (element.sourceEnd || 0) - (element.sourceStart || 0);
      const timelineDuration = sourceDuration / rate;
      const newEndTime = element.startTime + timelineDuration;
      updateClip(element.id, { playbackRate: rate, endTime: newEndTime });
    },
    [element, updateClip]
  );

  if (!element) {
    return (
      <div className="properties-panel">
        <h3 className="panel-title">Properties</h3>
        <div className="properties-empty">
          <p>Select an element on the canvas or timeline to view and edit its properties</p>
        </div>
      </div>
    );
  }

  // A clip is an overlay if it lives on an overlay track, OR is a shape/text/image type
  const elementTrack = state.tracks.find(t => t.id === element.trackId);
  const isOnOverlayTrack = elementTrack?.type === 'overlay';
  const isOverlay =
    isOnOverlayTrack ||
    element.type === 'rect' ||
    element.type === 'circle' ||
    element.type === 'triangle' ||
    element.type === 'arrow' ||
    element.type === 'line' ||
    element.type === 'text' ||
    element.type === 'image';

  return (
    <div className="properties-panel">
      <h3 className="panel-title">Properties</h3>

      <div className="properties-content">
        {/* Element Header */}
        <div className="prop-section">
          <div className="prop-section-header">
            <span className="prop-element-type">
              {element.type === 'video'
                ? '🎬'
                : element.type === 'text'
                ? '📝'
                : element.type === 'image'
                ? '🖼️'
                : element.type === 'circle'
                ? '⭕'
                : element.type === 'triangle'
                ? '🔺'
                : element.type === 'arrow'
                ? '➡️'
                : element.type === 'line'
                ? '📏'
                : '⬜'}{' '}
              {element.type.charAt(0).toUpperCase() + element.type.slice(1)}
            </span>
            <div className="prop-header-actions">
              <button
                className="prop-action-btn"
                onClick={() => duplicateClip(element.id, elementTrack?.id)}
                title="Duplicate"
              >
                <Copy size={14} />
              </button>
              <button
                className="prop-action-btn danger"
                onClick={() => deleteClip(element.id)}
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Position & Size - for overlay elements */}
        {isOverlay && (
          <div className="prop-section">
            <h4 className="prop-section-title">Position & Size</h4>
            <div className="prop-grid-2">
              <div className="prop-field">
                <label>X (%)</label>
                <input
                  type="number"
                  value={Math.round(element.x * 10) / 10}
                  onChange={(e) => handleUpdate('x', Number(e.target.value))}
                  step={0.5}
                />
              </div>
              <div className="prop-field">
                <label>Y (%)</label>
                <input
                  type="number"
                  value={Math.round(element.y * 10) / 10}
                  onChange={(e) => handleUpdate('y', Number(e.target.value))}
                  step={0.5}
                />
              </div>
              <div className="prop-field">
                <label>Width (%)</label>
                <input
                  type="number"
                  value={Math.round(element.width * 10) / 10}
                  onChange={(e) => {
                    const w = Math.max(1, Number(e.target.value));
                    const patch = { width: w };
                    // If aspect-ratio locked, auto-adjust height
                    if ((element.type === 'video' || element.type === 'image') && element.lockAspectRatio !== false) {
                      const frameAspect = 16 / 9;
                      const ref = element.type === 'video'
                        ? state.videos.find(v => v.id === element.videoId)
                        : state.images.find(v => v.id === element.imageId);
                      const mw = ref?.width  || 1920;
                      const mh = ref?.height || 1080;
                      if (mw && mh) {
                        patch.height = w * (frameAspect / (mw / mh));
                      }
                    }
                    updateClip(element.id, patch);
                  }}
                  min={1}
                  step={0.5}
                />
              </div>
              <div className="prop-field">
                <label>Height (%)</label>
                <input
                  type="number"
                  value={Math.round(element.height * 10) / 10}
                  onChange={(e) => {
                    const h = Math.max(1, Number(e.target.value));
                    const patch = { height: h };
                    if ((element.type === 'video' || element.type === 'image') && element.lockAspectRatio !== false) {
                      const frameAspect = 16 / 9;
                      const ref = element.type === 'video'
                        ? state.videos.find(v => v.id === element.videoId)
                        : state.images.find(v => v.id === element.imageId);
                      const mw = ref?.width  || 1920;
                      const mh = ref?.height || 1080;
                      if (mw && mh) {
                        patch.width = h * ((mw / mh) / frameAspect);
                      }
                    }
                    updateClip(element.id, patch);
                  }}
                  min={1}
                  step={0.5}
                />
              </div>
            </div>
            {/* Lock aspect ratio checkbox for images and video overlays */}
            {(element.type === 'video' || element.type === 'image') && isOnOverlayTrack && (
              <div className="prop-field" style={{ marginTop: 8 }}>
                <label className="prop-checkbox-label">
                  <input
                    type="checkbox"
                    checked={element.lockAspectRatio !== false}
                    onChange={(e) => handleUpdate('lockAspectRatio', e.target.checked)}
                  />
                  <span>Lock aspect ratio</span>
                </label>
              </div>
            )}
            <div className="prop-field">
              <label>Rotation (°)</label>
              <input
                type="number"
                value={element.rotation || 0}
                onChange={(e) => debouncedUpdate('rotation', Number(e.target.value), 80)}
                step={1}
              />
            </div>
          </div>
        )}

        {/* Timing - all elements */}
        <div className="prop-section">
          <h4 className="prop-section-title">Timing</h4>
          <div className="prop-grid-2">
            <div className="prop-field">
              <label>Start Time (s)</label>
              <input
                type="number"
                value={Math.round(element.startTime * 100) / 100}
                onChange={(e) => {
                  const newStart = Number(e.target.value);
                  // For video clips, cap startTime so sourceStart never goes below 0.
                  // Use the original source video duration as the absolute reference.
                  let cappedStart = Math.max(0, newStart);
                  if (element.type === 'video') {
                    const srcVideo = state.videos.find(v => v.id === element.videoId);
                    const originalDuration = srcVideo ? srcVideo.duration : (element.sourceEnd - element.sourceStart);
                    const timeScale = element.playbackRate || 1;
                    const maxTimelineDuration = originalDuration / timeScale;
                    const maxStart = element.endTime - 0.1;
                    const minStart = Math.max(0, element.endTime - maxTimelineDuration);
                    cappedStart = Math.max(Math.min(cappedStart, maxStart), minStart);
                  }
                  handleUpdate('startTime', Math.max(0, cappedStart));
                }}
                min={0}
                step={0.1}
              />
            </div>
            <div className="prop-field">
              <label>End Time (s)</label>
              <input
                type="number"
                value={Math.round(element.endTime * 100) / 100}
                onChange={(e) => {
                  const newEnd = Number(e.target.value);
                  // For video clips, cap endTime at the original source video duration.
                  let cappedEnd = Math.max(element.startTime + 0.1, newEnd);
                  if (element.type === 'video') {
                    const srcVideo = state.videos.find(v => v.id === element.videoId);
                    const originalDuration = srcVideo ? srcVideo.duration : (element.sourceEnd - element.sourceStart);
                    const timeScale = element.playbackRate || 1;
                    const maxEnd = element.startTime + originalDuration / timeScale;
                    cappedEnd = Math.min(cappedEnd, maxEnd);
                  }
                  handleUpdate('endTime', cappedEnd);
                }}
                min={element.startTime + 0.1}
                step={0.1}
              />
            </div>
          </div>
          <div className="prop-field">
            <label>Duration</label>
            <input
              type="text"
              value={`${(element.endTime - element.startTime).toFixed(2)}s`}
              readOnly
              className="prop-readonly"
            />
          </div>
        </div>

        {/* Opacity for overlay elements */}
        {isOverlay && (
          <div className="prop-section">
            <h4 className="prop-section-title">Opacity</h4>
            <div className="prop-field prop-range">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={element.opacity ?? 1}
                onChange={(e) => debouncedUpdate('opacity', Number(e.target.value))}
              />
              <span className="prop-range-value">
                {Math.round((element.opacity ?? 1) * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* Appearance - shapes and lines */}
        {(element.type === 'rect' ||
          element.type === 'circle' ||
          element.type === 'triangle' ||
          element.type === 'pen' ||
          element.type === 'arrow' ||
          element.type === 'line') && (
          <div className="prop-section">
            <h4 className="prop-section-title">Appearance</h4>
            <div className={element.type === 'pen' ? '' : 'prop-grid-2'}>
              <div className="prop-field">
                <label>Stroke Color</label>
                <input
                  type="color"
                  value={element.strokeColor || '#ff0000'}
                  onChange={(e) => debouncedUpdate('strokeColor', e.target.value)}
                />
              </div>
              {element.type !== 'pen' && (
                <div className="prop-field">
                  <label>Stroke Width</label>
                  <input
                    type="number"
                    value={element.strokeWidth || 2}
                    onChange={(e) =>
                      handleUpdate('strokeWidth', Math.max(1, Number(e.target.value)))
                    }
                    min={1}
                    max={20}
                  />
                </div>
              )}
            </div>
            {element.type !== 'pen' && (
              <div className="prop-field">
                <label>Fill</label>
                <div className="prop-fill-row">
                  <label className="prop-checkbox-label">
                    <input
                      type="checkbox"
                      checked={(element.fillColor || 'rgba(255, 0, 0, 0.3)') !== 'transparent'}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleUpdate('fillColor', 'rgba(255, 0, 0, 0.3)');
                        } else {
                          handleUpdate('fillColor', 'transparent');
                        }
                      }}
                    />
                    <span>Fill</span>
                  </label>
                  <input
                    style={{width:"100%"}}
                    type="color"
                    value={element.fillColor && element.fillColor !== 'transparent' ? element.fillColor : '#ff0000'}
                    onChange={(e) => debouncedUpdate('fillColor', e.target.value)}
                    disabled={element.fillColor === 'transparent'}
                  />
                </div>
              </div>
            )}
            {element.type === 'rect' && (
              <div className="prop-field prop-range">
                <label>Border Radius</label>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={element.borderRadius || 0}
                  onChange={(e) => debouncedUpdate('borderRadius', Number(e.target.value))}
                />
              </div>
            )}
          </div>
        )}

        {/* Text properties */}
        {element.type === 'text' && (
          <div className="prop-section">
            <h4 className="prop-section-title">Text</h4>
            <div className="prop-field">
              <label>Content</label>
              <textarea
                value={element.text || ''}
                onChange={(e) => handleUpdate('text', e.target.value)}
                rows={3}
              />
            </div>
            <div className="prop-field">
              <label>Font Size</label>
              <input
                type="number"
                value={element.fontSize || 24}
                onChange={(e) =>
                  handleUpdate('fontSize', Math.max(8, Number(e.target.value)))
                }
                min={8}
                max={200}
              />
            </div>
            <div className="prop-field">
              <label>Font Family</label>
              <select
                value={element.fontFamily || 'Arial'}
                onChange={(e) => handleUpdate('fontFamily', e.target.value)}
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
                <option value="Impact">Impact</option>
              </select>
            </div>
            <div className="prop-field">
              <label>Color</label>
              <input
                type="color"
                value={element.color || '#ffffff'}
                onChange={(e) => debouncedUpdate('color', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Video properties */}
        {element.type === 'video' && (
          <div className="prop-section">
            <h4 className="prop-section-title">Video</h4>
            <div className="prop-field">
              <label>Name</label>
              <input
                type="text"
                value={element.name || ''}
                onChange={(e) => handleUpdate('name', e.target.value)}
              />
            </div>
            <div className="prop-field prop-speed-field">
              <label>Speed</label>
              <div className="prop-speed-row">
                <input
                  type="range"
                  min={0.25}
                  max={15}
                  step={0.05}
                  value={element.playbackRate ?? 1}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                />
                <span className="prop-range-value prop-speed-value">
                  {(element.playbackRate ?? 1).toFixed(2)}×
                </span>
              </div>
              <div className="prop-speed-presets">
                {[0.25, 0.5, 1, 2, 4, 6, 10  ].map((rate) => (
                  <button
                    key={rate}
                    className={`prop-speed-preset-btn ${(element.playbackRate ?? 1) === rate ? 'active' : ''}`}
                    onClick={() => handleSpeedChange(rate)}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Image overlay properties */}
        {element.type === 'image' && (
          <div className="prop-section">
            <h4 className="prop-section-title">Image</h4>
            <div className="prop-field">
              <label>Name</label>
              <input
                type="text"
                value={element.name || ''}
                onChange={(e) => handleUpdate('name', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ID Info */}
        <div className="prop-section prop-id-section">
          <span className="prop-id">ID: {element.id}</span>
          <span className="prop-id">Track: {element.trackId}</span>
        </div>
      </div>
    </div>
  );
}
