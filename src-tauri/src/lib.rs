use std::collections::{HashMap, HashSet};
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

#[derive(Serialize)]
struct SavedAs {
    path: String,
    content: String,
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

struct ImageRef {
    start: usize,
    end: usize,
    url: String,
}

fn save_document_at(dest: &Path, content: &str, source: Option<&Path>) -> Result<String, String> {
    if let Some(parent) = dest.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let next = match source.and_then(|path| path.parent().filter(|dir| !dir.as_os_str().is_empty()))
    {
        Some(source_dir) => match dest.parent().filter(|dir| !dir.as_os_str().is_empty()) {
            Some(dest_dir) if !same_directory(source_dir, dest_dir) => {
                relocate_images(source_dir, dest_dir, content)?
            }
            _ => content.to_string(),
        },
        None => content.to_string(),
    };
    fs::write(dest, &next).map_err(|err| err.to_string())?;
    Ok(next)
}

fn same_directory(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn relocate_images(source_dir: &Path, dest_dir: &Path, content: &str) -> Result<String, String> {
    let refs = image_refs(content);
    let mut copied = HashSet::new();
    for item in &refs {
        let Some(relative) = safe_relative(&item.url) else {
            continue;
        };
        let Some(source) = find_inside(source_dir, &item.url) else {
            continue;
        };
        let key = source.canonicalize().unwrap_or_else(|_| source.clone());
        if !copied.insert(key) {
            continue;
        }
        copy_file(&source, &dest_dir.join(relative))?;
    }

    let mut replacements = Vec::new();
    let mut placed: HashMap<PathBuf, String> = HashMap::new();
    for item in &refs {
        if safe_relative(&item.url).is_some() {
            continue;
        }
        let Some(source) = find_escaped(source_dir, &item.url) else {
            continue;
        };
        let key = source.canonicalize().unwrap_or_else(|_| source.clone());
        if let Some(existing) = placed.get(&key) {
            replacements.push((item.start, item.end, existing.clone()));
            continue;
        }
        let Some(dest) = next_asset_path(dest_dir, &source)? else {
            continue;
        };
        copy_file(&source, &dest)?;
        let name = dest
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Could not name the copied image.".to_string())?;
        let markdown = format!("assets/{name}");
        placed.insert(key, markdown.clone());
        replacements.push((item.start, item.end, markdown));
    }
    Ok(apply_replacements(content, replacements))
}

fn find_inside(source_dir: &Path, url: &str) -> Option<PathBuf> {
    if let Some(relative) = safe_relative(url) {
        if let Some(path) = existing_file(source_dir, &relative) {
            return Some(path);
        }
    }
    let decoded = percent_decode(url);
    if decoded != url {
        if let Some(relative) = safe_relative(&decoded) {
            if let Some(path) = existing_file(source_dir, &relative) {
                return Some(path);
            }
        }
    }
    None
}

fn find_escaped(source_dir: &Path, url: &str) -> Option<PathBuf> {
    if safe_relative(url).is_some() {
        return None;
    }
    for candidate in [url.to_string(), percent_decode(url)] {
        if !looks_like_image(&candidate) {
            continue;
        }
        let Some(joined) = lexical_join(source_dir, &candidate) else {
            continue;
        };
        if joined.is_file() {
            return Some(joined);
        }
    }
    None
}

fn existing_file(root: &Path, relative: &Path) -> Option<PathBuf> {
    let joined = root.join(relative);
    if joined.is_file() {
        Some(joined)
    } else {
        None
    }
}

fn next_asset_path(dest_dir: &Path, source: &Path) -> Result<Option<PathBuf>, String> {
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image.png");
    let Ok((stem, ext)) = sanitize_image_name(name) else {
        return Ok(None);
    };
    let assets = dest_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|err| err.to_string())?;
    Ok(Some(unique_asset(&assets, &stem, &ext)))
}

fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    if let (Ok(src), Ok(dst)) = (from.canonicalize(), to.canonicalize()) {
        if src == dst {
            return Ok(());
        }
    }
    if let Some(parent) = to.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::copy(from, to)
        .map(|_| ())
        .map_err(|err| format!("Could not copy {}: {err}", from.display()))
}

fn apply_replacements(content: &str, mut replacements: Vec<(usize, usize, String)>) -> String {
    if replacements.is_empty() {
        return content.to_string();
    }
    replacements.sort_by(|left, right| right.0.cmp(&left.0));
    let mut result = content.to_string();
    for (start, end, url) in replacements {
        if start <= end && end <= result.len() {
            result.replace_range(start..end, &url);
        }
    }
    result
}

fn image_refs(content: &str) -> Vec<ImageRef> {
    let fences = fenced_ranges(content);
    let mut refs = Vec::new();
    scan_inline_images(content, &mut refs);
    scan_html_images(content, &mut refs);
    scan_reference_images(content, &mut refs);
    refs.retain(|item| !inside_fence(&fences, item.start));
    refs.sort_by_key(|item| item.start);
    refs.dedup_by(|left, right| left.start == right.start);
    refs
}

fn inside_fence(ranges: &[(usize, usize)], index: usize) -> bool {
    ranges
        .iter()
        .any(|(start, end)| index >= *start && index < *end)
}

fn fenced_ranges(content: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut offset = 0usize;
    let mut open: Option<(usize, char, usize)> = None;
    for line in content.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        let trimmed = body.trim_start();
        let indent = body.len() - trimmed.len();
        if let Some((start, marker, width)) = open {
            let fence = trimmed.chars().take_while(|ch| *ch == marker).count();
            let rest: String = trimmed.chars().skip(fence).collect();
            if fence >= width && rest.trim().is_empty() {
                ranges.push((start, offset + line.len()));
                open = None;
            }
        } else if indent < 4 {
            if let Some(marker) = trimmed.chars().next() {
                if marker == '`' || marker == '~' {
                    let width = trimmed.chars().take_while(|ch| *ch == marker).count();
                    if width >= 3 {
                        open = Some((offset, marker, width));
                    }
                }
            }
        }
        offset += line.len();
    }
    if let Some((start, _, _)) = open {
        ranges.push((start, content.len()));
    }
    ranges
}

fn scan_inline_images(content: &str, refs: &mut Vec<ImageRef>) {
    let bytes = content.as_bytes();
    let mut index = 0usize;
    while index + 1 < bytes.len() {
        if bytes[index] == b'!' && bytes[index + 1] == b'[' && !is_escaped(bytes, index) {
            if let Some(end_alt) = matching_bracket(bytes, index + 1) {
                if end_alt + 1 < bytes.len() && bytes[end_alt + 1] == b'(' {
                    if let Some((start, end)) = read_destination(content, end_alt + 2) {
                        push_url(refs, content, start, end, false);
                        index = end;
                        continue;
                    }
                }
            }
        }
        index += 1;
    }
}

fn scan_html_images(content: &str, refs: &mut Vec<ImageRef>) {
    let bytes = content.as_bytes();
    let mut index = 0usize;
    while index + 4 < bytes.len() {
        if index + 4 <= bytes.len()
            && bytes[index] == b'<'
            && starts_with_ignore_ascii(&bytes[index + 1..], b"img")
        {
            let after = index + 4;
            let boundary = after < bytes.len()
                && !bytes[after].is_ascii_alphanumeric()
                && bytes[after] != b'-';
            if boundary {
                if let Some(tag_end) = content[index..].find('>').map(|offset| index + offset) {
                    if let Some((start, end)) = html_src_range(&content[index..=tag_end]) {
                        push_url(refs, content, index + start, index + end, true);
                    }
                    index = tag_end + 1;
                    continue;
                }
            }
        }
        index += 1;
    }
}

fn scan_reference_images(content: &str, refs: &mut Vec<ImageRef>) {
    let mut offset = 0usize;
    for line in content.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        if let Some((start, end)) = reference_destination(body) {
            push_url(refs, content, offset + start, offset + end, false);
        }
        offset += line.len();
    }
}

fn reference_destination(line: &str) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() && index < 3 && bytes[index] == b' ' {
        index += 1;
    }
    if index < bytes.len() && bytes[index] == b' ' {
        return None;
    }
    if index >= bytes.len() || bytes[index] != b'[' {
        return None;
    }
    let end_label = line[index + 1..].find(']')? + index + 1;
    if end_label + 1 >= bytes.len() || bytes[end_label + 1] != b':' {
        return None;
    }
    let (start, end) = read_destination(line, end_label + 2)?;
    if looks_like_image(&line[start..end]) {
        Some((start, end))
    } else {
        None
    }
}

fn push_url(refs: &mut Vec<ImageRef>, content: &str, start: usize, end: usize, html: bool) {
    if start >= end || end > content.len() {
        return;
    }
    let Some(url) = prepared_url(&content[start..end], html) else {
        return;
    };
    refs.push(ImageRef { start, end, url });
}

fn prepared_url(raw: &str, html: bool) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let decoded = if html {
        decode_entities(trimmed)
    } else {
        trimmed.to_string()
    };
    let unescaped = unescape_markdown(decoded.trim());
    let stripped = strip_suffix(unescaped.trim());
    if stripped.is_empty() || is_remote(stripped) || is_absolute_fs(stripped) {
        None
    } else {
        Some(stripped.to_string())
    }
}

fn is_remote(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
        || lower.starts_with("file:")
        || lower.starts_with("mailto:")
        || lower.starts_with("//")
        || lower.starts_with('#')
}

fn is_absolute_fs(url: &str) -> bool {
    if Path::new(url).is_absolute() {
        return true;
    }
    let bytes = url.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

fn looks_like_image(url: &str) -> bool {
    let path = strip_suffix(url);
    let ext = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico" | "tif" | "tiff"
    )
}

fn strip_suffix(url: &str) -> &str {
    let end = url.find(['?', '#']).unwrap_or(url.len());
    &url[..end]
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn unescape_markdown(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = [bytes[index + 1], bytes[index + 2]];
            if let Ok(text) = std::str::from_utf8(&hex) {
                if let Ok(value) = u8::from_str_radix(text, 16) {
                    out.push(value);
                    index += 3;
                    continue;
                }
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn safe_relative(relative: &str) -> Option<PathBuf> {
    if relative.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for part in relative.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part.contains(':') || part.contains('\0') {
            return None;
        }
        if part == ".." {
            if parts.pop().is_none() {
                return None;
            }
            continue;
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return None;
    }
    let mut path = PathBuf::new();
    for part in parts {
        path.push(part);
    }
    Some(path)
}

fn lexical_join(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut out = root.to_path_buf();
    for part in relative.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if !out.pop() {
                return None;
            }
            continue;
        }
        if part.contains(':') || part.contains('\0') {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

fn is_escaped(bytes: &[u8], index: usize) -> bool {
    let mut slashes = 0usize;
    let mut cursor = index;
    while cursor > 0 && bytes[cursor - 1] == b'\\' {
        slashes += 1;
        cursor -= 1;
    }
    slashes % 2 == 1
}

fn matching_bracket(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = open;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
            continue;
        }
        if bytes[index] == b'[' {
            depth += 1;
        } else if bytes[index] == b']' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

fn read_destination(content: &str, mut index: usize) -> Option<(usize, usize)> {
    let bytes = content.as_bytes();
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if index >= bytes.len() || bytes[index] == b')' {
        return None;
    }
    if bytes[index] == b'<' {
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'>' && bytes[end] != b'\n' {
            end += 1;
        }
        if end < bytes.len() && bytes[end] == b'>' && start < end {
            return Some((start, end));
        }
        return None;
    }
    let start = index;
    while index < bytes.len() && !bytes[index].is_ascii_whitespace() && bytes[index] != b')' {
        if bytes[index] == b'\\' && index + 1 < bytes.len() {
            index += 2;
            continue;
        }
        index += 1;
    }
    if start == index {
        None
    } else {
        Some((start, index))
    }
}

fn starts_with_ignore_ascii(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len() && haystack[..needle.len()].eq_ignore_ascii_case(needle)
}

fn html_src_range(tag: &str) -> Option<(usize, usize)> {
    let bytes = tag.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        while index < bytes.len() && !bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] == b'>' || bytes[index] == b'/' {
            break;
        }
        let name_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric()
                || bytes[index] == b'-'
                || bytes[index] == b':')
        {
            index += 1;
        }
        let name = &tag[name_start..index];
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'=' {
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let (start, end) = read_attr_value(tag, index)?;
        let next = if end < bytes.len() && (bytes[end] == b'"' || bytes[end] == b'\'') {
            end + 1
        } else {
            end
        };
        if name.eq_ignore_ascii_case("src") {
            return Some((start, end));
        }
        index = next;
    }
    None
}

fn dialog_label(value: Option<String>, fallback: &str) -> String {
    value
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn read_attr_value(tag: &str, index: usize) -> Option<(usize, usize)> {
    let bytes = tag.as_bytes();
    if index >= bytes.len() {
        return None;
    }
    if bytes[index] == b'"' || bytes[index] == b'\'' {
        let quote = bytes[index];
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != quote {
            end += 1;
        }
        return Some((start, end));
    }
    let start = index;
    let mut end = index;
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() && bytes[end] != b'>' {
        end += 1;
    }
    if start == end {
        None
    } else {
        Some((start, end))
    }
}

#[tauri::command]
async fn open_markdown(
    app: AppHandle,
    window: WebviewWindow,
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<OpenedFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter(dialog_label(filter_name, "Markdown"), &["md", "markdown"])
        .set_title(dialog_label(title, "Open Markdown"))
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
    source_path: Option<String>,
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<SavedAs>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter(dialog_label(filter_name, "Markdown"), &["md", "markdown"])
        .set_title(dialog_label(title, "Save Markdown"))
        .set_parent(&window);

    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(name);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let path = ensure_extension(into_path(picked)?, "md");
    let source = source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(Path::new);
    let written = save_document_at(&path, &content, source)?;
    Ok(Some(SavedAs {
        path: path.to_string_lossy().into_owned(),
        content: written,
    }))
}

#[tauri::command]
async fn export_html(
    app: AppHandle,
    window: WebviewWindow,
    html: String,
    suggested_name: Option<String>,
    directory: Option<String>,
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter(dialog_label(filter_name, "HTML"), &["html"])
        .set_title(dialog_label(title, "Export HTML"))
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
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<SavedImage>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter(
            dialog_label(filter_name, "Images"),
            &["png", "jpg", "jpeg", "gif", "webp", "svg"],
        )
        .set_title(dialog_label(title, "Insert Image"))
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
    fn dialog_label_prefers_frontend_copy() {
        assert_eq!(
            dialog_label(Some("打开 Markdown".into()), "Open Markdown"),
            "打开 Markdown"
        );
        assert_eq!(dialog_label(None, "Open Markdown"), "Open Markdown");
        assert_eq!(dialog_label(Some("  ".into()), "Open Markdown"), "Open Markdown");
    }

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

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "markdown-editor-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_referenced_images_into_the_new_directory() {
        let root = TempTree::new("save-as-copy");
        let source_dir = root.0.join("docs");
        let dest_dir = root.0.join("backup");
        fs::create_dir_all(source_dir.join("assets")).unwrap();
        fs::write(source_dir.join("assets/diagram.png"), b"png-a").unwrap();
        fs::write(source_dir.join("assets/my file.png"), b"png-b").unwrap();
        fs::write(source_dir.join("assets/html.png"), b"png-c").unwrap();
        fs::write(source_dir.join("assets/secret.png"), b"do-not-copy").unwrap();
        fs::write(source_dir.join("assets/srcset.png"), b"do-not-copy").unwrap();
        fs::write(source_dir.join("assets/skip.txt"), b"nope").unwrap();
        let source = source_dir.join("notes.md");
        let dest = dest_dir.join("notes.md");
        let content = "\
![diagram](assets/diagram.png)\n\
![spaced](<assets/my file.png>)\n\
![web](https://example.com/a.png)\n\
![gone](assets/missing.png)\n\
<img alt=\"html\" src=\"assets/html.png\">\n\
<img srcset=\"assets/srcset.png\">\n\
![ref][fig]\n\
\n\
[fig]: assets/diagram.png\n\
\n\
```\n\
![secret](assets/secret.png)\n\
```\n\
[notes]: other.md\n";
        let written = save_document_at(&dest, content, Some(&source)).unwrap();
        assert_eq!(written, content);
        assert_eq!(fs::read(&dest).unwrap(), content.as_bytes());
        assert_eq!(
            fs::read(dest_dir.join("assets/diagram.png")).unwrap(),
            b"png-a"
        );
        assert_eq!(
            fs::read(dest_dir.join("assets/my file.png")).unwrap(),
            b"png-b"
        );
        assert_eq!(
            fs::read(dest_dir.join("assets/html.png")).unwrap(),
            b"png-c"
        );
        assert!(!dest_dir.join("assets/secret.png").exists());
        assert!(!dest_dir.join("assets/srcset.png").exists());
        assert!(!dest_dir.join("assets/missing.png").exists());
        assert!(!dest_dir.join("assets/skip.txt").exists());
        assert!(!dest_dir.join("other.md").exists());
    }

    #[test]
    fn does_not_replace_the_destination_when_image_copy_fails() {
        let root = TempTree::new("save-as-fail");
        let source_dir = root.0.join("docs");
        let dest_dir = root.0.join("backup");
        fs::create_dir_all(source_dir.join("assets")).unwrap();
        fs::write(source_dir.join("assets/diagram.png"), b"png").unwrap();
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(dest_dir.join("assets"), b"not-a-directory").unwrap();
        let dest = dest_dir.join("notes.md");
        fs::write(&dest, b"previous").unwrap();
        let err = save_document_at(
            &dest,
            "![diagram](assets/diagram.png)\n",
            Some(&source_dir.join("notes.md")),
        )
        .unwrap_err();
        assert!(
            err.contains("Could not copy") || err.contains("Not a directory") || !err.is_empty()
        );
        assert_eq!(fs::read(&dest).unwrap(), b"previous");
    }

    #[test]
    fn rewrites_image_links_that_leave_the_document_folder() {
        let root = TempTree::new("save-as-rewrite");
        let source_dir = root.0.join("docs");
        let dest_dir = root.0.join("backup");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(root.0.join("pic.png"), b"outside").unwrap();
        let written = save_document_at(
            &dest_dir.join("notes.md"),
            "See ![pic](../pic.png \"cover\")\n",
            Some(&source_dir.join("notes.md")),
        )
        .unwrap();
        assert_eq!(written, "See ![pic](assets/pic.png \"cover\")\n");
        assert_eq!(
            fs::read(dest_dir.join("assets/pic.png")).unwrap(),
            b"outside"
        );
    }

    #[test]
    fn save_as_tolerates_a_percent_sign_before_non_ascii_text() {
        let root = TempTree::new("save-as-percent");
        let source_dir = root.0.join("docs");
        let dest = root.0.join("backup").join("notes.md");
        fs::create_dir_all(&source_dir).unwrap();
        let content = "![x](assets/%你.png)\n";
        let written = save_document_at(&dest, content, Some(&source_dir.join("notes.md"))).unwrap();
        assert_eq!(written, content);
        assert_eq!(fs::read(&dest).unwrap(), content.as_bytes());
    }

    #[test]
    fn same_directory_save_keeps_links_without_copying() {
        let root = TempTree::new("save-as-same");
        let dir = root.0.join("docs");
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/diagram.png"), b"png").unwrap();
        let dest = dir.join("copy.md");
        let content = "![diagram](assets/diagram.png)\n";
        let written = save_document_at(&dest, content, Some(&dir.join("notes.md"))).unwrap();
        assert_eq!(written, content);
        assert_eq!(fs::read(dir.join("assets/diagram.png")).unwrap(), b"png");
        assert_eq!(fs::read(&dest).unwrap(), content.as_bytes());
    }
}
