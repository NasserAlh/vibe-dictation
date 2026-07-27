# Vibe Dictation — Bring-up Notes

## Hang diagnosis (Task 3 — RTX 4090 / home PC — 2026-07-12)

- The baseline app auto-downloads the default model (`ggml-large-v3-turbo.bin`,
  1.62 GB / 1.51 GiB) into the app data dir on first launch. On this run the
  download completed normally at ~10 MB/s (~2–3 min).
- **Most likely cause of the original "hang":** a slow or interrupted first-run
  model download, which visually reads as a freeze. Not a GPU or model-load fault.
- Dictation works end-to-end: English sentence recorded and typed into Notepad via
  "Type at cursor"; repeated dictations all succeeded.
- First dictation after launch took ~10 s before transcribing; every subsequent
  dictation was effectively instant.

## GPU confirmation — it IS using the RTX 4090 (Vulkan), not CPU

Three independent signals, all consistent with GPU execution:

1. `sona.exe` (PID 2644, the transcription engine) appears in the `nvidia-smi`
   GPU process list — it holds a live GPU context.
2. GPU VRAM used rose ~1.6 GB versus idle (~3.0 GB → 4.66 GB), matching the
   1.5 GiB model loaded into VRAM.
3. `sona.exe` system-RAM working set was only ~176 MB — far below the 1.5 GiB
   model, so the weights are resident in VRAM, not system RAM (CPU inference would
   keep them in RAM).

**Interpretation of the ~10 s first-run delay:** one-time warmup = Sona spawn +
model upload to VRAM + **Vulkan compute-shader/pipeline compilation on first
inference**. CPU inference has no shader-compile step, so "slow once, then instant"
is a *signature of GPU/Vulkan*, not CPU. `GPU Device number = Auto` correctly binds
the discrete 4090.

## Model A/B — large-v3-turbo vs large-v3 (Task 4 — 2026-07-12/13)

Both models tested on the user's own English + Arabic speech, type-at-cursor mode,
RTX 4090 via Vulkan, language = auto.

| Model | Latency (after warmup) | Arabic accuracy | English accuracy | Notes |
|---|---|---|---|---|
| large-v3-turbo (1.5 GiB) | instant | good; one hamza nit (`اعتقد` vs `أعتقد`) | perfect | first dictation ~10 s (one-time Vulkan warmup) |
| large-v3 (2.9 GiB) | instant — "as fast as Turbo, no glitches or lag" (user) | clean RTL Arabic, no artifacts | perfect | user-verified head-to-head |

**Decision: default = `ggml-large-v3.bin`.** Speed ties on this hardware, so the
fuller model's Arabic accuracy headroom wins; VRAM cost (3 GB vs 1.5 GB) is
irrelevant on 24 GB cards (both machines). Turbo remains selectable.

**Critical second finding — language default must be `auto`:** with the stock
default `lang: 'en'`, Arabic speech comes out **transliterated into Latin script**
("Assalamualaikum warahmatullahi wabarakatuh"). Switching the language to `auto`
(per-utterance detection) fixed Arabic completely and English kept working without
touching settings. Code default changed in `preference.tsx` (`lang: 'auto'`).

## Known issue — keystroke injection into Windows 11 Notepad

In the new (tabbed) Notepad, `type_text`/enigo injection garbles part of the
output (correct character count arrives, tail renders as dots; Arabic shows
tatweel-like stretching). **MS Word receives the identical injection perfectly**,
proving transcription and injection timing are correct — this is a target-app
input-handling quirk. Fallbacks: clipboard output mode (already in the app), or
per-char pacing / clipboard-paste injection for problem apps (candidate for
Task 11/12). Word is the reference target for acceptance tests.

## Follow-up (candidate for Task 11)

Pre-warm the model at app startup (load + a tiny dummy inference in the background
right after launch) so the first *real* dictation is instant, hiding the one-time
Vulkan warmup. Also relevant once the auto-download is removed (Task 7): the model
will be placed manually, so only the shader-compile warmup remains.
