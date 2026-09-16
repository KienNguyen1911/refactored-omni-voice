"use client";

import React, { useState, useRef } from "react";
import {
  Voice,
  uploadVoice,
  deleteVoice,
  getAudioFullUrl,
  fetchElevenLabsVoiceInfo,
  cloneElevenLabsVoice,
  ElevenLabsVoiceInfo,
} from "@/lib/api";
import {
  Mic,
  Play,
  Pause,
  Plus,
  Trash2,
  Check,
  Globe,
  User,
  AlertCircle,
  Loader2,
  X,
  Upload,
  Search,
  Radio,
  FileAudio,
  LayoutGrid,
  List,
  Sparkles,
  Link as LinkIcon,
  Volume2,
  CheckCircle2,
} from "lucide-react";

interface VoiceLibraryProps {
  voices: Voice[];
  selectedVoiceId: string | null;
  onSelectVoice: (voice: Voice) => void;
  onRefreshVoices: () => Promise<void>;
}

export const POPULAR_VOICE_SAMPLES = [
  { flag: "🇻🇳", lang: "Tiếng Việt", name: "Daniel (Việt Nam)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "vi" },
  { flag: "🇬🇧", lang: "Tiếng Anh (UK)", name: "Russell (Narrator)", voiceId: "NYC9WEgkq1u4jiqBseQ9", langCode: "en" },
  { flag: "🇺🇸", lang: "Tiếng Anh (US)", name: "Daniel (English)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "en" },
  { flag: "🇫🇷", lang: "Tiếng Pháp", name: "Daniel (Pháp)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "fr" },
  { flag: "🇩🇪", lang: "Tiếng Đức", name: "Daniel (Đức)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "de" },
  { flag: "🇪🇸", lang: "Tây Ban Nha", name: "Daniel (Tây Ban Nha)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "es" },
  { flag: "🇮🇹", lang: "Tiếng Ý", name: "Daniel (Ý)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "it" },
  { flag: "🇵🇹", lang: "Bồ Đào Nha", name: "Daniel (Bồ Đào Nha)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "pt" },
  { flag: "🇷🇺", lang: "Tiếng Nga", name: "Daniel (Nga)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "ru" },
  { flag: "🇰🇷", lang: "Tiếng Hàn", name: "Daniel (Hàn Quốc)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "ko" },
  { flag: "🇯🇵", lang: "Tiếng Nhật", name: "Anime / Studio", voiceId: "xctasy8XvGp2cVO9HL9k", langCode: "ja" },
  { flag: "🇨🇳", lang: "Tiếng Trung", name: "Chinese Expressive", voiceId: "PB6BdkFkZLbI39GHdnbQ", langCode: "zh" },
  { flag: "🇮🇩", lang: "Indonesia", name: "Daniel (Indonesia)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "id" },
  { flag: "🇮🇳", lang: "Tiếng Hindi", name: "Daniel (Ấn Độ)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "hi" },
  { flag: "🇵🇱", lang: "Tiếng Ba Lan", name: "Daniel (Gốc Ba Lan)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "pl" },
  { flag: "🇹🇷", lang: "Thổ Nhĩ Kỳ", name: "Daniel (Thổ Nhĩ Kỳ)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "tr" },
  { flag: "🇸🇪", lang: "Thụy Điển", name: "Daniel (Thụy Điển)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "sv" },
  { flag: "🇳🇴", lang: "Na Uy", name: "Daniel (Na Uy)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "no" },
  { flag: "🇬🇷", lang: "Hy Lạp", name: "Daniel (Hy Lạp)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "el" },
  { flag: "🇨🇿", lang: "Tiếng Séc", name: "Daniel (Séc)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "cs" },
  { flag: "🇷🇴", lang: "Romania", name: "Daniel (Romania)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "ro" },
  { flag: "🇭🇺", lang: "Hungary", name: "Daniel (Hungary)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "hu" },
  { flag: "🇭🇷", lang: "Croatia", name: "Daniel (Croatia)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "hr" },
  { flag: "🇹🇭", lang: "Tiếng Thái", name: "Thai Studio", voiceId: "xctasy8XvGp2cVO9HL9k", langCode: "th" },
  { flag: "🇸🇦", lang: "Tiếng Ả Rập", name: "Arabic Classic", voiceId: "xctasy8XvGp2cVO9HL9k", langCode: "ar" },
  { flag: "🇳🇱", lang: "Hà Lan", name: "Dutch Modern", voiceId: "xctasy8XvGp2cVO9HL9k", langCode: "nl" },
  { flag: "🇮🇳", lang: "Tamil", name: "Daniel (Tamil)", voiceId: "xAVsdcJvD1uegu8lFEE2", langCode: "ta" },
];

export default function VoiceLibrary({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onRefreshVoices,
}: VoiceLibraryProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"upload" | "elevenlabs">("upload");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState<"all" | "Female" | "Male">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [gender, setGender] = useState("Female");
  const [language, setLanguage] = useState("Vietnamese");
  const [description, setDescription] = useState("");
  const [refText, setRefText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ElevenLabs clone states
  const [elevenLabsUrl, setElevenLabsUrl] = useState("");
  const [isFetchingElevenLabs, setIsFetchingElevenLabs] = useState(false);
  const [elevenLabsInfo, setElevenLabsInfo] = useState<ElevenLabsVoiceInfo | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string>("");
  const [selectedLangCode, setSelectedLangCode] = useState<string>("");
  const [sampleSearchQuery, setSampleSearchQuery] = useState<string>("");
  const [isCloningElevenLabs, setIsCloningElevenLabs] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreviewAudio = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setIsPlayingPreview(false);
  };

  const togglePlayPreview = (url: string) => {
    if (isPlayingPreview) {
      stopPreviewAudio();
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.play().catch((err) => console.error("Play preview error:", err));
      setIsPlayingPreview(true);
      audio.onended = () => setIsPlayingPreview(false);
      audio.onerror = () => setIsPlayingPreview(false);
    }
  };

  const handleFetchElevenLabs = async (
    overrideUrl?: string,
    targetLangCode?: string,
    targetVoiceName?: string
  ) => {
    const targetUrl = (overrideUrl || elevenLabsUrl).trim();
    if (!targetUrl) {
      setUploadError("Vui lòng nhập link giọng ElevenLabs.");
      return;
    }

    setIsFetchingElevenLabs(true);
    setUploadError(null);
    stopPreviewAudio();

    try {
      const info = await fetchElevenLabsVoiceInfo(targetUrl);
      setElevenLabsInfo(info);
      setGender(info.gender || "Unspecified");
      setDescription(info.description || "");
      setRefText(info.ref_text || "");

      let chosenPreviewUrl = info.preview_url;
      let chosenLanguage = info.language || "Auto";
      let chosenCode = "";

      if (targetLangCode && info.available_languages && info.available_languages.length > 0) {
        const found = info.available_languages.find(
          (l) => l.code.toLowerCase() === targetLangCode.toLowerCase()
        );
        if (found) {
          chosenPreviewUrl = found.preview_url;
          chosenLanguage = found.label;
          chosenCode = found.code;
        }
      }

      setSelectedPreviewUrl(chosenPreviewUrl);
      setSelectedLangCode(chosenCode);
      setLanguage(chosenLanguage);
      setName(
        targetVoiceName ||
          (chosenCode
            ? `${info.name} (${chosenLanguage})`
            : `${info.name} (ElevenLabs)`)
      );
    } catch (err: any) {
      setUploadError(err.message || "Không thể lấy thông tin giọng từ ElevenLabs.");
    } finally {
      setIsFetchingElevenLabs(false);
    }
  };

  const handleCloneElevenLabs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!elevenLabsUrl.trim()) {
      setUploadError("Vui lòng nhập link ElevenLabs.");
      return;
    }
    if (!name.trim()) {
      setUploadError("Vui lòng nhập tên hiển thị cho giọng.");
      return;
    }

    setIsCloningElevenLabs(true);
    setUploadError(null);
    stopPreviewAudio();

    try {
      const newVoice = await cloneElevenLabsVoice({
        url: elevenLabsUrl.trim(),
        name: name.trim(),
        gender,
        language,
        description: description.trim(),
        ref_text: refText.trim() || undefined,
        preview_url: selectedPreviewUrl || elevenLabsInfo?.preview_url,
      });

      await onRefreshVoices();
      onSelectVoice(newVoice);
      setIsModalOpen(false);

      // Reset ElevenLabs state
      setElevenLabsUrl("");
      setElevenLabsInfo(null);
      setSelectedPreviewUrl("");
      setSelectedLangCode("");
      setName("");
      setDescription("");
      setRefText("");
    } catch (err: any) {
      setUploadError(err.message || "Lỗi khi clone giọng từ ElevenLabs.");
    } finally {
      setIsCloningElevenLabs(false);
    }
  };

  const togglePlayAudio = (voiceId: string, url: string) => {
    if (playingId === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(getAudioFullUrl(url));
      audioRef.current = newAudio;
      newAudio.play().catch((err) => console.error("Play error:", err));
      setPlayingId(voiceId);
      newAudio.onended = () => setPlayingId(null);
    }
  };

  const handleCreateVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setUploadError("Vui lòng nhập tên cho giọng nói.");
      return;
    }
    if (!audioFile) {
      setUploadError("Vui lòng chọn hoặc kéo thả file âm thanh mẫu (MP3 hoặc WAV).");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("gender", gender);
      formData.append("language", language);
      formData.append("description", description.trim());
      if (refText.trim()) formData.append("ref_text", refText.trim());
      formData.append("file", audioFile);

      const newVoice = await uploadVoice(formData);
      await onRefreshVoices();
      onSelectVoice(newVoice);
      setIsModalOpen(false);

      // Reset form
      setName("");
      setDescription("");
      setRefText("");
      setAudioFile(null);
    } catch (err: any) {
      setUploadError(err.message || "Lỗi khi lưu giọng nói.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (voiceId: string, voiceName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa giọng "${voiceName}" không?`)) return;
    try {
      await deleteVoice(voiceId);
      await onRefreshVoices();
    } catch (err: any) {
      alert("Xóa không thành công: " + err.message);
    }
  };

  const filteredVoices = voices.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.language?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGender = genderFilter === "all" || v.gender === genderFilter;
    return matchesSearch && matchesGender;
  });

  return (
    <div className="space-y-4">
      {/* Top Header & Search Bar */}
      <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white">
              Kho Giọng Mẫu (Voice Vault)
            </h2>
            <span className="text-xs font-mono text-slate-400 bg-[#161920] px-2 py-0.5 rounded border border-[#222735]">
              {voices.length} profiles
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Lưu trữ các file âm thanh chuẩn zero-shot cloning, tái sử dụng nhanh chóng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên, ngôn ngữ..."
              className="w-full pl-8 pr-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Gender Filter Buttons */}
          <div className="flex items-center bg-[#08090b] p-0.5 rounded border border-[#1e222b] text-xs">
            <button
              onClick={() => setGenderFilter("all")}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                genderFilter === "all" ? "bg-[#161920] text-white border border-[#2a2f3d]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setGenderFilter("Female")}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                genderFilter === "Female" ? "bg-[#161920] text-white border border-[#2a2f3d]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Nữ
            </button>
            <button
              onClick={() => setGenderFilter("Male")}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                genderFilter === "Male" ? "bg-[#161920] text-white border border-[#2a2f3d]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Nam
            </button>
          </div>

          {/* View Mode Toggle (Grid / Table) */}
          <div className="flex items-center bg-[#08090b] p-0.5 rounded border border-[#1e222b] text-xs">
            <button
              onClick={() => setViewMode("grid")}
              title="Chế độ xem lưới"
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                viewMode === "grid" ? "bg-[#161920] text-blue-400 border border-[#2a2f3d]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              title="Chế độ danh sách (Bảng)"
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                viewMode === "table" ? "bg-[#161920] text-blue-400 border border-[#2a2f3d]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => {
              setModalTab("elevenlabs");
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-600/40 transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Clone từ ElevenLabs</span>
          </button>

          <button
            onClick={() => {
              setModalTab("upload");
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm giọng</span>
          </button>
        </div>
      </div>

      {/* View Content */}
      {viewMode === "grid" ? (
        /* Voice Cards Grid - Expands to 4-5 cols on wide screens */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filteredVoices.map((v) => {
            const isSelected = selectedVoiceId === v.id;
            const isPlaying = playingId === v.id;

            return (
              <div
                key={v.id}
                className={`group bg-[#0e1014] border rounded-lg p-4 flex flex-col justify-between transition-all hover:shadow-md ${
                  isSelected
                    ? "border-blue-500/80 bg-[#12151c] ring-1 ring-blue-500/20"
                    : "border-[#1e222b] hover:border-[#2a303e]"
                }`}
              >
                <div className="space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-white truncate">
                          {v.name}
                        </h3>
                        {isSelected && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-500" />
                          {v.gender}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 truncate">
                          <Globe className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="truncate">{v.language}</span>
                        </span>
                      </div>
                    </div>

                    {/* Audio Preview & Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      {v.has_audio && (
                        <button
                          onClick={() => togglePlayAudio(v.id, v.audio_url)}
                          title={isPlaying ? "Dừng nghe" : "Nghe thử mẫu"}
                          className={`w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer border ${
                            isPlaying
                              ? "bg-blue-600 text-white border-blue-500"
                              : "bg-[#161920] hover:bg-[#202532] text-slate-300 border-[#232836]"
                          }`}
                        >
                          {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                        </button>
                      )}

                      <button
                        onClick={() => handleDelete(v.id, v.name)}
                        title="Xóa giọng"
                        className="w-7 h-7 rounded flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  {v.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {v.description}
                    </p>
                  )}

                  {v.ref_text && (
                    <div className="p-2 rounded bg-[#08090b] border border-[#181b22] text-[11px] text-slate-500 line-clamp-2 font-mono">
                      &quot;{v.ref_text}&quot;
                    </div>
                  )}
                </div>

                {/* Bottom Action */}
                <div className="pt-3 mt-3 border-t border-[#181b22] flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500">
                    {v.prompt_filename ? "⚡ Cache sẵn sàng" : "File gốc"}
                  </span>

                  <button
                    onClick={() => onSelectVoice(v)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-blue-600 text-white"
                        : "bg-[#161920] hover:bg-[#202532] text-slate-300 hover:text-white border border-[#232836]"
                    }`}
                  >
                    {isSelected ? "Đã chọn" : "Chọn giọng này"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Quick Add Voice Card Slot */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="group min-h-[160px] border border-dashed border-[#1e222b] hover:border-blue-500/50 rounded-lg p-5 flex flex-col items-center justify-center text-center bg-[#090b0e]/50 hover:bg-[#0e1117] transition-all cursor-pointer space-y-2"
          >
            <div className="w-9 h-9 rounded-full bg-[#161920] group-hover:bg-blue-600/20 text-slate-400 group-hover:text-blue-400 flex items-center justify-center transition-colors border border-[#222735] group-hover:border-blue-500/40">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300 group-hover:text-white">
                Thêm giọng mẫu mới
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Tải file WAV / MP3 (3-10s)
              </p>
            </div>
          </button>
        </div>
      ) : (
        /* Pro Table List View for high density */
        <div className="bg-[#0e1014] border border-[#1e222b] rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#08090b] border-b border-[#1e222b] text-slate-400 font-medium font-mono uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-3 w-12 text-center">Nghe</th>
                  <th className="p-3">Tên giọng</th>
                  <th className="p-3">Giới tính</th>
                  <th className="p-3">Ngôn ngữ</th>
                  <th className="p-3">Mô tả & Kịch bản mẫu</th>
                  <th className="p-3">Trạng thái Cache</th>
                  <th className="p-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181b22]">
                {filteredVoices.map((v) => {
                  const isSelected = selectedVoiceId === v.id;
                  const isPlaying = playingId === v.id;
                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-[#12151c] transition-colors ${
                        isSelected ? "bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        {v.has_audio ? (
                          <button
                            onClick={() => togglePlayAudio(v.id, v.audio_url)}
                            className={`w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer border ${
                              isPlaying
                                ? "bg-blue-600 text-white border-blue-500"
                                : "bg-[#161920] hover:bg-[#202532] text-slate-300 border-[#232836]"
                            }`}
                          >
                            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                          </button>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="p-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <span>{v.name}</span>
                          {isSelected && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              Đang chọn
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-300">{v.gender}</td>
                      <td className="p-3 text-slate-300">{v.language}</td>
                      <td className="p-3 text-slate-400 max-w-xs truncate">
                        {v.description || v.ref_text || "—"}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-400">
                        {v.prompt_filename ? "⚡ Sẵn sàng" : "File gốc"}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => onSelectVoice(v)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-blue-600 text-white"
                                : "bg-[#161920] hover:bg-[#202532] text-slate-300 hover:text-white border border-[#232836]"
                            }`}
                          >
                            {isSelected ? "Đã chọn" : "Chọn giọng"}
                          </button>
                          <button
                            onClick={() => handleDelete(v.id, v.name)}
                            title="Xóa giọng"
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredVoices.length === 0 && (
        <div className="p-8 text-center bg-[#0e1014] border border-[#1e222b] rounded-lg space-y-2">
          <p className="text-xs text-slate-400">Không tìm thấy giọng nói phù hợp.</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setGenderFilter("all");
            }}
            className="text-xs text-blue-400 hover:underline cursor-pointer"
          >
            Đặt lại bộ lọc
          </button>
        </div>
      )}

      {/* Add New Voice Modal Sheet */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-studio-in">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0e1014] border border-[#2a2f3d] rounded-lg p-5 space-y-4 shadow-2xl custom-scrollbar">
            <div className="flex items-center justify-between border-b border-[#1e222b] pb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalTab("upload");
                    stopPreviewAudio();
                    setUploadError(null);
                  }}
                  className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                    modalTab === "upload"
                      ? "bg-[#161920] text-blue-400 border border-[#2a2f3d]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <FileAudio className="w-3.5 h-3.5" />
                  <span>Tải File Audio</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setModalTab("elevenlabs");
                    stopPreviewAudio();
                    setUploadError(null);
                  }}
                  className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                    modalTab === "elevenlabs"
                      ? "bg-[#161920] text-amber-300 border border-amber-600/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Clone từ ElevenLabs</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setIsModalOpen(false);
                  stopPreviewAudio();
                }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-[#161920] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalTab === "elevenlabs" ? (
              /* ElevenLabs Clone Form */
              <form onSubmit={handleCloneElevenLabs} className="space-y-3.5">
                {uploadError && (
                  <div className="p-3 rounded bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                    <span>Đường link Voice trên ElevenLabs *</span>
                    <span className="text-[10px] text-slate-500 font-mono">/voices/{`{id}`} hoặc ?voiceId=</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={elevenLabsUrl}
                        onChange={(e) => setElevenLabsUrl(e.target.value)}
                        placeholder="https://elevenlabs.io/voices/xAVsdcJvD1uegu8lFEE2"
                        className="w-full pl-8 pr-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isFetchingElevenLabs || !elevenLabsUrl.trim()}
                      onClick={() => handleFetchElevenLabs()}
                      className="px-3.5 py-1.5 rounded text-xs font-medium text-amber-300 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/50 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isFetchingElevenLabs ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Đang lấy...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Lấy thông tin</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Popular Voice Samples Grid (27 Languages) */}
                  <div className="space-y-2 pt-1 border-t border-[#1e222b]">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-amber-400" />
                        <span>Mẫu giọng nhanh ({POPULAR_VOICE_SAMPLES.length} ngôn ngữ phổ thông)</span>
                      </label>
                      <span className="text-[10px] text-slate-500 font-mono">
                        Chọn để tự động điền & lấy mẫu
                      </span>
                    </div>

                    {/* Quick filter input */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={sampleSearchQuery}
                        onChange={(e) => setSampleSearchQuery(e.target.value)}
                        placeholder="Tìm kiếm ngôn ngữ (Việt, Anh, Nhật, Hàn, Pháp, Đức, Nga, Trung...)"
                        className="w-full pl-8 pr-7 py-1.5 text-xs rounded bg-[#08090b] border border-[#1e222b] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                      />
                      {sampleSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setSampleSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Scrollable Language Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto p-1.5 rounded-lg bg-[#08090b] border border-[#1e222b] custom-scrollbar">
                      {POPULAR_VOICE_SAMPLES.filter(
                        (s) =>
                          !sampleSearchQuery ||
                          s.lang.toLowerCase().includes(sampleSearchQuery.toLowerCase()) ||
                          s.name.toLowerCase().includes(sampleSearchQuery.toLowerCase())
                      ).map((sample, idx) => {
                        const isSelectedSample =
                          elevenLabsUrl.includes(sample.voiceId) &&
                          (!sample.langCode || selectedLangCode === sample.langCode);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              const url = `https://elevenlabs.io/voices/${sample.voiceId}`;
                              setElevenLabsUrl(url);
                              handleFetchElevenLabs(url, sample.langCode, sample.name);
                            }}
                            className={`flex items-center gap-2 p-2 rounded text-left transition-all cursor-pointer border ${
                              isSelectedSample
                                ? "bg-amber-950/40 text-amber-300 border-amber-600/60 shadow-sm"
                                : "bg-[#14171f] hover:bg-[#1b202c] text-slate-300 hover:text-white border-[#222735]"
                            }`}
                          >
                            <span className="text-base shrink-0">{sample.flag}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate leading-tight">{sample.lang}</p>
                              <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">{sample.name}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {elevenLabsInfo && (
                  <div className="p-3.5 rounded-lg bg-[#14171f] border border-[#232836] space-y-3">
                    <div className="flex items-center justify-between gap-3 border-b border-[#1e222b] pb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                          <Volume2 className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-white truncate">
                              {elevenLabsInfo.name}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0e1014] text-amber-400 border border-amber-800/40">
                              {language}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0e1014] text-slate-400 border border-[#222735]">
                              {elevenLabsInfo.gender}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            Voice ID: {elevenLabsInfo.voice_id}
                          </p>
                        </div>
                      </div>

                      {(selectedPreviewUrl || elevenLabsInfo.preview_url) && (
                        <button
                          type="button"
                          onClick={() => togglePlayPreview(selectedPreviewUrl || elevenLabsInfo.preview_url)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                            isPlayingPreview
                              ? "bg-amber-500 text-black shadow-sm font-semibold"
                              : "bg-[#1c202a] hover:bg-[#252b39] text-amber-400 border border-amber-700/40"
                          }`}
                        >
                          {isPlayingPreview ? (
                            <>
                              <Pause className="w-3.5 h-3.5" />
                              <span>Tạm dừng</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Nghe thử mẫu</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Multilingual Preview Switcher if voice supports multiple languages */}
                    {elevenLabsInfo.available_languages && elevenLabsInfo.available_languages.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-[#1e222b]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                            <Globe className="w-3 h-3 text-amber-400" />
                            <span>Đổi ngôn ngữ mẫu ({elevenLabsInfo.available_languages.length} ngôn ngữ có sẵn):</span>
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">Bấm để đổi audio mẫu</span>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 rounded bg-[#08090b] border border-[#1e222b] custom-scrollbar">
                          {elevenLabsInfo.available_languages.map((item) => {
                            const isSelectedLang =
                              (selectedPreviewUrl || elevenLabsInfo.preview_url) === item.preview_url;
                            return (
                              <button
                                key={item.code}
                                type="button"
                                onClick={() => {
                                  setSelectedPreviewUrl(item.preview_url);
                                  setSelectedLangCode(item.code);
                                  setLanguage(item.label);
                                  setName(`${elevenLabsInfo.name} (${item.label})`);
                                  if (isPlayingPreview) {
                                    togglePlayPreview(item.preview_url);
                                  }
                                }}
                                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer border ${
                                  isSelectedLang
                                    ? "bg-amber-500 text-black border-amber-400 font-semibold shadow-sm"
                                    : "bg-[#14171f] hover:bg-[#1e2330] text-slate-300 border-[#252a38]"
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">
                        Tên hiển thị trong Kho Giọng *
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300">Giới tính</label>
                        <select
                          value={gender}
                          onChange={(e) => setGender(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                        >
                          <option value="Male">Nam (Male)</option>
                          <option value="Female">Nữ (Female)</option>
                          <option value="Unspecified">Không xác định</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300">Ngôn ngữ</label>
                        <input
                          type="text"
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                          className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Mô tả giọng</label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                        <span>Đoạn transcript mẫu (Ref Text)</span>
                        <span className="text-[10px] text-emerald-400 font-mono">Tự động trích xuất</span>
                      </label>
                      <textarea
                        value={refText}
                        onChange={(e) => setRefText(e.target.value)}
                        rows={2}
                        className="w-full p-2.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-amber-500 font-sans resize-none"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e222b]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      stopPreviewAudio();
                    }}
                    className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white bg-[#14171f] hover:bg-[#1c202a] border border-[#222735] transition-colors cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={isCloningElevenLabs || !elevenLabsUrl.trim() || !name.trim()}
                    className="px-4 py-1.5 rounded text-xs font-medium text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    {isCloningElevenLabs ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang clone & tính toán Prompt...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Clone về Kho Giọng</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* Upload File Form */
              <form onSubmit={handleCreateVoice} className="space-y-3.5">
                {uploadError && (
                  <div className="p-3 rounded bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">
                    Tên giọng nói (Voice Name) *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="VD: Nguyễn Văn A (Nam, truyền cảm)..."
                    className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Giới tính</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                    >
                      <option value="Female">Nữ (Female)</option>
                      <option value="Male">Nam (Male)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Ngôn ngữ</label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="Vietnamese, English..."
                      className="w-full px-3 py-1.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">
                    File âm thanh mẫu (WAV / MP3, khuyến nghị 3-10 giây) *
                  </label>
                  <div className="p-4 rounded border border-dashed border-[#2a2f3d] bg-[#08090b] text-center space-y-2">
                    <FileAudio className="w-6 h-6 text-slate-500 mx-auto" />
                    <input
                      type="file"
                      accept="audio/*"
                      required
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setAudioFile(e.target.files[0]);
                        }
                      }}
                      className="text-xs text-slate-400 file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-[#161920] file:text-white hover:file:bg-[#202532] cursor-pointer"
                    />
                    {audioFile && (
                      <p className="text-xs font-mono text-emerald-400">
                        Đã chọn: {audioFile.name} ({(audioFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">
                    Nội dung file mẫu nói gì (Ref Text - Tùy chọn)
                  </label>
                  <textarea
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    rows={2}
                    placeholder="Nhập nguyên văn câu nói trong file audio mẫu nếu có (tăng độ chính xác zero-shot)..."
                    className="w-full p-2.5 rounded bg-[#08090b] border border-[#1e222b] text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-sans resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e222b]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      stopPreviewAudio();
                    }}
                    className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white bg-[#14171f] hover:bg-[#1c202a] border border-[#222735] transition-colors cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading}
                    className="px-4 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang lưu...</span>
                      </>
                    ) : (
                      <span>Lưu vào Kho Giọng</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
