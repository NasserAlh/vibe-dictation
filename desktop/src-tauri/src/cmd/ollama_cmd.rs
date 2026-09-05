use super::CommandError;
use crate::ollama;
use serde::Deserialize;

fn map_error(error: eyre::Report) -> CommandError {
    let is_connect = error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<reqwest::Error>())
        .any(|cause| cause.is_connect() || cause.is_timeout());
    CommandError {
        code: if is_connect { "ollama_unreachable" } else { "internal_error" }.to_string(),
        message: format!("{error:#}"),
    }
}

#[tauri::command]
pub async fn ollama_list_models(port: Option<u16>) -> Result<Vec<ollama::OllamaModel>, CommandError> {
    ollama::list_models(port.unwrap_or(ollama::DEFAULT_OLLAMA_PORT))
        .await
        .map_err(map_error)
}

/// Fire-and-forget model warm-up at hotkey-down (see `ollama::warm_model`).
#[tauri::command]
pub async fn ollama_warm_model(model: String, port: Option<u16>) -> Result<(), CommandError> {
    if model.trim().is_empty() {
        return Ok(());
    }
    ollama::warm_model(port.unwrap_or(ollama::DEFAULT_OLLAMA_PORT), &model)
        .await
        .map_err(map_error)
}

#[derive(Debug, Clone, Deserialize)]
pub struct OllamaFormatOptions {
    pub model: String,
    pub prompt: String,
    pub text: String,
    pub port: Option<u16>,
}

#[tauri::command]
pub async fn ollama_format_text(options: OllamaFormatOptions) -> Result<String, CommandError> {
    if options.model.trim().is_empty() {
        return Err(CommandError {
            code: "invalid_request".to_string(),
            message: "No Ollama model selected".to_string(),
        });
    }
    ollama::format_text(
        options.port.unwrap_or(ollama::DEFAULT_OLLAMA_PORT),
        &options.model,
        &options.prompt,
        &options.text,
    )
    .await
    .map_err(map_error)
}
