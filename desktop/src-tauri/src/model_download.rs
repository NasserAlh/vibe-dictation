//! Opt-in, content-pinned model downloader — the one deliberate exception to
//! the zero-egress rule, and the only code in this crate that may open a
//! non-loopback socket.
//!
//! Everything that bounds the exception is a compile-time constant: the URL
//! prefix, the redirect host allowlist, and the SHA-256 + byte size of every
//! downloadable file (mirrored from docs/model-sha256.txt — a unit test keeps
//! them in lockstep). Nothing is downloaded without a per-download
//! confirmation in the UI, and a build with `--no-default-features` removes
//! this module entirely.

use eyre::{bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

/// Every downloadable file lives under this exact prefix; the manifest below
/// appends only a pinned filename to it.
const URL_PREFIX: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Timeout between chunks, not for the whole transfer — a 3 GB download on a
/// slow line takes as long as it takes, but a stalled one must fail.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Emit a progress event roughly every this many bytes.
const PROGRESS_STEP: u64 = 8 * 1024 * 1024;

pub const PROGRESS_EVENT: &str = "model_download_progress";

pub struct ModelSpec {
    pub id: &'static str,
    pub filename: &'static str,
    /// Lowercase hex SHA-256 of the file content (docs/model-sha256.txt).
    pub sha256: &'static str,
    pub size_bytes: u64,
    /// Marks this fork's default model in the UI.
    pub is_default: bool,
}

impl ModelSpec {
    pub fn url(&self) -> String {
        format!("{URL_PREFIX}{}", self.filename)
    }
}

/// The downloadable set is exactly the fork's two content-pinned models;
/// anything else stays manual per docs/models.md.
pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "large-v3",
        filename: "ggml-large-v3.bin",
        sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        size_bytes: 3_095_033_483,
        is_default: true,
    },
    ModelSpec {
        id: "large-v3-turbo",
        filename: "ggml-large-v3-turbo.bin",
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
        size_bytes: 1_624_555_275,
        is_default: false,
    },
];

pub fn spec_by_id(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|spec| spec.id == id)
}

/// Initial URL host plus the CDN hosts HuggingFace redirects `resolve/` URLs
/// to (cdn-lfs*.huggingface.co historically, cas-bridge.xethub.hf.co today).
/// Content integrity never rests on this list — the SHA-256 pin does that —
/// it exists so "which hosts can this binary talk to" stays answerable from
/// source.
fn is_allowed_host(host: &str) -> bool {
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host == "hf.co" || host.ends_with(".hf.co")
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

struct ActiveGuard;

impl ActiveGuard {
    fn acquire() -> Result<Self> {
        if ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            bail!("a model download is already in progress");
        }
        Ok(Self)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

fn client() -> Result<reqwest::Client> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > 5 {
            return attempt.error("too many redirects");
        }
        let url = attempt.url().clone();
        if url.scheme() == "https" && url.host_str().is_some_and(is_allowed_host) {
            attempt.follow()
        } else {
            attempt.error(format!("redirect outside the pinned model hosts: {url}"))
        }
    });
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .redirect(redirect_policy)
        .build()
        .context("failed to build model download http client")
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub id: &'static str,
    pub downloaded: u64,
    pub total: u64,
}

fn emit_progress(app: &tauri::AppHandle, spec: &ModelSpec, downloaded: u64) {
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            id: spec.id,
            downloaded,
            total: spec.size_bytes,
        },
    );
}

fn check_integrity(size: u64, sha256_hex: &str, spec: &ModelSpec) -> Result<()> {
    if size != spec.size_bytes {
        bail!(
            "size mismatch for {}: got {size} bytes, pinned {} — file discarded",
            spec.filename,
            spec.size_bytes
        );
    }
    if sha256_hex != spec.sha256 {
        bail!(
            "SHA-256 mismatch for {}: got {sha256_hex}, pinned {} — file discarded",
            spec.filename,
            spec.sha256
        );
    }
    Ok(())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads the model with the given id into the models folder.
/// Returns `Ok(None)` if the user cancelled; the partial file is removed in
/// every non-success path so a failed download can never be selected as a
/// model.
pub async fn download(app: &tauri::AppHandle, id: &str) -> Result<Option<PathBuf>> {
    let spec = spec_by_id(id).ok_or_else(|| eyre::eyre!("unknown model id: {id}"))?;
    let _guard = ActiveGuard::acquire()?;
    CANCEL.store(false, Ordering::SeqCst);

    let folder = crate::cmd::app::get_models_folder(app.clone())?;
    std::fs::create_dir_all(&folder).context("failed to create models folder")?;
    let dest = folder.join(spec.filename);
    if dest.exists() {
        bail!("{} is already in the models folder", spec.filename);
    }
    let part = folder.join(format!("{}.part", spec.filename));

    let url = spec.url();
    tracing::info!("model download start: {url} -> {}", dest.display());
    let started = std::time::Instant::now();
    match stream_to_part(app, spec, &url, &part).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = std::fs::remove_file(&part);
            tracing::info!("model download cancelled: {}", spec.id);
            return Ok(None);
        }
        Err(error) => {
            let _ = std::fs::remove_file(&part);
            return Err(error);
        }
    }
    std::fs::rename(&part, &dest).context("failed to move verified model into place")?;
    tracing::info!("model download done in {:?}: {}", started.elapsed(), dest.display());
    Ok(Some(dest))
}

/// Streams the response into `part` while hashing. Returns `Ok(false)` on
/// cancellation; on `Ok(true)` the file is fully written, closed, and has
/// passed the size + SHA-256 pin check.
async fn stream_to_part(app: &tauri::AppHandle, spec: &ModelSpec, url: &str, part: &std::path::Path) -> Result<bool> {
    let response = client()?.get(url).send().await.context("failed to reach huggingface.co")?;
    if !response.status().is_success() {
        bail!("model download failed: HTTP {}", response.status());
    }
    let mut file = tokio::fs::File::create(part)
        .await
        .context("failed to create download file")?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;
    emit_progress(app, spec, 0);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if CANCEL.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let chunk = chunk.context("download stream failed")?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.context("failed to write model file")?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emitted >= PROGRESS_STEP {
            emit_progress(app, spec, downloaded);
            last_emitted = downloaded;
        }
    }
    file.flush().await.context("failed to flush model file")?;
    // Close the handle before the caller renames it (required on Windows).
    drop(file);
    let digest = to_hex(&hasher.finalize());
    check_integrity(downloaded, &digest, spec)?;
    emit_progress(app, spec, spec.size_bytes);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_content_pinned() {
        assert!(!MODELS.is_empty());
        let mut ids = std::collections::HashSet::new();
        let mut defaults = 0;
        for spec in MODELS {
            assert!(ids.insert(spec.id), "duplicate id {}", spec.id);
            assert_eq!(spec.sha256.len(), 64, "{}: pin must be a full SHA-256", spec.id);
            assert!(
                spec.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                "{}: pin must be lowercase hex",
                spec.id
            );
            assert!(spec.size_bytes > 1_000_000, "{}: implausible size", spec.id);
            assert!(spec.url().starts_with(URL_PREFIX));
            assert!(spec.filename.ends_with(".bin"));
            if spec.is_default {
                defaults += 1;
            }
        }
        assert_eq!(defaults, 1, "exactly one default model");
    }

    #[test]
    fn manifest_matches_docs_pin_file() {
        let pin_file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/model-sha256.txt");
        let content = std::fs::read_to_string(pin_file).expect("docs/model-sha256.txt must exist");
        for spec in MODELS {
            let line = content
                .lines()
                .find(|line| line.trim_start().starts_with(spec.filename))
                .unwrap_or_else(|| panic!("{} missing from docs/model-sha256.txt", spec.filename));
            assert!(
                line.to_lowercase().contains(spec.sha256),
                "hash for {} diverges from docs/model-sha256.txt",
                spec.filename
            );
            // The pin file records byte sizes with thousands separators.
            let with_separators = spec
                .size_bytes
                .to_string()
                .as_bytes()
                .rchunks(3)
                .rev()
                .map(|chunk| std::str::from_utf8(chunk).unwrap())
                .collect::<Vec<_>>()
                .join(",");
            assert!(
                line.contains(&with_separators),
                "size for {} diverges from docs/model-sha256.txt",
                spec.filename
            );
        }
    }

    #[test]
    fn allows_only_pinned_hosts() {
        for host in [
            "huggingface.co",
            "cdn-lfs.huggingface.co",
            "cdn-lfs-us-1.huggingface.co",
            "hf.co",
            "cas-bridge.xethub.hf.co",
        ] {
            assert!(is_allowed_host(host), "{host} must be allowed");
        }
        for host in [
            "evil.com",
            "huggingface.co.evil.com",
            "xhf.co",
            "nothuggingface.co",
            "hf.co.attacker.net",
            "localhost",
            "127.0.0.1",
        ] {
            assert!(!is_allowed_host(host), "{host} must be rejected");
        }
    }

    #[test]
    fn hex_digest_of_known_vector() {
        let mut hasher = Sha256::new();
        hasher.update(b"abc");
        assert_eq!(
            to_hex(&hasher.finalize()),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn integrity_check_rejects_wrong_size_and_hash() {
        let spec = &MODELS[0];
        assert!(check_integrity(spec.size_bytes, spec.sha256, spec).is_ok());
        assert!(check_integrity(spec.size_bytes + 1, spec.sha256, spec).is_err());
        let wrong_hash = "0".repeat(64);
        assert!(check_integrity(spec.size_bytes, &wrong_hash, spec).is_err());
    }

    /// Live HTTP roundtrip: connects to huggingface.co, follows the CDN
    /// redirect, reads a few chunks, and verifies the stream is non-empty.
    /// Verifies the network path works without downloading gigabytes.
    #[tokio::test]
    async fn live_http_roundtrip_to_huggingface() {
        let spec = &MODELS[0]; // ggml-large-v3.bin
        let client = client().expect("build http client");
        let response = client
            .get(spec.url())
            .send()
            .await
            .expect("GET model URL — is huggingface.co reachable?");
        assert!(
            response.status().is_success(),
            "HTTP {} for {}",
            response.status(),
            spec.url()
        );
        // Read ~64 KB to exercise the stream without pulling gigabytes.
        let mut stream = response.bytes_stream();
        let mut total: u64 = 0;
        let mut hasher = Sha256::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.expect("stream chunk");
            hasher.update(&chunk);
            total += chunk.len() as u64;
            if total >= 64 * 1024 {
                break;
            }
        }
        assert!(total > 0, "must have read at least one byte");
        let partial_hash = to_hex(&hasher.finalize());
        // Sanity: the partial hash must not match the full-file pin.
        assert_ne!(partial_hash, spec.sha256, "partial hash should not match the full-file pin");
        tracing::info!(
            "live roundtrip OK: {} bytes read from {}, partial SHA-256 {partial_hash}",
            total,
            spec.filename
        );
    }
}
