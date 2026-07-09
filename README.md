# Video Labeling — Video Editor & Labeler

A browser-based video editing application built with React that lets you import videos and images, arrange them on a multi-track timeline, draw overlay shapes (rectangles, circles, triangles, arrows, lines, text), adjust playback speed, trim clips, record screen, and export the final composition as WebM or MP4 — all client-side, no server required.

## Preview

![Video Labeling Preview](https://raw.githubusercontent.com/didi-stwn/video-labeling/main/public/video_labeling.png)

[![🚀 Live Demo](https://img.shields.io/badge/🚀_Live_Demo-Click_Here-4FC08D?style=for-the-badge)](https://didi-stwn.github.io/video-labeling/)

## Features

### Media Management ([`MediaPanel.js`](src/components/MediaPanel.js))
- **Import videos & images** — drag-and-drop or click to upload from your computer
- **Import from URL** — paste a video URL to load it directly
- **Screen Recording** — click "Record Screen" to show a popover with two options:
  - **Open PiP** — opens a Picture-in-Picture window with recording controls ([`ScreenRecorderPiP.js`](src/components/ScreenRecorderPiP.js))
  - **Record Now** — starts recording directly in-page with a minimal overlay UI ([`DirectRecorder.js`](src/components/DirectRecorder.js))
- **Manage media library** — delete imported videos/images from the sidebar list

### Multi-Track Timeline ([`Timeline.js`](src/components/Timeline.js))
- **Video track** — primary video layer; add multiple video clips
- **Overlay tracks** — unlimited overlay layers for shapes, images, text, and video overlays
- **Track controls** — add, remove, rename, reorder, collapse/expand tracks
- **Drag to move clips** — reorder clips within or between tracks
- **Edge-drag trimming** — drag the start or end edge of any clip to trim its duration
- **Hover split button** — hover over any clip to reveal a split (scissors) button at the current playhead position; click it to cut the clip in two
- **Playhead scrubbing** — drag the playhead to seek through the timeline
- **Zoom in/out** — adjust the timeline zoom level for finer editing
- **Keyboard shortcuts** — play/pause (Space), seek forward/back

### Drawing Tools ([`Header.js`](src/components/Header.js))
- **Selection tool (V)** — select, drag, resize, and rotate overlays on the canvas
- **Rectangle (R)** — draw filled/stroked rectangles
- **Circle (C)** — draw ellipses
- **Triangle (T)** — draw triangles
- **Arrow (A)** — draw arrows with arrowhead
- **Line (L)** — draw straight lines
- **Text (X)** — add text labels

### Properties Panel ([`PropertiesPanel.js`](src/components/PropertiesPanel.js))
- **Position & Size** — edit X/Y position (%), width/height (%), rotation angle
- **Lock aspect ratio** — maintain media aspect ratio when resizing video/image overlays
- **Timing** — edit start time, end time, and duration for any clip
- **Playback Speed** — adjust video playback rate (0.25× to 4×); duration auto-scales proportionally. Preset buttons: 0.25×, 0.5×, 0.75×, 1×, 1.5×, 2×, 3×, 4×
- **Appearance** — edit stroke color, fill color, stroke width, opacity, border radius (rectangles), font family, font size, text color, and text content
- **Duplicate & Delete** — copy or remove any selected clip

### Canvas Preview ([`PreviewCanvas.js`](src/components/PreviewCanvas.js))
- Live canvas rendering of all video clips and overlay elements at native quality
- Real-time playback at the configured speed rate
- Selection handles for resize and rotation (dashed outline, corner handles, rotation handle)
- Interactive drag-to-draw for new shapes
- Letterboxing/pillarboxing for mixed-aspect-ratio videos

### Export ([`PreviewCanvas.js`](src/components/PreviewCanvas.js), [`ffmpeg.js`](src/utils/ffmpeg.js))
- **Export as WebM** — fast, VP9 codec, no transcoding needed
- **Export as MP4** — client-side transcoding via FFmpeg.wasm to H.264
- **Pixel-perfect quality** — export renders at native video resolution (the first video clip's dimensions) so shapes, strokes, text, and other overlays match exactly what you see in the preview. Stroke widths, font sizes, and arrow head sizes are automatically scaled to the export resolution.
- **Cancel export** — stop an in-progress export at any time
- **Progress indicator** — real-time percentage display in the header

## State Management ([`VideoContext.js`](src/context/VideoContext.js))

All editor state is managed through React Context with `useReducer`. The reducer handles:
- Media CRUD (videos, images)
- Clip CRUD (add, update, delete, duplicate, split, trim)
- Track management (add, remove, rename, reorder, toggle collapse)
- Playback controls (play, pause, seek, speed)
- Tool selection
- Zoom level
- Export state and progress

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

### `npm test`

Launches the test runner in interactive watch mode.

## Project Structure

```
src/
├── App.js                          # Root layout: header, sidebar, canvas, timeline
├── App.css                         # All application styles
├── context/
│   └── VideoContext.js             # Global state (reducer + context provider)
├── components/
│   ├── Header.js                   # Toolbar + export buttons
│   ├── MediaPanel.js               # Left sidebar: media library + screen recorder
│   ├── PreviewCanvas.js            # Canvas rendering + export capture
│   ├── PropertiesPanel.js          # Right sidebar: element property editor
│   ├── Timeline.js                 # Multi-track timeline with clip editing
│   ├── ScreenRecorderPiP.js        # Picture-in-Picture screen recorder
│   ├── DirectRecorder.js           # In-page screen recorder (no PiP)
│   └── Timeline.js                 # Multi-track timeline
└── utils/
    └── ffmpeg.js                   # FFmpeg.wasm MP4 transcoding
```

## Tech Stack

- **React** — UI framework
- **Canvas API** — real-time rendering and drawing
- **MediaRecorder API** + **canvas.captureStream()** — WebM recording
- **Document Picture-in-Picture API** — PiP screen recording window
- **FFmpeg.wasm** — client-side WebM → MP4 transcoding
- **Lucide React** — icon library
