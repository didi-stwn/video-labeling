import React from 'react';
import { useVideo } from '../context/VideoContext';
import {
  MousePointer2,
  Square,
  Circle,
  Triangle,
  ArrowRight,
  Minus,
  Type,
  Save,
} from 'lucide-react';

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select (V)' },
  { id: 'rect', icon: Square, label: 'Rectangle (R)' },
  { id: 'circle', icon: Circle, label: 'Circle (C)' },
  { id: 'triangle', icon: Triangle, label: 'Triangle (T)' },
  { id: 'arrow', icon: ArrowRight, label: 'Arrow (A)' },
  { id: 'line', icon: Minus, label: 'Line (L)' },
  { id: 'text', icon: Type, label: 'Text (X)' },
];

export default function Header() {
  const { state, setTool, setExporting } = useVideo();

  const handleExport = () => {
    if (state.isExporting) {
      setExporting(false, 0);
    } else {
      setExporting(true, 0);
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">Video Labeling</h1>
        <span className="header-subtitle">Video Editor & Labeler</span>
      </div>

      <div className="header-right">
        <div className="tool-bar">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${state.tool === t.id ? 'active' : ''}`}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              <t.icon size={16} />
            </button>
          ))}
        </div>
        <div className="header-actions">
          <button
            className={`action-btn export-btn ${state.isExporting ? 'exporting' : ''}`}
            onClick={handleExport}
            title={state.isExporting ? 'Cancel Export' : 'Export Video'}
          >
            {state.isExporting ? (
              <>
                <span className="export-spinner" />
                <span>{state.exportProgress}%</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Export</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
