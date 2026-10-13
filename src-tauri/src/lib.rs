use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    content: String,
}

fn into_path(file: FilePath) -> Result<PathBuf, String> {
    file.into_path().map_err(|err| err.to_string())
}

fn ensure_markdown_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension("md")
    }
}

#[tauri::command]
async fn open_markdown(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<OpenedFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("Open Markdown")
        .set_parent(&window)
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(None);
    };

    let path = into_path(picked)?;
    let content = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
    Ok(Some(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
fn save_markdown(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|err| err.to_string())
}

#[tauri::command]
async fn save_markdown_as(
    app: AppHandle,
    window: WebviewWindow,
    content: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("Save Markdown")
        .set_parent(&window);

    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(name);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let path = ensure_markdown_extension(into_path(picked)?);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    std::fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            save_markdown,
            save_markdown_as
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_md_when_missing_extension() {
        let path = ensure_markdown_extension(PathBuf::from("notes"));
        assert_eq!(path, PathBuf::from("notes.md"));
    }

    #[test]
    fn keeps_existing_extension() {
        let path = ensure_markdown_extension(PathBuf::from("notes.markdown"));
        assert_eq!(path, PathBuf::from("notes.markdown"));
    }
}
