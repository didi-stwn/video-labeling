import React from 'react';
import { VideoProvider } from './context/VideoContext';
import Header from './components/Header';
import MediaPanel from './components/MediaPanel';
import PreviewCanvas from './components/PreviewCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';
import './App.css';

// force update
export default function App() {
  return (
    <VideoProvider>
      <div className="app">
        <Header />
        <div className="app-main">
          <aside className="sidebar sidebar-left">
            <MediaPanel />
          </aside>
          <div className="center-area">
            <PreviewCanvas />
            <Timeline />
          </div>
          <aside className="sidebar sidebar-right">
            <PropertiesPanel />
          </aside>
        </div>
      </div>
    </VideoProvider>
  );
}
