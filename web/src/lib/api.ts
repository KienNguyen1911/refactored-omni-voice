export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : typeof window !== "undefined"
      ? window.location.origin
      : "http://127.0.0.1:8000";

export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: string;
  language: string;
  audio_filename: string;
  prompt_filename: string | null;
  ref_text: string;
  created_at: string;
  has_audio: boolean;
  audio_url: string;
}

export interface BackendHealth {
  status: string;
  model_loaded: boolean;
  is_loading: boolean;
  device: string;
  gpu_name: string;
  sampling_rate: number;
  current_task_id?: string | null;
  concurrency?: number;
  max_concurrency?: number;
  active_workers?: number;
}

export interface WorkerSettings {
  concurrency: number;
  max_concurrency: number;
  active_workers: number;
  current_task_id?: string | null;
}

export interface GenerationResult {
  status: string;
  audio_url: string;
  filename: string;
  duration_sec: number;
  generation_time_sec: number;
  text: string;
  sampling_rate: number;
  instruct?: string;
  task_id?: string;
  order_num?: number;
}

export interface VoiceTask {
  id: string;
  order_num: number;
  task_type: "clone" | "design";
  text: string;
  voice_id?: string | null;
  voice_name?: string | null;
  language: string;
  instruct?: string | null;
  params: Record<string, any>;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  audio_url?: string | null;
  filename?: string | null;
  srt_url?: string | null;
  srt_filename?: string | null;
  duration_sec?: number | null;
  generation_time_sec?: number | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  is_master?: number;
  parent_id?: string | null;
  total_chunks?: number;
  completed_chunks?: number;
  gap_sec?: number;
}

export interface TaskStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface CreateTaskParams {
  task_type: "clone" | "design";
  text: string;
  voice_id?: string;
  voice_name?: string;
  language?: string;
  instruct?: string;
  speed?: number;
  duration?: number | null;
  num_step?: number;
  guidance_scale?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
  ref_text?: string;
}

export interface BatchTaskItem {
  text: string;
  task_type?: "clone" | "design";
  instruct?: string;
  language?: string;
  voice_id?: string;
  voice_name?: string;
  params?: Record<string, any>;
}

export interface MergedBatch {
  id: string;
  batch_id: string;
  title: string;
  audio_url: string;
  filename: string;
  duration_sec: number;
  chunks_count: number;
  gap_sec: number;
  created_at: string;
}

export interface SplitTextResponse {
  chunks: string[];
  total_chunks: number;
  total_chars: number;
}

export interface MergeResponse {
  status: string;
  audio_url: string;
  filename: string;
  duration_sec: number;
  chunks_count: number;
  gap_sec: number;
  sampling_rate: number;
}

export interface CreateBatchTasksParams {
  items: BatchTaskItem[];
  common_type?: "clone" | "design";
  common_voice_id?: string;
  common_voice_name?: string;
  common_language?: string;
  common_instruct?: string;
  common_params?: Record<string, any>;
  batch_id?: string;
  auto_merge?: boolean;
  gap_sec?: number;
}

export async function fetchHealth(): Promise<BackendHealth> {
  const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
  if (!res.ok) throw new Error("Backend not reachable");
  return res.json();
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE}/api/voices`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch voices");
  return res.json();
}

export async function fetchLanguages(): Promise<{ code: string; name: string }[]> {
  const res = await fetch(`${API_BASE}/api/languages`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch languages");
  return res.json();
}

export async function fetchDesignOptions(): Promise<{
  categories: Record<string, string[]>;
  info: Record<string, string>;
}> {
  const res = await fetch(`${API_BASE}/api/design-options`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch design options");
  return res.json();
}

export async function uploadVoice(formData: FormData): Promise<Voice> {
  const res = await fetch(`${API_BASE}/api/voices`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to upload voice");
  }
  return res.json();
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/voices/${voiceId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete voice");
}

export interface ElevenLabsVoiceInfo {
  voice_id: string;
  name: string;
  description: string;
  gender: string;
  language: string;
  preview_url: string;
  ref_text: string;
  source_url: string;
  available_languages?: Array<{
    code: string;
    label: string;
    preview_url: string;
  }>;
}

export interface CloneElevenLabsParams {
  url: string;
  name?: string;
  gender?: string;
  language?: string;
  description?: string;
  ref_text?: string;
  preview_url?: string;
}

export async function fetchElevenLabsVoiceInfo(url: string): Promise<ElevenLabsVoiceInfo> {
  const res = await fetch(`${API_BASE}/api/voices/elevenlabs/fetch-info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || "Không thể lấy thông tin giọng từ ElevenLabs");
  }
  return res.json();
}

export async function cloneElevenLabsVoice(params: CloneElevenLabsParams): Promise<Voice> {
  const res = await fetch(`${API_BASE}/api/voices/elevenlabs/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || "Không thể clone giọng từ ElevenLabs");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Task and Queue API
// ---------------------------------------------------------------------------

export async function fetchTasks(status?: string, limit = 200, offset = 0): Promise<VoiceTask[]> {
  const query = new URLSearchParams();
  if (status && status !== "all") {
    query.set("status", status);
  }
  query.set("limit", limit.toString());
  query.set("offset", offset.toString());

  const res = await fetch(`${API_BASE}/api/tasks?${query.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export async function fetchTaskStats(): Promise<TaskStats> {
  const res = await fetch(`${API_BASE}/api/tasks/stats`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch task stats");
  return res.json();
}

export async function fetchTask(taskId: string): Promise<VoiceTask> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch task detail");
  return res.json();
}

export async function createTask(params: CreateTaskParams): Promise<VoiceTask> {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create task");
  }
  return res.json();
}

export async function createBatchTasks(params: CreateBatchTasksParams): Promise<{
  status: string;
  count: number;
  tasks: VoiceTask[];
}> {
  const res = await fetch(`${API_BASE}/api/tasks/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create batch tasks");
  }
  return res.json();
}

export async function retryTask(taskId: string): Promise<VoiceTask> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/retry`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to retry task");
  }
  return res.json();
}

export async function cancelTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to cancel task");
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete task");
  }
}

export async function clearFinishedTasks(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear finished tasks");
}

// ---------------------------------------------------------------------------
// Synchronous fallback generation
// ---------------------------------------------------------------------------

export async function generateClone(params: {
  text: string;
  voice_id: string;
  language?: string;
  instruct?: string;
  ref_text?: string;
  speed?: number;
  duration?: number | null;
  num_step?: number;
  guidance_scale?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
}): Promise<GenerationResult> {
  const res = await fetch(`${API_BASE}/api/generate/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || "Voice synthesis failed");
  }
  return res.json();
}

export async function generateDesign(params: {
  text: string;
  instruct: string;
  language?: string;
  speed?: number;
  duration?: number | null;
  num_step?: number;
  guidance_scale?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
}): Promise<GenerationResult> {
  const res = await fetch(`${API_BASE}/api/generate/design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || "Voice design synthesis failed");
  }
  return res.json();
}

export function getAudioFullUrl(relativeUrl: string): string {
  if (relativeUrl.startsWith("http")) return relativeUrl;
  return `${API_BASE}${relativeUrl}`;
}

export async function splitText(text: string, targetChars: number = 1000): Promise<SplitTextResponse> {
  const res = await fetch(`${API_BASE}/api/tools/split-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, target_chars: targetChars }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to split text");
  }
  return res.json();
}

export async function mergeTasksAudio(
  taskIds: string[],
  gapSec: number = 0.8,
  outputFilename?: string
): Promise<MergeResponse> {
  const res = await fetch(`${API_BASE}/api/tasks/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_ids: taskIds, gap_sec: gapSec, output_filename: outputFilename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to merge audio");
  }
  return res.json();
}

export async function fetchMergedBatches(): Promise<MergedBatch[]> {
  const res = await fetch(`${API_BASE}/api/batches/merged`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchMergedBatch(batchId: string): Promise<MergedBatch | null> {
  const res = await fetch(`${API_BASE}/api/batches/${batchId}/merged`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export interface CreateLongFormTaskParams {
  text: string;
  voice_id: string;
  voice_name?: string;
  language?: string;
  instruct?: string;
  speed?: number;
  chunk_size?: number;
  gap_sec?: number;
  num_step?: number;
  guidance_scale?: number;
  denoise?: boolean;
}

export interface LongFormTaskResponse {
  status: string;
  task_id: string;
  order_num: number;
  total_chunks: number;
  progress: number;
  status_url: string;
  message: string;
}

export async function createLongFormTask(params: CreateLongFormTaskParams): Promise<LongFormTaskResponse> {
  const res = await fetch(`${API_BASE}/api/tasks/long-form`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create long form voice task");
  }
  return res.json();
}

export async function generateTaskSrt(taskId: string): Promise<{ srt_url: string; srt_filename: string; srt_content: string }> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/generate-srt`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate SRT subtitles");
  }
  return res.json();
}

export async function triggerCleanup(hours: number = 48.0): Promise<{
  status: string;
  deleted_tasks: number;
  deleted_batches: number;
  deleted_files: number;
  deleted_chunk_files: number;
}> {
  const res = await fetch(`${API_BASE}/api/tasks/cleanup?hours=${hours}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to trigger cleanup");
  }
  return res.json();
}

export async function fetchWorkerSettings(): Promise<WorkerSettings> {
  const res = await fetch(`${API_BASE}/api/worker/settings`);
  if (!res.ok) {
    throw new Error(`Failed to fetch worker settings: ${res.statusText}`);
  }
  return res.json();
}

export async function updateWorkerConcurrency(concurrency: number): Promise<WorkerSettings> {
  const res = await fetch(`${API_BASE}/api/worker/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concurrency }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update worker concurrency: ${res.statusText}`);
  }
  return res.json();
}


