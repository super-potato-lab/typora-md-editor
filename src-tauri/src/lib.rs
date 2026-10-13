use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedImage {
    relative_path: String,
    absolute_path: String,
}

fn into_path(file: FilePath) -> Result<PathBuf, String> {
    file.into_path().map_err(|err| err.to_string())
}

fn ensure_extension(path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension(extension)
    }
}

fn read_opened(path: PathBuf) -> Result<OpenedFile, String> {
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    Ok(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

fn sanitize_image_name(filename: &str) -> Result<(String, String), String> {
    let base = Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("image.png");
    let parsed = Path::new(base);
    let ext = parsed
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let allowed = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
    if !allowed.contains(&ext.as_str()) {
        return Err(format!("unsupported image type .{ext}"));
    }
    let stem = parsed
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let stem: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let stem = stem.trim_matches('-').to_string();
    let stem = if stem.is_empty() {
        "image".to_string()
    } else {
        stem
    };
    Ok((stem, ext))
}

fn unique_asset(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{index}.{ext}"));
        index += 1;
    }
    candidate
}

fn write_asset(document_path: &str, filename: &str, bytes: &[u8]) -> Result<SavedImage, String> {
    if document_path.trim().is_empty() {
        return Err("Save the document before inserting an image.".to_string());
    }
    let document = PathBuf::from(document_path);
    let parent = document
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| "The document has no folder.".to_string())?;
    let (stem, ext) = sanitize_image_name(filename)?;
    let assets = parent.join("assets");
    fs::create_dir_all(&assets).map_err(|err| err.to_string())?;
    let absolute = unique_asset(&assets, &stem, &ext);
    fs::write(&absolute, bytes).map_err(|err| err.to_string())?;
    let name = absolute
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Could not name the image.".to_string())?;
    Ok(SavedImage {
        relative_path: format!("assets/{name}"),
        absolute_path: absolute.to_string_lossy().into_owned(),
    })
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
    read_opened(into_path(picked)?).map(Some)
}

#[tauri::command]
fn read_markdown(path: String) -> Result<OpenedFile, String> {
    read_opened(PathBuf::from(path))
}

#[tauri::command]
fn save_markdown(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|err| err.to_string())
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

    let path = ensure_extension(into_path(picked)?, "md");
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn export_html(
    app: AppHandle,
    window: WebviewWindow,
    html: String,
    suggested_name: Option<String>,
    directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_title("Export HTML")
        .set_parent(&window);

    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(name);
    }
    if let Some(dir) = directory.filter(|value| !value.is_empty()) {
        dialog = dialog.set_directory(dir);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = ensure_extension(into_path(picked)?, "html");
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    fs::write(&path, html).map_err(|err| err.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn save_pasted_image(
    document_path: String,
    filename: String,
    bytes_base64: String,
) -> Result<SavedImage, String> {
    let bytes = STANDARD
        .decode(bytes_base64.trim())
        .map_err(|err| err.to_string())?;
    write_asset(&document_path, &filename, &bytes)
}

#[tauri::command]
async fn pick_and_save_image(
    app: AppHandle,
    window: WebviewWindow,
    document_path: String,
) -> Result<Option<SavedImage>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .set_title("Insert Image")
        .set_parent(&window)
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = into_path(picked)?;
    let filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    let bytes = fs::read(&source).map_err(|err| err.to_string())?;
    write_asset(&document_path, filename, &bytes).map(Some)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            read_markdown,
            save_markdown,
            save_markdown_as,
            export_html,
            save_pasted_image,
            pick_and_save_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_md_when_missing_extension() {
        let path = ensure_extension(PathBuf::from("notes"), "md");
        assert_eq!(path, PathBuf::from("notes.md"));
    }

    #[test]
    fn keeps_existing_extension() {
        let path = ensure_extension(PathBuf::from("notes.markdown"), "md");
        assert_eq!(path, PathBuf::from("notes.markdown"));
    }

    #[test]
    fn sanitizes_image_names() {
        let (stem, ext) = sanitize_image_name("../My Photo.PNG").unwrap();
        assert_eq!(stem, "My-Photo");
        assert_eq!(ext, "png");
    }

    #[test]
    fn rejects_non_images() {
        let err = sanitize_image_name("notes.txt").unwrap_err();
        assert!(err.contains("unsupported"));
    }

    #[test]
    fn writes_a_relative_asset_path() {
        let dir =
            std::env::temp_dir().join(format!("markdown-editor-assets-{}", std::process::id()));
        let document = dir.join("notes.md");
        fs::create_dir_all(&dir).unwrap();
        let saved = write_asset(document.to_str().unwrap(), "diagram.png", b"\x89PNG\r\n").unwrap();
        assert_eq!(saved.relative_path, "assets/diagram.png");
        assert!(Path::new(&saved.absolute_path).is_file());
        let again = write_asset(document.to_str().unwrap(), "diagram.png", b"next").unwrap();
        assert_eq!(again.relative_path, "assets/diagram-2.png");
        let _ = fs::remove_dir_all(dir);
    }
}
