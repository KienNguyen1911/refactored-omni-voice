"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  VoiceTask,
  TaskStats,
  fetchTasks,
  fetchTaskStats,
  retryTask,
  cancelTask,
  deleteTask,
  clearFinishedTasks,
  GenerationResult,
  getAudioFullUrl,
  mergeTasksAudio,
  fetchMergedBatches,
  MergedBatch,
  MergeResponse,
  generateTaskSrt,
  triggerCleanup,
} from "@/lib/api";
import {
  Clock,
  Play,
  RotateCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Copy,
  Check,
  Search,
  RefreshCw,
  Layers,
  AlertCircle,
  Activity,
  Merge,
  Volume2,
  CheckSquare,
  Square,
  FileAudio,
  FileText,
} from "lucide-react";

function formatSeconds(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || isNaN(sec)) return "";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

interface TaskQueueHistoryProps {
  onPlayAudio: (result: GenerationResult) => void;
  onSelectTab?: (tab: "clone" | "design") => void;
}

export default function TaskQueueHistory({
  onPlayAudio,
  onSelectTab,
}: TaskQueueHistoryProps) {
  const [tasks, setTasks] = useState<VoiceTask[]>([]);
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  });
  const [activeFilter, setActiveFilter] = useState<
    "all" | "processing" | "pending" | "completed" | "failed"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [mergedResult, setMergedResult] = useState<MergeResponse | null>(null);
  const [mergedBatches, setMergedBatches] = useState<MergedBatch[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [statsData, tasksData, batchesData] = await Promise.all([
        fetchTaskStats(),
        fetchTasks(activeFilter === "all" ? undefined : activeFilter),
        fetchMergedBatches().catch(() => []),
      ]);
      setStats(statsData);
      setTasks(tasksData);
      setMergedBatches(batchesData);
    } catch (err) {
      console.error("Failed to load task queue data:", err);
    }
  }, [activeFilter]);

  const toggleSelectTask = (id: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleMergeCompleted = async () => {
    let idsToMerge = selectedTaskIds;
    if (idsToMerge.length === 0) {
      idsToMerge = tasks
        .filter((t) => t.status === "completed" && t.filename)
        .map((t) => t.id);
    }

    if (idsToMerge.length < 1) {
      alert("Chưa có task nào hoàn thành để gộp audio.");
      return;
    }

    setIsMerging(true);
    try {
      const res = await mergeTasksAudio(idsToMerge, 0.8);
      setMergedResult(res);
      await loadData();
      onPlayAudio({
        status: "success",
        audio_url: res.audio_url,
        filename: res.filename,
        duration_sec: res.duration_sec,
        generation_time_sec: 0,
        text: `File gộp ${res.chunks_count} đoạn voiceover (khoảng nghỉ gap 0.8s)`,
        sampling_rate: res.sampling_rate || 24000,
      });
    } catch (err: any) {
      alert(`Lỗi khi gộp file audio: ${err.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Dynamic Polling
  useEffect(() => {
    const isBusy = stats.processing > 0 || stats.pending > 0;
    const intervalTime = isBusy ? 2000 : 6000;

    const interval = setInterval(() => {
      loadData();
    }, intervalTime);

    return () => clearInterval(interval);
  }, [loadData, stats.processing, stats.pending]);

  const handleRetry = async (taskId: string) => {
    setActionLoadingId(taskId);
    try {
      await retryTask(taskId);
      await loadData();
    } catch (err: any) {
      alert(`Lỗi khi thử lại: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    setActionLoadingId(taskId);
    try {
      await cancelTask(taskId);
      await loadData();
    } catch (err: any) {
      alert(`Lỗi khi huỷ task: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("Bạn có chắc muốn xoá task này khỏi lịch sử SQLite?")) return;
    setActionLoadingId(taskId);
    try {
      await deleteTask(taskId);
      await loadData();
    } catch (err: any) {
      alert(`Lỗi khi xoá: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleClearCompleted = async () => {
    if (!confirm("Xoá tất cả các task đã hoàn thành hoặc thất bại khỏi lịch sử?")) return;
    setLoading(true);
    try {
      await clearFinishedTasks();
      await loadData();
    } catch (err: any) {
      alert(`Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePurgeOld = async () => {
    if (!confirm("Dọn dẹp các task cũ hơn 48h và xoá tất cả file chunk thừa?")) return;
    setLoading(true);
    try {
      const res = await triggerCleanup(48.0);
      await loadData();
      alert(`Đã dọn dẹp xong: Xóa ${res.deleted_tasks} task cũ (>48h), ${res.deleted_chunk_files} file chunk thừa.`);
    } catch (err: any) {
      alert(`Lỗi khi dọn dẹp: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleGenerateSrt = async (taskId: string) => {
    setActionLoadingId(taskId);
    try {
      await generateTaskSrt(taskId);
      await loadData();
    } catch (err: any) {
      alert(`Lỗi khi tạo phụ đề SRT: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      task.text.toLowerCase().includes(q) ||
      (task.voice_name && task.voice_name.toLowerCase().includes(q)) ||
      (task.instruct && task.instruct.toLowerCase().includes(q)) ||
      task.order_num.toString().includes(q)
    );
  });

  const isBusy = stats.processing > 0 || stats.pending > 0;

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white">
              Hàng Đợi & Lịch Sử Tác Vụ (Task Queue & Registry)
            </h2>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Lưu trữ 48h • Tự động dọn chunk
            </span>
            {isBusy && (
              <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Activity className="w-3 h-3 animate-spin text-blue-400" />
                Đang xử lý ngầm
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Lưu trữ trạng thái theo số thứ tự Order # vào SQLite. Hỗ trợ xử lý bất đồng bộ không nghẽn máy. Tự động xoá lịch sử sau 48h.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {stats.completed > 1 && (
            <button
              onClick={handleMergeCompleted}
              disabled={isMerging}
              className="px-3 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isMerging ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Merge className="w-3.5 h-3.5" />
              )}
              <span>
                {selectedTaskIds.length > 1
                  ? `Gộp ${selectedTaskIds.length} đoạn đã chọn`
                  : `Gộp tất cả ${stats.completed} đoạn (Gap 0.8s)`}
              </span>
            </button>
          )}

          <button
            onClick={() => {
              setLoading(true);
              loadData().finally(() => setLoading(false));
            }}
            disabled={loading}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white bg-[#14171f] hover:bg-[#1a1f2c] border border-[#222735] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-400" : ""}`} />
            <span>Làm mới</span>
          </button>

          {stats.completed + stats.failed + stats.cancelled > 0 && (
            <button
              onClick={handleClearCompleted}
              className="px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 border border-[#222735] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Dọn dẹp lịch sử</span>
            </button>
          )}

          <button
            onClick={handlePurgeOld}
            title="Xoá lịch sử > 48h và dọn dẹp toàn bộ file chunk thừa"
            className="px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-amber-300 hover:bg-amber-950/30 border border-[#222735] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Dọn chunk & cũ</span>
          </button>
        </div>
      </div>

      {/* Merged Audio Banner */}
      {(mergedResult || mergedBatches.length > 0) && (
        <div className="bg-[#12151c] border border-blue-500/40 rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#181d28] border border-[#232a3b] flex items-center justify-center text-blue-400 shrink-0">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                  Merged Audio Ready
                </span>
                <span className="text-xs text-slate-400">Khoảng nghỉ gap: 0.8s</span>
              </div>
              <h4 className="text-xs font-medium text-white mt-0.5">
                {mergedResult
                  ? `File Gộp ${mergedResult.chunks_count} Đoạn (${mergedResult.duration_sec}s)`
                  : mergedBatches[0].title}
              </h4>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              onClick={() => {
                const target = mergedResult || mergedBatches[0];
                if (target) {
                  onPlayAudio({
                    status: "success",
                    audio_url: target.audio_url,
                    filename: target.filename,
                    duration_sec: target.duration_sec,
                    generation_time_sec: 0,
                    text: `File gộp âm thanh hoàn chỉnh`,
                    sampling_rate: 24000,
                  });
                }
              }}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 ml-0.5" />
              <span>Nghe file gộp</span>
            </button>

            <a
              href={getAudioFullUrl(mergedResult?.audio_url || mergedBatches[0]?.audio_url)}
              download={mergedResult?.filename || mergedBatches[0]?.filename}
              className="px-3 py-1.5 rounded bg-[#161920] hover:bg-[#202532] text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-[#232836] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải WAV</span>
            </a>

            <a
              href={getAudioFullUrl((mergedResult?.audio_url || mergedBatches[0]?.audio_url).replace(/\.[^/.]+$/, ".srt"))}
              download={(mergedResult?.filename || mergedBatches[0]?.filename || "merged").replace(/\.[^/.]+$/, ".srt")}
              title="Tải phụ đề SRT cho file gộp"
              className="px-3 py-1.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-1.5 border border-amber-500/30 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Tải SRT gộp</span>
            </a>
          </div>
        </div>
      )}

      {/* Telemetry Filter Strips - Full Width Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
        {[
          { key: "all", label: "Tổng số (Total)", count: stats.total, color: "text-slate-200" },
          { key: "processing", label: "Đang chạy", count: stats.processing, color: "text-blue-400" },
          { key: "pending", label: "Đang chờ", count: stats.pending, color: "text-amber-400" },
          { key: "completed", label: "Hoàn thành", count: stats.completed, color: "text-emerald-400" },
          { key: "failed", label: "Thất bại", count: stats.failed, color: "text-rose-400" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveFilter(item.key as any)}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer shadow-sm ${
              activeFilter === item.key
                ? "bg-[#14171f] border-blue-500/80 ring-1 ring-blue-500/20"
                : "bg-[#0e1014] border-[#1e222b] hover:border-[#2a2f3d] hover:bg-[#11131a]"
            }`}
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wider">{item.label}</div>
            <div className={`text-lg font-bold tabular-nums mt-1 ${item.color}`}>
              {item.count}
            </div>
          </button>
        ))}
      </div>

      {/* Search and Selection Tools */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#0e1014] border border-[#1e222b] rounded-lg p-3 shadow-sm">
        <div className="relative flex-1 w-full sm:max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo nội dung kịch bản, Order #, tên giọng..."
            className="w-full pl-9 pr-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-sans"
          />
        </div>

        {selectedTaskIds.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>Đã chọn: {selectedTaskIds.length}</span>
            <button
              onClick={() => setSelectedTaskIds([])}
              className="text-blue-400 hover:underline cursor-pointer"
            >
              Bỏ chọn
            </button>
          </div>
        )}
      </div>

      {/* Tasks Table / List */}
      <div className="space-y-2">
        {filteredTasks.map((task) => {
          const isSelected = selectedTaskIds.includes(task.id);
          const isLoadingAction = actionLoadingId === task.id;

          return (
            <div
              key={task.id}
              className={`bg-[#0e1014] border rounded-lg p-3 transition-colors ${
                isSelected ? "border-blue-500/60 bg-[#11141c]" : "border-[#1e222b] hover:border-[#252a36]"
              }`}
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                {/* Checkbox & Order Info */}
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <button
                    onClick={() => toggleSelectTask(task.id)}
                    className="mt-0.5 text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-white">
                        Order #{task.order_num}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#161920] text-slate-400 border border-[#232836] uppercase">
                        {task.task_type}
                      </span>
                      {task.voice_name && (
                        <span className="text-xs font-medium text-blue-400">
                          {task.voice_name}
                        </span>
                      )}

                      {/* Status pill */}
                      {task.status === "processing" && (
                        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          {task.total_chunks && task.total_chunks > 1
                            ? `Đoạn ${(task.completed_chunks || 0) + 1 > task.total_chunks ? task.total_chunks : (task.completed_chunks || 0) + 1}/${task.total_chunks} (${task.progress}%)`
                            : `Running (${task.progress}%)`}
                        </span>
                      )}
                      {task.status === "completed" && (
                        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Done {task.total_chunks && task.total_chunks > 1 ? `• ${task.total_chunks} đoạn` : ""}
                        </span>
                      )}
                      {task.status === "pending" && (
                        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Clock className="w-2.5 h-2.5" />
                          Queued
                        </span>
                      )}
                      {task.status === "failed" && (
                        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          <XCircle className="w-2.5 h-2.5" />
                          Failed
                        </span>
                      )}
                    </div>

                    {/* Task Script Preview */}
                    <p className="text-xs text-slate-300 line-clamp-2 mt-1 leading-relaxed font-sans">
                      {task.text}
                    </p>

                    {/* Active Progress Bar for processing tasks */}
                    {task.status === "processing" && (
                      <div className="mt-2.5 mb-1 space-y-1 bg-[#11141c] border border-[#202534] p-2 rounded-md">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-blue-400 font-medium flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                            {task.total_chunks && task.total_chunks > 1
                              ? `Tiến độ: Đã xong ${task.completed_chunks || 0}/${task.total_chunks} đoạn`
                              : "Đang tổng hợp giọng nói..."}
                          </span>
                          <span className="text-blue-300 font-bold tabular-nums">
                            {task.progress}%
                          </span>
                        </div>
                        <div className="w-full bg-[#161a24] rounded-full h-1.5 overflow-hidden border border-[#232938]">
                          <div
                            className="bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                            style={{ width: `${Math.max(5, Math.min(100, task.progress))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Telemetry info */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500 mt-1.5">
                      <span>Ngôn ngữ: {task.language}</span>
                      {task.params?.speed && <span>• Tốc độ: {task.params.speed}x</span>}
                      {task.params?.num_step && <span>• Steps: {task.params.num_step}</span>}
                      {task.total_chunks && task.total_chunks > 1 && (
                        <span className="text-blue-400">• Chunks: {task.completed_chunks || 0}/{task.total_chunks}</span>
                      )}
                      {task.duration_sec && (
                        <span className="text-slate-400">• Thời lượng: {formatSeconds(task.duration_sec)}</span>
                      )}
                      {task.generation_time_sec && (
                        <span className="text-emerald-400">• Gen: {formatSeconds(task.generation_time_sec)}</span>
                      )}
                    </div>

                    {task.error_message && (
                      <div className="text-xs text-rose-400 bg-rose-950/20 border border-rose-900/30 p-1.5 rounded mt-1">
                        {task.error_message}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Action buttons */}
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  {task.status === "completed" && task.audio_url && (
                    <>
                      <button
                        onClick={() =>
                          onPlayAudio({
                            status: "success",
                            audio_url: task.audio_url!,
                            filename: task.filename || `order_${task.order_num}.wav`,
                            duration_sec: task.duration_sec || 0,
                            generation_time_sec: task.generation_time_sec || 0,
                            text: task.text,
                            sampling_rate: 24000,
                            order_num: task.order_num,
                          })
                        }
                        title="Nghe file này"
                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Play className="w-3 h-3 ml-0.5" />
                        <span>Phát</span>
                      </button>

                      <a
                        href={getAudioFullUrl(task.audio_url)}
                        download={task.filename || `order_${task.order_num}.wav`}
                        title="Tải file WAV"
                        className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-[#181c26] border border-[#222735] transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>

                      {task.srt_url ? (
                        <a
                          href={getAudioFullUrl(task.srt_url)}
                          download={task.srt_filename || `${(task.filename || `order_${task.order_num}`).replace(/\.[^/.]+$/, "")}.srt`}
                          title="Tải phụ đề SRT (Forced Alignment)"
                          className="px-2 py-1 rounded text-amber-400 hover:text-white hover:bg-amber-500/20 border border-amber-500/30 transition-colors flex items-center gap-1 text-xs font-mono"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>SRT</span>
                        </a>
                      ) : (
                        <button
                          onClick={() => handleGenerateSrt(task.id)}
                          disabled={actionLoadingId === task.id}
                          title="Tạo file phụ đề SRT cho audio này"
                          className="px-2 py-1 rounded text-slate-400 hover:text-amber-300 hover:bg-[#181c26] border border-[#222735] transition-colors flex items-center gap-1 text-xs cursor-pointer disabled:opacity-50"
                        >
                          {actionLoadingId === task.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>+SRT</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => handleCopyText(task.text, task.id)}
                    title="Sao chép kịch bản"
                    className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-[#181c26] border border-[#222735] transition-colors cursor-pointer"
                  >
                    {copiedId === task.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {(task.status === "failed" || task.status === "cancelled") && (
                    <button
                      onClick={() => handleRetry(task.id)}
                      disabled={isLoadingAction}
                      title="Thử lại task này"
                      className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-[#181c26] border border-[#222735] transition-colors cursor-pointer"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isLoadingAction ? "animate-spin" : ""}`} />
                    </button>
                  )}

                  {(task.status === "pending" || task.status === "processing") && (
                    <button
                      onClick={() => handleCancel(task.id)}
                      disabled={isLoadingAction}
                      title="Hủy task"
                      className="p-1.5 rounded text-rose-400 hover:bg-rose-950/30 border border-[#222735] transition-colors cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(task.id)}
                    disabled={isLoadingAction}
                    title="Xóa khỏi SQLite"
                    className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/20 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredTasks.length === 0 && (
          <div className="p-12 text-center bg-[#0e1014] border border-[#1e222b] rounded-lg space-y-3 shadow-sm flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-[#161920] border border-[#232836] flex items-center justify-center text-slate-500">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-200">
                Không có tác vụ nào trong danh mục này
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Tất cả tác vụ đơn lẻ và phân đoạn dài (Batch Chunks) khi được đưa vào hàng đợi sẽ tự động xuất hiện tại đây và lưu trữ an toàn trong SQLite.
              </p>
            </div>
            {onSelectTab && (
              <button
                type="button"
                onClick={() => onSelectTab("clone")}
                className="mt-2 px-4 py-2 rounded-md bg-[#161920] hover:bg-[#202633] text-xs font-medium text-blue-400 border border-[#242938] transition-colors cursor-pointer"
              >
                Đến Trạm Studio để tạo giọng mới
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
