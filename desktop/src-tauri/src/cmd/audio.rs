use crate::ffmpeg::get_vibe_temp_folder;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, Sample, SizedSample, Stream, SupportedStreamConfig};
use eyre::{bail, eyre, Context, ContextCompat, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::error::LogError;
use crate::ffmpeg::{get_local_time, random_string};

type WavWriterHandle = Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>;

/// Below this much audio a snapshot is pointless — whisper has nothing to say.
const LIVE_MIN_SECONDS: f64 = 0.4;
/// Hallucination gate for live partials: whisper reliably invents phrases
/// ("Thank you.") when fed silence, and the first tick after the hotkey goes
/// down is mostly silence until the speaker starts. Until the buffer contains
/// at least one sample this loud, no snapshot is produced. Partials only —
/// the final pass is never gated.
const LIVE_MIN_PEAK: f32 = 0.03;
/// Memory cap for the live buffer (~10 min mono @48 kHz ≈ 115 MB). Past it the
/// preview freezes at the cap; the WAV writer keeps recording unaffected.
const LIVE_MAX_SECONDS: usize = 600;

/// In-memory copy of the samples of the recording in progress, filled by the
/// audio callback when live dictation is on. Feeds `snapshot_live_recording`,
/// which the frontend re-transcribes every couple of seconds to type the
/// stable prefix at the cursor (live typing). The dictation indicator shows
/// status only and never reads this buffer.
struct LiveCapture {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u16,
    max_samples: usize,
    last_snapshot: Option<PathBuf>,
    /// Sample count at the moment of the last snapshot. A new snapshot is
    /// only produced when the audio past this point contains speech — whisper
    /// re-fed the same speech plus more silence can only hallucinate a
    /// continuation (live-test finding, 2026-08-09: "Watermelon" + 25 s of
    /// silence grew a phantom "Thank you").
    snapshot_len: usize,
}

type LiveCaptureHandle = Arc<Mutex<Option<LiveCapture>>>;

static LIVE_CAPTURE: Lazy<LiveCaptureHandle> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Loudest absolute sample (as `f32::to_bits`) seen by the audio callback since
/// the level meter last read it. Written lock-free from the callback for every
/// recording (not only live capture), drained every `LEVEL_TICK_MS` by the
/// meter task in `start_record`. Feeds the indicator's five bars — status
/// only, in-process only (ROADMAP "Animated recording indicator").
static INPUT_PEAK: AtomicU32 = AtomicU32::new(0);
/// Meter refresh period (~15 Hz, plan §4).
const LEVEL_TICK_MS: u64 = 66;
/// Per-tick decay when the new peak is lower than the current level.
const LEVEL_DECAY: f32 = 0.8;
/// Emitted to the indicator window only.
const LEVEL_EVENT: &str = "dictation-indicator-level";

/// Next meter level: jump up to a louder peak at once, fall back at
/// `LEVEL_DECAY` per tick otherwise. Always within 0..=1.
pub(crate) fn decay_level(level: f32, peak: f32) -> f32 {
    peak.max(level * LEVEL_DECAY).clamp(0.0, 1.0)
}

/// Records the loudest sample of one callback buffer. Allocation-free and
/// never blocks (same rule as `write_input_data`). Non-negative f32 bit
/// patterns order like their values, so `fetch_max` keeps the loudest buffer
/// since the meter's last `swap(0)`.
fn note_input_peak<T>(input: &[T])
where
    T: Sample + Copy,
    f32: FromSample<T>,
{
    let peak = input
        .iter()
        .fold(0.0f32, |acc, &sample| acc.max(f32::from_sample(sample).abs()));
    INPUT_PEAK.fetch_max(peak.to_bits(), Ordering::Relaxed);
}

fn clear_live_capture() {
    if let Ok(mut guard) = LIVE_CAPTURE.lock() {
        if let Some(capture) = guard.take() {
            if let Some(path) = capture.last_snapshot {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub is_default: bool,
    pub is_input: bool,
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();
    let mut audio_devices = Vec::new();

    let default_in = host
        .default_input_device()
        .map(|e| e.description().map(|d| d.to_string()))
        .context("name")?;
    let default_out = host
        .default_output_device()
        .map(|e| e.description().map(|d| d.to_string()))
        .context("name")?;
    tracing::debug!("Default Input Device:\n{:?}", default_in);
    tracing::debug!("Default Output Device:\n{:?}", default_out);

    let devices = host.devices()?;
    tracing::debug!("Devices: ");
    for (device_index, device) in devices.enumerate() {
        let name = device.description()?.to_string();
        let is_default_in = default_in.as_ref().is_ok_and(|d| d == &name);
        let is_default_out = default_out.as_ref().is_ok_and(|d| d == &name);

        let audio_device = AudioDevice {
            is_default: is_default_in || is_default_out,
            is_input: device.supports_input(),
            id: device_index.to_string(),
            name,
        };
        audio_devices.push(audio_device);
    }

    Ok(audio_devices)
}

struct StreamHandle(Stream);
unsafe impl Send for StreamHandle {}
unsafe impl Sync for StreamHandle {}

#[tauri::command]
/// Record audio from the given devices, store to wav, merge with ffmpeg, and return path
pub async fn start_record(
    app_handle: AppHandle,
    devices: Vec<AudioDevice>,
    store_in_documents: bool,
    custom_path: Option<String>,
    recording_name: Option<String>,
    capture_live: Option<bool>,
) -> Result<()> {
    let host = cpal::default_host();

    let mut wav_paths: Vec<(PathBuf, u32)> = Vec::new();
    let mut stream_handles = Vec::new();
    let mut stream_writers = Vec::new();

    let live_enabled = capture_live.unwrap_or(false);
    clear_live_capture();
    INPUT_PEAK.store(0, Ordering::Relaxed);

    for (device_index, device) in devices.into_iter().enumerate() {
        tracing::debug!("Recording from device: {}", device.name);
        tracing::debug!("Device ID: {}", device.id);

        let is_input = device.is_input;
        let (device, config) = if is_input {
            let device_id: usize = device.id.parse().context("Failed to parse device ID")?;
            let dev = host.devices()?.nth(device_id).context("Failed to get device by ID")?;
            let config = dev.default_input_config().context("Failed to get default input config")?;
            (dev, config)
        } else {
            get_output_device_and_config(&host, &device)?
        };
        let spec = wav_spec_from_config(&config);

        let path = get_vibe_temp_folder().join(format!("{}.wav", random_string(10)));
        tracing::debug!("WAV file path: {:?}", path);
        wav_paths.push((path.clone(), 0));

        let writer = hound::WavWriter::create(path.clone(), spec)?;
        let writer = Arc::new(Mutex::new(Some(writer)));
        stream_writers.push(writer.clone());
        let writer_2 = writer.clone();

        // Live preview taps only the first device — hotkey dictation records
        // exactly one (the default input).
        let live = if live_enabled && device_index == 0 {
            if let Ok(mut guard) = LIVE_CAPTURE.lock() {
                *guard = Some(LiveCapture {
                    samples: Vec::new(),
                    sample_rate: spec.sample_rate,
                    channels: spec.channels,
                    max_samples: spec.sample_rate as usize * spec.channels as usize * LIVE_MAX_SECONDS,
                    last_snapshot: None,
                    snapshot_len: 0,
                });
            }
            Some(LIVE_CAPTURE.clone())
        } else {
            None
        };

        let stream = build_input_stream(&device, config, writer_2, live)?;
        stream.play()?;
        tracing::debug!("Stream started playing");

        let stream_handle = Arc::new(Mutex::new(Some(StreamHandle(stream))));
        stream_handles.push(stream_handle.clone());
        tracing::debug!("Stream handle created");
    }

    // Level meter: every LEVEL_TICK_MS drain the callback's peak, decay, and
    // send the level to the indicator window only. Nothing is sent when the
    // indicator is disabled or its window does not exist. Stops on stop_record.
    let meter_stop = Arc::new(AtomicBool::new(false));
    {
        let stop = meter_stop.clone();
        let app = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut level = 0.0f32;
            while !stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(LEVEL_TICK_MS)).await;
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let peak = f32::from_bits(INPUT_PEAK.swap(0, Ordering::Relaxed));
                level = decay_level(level, peak);
                if !crate::dictation_indicator::is_enabled(&app)
                    || app.get_webview_window(crate::dictation_indicator::WINDOW_LABEL).is_none()
                {
                    continue;
                }
                let _ = app.emit_to(
                    crate::dictation_indicator::WINDOW_LABEL,
                    LEVEL_EVENT,
                    json!({ "level": level }),
                );
            }
        });
    }

    let app_handle_clone = app_handle.clone();
    app_handle.once("stop_record", move |_event| {
        meter_stop.store(true, Ordering::Relaxed);
        clear_live_capture();
        for (i, stream_handle) in stream_handles.iter().enumerate() {
            let stream_handle = stream_handle.lock().map_err(|e| eyre!("{:?}", e)).log_error();
            if let Some(mut stream_handle) = stream_handle {
                let stream = stream_handle.take();
                let writer = stream_writers[i].clone();
                if let Some(stream) = stream {
                    tracing::debug!("Pausing stream");
                    stream.0.pause().map_err(|e| eyre!("{:?}", e)).log_error();
                    tracing::debug!("Finalizing writer");
                    let writer = writer.lock().expect("lock").take().expect("writer");
                    let written = writer.len();
                    wav_paths[i] = (wav_paths[i].0.clone(), written);
                    writer.finalize().map_err(|e| eyre!("{:?}", e)).log_error();
                }
            }
        }

        let dst = if wav_paths.len() == 1 {
            wav_paths[0].0.clone()
        } else if wav_paths[0].1 > 0 && wav_paths[1].1 > 0 {
            let dst = get_vibe_temp_folder().join(format!("{}.wav", random_string(10)));
            tracing::debug!("Merging WAV files");
            crate::ffmpeg::merge_wav_files(wav_paths[0].0.clone(), wav_paths[1].0.clone(), dst.clone()).map_err(|e| eyre!("{e:?}")).log_error();
            dst
        } else if wav_paths[0].1 > wav_paths[1].1 {
            // First WAV file has a larger sample count, choose it
            wav_paths[0].0.clone()
        } else {
            // Second WAV file has a larger sample count or both have non-positive sample counts,
            // choose the second WAV file or fallback to the first one
            wav_paths[1].0.clone()
        };

        tracing::debug!("Emitting record_finish event");
        let recording_stem = recording_name
            .as_deref()
            .map(crate::cmd::files::sanitize_filename_stem)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(get_local_time);
        let temp_dir = get_vibe_temp_folder();
        let mut normalized = crate::cmd::files::available_path(&temp_dir, &recording_stem, "wav");
        crate::ffmpeg::normalize(dst.clone(), normalized.clone(), None).map_err(|e| eyre!("{e:?}")).log_error();

        if store_in_documents {
            if normalized.file_name().is_some() {
                let save_dir = if let Some(ref cp) = custom_path {
                    Some(PathBuf::from(cp))
                } else {
                    app_handle_clone.path().document_dir().map(|d| d.join(crate::config::DOCUMENTS_SUBFOLDER)).map_err(|e| eyre!("{e:?}")).log_error()
                };
                if let Some(save_dir) = save_dir {
                    if std::fs::create_dir_all(&save_dir)
                        .context("Failed to create recording directory")
                        .map_err(|e| eyre!("{e:?}"))
                        .is_ok()
                    {
                        let target_path = crate::cmd::files::available_path(&save_dir, &recording_stem, "wav");
                        let moved = std::fs::rename(&normalized, &target_path)
                            .context("Failed to move file to directory")
                            .map_err(|e| eyre!("{e:?}"))
                            .is_ok();
                        let copied = if moved {
                            false
                        } else {
                            // Cross-filesystem moves can fail; copy as fallback.
                            std::fs::copy(&normalized, &target_path)
                                .context("Failed to copy file to directory")
                                .map_err(|e| eyre!("{e:?}"))
                                .is_ok()
                        };

                        if moved || copied {
                            if copied {
                                std::fs::remove_file(&normalized).map_err(|e| eyre!("{e:?}")).log_error();
                            }
                            normalized = target_path;
                        }
                    }
                }
            } else {
                tracing::error!("Failed to retrieve file name from destination path");
            }
        }

        // Clean files
        for (path, _) in wav_paths {
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| eyre!("{e:?}")).log_error();
            }
        }
        app_handle_clone.emit(
            "record_finish",
            json!({"path": normalized.to_string_lossy(), "name": normalized.file_name().map(|n| n.to_str().unwrap_or_default()).unwrap_or_default()}),
        ).map_err(|e| eyre!("{e:?}")).log_error();
    });

    Ok(())
}

#[allow(unused_variables)]
fn get_output_device_and_config(host: &cpal::Host, audio_device: &AudioDevice) -> Result<(Device, SupportedStreamConfig)> {
    // On macOS, use the default output device directly — cpal's loopback support
    // requires this path to build an input stream from an output device.
    #[cfg(target_os = "macos")]
    {
        let device = host.default_output_device().context("Failed to get default output device")?;
        let config = device
            .default_output_config()
            .context("Failed to get default output config")?;
        Ok((device, config))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let device_id: usize = audio_device.id.parse().context("Failed to parse device ID")?;
        let device = host.devices()?.nth(device_id).context("Failed to get device by ID")?;
        let config = device
            .default_output_config()
            .context("Failed to get default output config")?;
        Ok((device, config))
    }
}

fn build_input_stream_typed<T>(
    device: &Device,
    config: SupportedStreamConfig,
    writer: WavWriterHandle,
    live: Option<LiveCaptureHandle>,
) -> Result<Stream>
where
    T: SizedSample + hound::Sample + FromSample<T> + Mul<Output = T> + Copy,
    f32: FromSample<T>,
{
    let stream = device.build_input_stream(
        config.into(),
        move |data: &[T], _: &_| {
            write_input_data::<T, T>(data, &writer);
            note_input_peak(data);
            if let Some(ref live) = live {
                append_live_samples(data, live);
            }
        },
        |err| tracing::error!("An error occurred on stream: {}", err),
        None,
    )?;
    Ok(stream)
}

fn build_input_stream(
    device: &Device,
    config: SupportedStreamConfig,
    writer: WavWriterHandle,
    live: Option<LiveCaptureHandle>,
) -> Result<Stream> {
    match config.sample_format() {
        cpal::SampleFormat::I8 => build_input_stream_typed::<i8>(device, config, writer, live),
        cpal::SampleFormat::I16 => build_input_stream_typed::<i16>(device, config, writer, live),
        cpal::SampleFormat::I32 => build_input_stream_typed::<i32>(device, config, writer, live),
        cpal::SampleFormat::F32 => build_input_stream_typed::<f32>(device, config, writer, live),
        sample_format => bail!("Unsupported sample format '{}'", sample_format),
    }
}

fn append_live_samples<T>(input: &[T], live: &LiveCaptureHandle)
where
    T: Sample + Copy,
    f32: FromSample<T>,
{
    // try_lock like the WAV writer above: never block the audio callback.
    if let Ok(mut guard) = live.try_lock() {
        if let Some(capture) = guard.as_mut() {
            let room = capture.max_samples.saturating_sub(capture.samples.len());
            for &sample in input.iter().take(room) {
                capture.samples.push(f32::from_sample(sample));
            }
        }
    }
}

fn has_speech_energy(samples: &[f32]) -> bool {
    samples.iter().any(|sample| sample.abs() >= LIVE_MIN_PEAK)
}

fn write_live_wav(samples: &[f32], sample_rate: u32, channels: u16, path: &Path) -> Result<()> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec).context("failed to create live snapshot wav")?;
    for sample in samples {
        writer.write_sample(*sample).context("failed to write live snapshot sample")?;
    }
    writer.finalize().context("failed to finalize live snapshot wav")?;
    Ok(())
}

/// Writes the live-capture buffer to a fresh 16 kHz mono WAV for a partial
/// transcription pass. Returns `None` when live capture is off or the buffer
/// is still too short. The previous snapshot is deleted here — the frontend
/// requests snapshots strictly one at a time, after the previous partial
/// transcription finished, so sona is done reading it.
#[tauri::command]
pub async fn snapshot_live_recording() -> Result<Option<String>> {
    let (samples, sample_rate, channels, previous) = {
        let mut guard = LIVE_CAPTURE.lock().map_err(|e| eyre!("{e:?}"))?;
        let Some(capture) = guard.as_mut() else {
            return Ok(None);
        };
        let min_samples = (capture.sample_rate as f64 * capture.channels as f64 * LIVE_MIN_SECONDS) as usize;
        if capture.samples.len() < min_samples {
            return Ok(None);
        }
        // Tail-energy gate: transcribe only when speech arrived since the
        // last snapshot. Covers both the pre-speech case (first tail is the
        // whole buffer) and mid-dictation silence, where a re-transcription
        // could only append hallucinated text — and would waste GPU.
        if !has_speech_energy(&capture.samples[capture.snapshot_len.min(capture.samples.len())..]) {
            return Ok(None);
        }
        (
            capture.samples.clone(),
            capture.sample_rate,
            capture.channels,
            capture.last_snapshot.take(),
        )
    };
    let covered_len = samples.len();
    let normalized = tokio::task::spawn_blocking(move || -> Result<PathBuf> {
        if let Some(previous) = previous {
            let _ = std::fs::remove_file(previous);
        }
        let temp_dir = get_vibe_temp_folder();
        let raw = temp_dir.join(format!("live_raw_{}.wav", random_string(8)));
        write_live_wav(&samples, sample_rate, channels, &raw)?;
        let normalized = temp_dir.join(format!("live_{}.wav", random_string(8)));
        let converted = crate::ffmpeg::normalize(raw.clone(), normalized.clone(), None);
        let _ = std::fs::remove_file(&raw);
        converted?;
        Ok(normalized)
    })
    .await
    .map_err(|e| eyre!("live snapshot task failed: {e}"))??;
    {
        let mut guard = LIVE_CAPTURE.lock().map_err(|e| eyre!("{e:?}"))?;
        match guard.as_mut() {
            Some(capture) => {
                capture.last_snapshot = Some(normalized.clone());
                capture.snapshot_len = covered_len;
            }
            None => {
                // Recording stopped while the snapshot was being written.
                let _ = std::fs::remove_file(&normalized);
                return Ok(None);
            }
        }
    }
    Ok(Some(normalized.to_string_lossy().to_string()))
}

fn sample_format(format: cpal::SampleFormat) -> hound::SampleFormat {
    if format.is_float() {
        hound::SampleFormat::Float
    } else {
        hound::SampleFormat::Int
    }
}

fn wav_spec_from_config(config: &cpal::SupportedStreamConfig) -> hound::WavSpec {
    hound::WavSpec {
        channels: config.channels() as _,
        sample_rate: config.sample_rate(),
        bits_per_sample: (config.sample_format().sample_size() * 8) as _,
        sample_format: sample_format(config.sample_format()),
    }
}

use std::ops::Mul;

fn write_input_data<T, U>(input: &[T], writer: &WavWriterHandle)
where
    T: Sample,
    U: Sample + hound::Sample + FromSample<T> + Mul<Output = U> + Copy,
{
    if let Ok(mut guard) = writer.try_lock() {
        if let Some(writer) = guard.as_mut() {
            for &sample in input.iter() {
                let sample: U = U::from_sample(sample);
                writer.write_sample(sample).ok();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{has_speech_energy, write_live_wav};

    #[test]
    fn silence_and_noise_floor_have_no_speech_energy() {
        let silence = vec![0.0f32; 16000];
        assert!(!has_speech_energy(&silence));
        // Typical idle mic noise floor sits well under the gate.
        let noise: Vec<f32> = (0..16000).map(|i| if i % 2 == 0 { 0.008 } else { -0.008 }).collect();
        assert!(!has_speech_energy(&noise));
    }

    #[test]
    fn speech_level_samples_pass_the_gate() {
        let mut samples = vec![0.0f32; 16000];
        samples[8000] = 0.2; // one vowel-level peak is enough
        assert!(has_speech_energy(&samples));
        let negative_peak = vec![0.0f32, -0.5, 0.0];
        assert!(has_speech_energy(&negative_peak));
    }

    #[test]
    fn live_wav_roundtrip() {
        let samples: Vec<f32> = (0..1600).map(|i| ((i as f32) / 1600.0) - 0.5).collect();
        let path = std::env::temp_dir().join(format!("vibe_live_wav_test_{}.wav", std::process::id()));
        write_live_wav(&samples, 16000, 1, &path).unwrap();
        let mut reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 16000);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_format, hound::SampleFormat::Float);
        let read: Vec<f32> = reader.samples::<f32>().map(|sample| sample.unwrap()).collect();
        assert_eq!(read, samples);
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg(test)]
mod level_meter_tests {
    use super::{decay_level, LEVEL_DECAY};

    #[test]
    fn louder_peak_jumps_up_immediately() {
        assert_eq!(decay_level(0.1, 0.9), 0.9);
        assert_eq!(decay_level(0.0, 0.5), 0.5);
    }

    #[test]
    fn quieter_peak_decays_by_the_factor() {
        assert!((decay_level(1.0, 0.0) - LEVEL_DECAY).abs() < 1e-6);
        assert!((decay_level(0.5, 0.1) - 0.4).abs() < 1e-6);
        // Decay wins only while it is above the new peak.
        assert!((decay_level(0.5, 0.45) - 0.45).abs() < 1e-6);
    }

    #[test]
    fn silence_decays_to_rest_within_a_second() {
        // 15 ticks of silence (~1 s at 66 ms) from full scale end below the
        // meter's 0.02 resting threshold.
        let mut level = 1.0f32;
        for _ in 0..15 {
            level = decay_level(level, 0.0);
        }
        assert!(level < 0.04, "level after 1 s of silence: {level}");
        for _ in 0..5 {
            level = decay_level(level, 0.0);
        }
        assert!(level < 0.02, "level after ~1.3 s of silence: {level}");
    }

    #[test]
    fn level_is_clamped_to_unit_range() {
        assert_eq!(decay_level(0.0, 1.7), 1.0);
        assert_eq!(decay_level(-1.0, -0.5), 0.0);
    }
}
