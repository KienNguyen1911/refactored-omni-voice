"use client";

import React, { useState, useRef } from "react";
import {
  Voice,
  generateClone,
  createTask,
  createLongFormTask,
  splitText,
  GenerationResult,
  getAudioFullUrl,
} from "@/lib/api";
import {
  Mic,
  Sliders,
  Play,
  Pause,
  Loader2,
  ChevronDown,
  ChevronUp,
  Volume2,
  Sparkles,
  AlertCircle,
  Layers,
  CheckCircle2,
  ArrowRight,
  Scissors,
  Check,
  FileText,
  Clock,
  Settings2,
} from "lucide-react";

interface VoiceCloneStudioProps {
  voices: Voice[];
  selectedVoice: Voice | null;
  onOpenLibrary: () => void;
  onGenerationComplete: (result: GenerationResult) => void;
  onOpenQueue?: () => void;
}

const NON_VERBAL_TAGS = [
  { tag: "[laughter]", label: "Cười", emoji: "😄", desc: "Tiếng cười vui vẻ / tự động khớp [giggles]" },
  { tag: "[sigh]", label: "Thở dài", emoji: "😮‍💨", desc: "Tiếng thở dài / tự động khớp [sighs]" },
  { tag: "[surprise-oh]", label: "Ngạc nhiên", emoji: "😲", desc: "Cảm thán ngạc nhiên (Ồ!)" },
  { tag: "[surprise-ah]", label: "À ra thế", emoji: "💡", desc: "Tiếng nhận ra (À!)" },
  { tag: "[confirmation-en]", label: "Ừm đồng ý", emoji: "🤝", desc: "Tiếng ừm khẳng định tự nhiên" },
  { tag: "[dissatisfaction-hnn]", label: "Hừm...", emoji: "🤔", desc: "Tiếng hừm phân vân" },
  { tag: "...", label: "Nghỉ nhịp", emoji: "⏸️", desc: "Khoảng nghỉ hơi tự nhiên" },
];

export default function VoiceCloneStudio({
  voices,
  selectedVoice,
  onOpenLibrary,
  onGenerationComplete,
  onOpenQueue,
}: VoiceCloneStudioProps) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [text, setText] = useState(
    "Xin chào! Đây là bản thử nghiệm tổng hợp giọng nói cực kỳ tự nhiên từ OmniVoice Studio."
  );
  const [batchText, setBatchText] = useState(
    "Xin chào mọi người, chúc một ngày làm việc tràn đầy năng lượng!\nChào mừng bạn đến với hệ thống voiceover tự động OmniVoice.\nĐoạn thứ ba sẽ được đưa vào hàng đợi xử lý ngầm và lưu vào SQLite."
  );
  const [language, setLanguage] = useState("Auto");
  const [speed, setSpeed] = useState<number>(1.0);
  const [duration, setDuration] = useState<string>("");
  const [numStep, setNumStep] = useState<number>(16);
  const [guidanceScale, setGuidanceScale] = useState<number>(2.0);
  const [denoise, setDenoise] = useState<boolean>(true);
  const [preprocessPrompt, setPreprocessPrompt] = useState<boolean>(true);
  const [postprocessOutput, setPostprocessOutput] = useState<boolean>(true);
  const [instruct, setInstruct] = useState<string>("");

  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isQueueing, setIsQueueing] = useState<boolean>(false);
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const [gapSec, setGapSec] = useState<number>(0.8);
  const [splitSuccessInfo, setSplitSuccessInfo] = useState<string | null>(null);
  const [queueSuccessMsg, setQueueSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Textarea references for precise cursor insertion
  const singleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const batchTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reference voice preview player
  const [isPlayingRef, setIsPlayingRef] = useState(false);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlayRefAudio = () => {
    if (!selectedVoice?.audio_url) return;
    if (!refAudioRef.current) {
      refAudioRef.current = new Audio(getAudioFullUrl(selectedVoice.audio_url));
      refAudioRef.current.onended = () => setIsPlayingRef(false);
    }
    if (isPlayingRef) {
      refAudioRef.current.pause();
      setIsPlayingRef(false);
    } else {
      refAudioRef.current.play().then(() => setIsPlayingRef(true)).catch(() => {});
    }
  };

  const handleSmartSplit = async () => {
    const raw = (mode === "batch" ? batchText : text).trim();
    if (!raw) {
      setErrorMsg("Vui lòng nhập văn bản cần phân đoạn.");
      return;
    }

    setIsSplitting(true);
    setErrorMsg(null);
    setSplitSuccessInfo(null);
    try {
      const res = await splitText(raw, 1000);
      if (res.chunks && res.chunks.length > 0) {
        setBatchText(res.chunks.join("\n"));
        setMode("batch");
        setSplitSuccessInfo(
          `Đã chia văn bản (${raw.length.toLocaleString()} ký tự) thành ${res.total_chunks} đoạn (~1000 ký tự). Khi tạo task, hệ thống sẽ tự động ghép audio hoàn chỉnh!`
        );
      } else {
        setErrorMsg("Không tìm thấy đoạn phù hợp để phân chia.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Lỗi khi phân đoạn văn bản.");
    } finally {
      setIsSplitting(false);
    }
  };

  const insertTag = (tag: string) => {
    const targetEl = mode === "single" ? singleTextareaRef.current : batchTextareaRef.current;
    if (targetEl) {
      const start = targetEl.selectionStart ?? targetEl.value.length;
      const end = targetEl.selectionEnd ?? targetEl.value.length;
      const val = targetEl.value;
      const insertion = ` ${tag} `;
      const nextVal = val.substring(0, start) + insertion + val.substring(end);
      if (mode === "single") {
        setText(nextVal);
      } else {
        setBatchText(nextVal);
      }
      setTimeout(() => {
        targetEl.focus();
        targetEl.setSelectionRange(start + insertion.length, start + insertion.length);
      }, 10);
    } else {
      if (mode === "single") {
        setText((prev) => (prev ? prev + " " + tag + " " : tag + " "));
      } else {
        setBatchText((prev) => (prev ? prev + " " + tag + " " : tag + " "));
      }
    }
  };

  const getBatchLines = () => {
    return batchText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  };

  // Direct synchronous generate & play
  const handleGenerateImmediate = async () => {
    if (!selectedVoice) {
      setErrorMsg("Vui lòng chọn một giọng nói mẫu trước khi tạo.");
      return;
    }
    const currentText = mode === "single" ? text.trim() : getBatchLines()[0] || "";
    if (!currentText) {
      setErrorMsg("Vui lòng nhập văn bản cần tổng hợp.");
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);
    setQueueSuccessMsg(null);

    try {
      const result = await generateClone({
        text: currentText,
        voice_id: selectedVoice.id,
        language: language,
        speed: speed,
        duration: duration ? parseFloat(duration) : null,
        num_step: numStep,
        guidance_scale: guidanceScale,
        denoise: denoise,
        preprocess_prompt: preprocessPrompt,
        postprocess_output: postprocessOutput,
        instruct: instruct.trim() || undefined,
      });

      onGenerationComplete(result);
    } catch (err: any) {
      setErrorMsg(err.message || "Quá trình tạo giọng thất bại.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Queue to SQLite task table
  const handleQueueTask = async () => {
    if (!selectedVoice) {
      setErrorMsg("Vui lòng chọn một giọng nói mẫu trước khi đưa vào hàng đợi.");
      return;
    }

    setIsQueueing(true);
    setErrorMsg(null);
    setQueueSuccessMsg(null);

    try {
      const commonParams = {
        speed: speed,
        duration: duration ? parseFloat(duration) : null,
        num_step: numStep,
        guidance_scale: guidanceScale,
        denoise: denoise,
        preprocess_prompt: preprocessPrompt,
        postprocess_output: postprocessOutput,
      };

      if (mode === "single") {
        if (!text.trim()) {
          setErrorMsg("Vui lòng nhập văn bản cần đọc.");
          return;
        }

        if (text.trim().length > 1200) {
          const res = await createLongFormTask({
            text: text.trim(),
            voice_id: selectedVoice.id,
            voice_name: selectedVoice.name,
            language: language,
            instruct: instruct.trim() || undefined,
            speed: speed,
            chunk_size: 1000,
            gap_sec: gapSec,
            num_step: numStep,
            guidance_scale: guidanceScale,
            denoise: denoise,
          });
          setQueueSuccessMsg(
            `Đã tạo Master Order #${res.order_num} gồm ${res.total_chunks} đoạn (~1000 ký tự, ${numStep} steps). Hệ thống tự động ghép 1 file hoàn chỉnh khi xong!`
          );
        } else {
          const task = await createTask({
            task_type: "clone",
            text: text.trim(),
            voice_id: selectedVoice.id,
            voice_name: selectedVoice.name,
            language: language,
            instruct: instruct.trim() || undefined,
            ...commonParams,
          });
          setQueueSuccessMsg(`Đã tạo Order #${task.order_num} vào hàng đợi SQLite.`);
        }
      } else {
        if (!batchText.trim()) {
          setErrorMsg("Vui lòng nhập hoặc dán văn bản transcript.");
          return;
        }

        const res = await createLongFormTask({
          text: batchText.trim(),
          voice_id: selectedVoice.id,
          voice_name: selectedVoice.name,
          language: language,
          instruct: instruct.trim() || undefined,
          speed: speed,
          chunk_size: 1000,
          gap_sec: gapSec,
          num_step: numStep,
          guidance_scale: guidanceScale,
          denoise: denoise,
        });

        setQueueSuccessMsg(
          `Đã tạo Master Order #${res.order_num} gồm ${res.total_chunks} đoạn (~1000 ký tự, ${numStep} steps). Tự động ghép audio (gap ${gapSec}s) khi xong!`
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Không thể đưa vào hàng đợi.");
    } finally {
      setIsQueueing(false);
    }
  };

  const activeContent = mode === "single" ? text : batchText;
  const charCount = activeContent.length;
  const wordCount = activeContent.trim() ? activeContent.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.max(1, Math.round((wordCount / (150 * speed)) * 60));
  const batchCount = getBatchLines().length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch flex-1 min-h-0 h-full overflow-hidden">
      {/* Left Column: Script & Input Workbench (7 Cols / 8 Cols on 2xl) */}
      <div className="xl:col-span-7 2xl:col-span-8 flex flex-col min-h-0 h-full overflow-hidden">
        {/* Main Script Box */}
        <div className="flex-1 min-h-0 flex flex-col bg-[#0e1014] border border-[#1e222b] rounded-lg p-3 sm:p-3.5 space-y-2 shadow-sm overflow-hidden">
          {/* Header Controls */}
          <div className="shrink-0 flex flex-wrap items-center justify-between border-b border-[#181b22] pb-2 gap-1.5">
            <div className="flex items-center gap-1 bg-[#08090b] p-0.5 rounded border border-[#1e222b] text-xs">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                  mode === "single"
                    ? "bg-[#161920] text-white border border-[#2a2f3d]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Văn bản đơn (Single Take)
              </button>
              <button
                type="button"
                onClick={() => setMode("batch")}
                className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                  mode === "batch"
                    ? "bg-[#161920] text-white border border-[#2a2f3d]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Văn bản dài & Batch ({batchCount})
              </button>
            </div>

            {/* Smart Chunk Split Button */}
            <button
              type="button"
              onClick={handleSmartSplit}
              disabled={isSplitting}
              title="Tự động chia văn bản thành các câu kết thúc trọn vẹn (~1000 ký tự)"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-[#14171f] hover:bg-[#1a1f2c] border border-[#222735] rounded transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSplitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Scissors className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>Tự động chia đoạn</span>
            </button>
          </div>

          {/* Emotion & Expression Tag Toolbar */}
          <div className="shrink-0 flex items-center justify-between gap-1.5 flex-wrap bg-[#08090b] px-2.5 py-1.5 rounded-md border border-[#1a1d24]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-medium text-amber-400/90 flex items-center gap-1 mr-0.5 shrink-0">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>Chèn biểu cảm:</span>
              </span>
              {NON_VERBAL_TAGS.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertTag(item.tag)}
                  title={`${item.desc} (Click để chèn vào vị trí con trỏ)`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#14171f] hover:bg-[#1f2433] hover:text-white text-slate-300 border border-[#232836] hover:border-amber-500/40 transition-colors cursor-pointer"
                >
                  <span>{item.emoji}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <span
              className="text-[10px] text-slate-500 hidden md:inline-block font-mono"
              title="Tự động tương thích với các thẻ ElevenLabs như [giggles], [sighs], [pause]"
            >
              💡 Tương thích thẻ ElevenLabs [giggles], [sighs]
            </span>
          </div>

          {/* Textarea Area (Takes remaining vertical height, scrolls internally if long) */}
          {mode === "single" ? (
            <div className="flex-1 min-h-0 flex flex-col space-y-1">
              <textarea
                ref={singleTextareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Nhập hoặc dán nội dung kịch bản cần đọc tại đây..."
                className="w-full flex-1 min-h-0 p-3 bg-[#08090b] border border-[#1e222b] rounded-md text-[#f1f3f7] text-sm focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600 resize-none overflow-y-auto leading-relaxed font-sans"
              />
              <div className="shrink-0 flex items-center justify-between text-[10px] font-mono text-slate-500 pt-0.5">
                <div className="flex items-center gap-2.5">
                  <span>{charCount} ký tự</span>
                  <span>•</span>
                  <span>{wordCount} từ</span>
                  <span>•</span>
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    Ước tính ~{estimatedSeconds}s
                  </span>
                </div>
                {charCount > 1000 && (
                  <span className="text-amber-400">
                    Gợi ý: Dùng &quot;Tự động chia đoạn&quot;
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col space-y-1.5">
              <div className="shrink-0 flex items-center justify-between text-xs text-slate-400 bg-[#08090b] px-3 py-1.5 rounded border border-[#1e222b]">
                <span>Phân đoạn: {batchCount} đoạn</span>
                <div className="flex items-center gap-2">
                  <span>Khoảng lặng (gap):</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={gapSec}
                    onChange={(e) => setGapSec(parseFloat(e.target.value) || 0.8)}
                    className="w-14 px-1.5 py-0.5 rounded bg-[#161920] border border-[#2a2f3d] text-white text-center font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                  <span>giây</span>
                </div>
              </div>

              <textarea
                ref={batchTextareaRef}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder="Dán văn bản dài vào đây. Mỗi dòng là 1 phân đoạn độc lập..."
                className="w-full flex-1 min-h-0 p-3 bg-[#08090b] border border-[#1e222b] rounded-md text-[#f1f3f7] text-sm focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600 resize-none overflow-y-auto leading-relaxed font-sans"
              />

              {splitSuccessInfo && (
                <div className="shrink-0 p-2 rounded bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-[11px] flex items-center gap-2">
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate">{splitSuccessInfo}</span>
                </div>
              )}
            </div>
          )}

          {/* Non-Verbal Sound Tags Injector */}
          <div className="shrink-0 pt-1.5 border-t border-[#181b22]">
            <div className="text-[11px] text-slate-400 mb-1 font-medium">
              Chèn biểu cảm tự nhiên (Acoustic Nuances):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {NON_VERBAL_TAGS.map((tag) => (
                <button
                  key={tag.tag}
                  type="button"
                  onClick={() => insertTag(tag.tag)}
                  className="px-2 py-0.5 rounded bg-[#12141a] hover:bg-[#1a1e27] text-slate-300 hover:text-white text-[11px] border border-[#1e222b] hover:border-[#2a2f3d] transition-colors cursor-pointer font-mono"
                >
                  +{tag.tag}
                </button>
              ))}
            </div>
          </div>

          {/* Emotion / Delivery Instruction Input */}
          <div className="shrink-0">
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Chỉ dẫn cảm xúc / phong cách đọc (Instruction Prompt)
            </label>
            <input
              type="text"
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder="VD: Nói giọng truyền cảm ấm áp, thì thầm nhẹ nhàng, hoặc phong thái bản tin..."
              className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500/80 placeholder:text-slate-600 font-sans"
            />
          </div>

          {/* Notification Messages */}
          {errorMsg && (
            <div className="shrink-0 p-2 rounded bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {queueSuccessMsg && (
            <div className="shrink-0 p-2 rounded bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{queueSuccessMsg}</span>
              </div>
              {onOpenQueue && (
                <button
                  type="button"
                  onClick={onOpenQueue}
                  className="px-2 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                >
                  Xem Hàng Đợi <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}

          {/* Action Trigger Buttons - ALWAYS VISIBLE, NEVER SCROLLED OFF */}
          <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleQueueTask}
              disabled={isQueueing || isGenerating || !selectedVoice}
              className="py-2.5 px-3.5 rounded-md font-medium text-xs text-slate-200 bg-[#14171f] hover:bg-[#1a1f2c] border border-[#222735] hover:border-[#30384a] active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isQueueing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>Đang ghi hàng đợi...</span>
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    {mode === "batch"
                      ? `Đưa ${batchCount} đoạn vào hàng đợi (Queue)`
                      : "Thêm vào hàng đợi (Queue Task)"}
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleGenerateImmediate}
              disabled={isGenerating || isQueueing || !selectedVoice}
              className="py-2.5 px-3.5 rounded-md font-semibold text-xs text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/20"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang tổng hợp trực tiếp...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tổng hợp ngay & Nghe thử (Synthesize)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Voice Profile & Acoustic Rack (5 Cols / 4 Cols on 2xl) */}
      <div className="xl:col-span-5 2xl:col-span-4 flex flex-col min-h-0 h-full space-y-3 overflow-y-auto pr-1">
        {/* Active Reference Voice Card */}
        <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[#181b22] pb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Giọng nói tham chiếu (Reference Voice)
            </span>
            <button
              type="button"
              onClick={onOpenLibrary}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
            >
              Đổi giọng / Kho ({voices.length})
            </button>
          </div>

          {selectedVoice ? (
            <div className="p-3 rounded bg-[#08090b] border border-[#1e222b] flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {selectedVoice.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#161920] text-slate-400 border border-[#232836]">
                    {selectedVoice.gender}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {selectedVoice.description || selectedVoice.ref_text || "Giọng mẫu zero-shot"}
                </p>
              </div>

              {selectedVoice.audio_url && (
                <button
                  type="button"
                  onClick={togglePlayRefAudio}
                  title="Nghe thử file mẫu"
                  className="w-8 h-8 rounded-full bg-[#161920] hover:bg-[#202532] text-slate-200 flex items-center justify-center border border-[#232836] transition-colors cursor-pointer shrink-0"
                >
                  {isPlayingRef ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                </button>
              )}
            </div>
          ) : (
            <div className="p-4 rounded bg-[#08090b] border border-dashed border-[#1e222b] text-center space-y-2">
              <p className="text-xs text-slate-400">Chưa có giọng nói nào được chọn</p>
              <button
                type="button"
                onClick={onOpenLibrary}
                className="px-3 py-1 rounded bg-[#161920] hover:bg-[#202532] text-xs text-blue-400 border border-[#232836] cursor-pointer"
              >
                Mở Kho Giọng để chọn
              </button>
            </div>
          )}
        </div>

        {/* Acoustic Parameter Rack */}
        <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#181b22] pb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tham số âm học (Acoustic Parameters)
            </span>
          </div>

          {/* Language Selection */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">
              Ngôn ngữ tổng hợp (Synthesis Language)
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="Auto">Auto Detect (Tự động nhận diện theo văn bản)</option>
              <option value="vi">Tiếng Việt (Vietnamese)</option>
              <option value="en">English (Tiếng Anh)</option>
              <option value="zh">Chinese (中文 - Tiếng Trung)</option>
              <option value="ja">Japanese (日本語 - Tiếng Nhật)</option>
              <option value="ko">Korean (한국어 - Tiếng Hàn)</option>
              <option value="fr">French (Français)</option>
              <option value="de">German (Deutsch)</option>
              <option value="es">Spanish (Español)</option>
            </select>
          </div>

          {/* Speed Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Tốc độ đọc (Speech Rate):</span>
              <span className="font-mono text-white font-medium">{speed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-[#1a1e27] rounded cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0.5x Chậm</span>
              <span>1.0x Tiêu chuẩn</span>
              <span>1.5x Nhanh</span>
            </div>
          </div>

          {/* Diffusion Steps Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Số bước Diffusion (Steps):</span>
              <span className="font-mono text-white font-medium">{numStep} steps</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { val: 8, label: "8 (Cực nhanh)" },
                { val: 16, label: "16 (Mặc định)" },
                { val: 32, label: "32 (Chuẩn)" },
                { val: 64, label: "64 (Studio)" },
              ].map((step) => (
                <button
                  key={step.val}
                  type="button"
                  onClick={() => setNumStep(step.val)}
                  className={`py-1.5 text-center rounded text-xs font-mono transition-colors cursor-pointer border ${
                    numStep === step.val
                      ? "bg-[#161920] border-blue-500/80 text-white font-medium"
                      : "bg-[#08090b] border-[#1e222b] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {step.val}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced Accordion */}
          <div className="border-t border-[#181b22] pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 cursor-pointer"
            >
              <span>Cài đặt chuyên sâu (CFG, Denoise, Prompt Preprocess)</span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-2 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">Guidance Scale (CFG):</span>
                    <span className="font-mono text-white">{guidanceScale}</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.1"
                    value={guidanceScale}
                    onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#1a1e27] rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400">Khử nhiễu đầu ra (Denoise Output)</span>
                  <input
                    type="checkbox"
                    checked={denoise}
                    onChange={(e) => setDenoise(e.target.checked)}
                    className="accent-blue-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400">Tiền xử lý prompt (Preprocess Prompt)</span>
                  <input
                    type="checkbox"
                    checked={preprocessPrompt}
                    onChange={(e) => setPreprocessPrompt(e.target.checked)}
                    className="accent-blue-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400">Hậu xử lý âm thanh (Postprocess Output)</span>
                  <input
                    type="checkbox"
                    checked={postprocessOutput}
                    onChange={(e) => setPostprocessOutput(e.target.checked)}
                    className="accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
