/**
 * Lazy-loaded FFmpeg.wasm singleton — transcodes WebM → MP4 entirely client-side.
 * The ~31 MB WebAssembly binary is fetched once on first use and cached in memory.
 */

let ffmpeg = null;
let loadPromise = null;

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;

  if (!loadPromise) {
    loadPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');

      const instance = new FFmpeg();

      // Explicit CDN URLs matching @ffmpeg/core@0.12.6 (the version bundled
      // with @ffmpeg/ffmpeg@0.12.10). Using raw URLs (not Blob URLs) for
      // maximum reliability with CRA's webpack setup.
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await instance.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        workerURL: `${baseURL}/ffmpeg-core.worker.js`,
      });

      ffmpeg = instance;
      return instance;
    })();
  }

  return loadPromise;
}

/**
 * Transcodes a WebM Blob → MP4 (H.264) Blob.
 *
 * @param {Blob} webmBlob  - The source WebM from MediaRecorder
 * @param {number} [fps=30] - Frame rate used for encoding
 * @returns {Promise<Blob>}  MP4 Blob
 */
export async function webmToMp4(webmBlob, fps = 30) {
  const fm = await getFFmpeg();

  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  await fm.writeFile(inputName, await fetchFile(webmBlob));

  await fm.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-r', String(fps),
    outputName,
  ]);

  const data = await fm.readFile(outputName);

  const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });

  await fm.deleteFile(inputName);
  await fm.deleteFile(outputName);

  return mp4Blob;
}
