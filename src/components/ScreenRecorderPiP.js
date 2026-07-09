import { useRef, useCallback, useEffect } from 'react';

const PIP_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a1a;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    width: 100%;
  }
  .timer {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #fff;
    min-height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 28px;
    border: none;
    border-radius: 40px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 150ms;
    min-width: 120px;
  }
  .btn-start { background: #e03131; color: #fff; }
  .btn-start:hover { background: #c92a2a; }
  .btn-stop { background: #e03131; color: #fff; }
  .btn-stop:hover { background: #c92a2a; }
  .btn-disabled { background: #444; color: #888; cursor: not-allowed; }
  .status-label { font-size: 13px; color: #aaa; text-align: center; }
  .rec-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff4444;
    animation: blink 1s ease-in-out infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;

const formatTimer = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

export default function ScreenRecorderPiP({ addVideo, onClose, onRecordingChange }) {
  const pipRef = useRef(null);
  const streamRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const secRef = useRef(0);
  const addVideoRef = useRef(addVideo);
  const onCloseRef = useRef(onClose);
  const onRecordingChangeRef = useRef(onRecordingChange);
  const stopFnRef = useRef(null);

  addVideoRef.current = addVideo;
  onCloseRef.current = onClose;
  onRecordingChangeRef.current = onRecordingChange;

  // Notify parent of recording state and provide a stop function
  const notifyState = useCallback((isRecording, seconds) => {
    if (onRecordingChangeRef.current) {
      onRecordingChangeRef.current({
        isRecording,
        seconds,
        stop: isRecording && stopFnRef.current ? stopFnRef.current : null,
      });
    }
  }, []);

  // Inject CSS once
  const initPipDoc = useCallback((pipWin) => {
    const s = pipWin.document.createElement('style');
    s.textContent = PIP_STYLES;
    pipWin.document.head.appendChild(s);

    const root = pipWin.document.createElement('div');
    root.id = 'pip-root';
    pipWin.document.body.appendChild(root);
    return root;
  }, []);

  // Render a view into the PiP
  const setView = useCallback((pipWin, html) => {
    const root = pipWin.document.getElementById('pip-root');
    if (root) root.innerHTML = html;
  }, []);

  // Show idle
  const showIdle = useCallback((pipWin) => {
    setView(pipWin, `
      <div class="container">
        <button class="btn btn-start" id="pip-btn">● Start Recording</button>
      </div>
    `);
    const btn = pipWin.document.getElementById('pip-btn');
    if (btn) btn.onclick = () => doStart(pipWin);
    notifyState(false, 0);
  }, [setView, notifyState]);

  // Show requesting
  const showRequesting = useCallback((pipWin) => {
    setView(pipWin, `
      <div class="container">
        <div class="status-label">Select a screen to share...</div>
      </div>
    `);
  }, [setView]);

  // Show recording (merged timer + stop button)
  const showRecording = useCallback((pipWin) => {
    setView(pipWin, `
      <div class="container">
        <button class="btn btn-stop" id="pip-btn">
          <span class="rec-dot"></span> ${formatTimer(secRef.current)} <span style="font-size:18px;">■</span>
        </button>
      </div>
    `);
    const btn = pipWin.document.getElementById('pip-btn');
    if (btn) btn.onclick = () => doStop();
    notifyState(true, secRef.current);
  }, [setView, notifyState]);

  // Show saving
  const showSaving = useCallback((pipWin) => {
    setView(pipWin, `
      <div class="container">
        <div style="font-size:20px;">💾</div>
        <div class="status-label">Saving to Media Library...</div>
      </div>
    `);
  }, [setView]);

  // Show done
  const showDone = useCallback((pipWin) => {
    setView(pipWin, `
      <div class="container">
        <div style="font-size:20px;">✅</div>
        <div class="timer" style="font-size:16px;color:#69db7c;">Saved!</div>
      </div>
    `);
  }, [setView]);

  // Update timer text inside the merged button without re-rendering whole view
  const updateTimerText = useCallback((pipWin) => {
    const el = pipWin.document.getElementById('pip-btn');
    if (el) {
      el.innerHTML = `<span class="rec-dot"></span> ${formatTimer(secRef.current)} <span style="font-size:18px;">■</span>`;
      // Re-bind onclick since innerHTML replacement destroys it
      el.onclick = () => doStop();
    }
    notifyState(true, secRef.current);
  }, [notifyState]);

  // Stop recording
  const doStop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop();
    }
  }, []);

  // Keep stopFnRef updated
  stopFnRef.current = doStop;

  // Start recording
  const doStart = useCallback(async (pipWin) => {
    showRequesting(pipWin);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      streamRef.current = stream;
      chunksRef.current = [];
      secRef.current = 0;

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm',
      });
      mrRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => doFinish(pipWin);

      mr.start();

      // Show recording UI
      showRecording(pipWin);

      // Start timer — only update the text, don't re-render
      timerRef.current = setInterval(() => {
        secRef.current += 1;
        if (pipRef.current) updateTimerText(pipRef.current);
      }, 1000);

      // If browser closes share bar
      stream.getVideoTracks()[0].onended = () => doStop();

    } catch (err) {
      console.error('Screen capture error:', err);
      showIdle(pipWin);
    }
  }, [showRequesting, showRecording, showIdle, updateTimerText]);

  // Finish: save to library
  const doFinish = useCallback((pipWin) => {
    showSaving(pipWin);

    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `Screen Recording ${ts}`;

    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
      addVideoRef.current(name, url, tempVideo.duration, tempVideo.videoWidth || 1920, tempVideo.videoHeight || 1080);

      const pw = pipRef.current;
      if (pw) {
        showDone(pw);
        // Show "Saved!" briefly, then reset to idle so user can record again
        setTimeout(() => {
          if (pipRef.current) showIdle(pipRef.current);
        }, 1200);
      }
    };
    tempVideo.src = url;
    chunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [showSaving, showDone, notifyState]);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Open PiP on mount
  useEffect(() => {
    let pipWin = null;
    let closedByAction = false;

    async function open() {
      try {
        if (!('documentPictureInPicture' in window)) {
          alert('Document Picture-in-Picture requires Chrome 116+.');
          onCloseRef.current();
          return;
        }

        pipWin = await window.documentPictureInPicture.requestWindow({
          width: 280,
          height: 200,
        });

        pipRef.current = pipWin;
        initPipDoc(pipWin);
        showIdle(pipWin);

        pipWin.addEventListener('pagehide', () => {
          if (!closedByAction) {
            cleanup();
            notifyState(false, 0);
            pipRef.current = null;
            onCloseRef.current();
          }
        });

      } catch (err) {
        console.error('PiP error:', err);
        onCloseRef.current();
      }
    }

    open();

    return () => {
      closedByAction = true;
      cleanup();
      if (pipWin && !pipWin.closed) {
        try { pipWin.close(); } catch {}
      }
      pipRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
