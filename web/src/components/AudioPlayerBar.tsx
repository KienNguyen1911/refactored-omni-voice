"use client";

import React, { useState, useRef, useEffect } from "react";
import { GenerationResult, getAudioFullUrl } from "@/lib/api";
import {
  Play,
  Pause,
  Download,
  Volume2,
  VolumeX,
  X,
  Radio,
  Clock,
  Zap,
  Repeat,
} from "lucide-react";

interface AudioPlayerBarProps {
  currentResult: GenerationResult | null;
  onClose: () => void;
  onOpenQueue?: () => void;
}

export default function AudioPlayerBar({
  currentResult,
  onClose,
  onOpenQueue,
}: AudioPlayerBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoop, setIsLoop] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (currentResult && audioRef.current) {
      audioRef.current.src = getAudioFullUrl(currentResult.audio_url);
      audioRef.current.load();
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  }, [currentResult]);

  if (!currentResult) return null;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || currentResult.duration_sec || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 1;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const formatPrecisionTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "00:00.00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}.${ms < 10 ? "0" : ""}${ms}`;
  };

  const effectiveDuration = duration || currentResult.duration_sec || 1;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100));

  // Compute RTF
  const rtfValue =
    currentResult.duration_sec && currentResult.generation_time_sec
      ? (currentResult.generation_time_sec / currentResult.duration_sec).toFixed(3)
      : null;

  const speedupX =
    rtfValue && parseFloat(rtfValue) > 0 ? (1 / parseFloat(rtfValue)).toFixed(1) : null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0e12]/95 border-t border-[#1e222b] backdrop-blur-md px-4 py-2.5 shadow-2xl animate-studio-in">
      <audio
        ref={audioRef}
        loop={isLoop}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          if (!isLoop) setIsPlaying(false);
        }}
      />

      <div className="w-full max-w-[1800px] mx-auto px-2 sm:px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Track Metadata & Telemetry */}
        <div className="flex items-center gap-3 w-full md:w-1/3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-[#161920] border border-[#232733] flex items-center justify-center text-blue-400 shrink-0">
            <Radio className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-white truncate max-w-[200px]">
                {currentResult.filename || "audio_output.wav"}
              </span>
              {currentResult.order_num && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#181b24] text-slate-400 border border-[#242836]">
                  #{currentResult.order_num}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                {currentResult.duration_sec?.toFixed(2)}s
              </span>
              {rtfValue && (
                <span className="flex items-center gap-1 text-emerald-400 border-l border-[#242836] pl-2">
                  <Zap className="w-3 h-3" />
                  RTF {rtfValue} ({speedupX}x)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Master Scrubber & Transport Controls */}
        <div className="flex flex-col items-center gap-1.5 w-full md:w-2/4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsLoop(!isLoop)}
              title="Lặp lại (Loop)"
              className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                isLoop ? "text-blue-400 bg-blue-500/10" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-transform active:scale-95 cursor-pointer shadow-sm"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>

            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
              <span className="text-white font-medium">{formatPrecisionTime(currentTime)}</span>
              <span className="text-slate-600">/</span>
              <span>{formatPrecisionTime(effectiveDuration)}</span>
            </div>
          </div>

          {/* Precision scrubber */}
          <div className="w-full flex items-center gap-2">
            <div className="relative flex-1 flex items-center group">
              <input
                type="range"
                min="0"
                max={effectiveDuration}
                step="0.01"
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-[#1a1e27] rounded-full appearance-none cursor-pointer focus:outline-none"
              />
              <div
                className="absolute left-0 top-0 h-1.5 bg-blue-500 rounded-full pointer-events-none"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right Section: Volume & Actions */}
        <div className="flex items-center justify-end gap-3 w-full md:w-1/3">
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="text-slate-400 hover:text-slate-200 cursor-pointer p-1"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 h-1 bg-[#1a1e27] rounded cursor-pointer"
            />
          </div>

          <a
            href={getAudioFullUrl(currentResult.audio_url)}
            download={currentResult.filename}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#161920] hover:bg-[#202530] text-xs font-medium text-white border border-[#232836] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Tải WAV</span>
          </a>

          <button
            onClick={onClose}
            title="Đóng thanh phát"
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-[#161920] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
