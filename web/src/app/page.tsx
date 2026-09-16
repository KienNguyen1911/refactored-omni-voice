"use client";

import React, { useState, useEffect } from "react";
import {
  Voice,
  BackendHealth,
  GenerationResult,
  TaskStats,
  fetchVoices,
  fetchHealth,
  fetchTaskStats,
} from "@/lib/api";
import VoiceLibrary from "@/components/VoiceLibrary";
import VoiceCloneStudio from "@/components/VoiceCloneStudio";
import VoiceDesignStudio from "@/components/VoiceDesignStudio";
import AudioPlayerBar from "@/components/AudioPlayerBar";
import TaskQueueHistory from "@/components/TaskQueueHistory";
import ApiDocumentation from "@/components/ApiDocumentation";
import {
  Mic,
  Wand2,
  Library,
  Layers,
  Radio,
  Activity,
  Loader2,
  Cpu,
  Code2,
} from "lucide-react";

export default function Home() {
  const [activeNav, setActiveNav] = useState<"studio" | "library" | "history" | "docs">("studio");
  const [studioMode, setStudioMode] = useState<"clone" | "design">("clone");

  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [currentAudioResult, setCurrentAudioResult] = useState<GenerationResult | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);

  // Load health, voices, and task stats
  useEffect(() => {
    loadHealth();
    loadVoices();
    loadStats();

    const interval = setInterval(() => {
      loadHealth();
      loadStats();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const loadHealth = async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
    } catch {
      setHealth(null);
    }
  };

  const loadStats = async () => {
    try {
      const s = await fetchTaskStats();
      setTaskStats(s);
    } catch {
      // ignore
    }
  };

  const loadVoices = async () => {
    try {
      const list = await fetchVoices();
      setVoices(list);
      if (list.length > 0 && !selectedVoice) {
        setSelectedVoice(list[0]);
      }
    } catch (err) {
      console.error("Failed to load voices:", err);
    }
  };

  const handleGenerationComplete = (result: GenerationResult) => {
    setCurrentAudioResult(result);
    loadStats();
  };

  const isWorkerBusy = (taskStats?.processing || 0) > 0;
  const hasPendingTasks = (taskStats?.pending || 0) > 0;

  return (
    <div className="h-screen max-h-screen bg-[#08090b] text-[#f1f3f7] flex flex-col font-sans overflow-hidden">
      {/* Swiss Precision Top Header */}
      <header className="shrink-0 sticky top-0 z-30 border-b border-[#181b22] bg-[#0c0e12]/90 backdrop-blur-md">
        <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 h-13 flex items-center justify-between gap-4">
          {/* Brand & Monospace Telemetry */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#161920] border border-[#232836] flex items-center justify-center text-blue-400">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">
                  OmniVoice
                </span>
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-[#161920] text-blue-400 border border-[#232836] uppercase tracking-wider">
                  Studio
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  v0.2.1
                </span>
              </div>
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="flex items-center p-0.5 rounded-md bg-[#08090b] border border-[#1e222b] text-xs">
            <button
              onClick={() => setActiveNav("studio")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                activeNav === "studio"
                  ? "bg-[#161920] text-white border border-[#2a2f3d]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              <span>Trạm Studio (DAW)</span>
            </button>

            <button
              onClick={() => setActiveNav("library")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                activeNav === "library"
                  ? "bg-[#161920] text-white border border-[#2a2f3d]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Library className="w-3.5 h-3.5" />
              <span>Kho Giọng</span>
              <span className="text-[10px] font-mono text-slate-500">
                ({voices.length})
              </span>
            </button>

            <button
              onClick={() => setActiveNav("history")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer relative ${
                activeNav === "history"
                  ? "bg-[#161920] text-white border border-[#2a2f3d]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Hàng Đợi</span>
              {isWorkerBusy ? (
                <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-400/10 text-amber-300 border border-amber-400/30 animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  {taskStats?.processing} running
                </span>
              ) : hasPendingTasks ? (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                  {taskStats?.pending} queued
                </span>
              ) : taskStats && taskStats.total > 0 ? (
                <span className="text-[10px] font-mono text-slate-500">
                  ({taskStats.total})
                </span>
              ) : null}
            </button>

            <button
              onClick={() => setActiveNav("docs")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                activeNav === "docs"
                  ? "bg-[#161920] text-white border border-[#2a2f3d]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Tài Liệu API</span>
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                v1.1
              </span>
            </button>
          </nav>

          {/* Backend / GPU Status Badge */}
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#08090b] border border-[#1e222b] text-[11px] font-mono">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  health?.status === "online" ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                }`}
              />
              <span className="text-slate-300 truncate max-w-[220px]">
                {health?.status === "online"
                  ? `${health.gpu_name} (24kHz)`
                  : "Đang kết nối backend..."}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Studio Canvas - Locked to Viewport Height */}
      <main className={`flex-1 min-h-0 w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col overflow-hidden ${currentAudioResult ? "pb-24" : "pb-2.5"}`}>
        {activeNav === "studio" && (
          <div className="flex-1 min-h-0 flex flex-col space-y-2.5 overflow-hidden">
            {/* Studio Mode Switcher Toolbar */}
            <div className="shrink-0 flex items-center justify-between bg-[#0e1014] border border-[#1e222b] rounded-lg p-1.5">
              <div className="flex items-center gap-1 bg-[#08090b] p-0.5 rounded border border-[#1e222b] text-xs">
                <button
                  type="button"
                  onClick={() => setStudioMode("clone")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                    studioMode === "clone"
                      ? "bg-[#161920] text-white border border-[#2a2f3d]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Mic className="w-3.5 h-3.5 text-blue-400" />
                  <span>Voice Clone (Nhân bản giọng)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStudioMode("design")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                    studioMode === "design"
                      ? "bg-[#161920] text-white border border-[#2a2f3d]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Voice Design (Thiết kế giọng mới)</span>
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 font-mono pr-2">
                <span>Massively Multilingual (600+ Languages)</span>
                <span>•</span>
                <span className="text-emerald-400">RTF ~0.025</span>
              </div>
            </div>

            {/* Sub-Studio Views (Full height, no outer scroll) */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {studioMode === "clone" ? (
                <VoiceCloneStudio
                  voices={voices}
                  selectedVoice={selectedVoice}
                  onOpenLibrary={() => setActiveNav("library")}
                  onGenerationComplete={handleGenerationComplete}
                  onOpenQueue={() => setActiveNav("history")}
                />
              ) : (
                <VoiceDesignStudio
                  onGenerationComplete={handleGenerationComplete}
                  onOpenQueue={() => setActiveNav("history")}
                />
              )}
            </div>
          </div>
        )}

        {activeNav === "library" && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <VoiceLibrary
              voices={voices}
              selectedVoiceId={selectedVoice?.id || null}
              onSelectVoice={(v) => {
                setSelectedVoice(v);
                setActiveNav("studio");
                setStudioMode("clone");
              }}
              onRefreshVoices={loadVoices}
            />
          </div>
        )}

        {activeNav === "history" && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <TaskQueueHistory
              onPlayAudio={(res) => setCurrentAudioResult(res)}
              onSelectTab={(tab) => {
                setActiveNav("studio");
                setStudioMode(tab);
              }}
            />
          </div>
        )}

        {activeNav === "docs" && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <ApiDocumentation />
          </div>
        )}
      </main>

      {/* Floating Master Audio Deck */}
      <AudioPlayerBar
        currentResult={currentAudioResult}
        onClose={() => setCurrentAudioResult(null)}
        onOpenQueue={() => setActiveNav("history")}
      />
    </div>
  );
}
