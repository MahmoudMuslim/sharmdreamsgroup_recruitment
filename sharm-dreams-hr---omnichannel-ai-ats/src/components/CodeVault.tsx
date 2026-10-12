import React, { useState } from 'react';
import { FRAPPE_DELIVERABLES } from '../data/frappeFiles';
import { FrappeSourceFile } from '../types';
import { 
  FileCode, Copy, Check, Download, FolderArchive, 
  Terminal, ExternalLink, CheckCircle2, ChevronRight
} from 'lucide-react';
import JSZip from 'jszip';

export const CodeVault: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<FrappeSourceFile>(FRAPPE_DELIVERABLES[0]);
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSingle = () => {
    const blob = new Blob([selectedFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const appFolder = zip.folder("sharm_dreams_hr");

      FRAPPE_DELIVERABLES.forEach(f => {
        appFolder?.file(f.path, f.content);
      });

      // Add __init__.py files
      appFolder?.file("sharm_dreams_hr/__init__.py", "__version__ = '1.0.0'\n");
      appFolder?.file("__init__.py", "");

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = "sharm_dreams_hr_frappe_app.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ZIP creation failed:", e);
    } finally {
      setZipping(false);
    }
  };

  const lineCount = selectedFile.content.split('\n').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <FileCode className="w-4 h-4" />
            Frappe Framework v15/v16 Architecture Vault
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            Custom App: <code className="text-amber-400 font-mono">sharm_dreams_hr</code>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            All 6 production deliverables specified for Sharm Dreams Group. Clean, fully typed, production-ready Python, JavaScript, and JSON fixtures with PyPDF resume parsing and OpenRouter LLM integration.
          </p>
        </div>

        <button
          onClick={handleDownloadZip}
          disabled={zipping}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-amber-950 transition-all shrink-0 disabled:opacity-50"
        >
          <FolderArchive className="w-4 h-4" />
          {zipping ? 'Packaging ZIP...' : 'Download Full Frappe App (.zip)'}
        </button>
      </div>

      {/* Main Code Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Deliverables File List */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
          <div className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
            Architecture Deliverables
          </div>

          <div className="space-y-1.5">
            {FRAPPE_DELIVERABLES.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-start gap-3 ${
                    isSelected
                      ? 'bg-amber-500/15 border border-amber-500/40 text-white shadow-sm'
                      : 'hover:bg-slate-800/60 border border-transparent text-slate-300'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                    isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {file.deliverableNumber}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs font-mono font-semibold truncate ${isSelected ? 'text-amber-300' : 'text-slate-200'}`}>
                        {file.name}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-950 text-slate-400">
                        {file.language}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {file.path}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 px-2 space-y-1">
            <div className="text-slate-400 font-medium">Frappe Bench Compatibility:</div>
            <div>• Frappe Framework: v15.0+ / v16.0+</div>
            <div>• Frappe HR (`hrms`): v15.0+</div>
            <div>• Python: 3.10, 3.11, 3.12</div>
          </div>
        </div>

        {/* Right Pane: Code Viewer */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
          {/* File Header Bar */}
          <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Deliverable #{selectedFile.deliverableNumber}
                </span>
                <span className="text-sm font-mono text-white font-semibold">
                  {selectedFile.path}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {selectedFile.description}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy Code'}
              </button>

              <button
                onClick={handleDownloadSingle}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          </div>

          {/* Code Viewer Container */}
          <div className="flex-1 bg-slate-950 overflow-auto max-h-[600px] p-4 text-xs font-mono leading-relaxed relative">
            <pre className="text-slate-300 whitespace-pre">
              {selectedFile.content}
            </pre>
          </div>

          {/* Footer Bar */}
          <div className="p-3 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between px-4">
            <span>Format: {selectedFile.language.toUpperCase()} • {lineCount} lines</span>
            <span>Target path: apps/sharm_dreams_hr/{selectedFile.path}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
