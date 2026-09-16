"use client";

import React, { useState, useEffect } from "react";
import { API_BASE, fetchHealth, BackendHealth } from "@/lib/api";
import {
  Code2,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  Play,
  Layers,
  Mic,
  Wand2,
  Subtitles,
  Search,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Cpu,
  RefreshCw,
  HelpCircle,
  BookOpen,
  CheckCircle2,
} from "lucide-react";

type CodeLang = "curl" | "python" | "javascript" | "node";

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  defaultVal?: string;
  description: string;
}

interface EndpointDoc {
  id: string;
  method: "GET" | "POST";
  path: string;
  category: "design" | "clone" | "voices" | "tasks";
  title: string;
  description: string;
  tags: string[];
  params?: ParamInfo[];
  bodyType?: "json" | "multipart" | "none";
  exampleRequest: {
    curl: string;
    python: string;
    javascript: string;
    node: string;
  };
  exampleResponse: {
    status: number;
    data: any;
  };
  canTestLive?: boolean;
  testConfig?: {
    method: "GET" | "POST";
    path: string;
    defaultBody?: any;
  };
}

export default function ApiDocumentation() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("" );
  const [selectedLang, setSelectedLang] = useState<CodeLang>("python");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({
    "task-design": true,
    "task-clone": true,
    "tasks-check": true,
  });

  // Live test state
  const [testOutputs, setTestOutputs] = useState<
    Record<string, { loading: boolean; status?: number; timeMs?: number; data?: any; error?: string }>
  >({});

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleExpand = (id: string) => {
    setExpandedEndpoints((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const runLiveTest = async (endpoint: EndpointDoc) => {
    if (!endpoint.testConfig) return;
    const { method, path, defaultBody } = endpoint.testConfig;
    const testId = endpoint.id;

    setTestOutputs((prev) => ({
      ...prev,
      [testId]: { loading: true },
    }));

    const startTime = performance.now();
    try {
      const url = `${API_BASE}${path}`;
      const options: RequestInit = {
        method,
        headers: defaultBody ? { "Content-Type": "application/json" } : {},
        body: defaultBody ? JSON.stringify(defaultBody) : undefined,
      };

      const res = await fetch(url, options);
      const timeMs = Math.round(performance.now() - startTime);
      const data = await res.json();

      setTestOutputs((prev) => ({
        ...prev,
        [testId]: {
          loading: false,
          status: res.status,
          timeMs,
          data,
        },
      }));
    } catch (err: any) {
      const timeMs = Math.round(performance.now() - startTime);
      setTestOutputs((prev) => ({
        ...prev,
        [testId]: {
          loading: false,
          status: 0,
          timeMs,
          error: err.message || "Không thể kết nối đến máy chủ",
        },
      }));
    }
  };

  // 4 Core API Groups:
  // 1. Tạo MP3 + SRT từ Voice Design
  // 2. Tạo MP3 + SRT từ Voice Clone
  // 3. List Voice & Tạo Voice
  // 4. List Task & Check Task
  const endpoints: EndpointDoc[] = [
    // ----------------------------------------------------
    // 1. TẠO MP3 + SRT TỪ VOICE DESIGN
    // ----------------------------------------------------
    {
      id: "task-design",
      method: "POST",
      path: "/api/tasks/design",
      category: "design",
      title: "Tạo Âm Thanh & Phụ Đề SRT Từ Voice Design (Prompt)",
      description:
        "Tạo giọng nói mới hoàn toàn từ mô tả tự nhiên (instruct). Truyền vào transcript bất kỳ (ngắn hay dài hàng nghìn chữ), hệ thống sẽ tự động phân chia đoạn thông minh khi thực hiện và mặc định xuất ra file âm thanh (MP3/WAV) cùng file phụ đề SRT (Forced Alignment) khớp từng từ.",
      tags: ["Voice Design", "Tự động Chunk", "Mặc định xuất SRT + Audio"],
      bodyType: "json",
      params: [
        {
          name: "transcript",
          type: "string",
          required: true,
          description: "Toàn bộ kịch bản / văn bản cần đọc (tự động chunking nếu dài, chấp nhận alias 'text').",
        },
        {
          name: "instruct",
          type: "string",
          required: true,
          description: "Mô tả đặc tính giọng nói (Ví dụ: 'Nữ trẻ tuổi, giọng Hà Nội trong trẻo, truyền cảm, nhịp điệu từ tốn').",
        },
        {
          name: "language",
          type: "string",
          required: false,
          defaultVal: "vi",
          description: "Mã ngôn ngữ đọc (mặc định 'vi' hoặc 'Auto').",
        },
        {
          name: "speed",
          type: "float",
          required: false,
          defaultVal: "1.0",
          description: "Tốc độ đọc giọng nói (0.5 - 2.0).",
        },
        {
          name: "gap_sec",
          type: "float",
          required: false,
          defaultVal: "0.8",
          description: "Khoảng lặng nối giữa các câu/đoạn khi transcript dài (giây).",
        },
        {
          name: "num_step",
          type: "int",
          required: false,
          defaultVal: "32",
          description: "Số bước khuếch tán Diffusion (16 - 64).",
        },
      ],
      exampleRequest: {
        curl: `curl -X POST "${API_BASE}/api/tasks" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_type": "design",
    "transcript": "Chào mừng quý vị và các bạn đã quay trở lại với kênh khoa học và công nghệ. Trong tập hôm nay, chúng ta cùng tìm hiểu về mô hình trí tuệ nhân tạo thế hệ mới...",
    "instruct": "Nam trung niên, giọng miền Nam trầm ấm, phong thái tin tức khoa học chuyên nghiệp, phát âm rõ ràng",
    "language": "vi",
    "speed": 1.0,
    "gap_sec": 0.8
  }'`,
        python: `import requests

url = "${API_BASE}/api/tasks"  # Hoặc ${API_BASE}/api/tasks/design
payload = {
    "task_type": "design",
    "transcript": "Chào mừng bạn đến với OmniVoice Studio. Hệ thống tự động chunk transcript và luôn xuất kèm phụ đề SRT chuẩn xác.",
    "instruct": "Nữ trẻ tuổi, giọng Hà Nội nhẹ nhàng, truyền cảm",
    "language": "vi",
    "speed": 1.0
}

res = requests.post(url, json=payload).json()
print("Task ID đã tạo:", res["id"])
print("Trạng thái:", res["status"])
# Khi hoàn thành, gọi GET /api/tasks/{task_id} để lấy audio_url và srt_url`,
        javascript: `const res = await fetch("${API_BASE}/api/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    task_type: "design",
    transcript: "Chào mừng bạn đến với OmniVoice Studio. Hệ thống tự động chunk và xuất file âm thanh kèm SRT.",
    instruct: "Nữ trẻ tuổi, giọng miền Bắc nhẹ nhàng, truyền cảm",
    language: "vi",
    speed: 1.0,
  }),
});
const task = await res.json();
console.log("Task ID:", task.id);`,
        node: `const axios = require('axios');

async function createDesignVoice() {
  const { data } = await axios.post('${API_BASE}/api/tasks', {
    task_type: 'design',
    transcript: 'Hệ thống tự động phân đoạn transcript và xuất đầy đủ file âm thanh kèm file phụ đề SRT.',
    instruct: 'Nam trung niên, giọng trầm ấm, phát thanh viên',
    language: 'vi'
  });
  console.log('Task ID:', data.id);
}
createDesignVoice();`,
      },
      exampleResponse: {
        status: 200,
        data: {
          id: "task_4e891b02c1",
          order_num: 15,
          task_type: "design",
          status: "pending",
          progress: 0,
          total_chunks: 1,
          created_at: "2026-09-13T03:10:00",
          status_url: "/api/tasks/task_4e891b02c1",
        },
      },
    },

    // ----------------------------------------------------
    // 2. TẠO MP3 + SRT TỪ VOICE CLONE
    // ----------------------------------------------------
    {
      id: "task-clone",
      method: "POST",
      path: "/api/tasks/clone",
      category: "clone",
      title: "Tạo Âm Thanh & Phụ Đề SRT Từ Voice Clone",
      description:
        "Nhân bản giọng nói theo mẫu có sẵn trong thư viện (voice_id). Input là transcript kịch bản (tự động chunk nếu dài), hệ thống xử lý tuần tự an toàn GPU và mặc định luôn xuất kèm file phụ đề SRT khớp thời gian từng từ.",
      tags: ["Voice Clone", "Tự động Chunk", "Mặc định xuất SRT + Audio"],
      bodyType: "json",
      params: [
        {
          name: "transcript",
          type: "string",
          required: true,
          description: "Nội dung văn bản / kịch bản cần đọc (tự động chunking nếu dài, chấp nhận alias 'text').",
        },
        {
          name: "voice_id",
          type: "string",
          required: true,
          description: "ID giọng mẫu trong thư viện (lấy danh sách từ GET /api/voices).",
        },
        {
          name: "language",
          type: "string",
          required: false,
          defaultVal: "vi",
          description: "Mã ngôn ngữ đọc (vi, en, Auto).",
        },
        {
          name: "speed",
          type: "float",
          required: false,
          defaultVal: "1.0",
          description: "Tốc độ đọc giọng nói (0.5 - 2.0).",
        },
        {
          name: "gap_sec",
          type: "float",
          required: false,
          defaultVal: "0.8",
          description: "Khoảng lặng ngắt nghỉ giữa các phân đoạn (giây).",
        },
        {
          name: "num_step",
          type: "int",
          required: false,
          defaultVal: "32",
          description: "Số bước khuếch tán Diffusion.",
        },
      ],
      exampleRequest: {
        curl: `curl -X POST "${API_BASE}/api/tasks" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_type": "clone",
    "transcript": "Hôm nay chúng ta sẽ bắt đầu bài thuyết trình về các ứng dụng thực tiễn của trí tuệ nhân tạo trong xử lý tiếng nói và phụ đề video tự động.",
    "voice_id": "voice_sample_01",
    "language": "vi",
    "speed": 1.0,
    "gap_sec": 0.8
  }'`,
        python: `import requests

url = "${API_BASE}/api/tasks"  # Hoặc ${API_BASE}/api/tasks/clone
payload = {
    "task_type": "clone",
    "transcript": "Đây là nội dung kịch bản cần đọc. Dù bạn truyền vào 1 câu hay 1 cuốn sách, hệ thống đều tự động phân đoạn và xuất ra file audio + SRT hoàn chỉnh.",
    "voice_id": "voice_sample_01",
    "language": "vi",
    "speed": 1.0
}

res = requests.post(url, json=payload).json()
print("Task ID đã tạo:", res["id"])
print("Trạng thái:", res["status"])`,
        javascript: `const res = await fetch("${API_BASE}/api/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    task_type: "clone",
    transcript: "Nội dung cần thuyết minh...",
    voice_id: "voice_sample_01",
    language: "vi",
    speed: 1.0,
  }),
});
const task = await res.json();
console.log("Task ID:", task.id);`,
        node: `const axios = require('axios');

axios.post('${API_BASE}/api/tasks', {
  task_type: 'clone',
  transcript: 'Nội dung thuyết minh kịch bản...',
  voice_id: 'voice_sample_01',
  language: 'vi'
}).then(res => console.log('Task ID:', res.data.id));`,
      },
      exampleResponse: {
        status: 200,
        data: {
          id: "task_8a719c02df",
          order_num: 16,
          task_type: "clone",
          voice_id: "voice_sample_01",
          voice_name: "Hương Mai (Hà Nội)",
          status: "pending",
          progress: 0,
          total_chunks: 1,
          created_at: "2026-09-13T03:12:00",
          status_url: "/api/tasks/task_8a719c02df",
        },
      },
    },

    // ----------------------------------------------------
    // 3. QUẢN LÝ GIỌNG (LIST VOICE & TẠO VOICE)
    // ----------------------------------------------------
    {
      id: "voices-list",
      method: "GET",
      path: "/api/voices",
      category: "voices",
      title: "Lấy Danh Sách Giọng Mẫu (List Voices)",
      description:
        "Trả về toàn bộ danh sách hồ sơ giọng đọc đã lưu trữ trong thư viện. Sử dụng các 'id' trong danh sách này để truyền vào tham số voice_id khi tạo task clone.",
      tags: ["Voice Vault", "Danh sách giọng", "Profiles"],
      canTestLive: true,
      testConfig: {
        method: "GET",
        path: "/api/voices",
      },
      exampleRequest: {
        curl: `curl "${API_BASE}/api/voices"`,
        python: `import requests

voices = requests.get("${API_BASE}/api/voices").json()
for v in voices:
    print(f"ID: {v['id']} | Tên: {v['name']} | Giới tính: {v['gender']} | Ngôn ngữ: {v['language']}")`,
        javascript: `const res = await fetch("${API_BASE}/api/voices");
const voices = await res.json();
console.log("Danh sách giọng:", voices);`,
        node: `const axios = require('axios');
const { data } = await axios.get('${API_BASE}/api/voices');
console.log(data);`,
      },
      exampleResponse: {
        status: 200,
        data: [
          {
            id: "voice_sample_01",
            name: "Hương Mai (Hà Nội)",
            gender: "Female",
            language: "Vietnamese",
            description: "Giọng nữ thanh lịch, chuẩn phát thanh",
            audio_url: "/api/audio/voice_sample_01",
            has_audio: true,
            created_at: "2026-09-12T10:00:00",
          },
        ],
      },
    },
    {
      id: "voices-create",
      method: "POST",
      path: "/api/voices",
      category: "voices",
      title: "Tạo Mẫu Giọng Mới (Upload Voice Sample)",
      description:
        "Tải lên file âm thanh mẫu (WAV hoặc MP3 từ 3 đến 10 giây) để tạo hồ sơ clone mới vào thư viện. Hệ thống tự động trích xuất đặc trưng âm học.",
      tags: ["Upload Mẫu", "Multipart/Form-Data", "Đăng ký giọng"],
      bodyType: "multipart",
      params: [
        {
          name: "name",
          type: "string (Form)",
          required: true,
          description: "Tên đại diện cho giọng đọc (Ví dụ: 'MC Hoàng Nam').",
        },
        {
          name: "file",
          type: "file (UploadFile)",
          required: true,
          description: "File âm thanh mẫu sạch (3s - 15s, định dạng WAV hoặc MP3).",
        },
        {
          name: "gender",
          type: "string (Form)",
          required: false,
          defaultVal: "Female",
          description: "Giới tính ('Female', 'Male', hoặc 'Unspecified').",
        },
        {
          name: "language",
          type: "string (Form)",
          required: false,
          defaultVal: "Auto",
          description: "Ngôn ngữ của file âm thanh mẫu.",
        },
        {
          name: "description",
          type: "string (Form)",
          required: false,
          description: "Ghi chú ngắn về đặc điểm giọng.",
        },
      ],
      exampleRequest: {
        curl: `curl -X POST "${API_BASE}/api/voices" \\
  -F "name=MC Hoàng Nam" \\
  -F "gender=Male" \\
  -F "language=Vietnamese" \\
  -F "file=@/path/to/sample_voice.mp3"`,
        python: `import requests

url = "${API_BASE}/api/voices"
data = {
    "name": "MC Hoàng Nam",
    "gender": "Male",
    "language": "Vietnamese"
}
files = {
    "file": open("sample_voice.mp3", "rb")
}

res = requests.post(url, data=data, files=files).json()
print("Voice ID mới tạo:", res["id"])`,
        javascript: `const formData = new FormData();
formData.append("name", "MC Hoàng Nam");
formData.append("gender", "Male");
formData.append("file", fileInput.files[0]);

const res = await fetch("${API_BASE}/api/voices", {
  method: "POST",
  body: formData,
});
const newVoice = await res.json();
console.log("Voice ID:", newVoice.id);`,
        node: `const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

const form = new FormData();
form.append('name', 'MC Hoàng Nam');
form.append('file', fs.createReadStream('sample_voice.mp3'));

const res = await axios.post('${API_BASE}/api/voices', form, {
  headers: form.getHeaders()
});
console.log('New Voice ID:', res.data.id);`,
      },
      exampleResponse: {
        status: 200,
        data: {
          id: "voice_b910e4a78c",
          name: "MC Hoàng Nam",
          gender: "Male",
          language: "Vietnamese",
          audio_filename: "voice_b910e4a78c.mp3",
          audio_url: "/api/audio/voice_b910e4a78c",
          created_at: "2026-09-13T03:15:00",
        },
      },
    },

    // ----------------------------------------------------
    // 4. QUẢN LÝ & THEO DÕI TASK (LIST TASK & CHECK TASK)
    // ----------------------------------------------------
    {
      id: "tasks-list",
      method: "GET",
      path: "/api/tasks",
      category: "tasks",
      title: "Lấy Danh Sách Tác Vụ (List Tasks)",
      description:
        "Truy vấn danh sách các tác vụ tổng hợp giọng nói, hỗ trợ lọc theo trạng thái (pending, processing, completed, failed).",
      tags: ["Danh sách Task", "Lọc trạng thái"],
      canTestLive: true,
      testConfig: {
        method: "GET",
        path: "/api/tasks?limit=10",
      },
      params: [
        {
          name: "status",
          type: "string (Query)",
          required: false,
          description: "Lọc trạng thái: 'pending', 'processing', 'completed', 'failed', hoặc để trống lấy tất cả.",
        },
        {
          name: "limit",
          type: "int (Query)",
          required: false,
          defaultVal: "200",
          description: "Số lượng bản ghi tối đa trả về.",
        },
      ],
      exampleRequest: {
        curl: `curl "${API_BASE}/api/tasks?limit=10"`,
        python: `import requests

tasks = requests.get("${API_BASE}/api/tasks?limit=10").json()
for t in tasks:
    print(f"#{t['order_num']} [{t['status']}] {t['task_type']} - Tiến độ: {t['progress']}%")`,
        javascript: `const res = await fetch("${API_BASE}/api/tasks?limit=10");
const tasks = await res.json();
console.log("Tổng số tasks:", tasks.length);`,
        node: `const axios = require('axios');
const { data } = await axios.get('${API_BASE}/api/tasks?limit=10');
console.log(data);`,
      },
      exampleResponse: {
        status: 200,
        data: [
          {
            id: "task_4e891b02c1",
            order_num: 15,
            task_type: "design",
            status: "completed",
            progress: 100,
            audio_url: "/api/audio/output_out_design_4e891b02c1.wav",
            srt_url: "/api/audio/output_out_design_4e891b02c1.srt",
            duration_sec: 5.4,
            created_at: "2026-09-13T03:10:00",
          },
        ],
      },
    },
    {
      id: "tasks-check",
      method: "GET",
      path: "/api/tasks/{task_id}",
      category: "tasks",
      title: "Kiểm Tra Trạng Thái & Lấy File Kết Quả (Check Task)",
      description:
        "Kiểm tra tiến độ thực hiện (%) của một task. Khi trạng thái chuyển sang 'completed', API trả về đầy đủ đường dẫn tải file âm thanh (audio_url) và file phụ đề SRT (srt_url) đã đồng bộ chính xác.",
      tags: ["Check Task", "Tiến độ", "Lấy Audio + SRT"],
      params: [
        {
          name: "task_id",
          type: "string (Path)",
          required: true,
          description: "Mã định danh task nhận được khi tạo (Ví dụ: 'task_4e891b02c1').",
        },
      ],
      exampleRequest: {
        curl: `curl "${API_BASE}/api/tasks/task_4e891b02c1"`,
        python: `import requests
import time

task_id = "task_4e891b02c1"

# Vòng lặp kiểm tra tiến độ đến khi hoàn thành
while True:
    res = requests.get(f"${API_BASE}/api/tasks/{task_id}").json()
    status = res["status"]
    progress = res.get("progress", 0)
    print(f"Trạng thái: {status} ({progress}%)")

    if status == "completed":
        print("Tải file Âm thanh:", "${API_BASE}" + res["audio_url"])
        print("Tải file Phụ đề SRT:", "${API_BASE}" + res["srt_url"])
        print(f"Thời lượng: {res.get('duration_sec')}s | Thời gian sinh: {res.get('generation_time_sec')}s")
        break
    elif status in ("failed", "cancelled"):
        print("Lỗi:", res.get("error_message"))
        break
    time.sleep(1.5)`,
        javascript: `async function checkTask(taskId) {
  const res = await fetch(\`${API_BASE}/api/tasks/\${taskId}\`);
  const data = await res.json();
  if (data.status === "completed") {
    console.log("Audio URL:", "${API_BASE}" + data.audio_url);
    console.log("SRT URL:", "${API_BASE}" + data.srt_url);
  }
  return data;
}`,
        node: `const axios = require('axios');

async function pollTask(taskId) {
  const { data } = await axios.get(\`${API_BASE}/api/tasks/\${taskId}\`);
  console.log('Status:', data.status, 'Progress:', data.progress + '%');
  if (data.status === 'completed') {
    console.log('Audio:', data.audio_url);
    console.log('SRT:', data.srt_url);
  }
}
pollTask('task_4e891b02c1');`,
      },
      exampleResponse: {
        status: 200,
        data: {
          id: "task_4e891b02c1",
          order_num: 15,
          task_type: "design",
          status: "completed",
          progress: 100,
          audio_url: "/api/audio/output_out_design_4e891b02c1.wav",
          filename: "out_design_4e891b02c1.wav",
          srt_url: "/api/audio/output_out_design_4e891b02c1.srt",
          srt_filename: "out_design_4e891b02c1.srt",
          duration_sec: 14.85,
          generation_time_sec: 1.42,
          created_at: "2026-09-13T03:10:00",
          completed_at: "2026-09-13T03:10:02",
        },
      },
    },
  ];

  // Filtering
  const filteredEndpoints = endpoints.filter((ep) => {
    const matchCat = selectedCategory === "all" || ep.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchQuery =
      !q ||
      ep.path.toLowerCase().includes(q) ||
      ep.title.toLowerCase().includes(q) ||
      ep.description.toLowerCase().includes(q) ||
      ep.tags.some((t) => t.toLowerCase().includes(q));
    return matchCat && matchQuery;
  });

  const getMethodBadgeClass = (method: string) => {
    switch (method) {
      case "GET":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "POST":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto pr-1 pb-16 font-sans">
      {/* Top Banner: Minimalist Swiss Telemetry & Interactive Links */}
      <div className="shrink-0 bg-[#0e1014] border border-[#1e222b] rounded-xl p-4 sm:p-5 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#161920] border border-[#232836] flex items-center justify-center text-blue-400">
                <Code2 className="w-4 h-4" />
              </div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Tài Liệu Tích Hợp API
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  Chuẩn Tinh Gọn (4 Nhóm Đầu API)
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              API tích hợp đồng bộ và đơn giản hóa tối đa: Bạn chỉ cần gửi <strong className="text-slate-200">transcript</strong>.
              Hệ thống sẽ <span className="text-blue-300 font-semibold">tự động chunking</span> khi thực hiện task nếu văn bản dài,
              và <span className="text-emerald-400 font-semibold">mặc định 100% luôn xuất file phụ đề SRT</span> (Forced Alignment)
              kèm file âm thanh chất lượng cao. Không cần tách hay gộp thủ công.
            </p>
          </div>

          {/* Telemetry & Quick Action Links */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#08090b] border border-[#1e222b] text-xs font-mono">
              <span className="text-slate-500">BASE URL:</span>
              <span className="text-slate-200 font-semibold">{API_BASE}</span>
              <button
                onClick={() => copyToClipboard(API_BASE, "base-url")}
                title="Sao chép Base URL"
                className="p-1 rounded hover:bg-[#161920] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedId === "base-url" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <a
              href={`${API_BASE}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161920] border border-[#232836] text-xs text-slate-300 hover:text-white hover:border-[#3b82f6]/40 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              <span>Swagger UI (/docs)</span>
            </a>

            <a
              href={`${API_BASE}/redoc`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161920] border border-[#232836] text-xs text-slate-300 hover:text-white hover:border-[#3b82f6]/40 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span>ReDoc (/redoc)</span>
            </a>
          </div>
        </div>

        {/* System Specs Pill Row */}
        <div className="mt-4 pt-3.5 border-t border-[#181b22] flex flex-wrap items-center gap-4 text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.status === "online" ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
              }`}
            />
            <span>Trạng thái:</span>
            <span className="text-slate-200">{health?.status === "online" ? "Online" : "Offline"}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>GPU:</span>
            <span className="text-slate-200">{health?.gpu_name || "CPU / Pending"}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Âm thanh:</span>
            <span className="text-slate-200">24,000 Hz Studio</span>
          </div>

          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Phụ đề SRT:</span>
            <span className="text-emerald-400 font-semibold">Tự động xuất mặc định (Forced Alignment)</span>
          </div>
        </div>
      </div>

      {/* 4 Core API Architecture Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          onClick={() => setSelectedCategory("design")}
          className={`p-3 rounded-xl border transition-all cursor-pointer ${
            selectedCategory === "design"
              ? "bg-[#141822] border-blue-500/50 shadow-sm shadow-blue-500/10"
              : "bg-[#0e1014] border-[#1e222b] hover:border-[#282e3c]"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 mb-1">
            <Wand2 className="w-4 h-4" />
            <span>1. Voice Design (Prompt)</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            Input: <code className="text-slate-200 font-mono">transcript</code> + <code className="text-slate-200 font-mono">instruct</code>. Tự chunk, luôn xuất Audio + SRT.
          </p>
        </div>

        <div
          onClick={() => setSelectedCategory("clone")}
          className={`p-3 rounded-xl border transition-all cursor-pointer ${
            selectedCategory === "clone"
              ? "bg-[#141822] border-blue-500/50 shadow-sm shadow-blue-500/10"
              : "bg-[#0e1014] border-[#1e222b] hover:border-[#282e3c]"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 mb-1">
            <Mic className="w-4 h-4" />
            <span>2. Voice Clone</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            Input: <code className="text-slate-200 font-mono">transcript</code> + <code className="text-slate-200 font-mono">voice_id</code>. Tự chunk, luôn xuất Audio + SRT.
          </p>
        </div>

        <div
          onClick={() => setSelectedCategory("voices")}
          className={`p-3 rounded-xl border transition-all cursor-pointer ${
            selectedCategory === "voices"
              ? "bg-[#141822] border-blue-500/50 shadow-sm shadow-blue-500/10"
              : "bg-[#0e1014] border-[#1e222b] hover:border-[#282e3c]"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-1">
            <Sparkles className="w-4 h-4" />
            <span>3. List Voice & Tạo Voice</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            <code className="text-slate-200 font-mono">GET</code> lấy danh sách ID giọng & <code className="text-slate-200 font-mono">POST</code> upload mẫu 3-10s.
          </p>
        </div>

        <div
          onClick={() => setSelectedCategory("tasks")}
          className={`p-3 rounded-xl border transition-all cursor-pointer ${
            selectedCategory === "tasks"
              ? "bg-[#141822] border-blue-500/50 shadow-sm shadow-blue-500/10"
              : "bg-[#0e1014] border-[#1e222b] hover:border-[#282e3c]"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400 mb-1">
            <Layers className="w-4 h-4" />
            <span>4. List Task & Check Task</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            <code className="text-slate-200 font-mono">GET /api/tasks</code> & <code className="text-slate-200 font-mono">/{'{task_id}'}</code> lấy audio_url và srt_url.
          </p>
        </div>
      </div>

      {/* Filter Toolbar & Language Switcher */}
      <div className="bg-[#0e1014] border border-[#1e222b] rounded-xl p-2.5 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 bg-[#08090b] p-0.5 rounded-lg border border-[#1e222b] text-xs w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer shrink-0 ${
              selectedCategory === "all"
                ? "bg-[#161920] text-white border border-[#2a2f3d]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Tất Cả ({endpoints.length})
          </button>
          <button
            onClick={() => setSelectedCategory("design")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer shrink-0 ${
              selectedCategory === "design"
                ? "bg-[#161920] text-white border border-[#2a2f3d]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 text-blue-400" />
            <span>Voice Design</span>
          </button>
          <button
            onClick={() => setSelectedCategory("clone")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer shrink-0 ${
              selectedCategory === "clone"
                ? "bg-[#161920] text-white border border-[#2a2f3d]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Mic className="w-3.5 h-3.5 text-emerald-400" />
            <span>Voice Clone</span>
          </button>
          <button
            onClick={() => setSelectedCategory("voices")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer shrink-0 ${
              selectedCategory === "voices"
                ? "bg-[#161920] text-white border border-[#2a2f3d]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Quản Lý Giọng</span>
          </button>
          <button
            onClick={() => setSelectedCategory("tasks")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer shrink-0 ${
              selectedCategory === "tasks"
                ? "bg-[#161920] text-white border border-[#2a2f3d]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Theo Dõi Task</span>
          </button>
        </div>

        {/* Search Bar & Code Snippet Language Switcher */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="relative flex-1 sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm endpoint (/api/...)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#08090b] border border-[#1e222b] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div className="flex items-center bg-[#08090b] p-0.5 rounded-lg border border-[#1e222b] text-[11px] font-mono shrink-0">
            {(["python", "curl", "javascript", "node"] as CodeLang[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setSelectedLang(lang)}
                className={`px-2 py-0.5 rounded uppercase transition-colors cursor-pointer ${
                  selectedLang === lang
                    ? "bg-[#161920] text-blue-400 font-semibold border border-[#2a2f3d]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {lang === "javascript" ? "Fetch" : lang}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-3">
        {filteredEndpoints.length === 0 ? (
          <div className="p-8 text-center bg-[#0e1014] border border-[#1e222b] rounded-xl text-slate-500 text-xs">
            Không tìm thấy endpoint nào phù hợp với từ khóa &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          filteredEndpoints.map((ep) => {
            const isExpanded = !!expandedEndpoints[ep.id];
            const testResult = testOutputs[ep.id];

            return (
              <div
                key={ep.id}
                className="bg-[#0e1014] border border-[#1e222b] rounded-xl overflow-hidden transition-all duration-150 hover:border-[#282e3c]"
              >
                {/* Header Summary Row (Click to toggle) */}
                <div
                  onClick={() => toggleExpand(ep.id)}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none bg-[#0e1014] hover:bg-[#12151a] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border uppercase shrink-0 ${getMethodBadgeClass(
                        ep.method
                      )}`}
                    >
                      {ep.method}
                    </span>

                    <span className="font-mono text-xs sm:text-sm font-semibold text-white truncate">
                      {ep.path}
                    </span>

                    <span className="hidden md:inline text-xs text-slate-400 truncate">
                      — {ep.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden sm:flex items-center gap-1.5">
                      {ep.tags.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#161920] text-slate-400 border border-[#232836]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>

                    <div className="p-1 rounded text-slate-500 hover:text-slate-300">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Endpoint Documentation Detail */}
                {isExpanded && (
                  <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-[#181b22] space-y-4 bg-[#0a0c0f]">
                    {/* Description */}
                    <div className="text-xs text-slate-300 leading-relaxed pt-2">
                      {ep.description}
                    </div>

                    {/* Parameters Table */}
                    {ep.params && ep.params.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                            Tham số yêu cầu ({ep.bodyType === "multipart" ? "Form Data" : ep.method === "GET" ? "Query Param" : "JSON Body"})
                          </h4>
                          {ep.bodyType && ep.method === "POST" && (
                            <span className="text-[10px] font-mono text-slate-500 bg-[#161920] px-1.5 py-0.2 rounded border border-[#232836]">
                              Content-Type: {ep.bodyType === "multipart" ? "multipart/form-data" : "application/json"}
                            </span>
                          )}
                        </div>

                        <div className="overflow-x-auto border border-[#1e222b] rounded-lg">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-[#12151b] border-b border-[#1e222b] text-[11px] font-mono text-slate-400">
                                <th className="py-2 px-3 font-medium">Tên trường</th>
                                <th className="py-2 px-3 font-medium">Kiểu</th>
                                <th className="py-2 px-3 font-medium">Bắt buộc</th>
                                <th className="py-2 px-3 font-medium">Mặc định</th>
                                <th className="py-2 px-3 font-medium">Mô tả</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#181b22] text-[11px]">
                              {ep.params.map((p, pIdx) => (
                                <tr key={pIdx} className="hover:bg-[#12151a]/50">
                                  <td className="py-2 px-3 font-mono text-blue-400 font-semibold">{p.name}</td>
                                  <td className="py-2 px-3 font-mono text-amber-400/90">{p.type}</td>
                                  <td className="py-2 px-3">
                                    {p.required ? (
                                      <span className="text-[10px] font-mono text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded border border-rose-400/20">
                                        bắt buộc
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-mono text-slate-500">tùy chọn</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-400">{p.defaultVal || "—"}</td>
                                  <td className="py-2 px-3 text-slate-300 leading-normal">{p.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Code Snippet & Response Two-Column Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                      {/* Request Code Snippet */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Terminal className="w-3.5 h-3.5 text-blue-400" />
                            <span>Mã Nguồn Mẫu ({selectedLang.toUpperCase()})</span>
                          </span>

                          <button
                            onClick={() => copyToClipboard(ep.exampleRequest[selectedLang], `req-${ep.id}`)}
                            className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white px-2 py-0.5 rounded bg-[#161920] border border-[#232836] transition-colors cursor-pointer"
                          >
                            {copiedId === `req-${ep.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Đã sao chép</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Code</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="p-3 rounded-lg bg-[#08090b] border border-[#1e222b] overflow-x-auto font-mono text-[11px] text-slate-200 leading-relaxed max-h-72">
                          <pre>{ep.exampleRequest[selectedLang]}</pre>
                        </div>
                      </div>

                      {/* Example Response JSON */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Kết Quả Mẫu (HTTP {ep.exampleResponse.status} OK)</span>
                          </span>

                          <button
                            onClick={() =>
                              copyToClipboard(JSON.stringify(ep.exampleResponse.data, null, 2), `res-${ep.id}`)
                            }
                            className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white px-2 py-0.5 rounded bg-[#161920] border border-[#232836] transition-colors cursor-pointer"
                          >
                            {copiedId === `res-${ep.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Đã sao chép</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="p-3 rounded-lg bg-[#08090b] border border-[#1e222b] overflow-x-auto font-mono text-[11px] text-emerald-300/90 leading-relaxed max-h-72">
                          <pre>{JSON.stringify(ep.exampleResponse.data, null, 2)}</pre>
                        </div>
                      </div>
                    </div>

                    {/* Live Test Console (If supported) */}
                    {ep.canTestLive && (
                      <div className="mt-3 pt-3 border-t border-[#181b22] space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <h5 className="text-xs font-semibold text-white">Thử Nghiệm Trực Tiếp (Live API Ping)</h5>
                            <span className="text-[10px] font-mono text-slate-500">Gửi trực tiếp đến {ep.path}</span>
                          </div>

                          <button
                            onClick={() => runLiveTest(ep)}
                            disabled={testResult?.loading}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
                          >
                            {testResult?.loading ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                            <span>{testResult?.loading ? "Đang gửi..." : "Gửi Thử Nghiệm Ngay"}</span>
                          </button>
                        </div>

                        {testResult && (
                          <div className="p-3 rounded-lg bg-[#08090b] border border-[#222836] space-y-2">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">Trạng thái:</span>
                                <span
                                  className={
                                    testResult.status === 200
                                      ? "text-emerald-400 font-bold"
                                      : "text-rose-400 font-bold"
                                  }
                                >
                                  {testResult.status ? `${testResult.status} OK` : "Lỗi kết nối"}
                                </span>
                              </div>

                              {testResult.timeMs !== undefined && (
                                <div className="text-slate-400">
                                  Độ trễ: <span className="text-blue-400 font-bold">{testResult.timeMs}ms</span>
                                </div>
                              )}
                            </div>

                            <div className="overflow-x-auto text-[11px] font-mono p-2 rounded bg-[#0c0e12] border border-[#1a1e27] text-slate-300 max-h-48">
                              {testResult.error ? (
                                <span className="text-rose-400">{testResult.error}</span>
                              ) : (
                                <pre>{JSON.stringify(testResult.data, null, 2)}</pre>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Integration Workflow Summary Card */}
      <div className="mt-4 p-5 rounded-xl bg-[#0e1014] border border-[#1e222b] space-y-3">
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <HelpCircle className="w-4 h-4 text-blue-400" />
          <span>Quy Trình Tích Hợp Đơn Giản Trong 2 Bước</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400 leading-relaxed">
          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              Bước 1: Gửi Task (Design hoặc Clone)
            </h5>
            <p>
              Gọi <code className="text-blue-300 font-mono">POST /api/tasks/design</code> hoặc{" "}
              <code className="text-blue-300 font-mono">POST /api/tasks/clone</code> với tham số{" "}
              <code className="text-slate-200 font-mono">transcript</code>. Hệ thống trả về ngay{" "}
              <code className="text-amber-300 font-mono">task_id</code>. Dù transcript dài hay ngắn, bạn không cần gọi bất kỳ API phân tách (split) nào.
            </p>
          </div>

          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Bước 2: Lấy Audio & Phụ Đề SRT
            </h5>
            <p>
              Gọi <code className="text-blue-300 font-mono">GET /api/tasks/{'{task_id}'}</code>. Khi status là{" "}
              <code className="text-emerald-400 font-mono">&ldquo;completed&rdquo;</code>, lấy trực tiếp đường dẫn file âm thanh{" "}
              <code className="text-slate-200 font-mono">audio_url</code> và file phụ đề{" "}
              <code className="text-emerald-300 font-mono">srt_url</code> (Forced Alignment tự động căn chỉnh thời gian chuẩn xác).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
