# Design System: Minimalist Swiss Audio Studio

<!-- impeccable:design-schema 1 -->

## Aesthetic & World

OmniVoice Studio embodies a **Minimalist Swiss Audio Studio** aesthetic—an architectural, high-precision dark workstation inspired by classic acoustic laboratory instruments, digital audio workstations (DAWs), and modernist typographic discipline. It avoids decorative clutter, rainbow gradient text, and arbitrary card-nesting in favor of razor-sharp 1px hairline borders, subtle tonal elevation, and disciplined monochromatic hierarchy punctuated by an electric signal azure (`#3b82f6`) for active playback and synthesis triggers.

---

## Palette Tokens

| Token | Hex / Value | Purpose |
|---|---|---|
| `--bg-workspace` | `#08090b` | Deep obsidian canvas base |
| `--bg-surface` | `#0e1014` | Primary container & pane surface |
| `--bg-surface-elevated` | `#15181f` | Card highlights, dropdowns, modal sheets |
| `--bg-surface-hover` | `#1c202a` | Interactive hover state for tactile controls |
| `--border-subtle` | `#1e222b` | 1px precision hairline boundaries |
| `--border-strong` | `#2a2f3d` | Active / focused element outline |
| `--text-primary` | `#f1f3f7` | Crisp high-contrast foreground copy (>= 4.5:1) |
| `--text-secondary` | `#949db0` | Secondary labels & parameter names |
| `--text-muted` | `#5e6676` | Inactive hints, dividers, and units |
| `--accent-signal` | `#3b82f6` | Signal Azure for primary synthesis & play states |
| `--accent-signal-hover` | `#2563eb` | Active state hover |
| `--accent-signal-subtle` | `rgba(59, 130, 246, 0.12)` | Active pill badge background |
| `--signal-emerald` | `#10b981` | Realtime speedup badge (RTF) & completion status |
| `--signal-amber` | `#f59e0b` | Queued tasks & warning notices |
| `--signal-rose` | `#f43f5e` | Failed task indicators & destructive actions |

---

## Typography & Numerals

- **Primary Font Family**: Inter / Modernist System Sans (`cv02`, `cv03`, `cv04`, `cv11` enabled).
- **Tracking**: Tight tracking (`-0.02em` to `-0.03em`) for clean architectural legibility.
- **Tabular Numerals (`tabular-nums`, `font-mono`)**: Mandatory for all timecodes (`00:01.45`), RTF telemetry (`RTF 0.025`), Order numbers (`#001`), and slider percentages to prevent visual jitter.
- **Text Selection**: Custom Signal Azure tinted selection (`rgba(59, 130, 246, 0.3)`).

---

## Workspace Layout (Dual-Pane DAW)

1. **Precision Top Navigation**:
   - Monospace telemetry displaying GPU status, active sampling rate (24kHz), and realtime background worker activity (`running` / `queued`).
   - Clean segment switchers between **Trạm Studio (DAW)**, **Kho Giọng (Voice Vault)**, and **Hàng Đợi (Queue Registry)**.
2. **Left Studio Pane (Script & Text Workbench)**:
   - Distraction-free script editor with character, word, and estimated speech duration counters.
   - Non-verbal acoustic nuance buttons (`[laughter]`, `[sigh]`, `[surprise-wa]`).
   - Smart sentence chunking tool (~1000 characters per chunk) with configurable gap intervals.
3. **Right Studio Pane (Voice Identity & Acoustic Rack)**:
   - Mode switcher between **Voice Clone** (zero-shot reference audio) and **Voice Design** (parametric attribute matrix: gender, age, pitch, delivery style, accent, dialect).
   - Real-time `instruct` telemetry preview pill.
   - Acoustic parameter rack: Language, Speed (0.5x–1.5x), Diffusion Steps (8, 16, 32, 64), Guidance Scale (CFG), Denoise.
   - Primary action triggers: "Synthesize / Tổng hợp ngay" (Signal Azure) and "Queue Task / Đưa vào hàng đợi".
4. **Master Pro Audio Deck**:
   - Fixed bottom transport strip with precision scrubber, sub-second timecode counter, RTF telemetry badge, volume slider, loop toggle, and instant WAV download.

---

## Craft Floor Adherence

- **No Card Nesting**: Structural delineation is achieved via clean 1px hairline rules and subtle tonal shifts.
- **No Gradient Text**: Visual weight is achieved strictly through font weight, contrast, and scale.
- **Elevation**: Declared once via 1px border; no decorative fuzzy halos or zero-blur drop shadows.
- **Custom Browser Surfaces**: Sleek custom 5px dark scrollbar and focus rings themed from the palette.
