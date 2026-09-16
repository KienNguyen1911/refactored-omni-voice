"use client";

import React, { useState } from "react";
import { generateDesign, createTask, GenerationResult } from "@/lib/api";
import {
  Sparkles,
  Sliders,
  Loader2,
  Volume2,
  User,
  SlidersHorizontal,
  AlertCircle,
  Wand2,
  Layers,
  CheckCircle2,
  ArrowRight,
  Clock,
  Terminal,
} from "lucide-react";

interface VoiceDesignStudioProps {
  onGenerationComplete: (result: GenerationResult) => void;
  onOpenQueue?: () => void;
}

export default function VoiceDesignStudio({
  onGenerationComplete,
  onOpenQueue,
}: VoiceDesignStudioProps) {
  const [text, setText] = useState(
    "Hello! This is a completely customized voice designed with natural speaker attributes."
  );
  const [gender, setGender] = useState("Female / 女");
  const [age, setAge] = useState("Young Adult / 青年");
  const [pitch, setPitch] = useState("Moderate Pitch / 中音调");
  const [style, setStyle] = useState("Auto");
  const [accent, setAccent] = useState("American Accent / 美式口音");
  const [dialect, setDialect] = useState("Auto");
  const [language, setLanguage] = useState("Auto");

  const [speed, setSpeed] = useState<number>(1.0);
  const [numStep, setNumStep] = useState<number>(32);
  const [guidanceScale, setGuidanceScale] = useState<number>(2.0);
  const [denoise, setDenoise] = useState<boolean>(true);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isQueueing, setIsQueueing] = useState<boolean>(false);
  const [queueSuccessMsg, setQueueSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const buildInstructString = () => {
    const parts: string[] = [];

    const parseVal = (val: string, isDialect = false) => {
      if (val === "Auto") return;
      if (val.includes(" / ")) {
        const [en, zh] = val.split(" / ");
        if (isDialect) parts.push(zh.trim());
        else parts.push(en.trim().toLowerCase());
      } else {
        parts.push(val);
      }
    };

    parseVal(gender);
    parseVal(age);
    parseVal(pitch);
    parseVal(style);
    parseVal(accent);
    parseVal(dialect, true);

    return parts.join(", ");
  };

  const handleGenerateImmediate = async () => {
    if (!text.trim()) {
      setErrorMsg("Vui lòng nhập văn bản cần tổng hợp.");
      return;
    }

    const instruct = buildInstructString();
    if (!instruct) {
      setErrorMsg("Vui lòng chọn ít nhất một thuộc tính giọng nói.");
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);
    setQueueSuccessMsg(null);

    try {
      const result = await generateDesign({
        text: text.trim(),
        instruct: instruct,
        language: language,
        speed: speed,
        num_step: numStep,
        guidance_scale: guidanceScale,
        denoise: denoise,
      });

      onGenerationComplete(result);
    } catch (err: any) {
      setErrorMsg(err.message || "Tạo giọng thiết kế thất bại.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQueueTask = async () => {
    if (!text.trim()) {
      setErrorMsg("Vui lòng nhập văn bản cần tổng hợp.");
      return;
    }

    const instruct = buildInstructString();
    if (!instruct) {
      setErrorMsg("Vui lòng chọn ít nhất một thuộc tính giọng nói.");
      return;
    }

    setIsQueueing(true);
    setErrorMsg(null);
    setQueueSuccessMsg(null);

    try {
      const task = await createTask({
        task_type: "design",
        text: text.trim(),
        instruct: instruct,
        language: language,
        speed: speed,
        num_step: numStep,
        guidance_scale: guidanceScale,
        denoise: denoise,
      });

      setQueueSuccessMsg(`Đã tạo Order #${task.order_num} vào hàng đợi SQLite.`);
    } catch (err: any) {
      setErrorMsg(err.message || "Thêm vào hàng đợi thất bại.");
    } finally {
      setIsQueueing(false);
    }
  };

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.max(1, Math.round((wordCount / (150 * speed)) * 60));
  const activeInstruct = buildInstructString();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch flex-1 min-h-0 h-full overflow-hidden">
      {/* Left Column: Script & Attribute Matrix (7 Cols / 8 Cols on 2xl) */}
      <div className="xl:col-span-7 2xl:col-span-8 flex flex-col min-h-0 h-full overflow-hidden space-y-2">
        {/* Parametric Attribute Matrix */}
        <div className="shrink-0 bg-[#0e1014] border border-[#1e222b] rounded-lg p-3 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#181b22] pb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Ma trận thuộc tính giọng (Voice Attribute Matrix)
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Zero-Shot Synthesis</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-2">
            {/* Giới tính */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Giới tính (Gender)
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="Female / 女">Nữ (Female)</option>
                <option value="Male / 男">Nam (Male)</option>
              </select>
            </div>

            {/* Độ tuổi */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Độ tuổi (Age)
              </label>
              <select
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="Child / 少年">Trẻ em (Child)</option>
                <option value="Young Adult / 青年">Thanh niên (Young Adult)</option>
                <option value="Middle-aged / 中年">Trung niên (Middle-aged)</option>
                <option value="Elderly / 老年">Người cao tuổi (Elderly)</option>
              </select>
            </div>

            {/* Cao độ */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Cao độ (Pitch)
              </label>
              <select
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="High Pitch / 高音调">Cao (High Pitch)</option>
                <option value="Moderate Pitch / 中音调">Vừa phải (Moderate)</option>
                <option value="Low Pitch / 低音调">Trầm (Low Pitch)</option>
              </select>
            </div>

            {/* Phong cách */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Phong cách (Delivery Style)
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="Auto">Tự nhiên / Chuẩn (Normal)</option>
                <option value="Whisper / 耳语">Thì thầm (Whisper)</option>
              </select>
            </div>

            {/* Ngữ điệu Tiếng Anh */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Ngữ điệu tiếng Anh (Accent)
              </label>
              <select
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="American Accent / 美式口音">Mỹ (American)</option>
                <option value="British Accent / 英国口音">Anh (British)</option>
                <option value="Australian Accent / 澳大利亚口音">Úc (Australian)</option>
                <option value="Canadian Accent / 加拿大口音">Canada</option>
                <option value="Indian Accent / 印度口音">Ấn Độ (Indian)</option>
                <option value="Japanese Accent / 日本口音">Nhật Bản (Japanese)</option>
                <option value="Russian Accent / 俄罗斯口音">Nga (Russian)</option>
                <option value="Auto">Mặc định / Không chỉ định</option>
              </select>
            </div>

            {/* Phương ngữ Tiếng Trung */}
            <div className="space-y-0.5">
              <label className="text-[11px] font-medium text-slate-300">
                Phương ngữ tiếng Trung (Dialect)
              </label>
              <select
                value={dialect}
                onChange={(e) => setDialect(e.target.value)}
                className="w-full px-2 py-1 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="Auto">Phổ thông / Tiêu chuẩn</option>
                <option value="Sichuan Dialect / 四川话">Tứ Xuyên (四川话)</option>
                <option value="Shaanxi Dialect / 陕西话">Thiểm Tây (陕西话)</option>
                <option value="Henan Dialect / 河南话">Hà Nam (河南话)</option>
                <option value="Guangdong / 粤语">Quảng Đông (粤语)</option>
              </select>
            </div>
          </div>

          {/* Realtime Instruct Telemetry Pill */}
          <div className="p-2 rounded bg-[#08090b] border border-[#181b22] flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-slate-500 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-slate-500" />
              instruct preview:
            </span>
            <span className="text-blue-400 font-medium truncate">
              {activeInstruct || "chưa chọn thuộc tính"}
            </span>
          </div>
        </div>

        {/* Script Text Box */}
        <div className="flex-1 min-h-0 flex flex-col bg-[#0e1014] border border-[#1e222b] rounded-lg p-3 sm:p-3.5 space-y-2 shadow-sm overflow-hidden">
          <div className="shrink-0 flex items-center justify-between border-b border-[#181b22] pb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Nội dung kịch bản (Script Text)
            </span>
            <div className="text-[10px] font-mono text-slate-500 flex items-center gap-2.5">
              <span>{charCount} ký tự</span>
              <span>•</span>
              <span>{wordCount} từ</span>
              <span>•</span>
              <span className="text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                Ước tính ~{estimatedSeconds}s
              </span>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nhập nội dung cần đọc cho giọng nói thiết kế..."
            className="w-full flex-1 min-h-0 p-3 bg-[#08090b] border border-[#1e222b] rounded-md text-[#f1f3f7] text-sm focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600 resize-none overflow-y-auto leading-relaxed font-sans"
          />

          {/* Notifications */}
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

          {/* Action Triggers - ALWAYS VISIBLE, NO SCROLLING REQUIRED */}
          <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleQueueTask}
              disabled={isQueueing || isGenerating}
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
                  <span>Thêm vào hàng đợi (Queue Task)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleGenerateImmediate}
              disabled={isGenerating || isQueueing}
              className="py-2.5 px-3.5 rounded-md font-semibold text-xs text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/20"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang thiết kế & tạo giọng...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tạo ngay & Nghe thử (Generate)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Acoustic Parameter Rack (5 Cols / 4 Cols on 2xl) */}
      <div className="xl:col-span-5 2xl:col-span-4 flex flex-col min-h-0 h-full space-y-3 overflow-y-auto pr-1">
        <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#181b22] pb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tùy chỉnh âm học (Acoustic Parameters)
            </span>
          </div>

          {/* Language Selection */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">
              Ngôn ngữ (Language)
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="Auto">Auto Detect (Tự động nhận diện)</option>
              <option value="vi">Tiếng Việt (Vietnamese)</option>
              <option value="en">English</option>
              <option value="zh">Chinese (中文)</option>
              <option value="ja">Japanese (日本語)</option>
              <option value="ko">Korean (한국어)</option>
              <option value="fr">French (Français)</option>
              <option value="de">German (Deutsch)</option>
              <option value="es">Spanish (Español)</option>
            </select>
          </div>

          {/* Speed Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Tốc độ (Speed):</span>
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
          </div>

          {/* Diffusion Steps Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Số bước Diffusion (Steps):</span>
              <span className="font-mono text-white font-medium">{numStep} steps</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { val: 16, label: "16 (Nhanh)" },
                { val: 32, label: "32 (Chuẩn)" },
                { val: 48, label: "48 (Studio)" },
                { val: 64, label: "64 (Max)" },
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

          {/* Guidance Scale */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Guidance Scale (CFG):</span>
              <span className="font-mono text-white font-medium">{guidanceScale.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="4.0"
              step="0.1"
              value={guidanceScale}
              onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-[#1a1e27] rounded cursor-pointer"
            />
          </div>

          {/* Denoise Checkbox */}
          <div className="pt-2 border-t border-[#181b22] flex items-center justify-between text-xs text-slate-300">
            <span>Khử nhiễu đầu ra (Denoise Output)</span>
            <input
              type="checkbox"
              checked={denoise}
              onChange={(e) => setDenoise(e.target.checked)}
              className="accent-blue-500 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
