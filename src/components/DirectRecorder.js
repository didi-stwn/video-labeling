import React, { useRef, useCallback, useEffect, useState } from 'react';

const formatTimer = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

export default function DirectRecorder({ addVideo, onClose, onRecordingChange }) {
  const [phase, setPhase] = useState('idle'); // idle | requesting | recording | saving
  const [seconds, setSeconds] = useState(0);
  const streamRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const secRef = useRef(0);
  const addVideoRef = useRef(addVideo);
  const onCloseRef = useRef(onClose);
  const onRecordingChangeRef = useRef(onRecordingChange);
  const finishRef = useRef(null);

  addVideoRef.current = addVideo;
  onCloseRef.current = onClose;
  onRecordingChangeRef.current = onRecordingChange;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      try { mrRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    setPhase('saving');

    // Notify parent
    if (onRecordingChangeRef.current) {
      onRecordingChangeRef.current({ isRecording: false, seconds: secRef.current, stop: null });
    }

    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `Screen Recording ${ts}`;

    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
      addVideoRef.current(name, url, tempVideo.duration, tempVideo.videoWidth || 1920, tempVideo.videoHeight || 1080);
      // Brief "Saved!" then close
      setTimeout(() => {
        if (onCloseRef.current) onCloseRef.current();
      }, 800);
    };
    tempVideo.src = url;
    chunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  finishRef.current = finish;

  const handleStart = useCallback(async () => {
    setPhase('requesting');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      streamRef.current = stream;
      chunksRef.current = [];
      secRef.current = 0;
      setSeconds(0);
      setPhase('recording');

      // Notify parent
      if (onRecordingChangeRef.current) {
        onRecordingChangeRef.current({ isRecording: true, seconds: 0, stop: null });
      }

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm',
      });
      mrRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        if (finishRef.current) finishRef.current();
      };

      mr.start();

      // Timer
      timerRef.current = setInterval(() => {
        secRef.current += 1;
        setSeconds(secRef.current);
      }, 1000);

      // Handle user closing share bar via browser UI
      stream.getVideoTracks()[0].onended = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (mrRef.current && mrRef.current.state !== 'inactive') {
          mrRef.current.stop();
        }
      };
    } catch (err) {
      console.error('Screen capture error:', err);
      // If user cancelled the share dialog, go back to idle
      if (phase !== 'recording') {
        setPhase('idle');
      }
    }
  }, [phase]);

  const handleStop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return (
    <div className="direct-recorder-overlay">
      {phase === 'idle' && (
        <div className="direct-recorder-card">
          <div className="direct-recorder-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3" fill="currentColor"/>
            </svg>
          </div>
          <div className="direct-recorder-text">Ready to record your screen</div>
          <button className="direct-recorder-start-btn" onClick={handleStart}>
            <span className="rec-dot-inline" /> Start Recording
          </button>
          <button className="direct-recorder-cancel-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}

      {phase === 'requesting' && (
        <div className="direct-recorder-card">
          <div className="direct-recorder-spinner" />
          <div className="direct-recorder-text">Select a screen to share...</div>
        </div>
      )}

      {phase === 'recording' && (
        <div className="direct-recorder-card recording">
          <button className="direct-recorder-stop-btn" onClick={handleStop} title="Stop Recording">
            <span className="direct-recorder-dot" />
            <span className="direct-recorder-timer">{formatTimer(seconds)}</span>
            <span className="direct-recorder-stop-icon">■</span>
          </button>
        </div>
      )}

      {phase === 'saving' && (
        <div className="direct-recorder-card">
          <div className="direct-recorder-saved-icon">💾</div>
          <div className="direct-recorder-text">Saving to Media Library...</div>
        </div>
      )}
    </div>
  );
}
