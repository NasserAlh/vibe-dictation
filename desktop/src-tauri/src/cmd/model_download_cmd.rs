use super::CommandError;
use serde::Serialize;

/// One row of the downloadable-models manifest, with install state resolved
/// against the current models folder. The url/sha256 are surfaced so the UI
/// can show the user exactly what will be fetched and verified.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadableModel {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub is_default: bool,
    pub installed: bool,
}

#[cfg(feature = "model-download")]
#[tauri::command]
pub async fn list_downloadable_models(app_handle: tauri::AppHandle) -> Result<Vec<DownloadableModel>, CommandError> {
    let folder = crate::cmd::app::get_models_folder(app_handle)?;
    Ok(crate::model_download::MODELS
        .iter()
        .map(|spec| DownloadableModel {
            id: spec.id.to_string(),
            filename: spec.filename.to_string(),
            url: spec.url(),
            sha256: spec.sha256.to_string(),
            size_bytes: spec.size_bytes,
            is_default: spec.is_default,
            installed: folder.join(spec.filename).exists(),
        })
        .collect())
}

/// Returns the downloaded file's path, or `None` if the user cancelled.
#[cfg(feature = "model-download")]
#[tauri::command]
pub async fn download_model(app_handle: tauri::AppHandle, model_id: String) -> Result<Option<String>, CommandError> {
    let path = crate::model_download::download(&app_handle, &model_id).await?;
    Ok(path.map(|path| path.to_string_lossy().to_string()))
}

#[cfg(feature = "model-download")]
#[tauri::command]
pub fn cancel_model_download() {
    crate::model_download::cancel();
}

// Stubs for builds compiled with `--no-default-features`: the command surface
// stays identical, the frontend sees an empty manifest and hides the download
// UI entirely, and no download code exists in the binary.

#[cfg(not(feature = "model-download"))]
#[tauri::command]
pub async fn list_downloadable_models() -> Result<Vec<DownloadableModel>, CommandError> {
    Ok(Vec::new())
}

#[cfg(not(feature = "model-download"))]
#[tauri::command]
pub async fn download_model(_model_id: String) -> Result<Option<String>, CommandError> {
    Err(CommandError {
        code: "model_download_disabled".to_string(),
        message: "this build was compiled without the model-download feature".to_string(),
    })
}

#[cfg(not(feature = "model-download"))]
#[tauri::command]
pub fn cancel_model_download() {}
