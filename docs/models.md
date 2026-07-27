# 🌟 Vibe Dictation Models 🌟

> **This fork:** models are placed manually (the app performs no downloads).
> The models this fork actually uses are content-pinned — verify any downloaded
> or copied file against
> [superpowers/notes/model-sha256.txt](superpowers/notes/model-sha256.txt)
> before first use. Deployment steps: [deployment.md](deployment.md).

This page lists models compatible with the engine. **This fork downloads nothing
and has no "Magic Setup" or in-app download.** To add a model: open a **Direct
Download** link below in a browser, save the `ggml-*.bin` (or `.gguf`) file,
verify its hash where pinned, and drop it into the models folder (Settings →
Select Model → Models Folder). The default is **Large v3**.

Quantized variants (`q5_0`, `q8_0`, `Q4_K_M`, …) are smaller and use less VRAM;
they are placed the same way — useful on lower-VRAM machines. Grab one from the
whisper.cpp [models tree](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
or build your own (below).

## Whisper models

### 🌱 Tiny

Compact and fast; for quick tasks or limited-resource machines.

[🔽 Direct Download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin?download=true)

### 🌿 Small

A balance of efficiency and accuracy.

[🔽 Direct Download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true)

### ⚖️ Medium

General-purpose; more accurate than small, lighter than large.

[🔽 Direct Download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin?download=true)

### 🚀 Large v3 — this fork's default

High accuracy across English + Arabic; chosen by an A/B on real bilingual speech
(see [superpowers/notes/model-ab-results.md](superpowers/notes/model-ab-results.md)).

[🔽 Direct Download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin?download=true)

### 🚀 Large v3 Turbo — faster alternative

Lighter and faster than large-v3, also bilingual. Selectable, not the default here.

[🔽 Direct Download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin)

More Whisper builds — including quantized variants — are in the whisper.cpp
[models tree](https://huggingface.co/ggerganov/whisper.cpp/tree/main).

## Streaming dictation models (English-only)

Parakeet and Nemotron are English-only, low-latency **streaming** models — kept
selectable per the design spec §6, but **not** the default (they do not cover
Arabic). Both are distributed as quantized `.gguf`.

### 🦜 Parakeet TDT 0.6B v3

[🔽 Download Q4_K_M](https://huggingface.co/vibe-app/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q4_K_M.gguf?download=true)

### ⚡ Nemotron 3.5 ASR Streaming 0.6B

[🔽 Download Q4_K_M](https://huggingface.co/vibe-app/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf?download=true)

---

### Prepare your own models

<details>
<summary>Convert transformers to GGML</summary>

```console
# Setup environment
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv venv
uv pip install torch transformers huggingface_hub
huggingface-cli login --token "token" # https://huggingface.co/settings/tokens

# Convert and upload
git clone https://github.com/openai/whisper
git clone https://github.com/ggml-org/whisper.cpp
git clone https://huggingface.co/ivrit-ai/whisper-large-v3-turbo
uv run ./whisper.cpp/models/convert-h5-to-ggml.py ./whisper-large-v3-turbo/ ./whisper .
uv run huggingface-cli upload --repo-type model whisper-large-v3-turbo-ivrit ./ggml-model.bin ./ggml-model.bin

# Quantize
sudo apt install cmake build-essential -y
cd whisper.cpp
cmake -B build
cmake --build build --config Release
cd ..
./whisper.cpp/build/bin/quantize ggml-model.bin ./ggml-model.int8.bin q8_0 # fp32/fp16/q8_0/q5_0
```

</details>
