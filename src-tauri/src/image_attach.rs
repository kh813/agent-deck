// Images pasted into the app (screenshots), handed to agy / Claude Code as a
// file path in the prompt -- engine-neutral, since both read an image from a
// path, while neither CLI's own image paste works through xterm.js
// (app_specs.md 5.7.2).
//
// Saved under <agent-deck install>/tmp/screenshots/ (always the install root,
// never the tab's working folder, so external repos/folders are never dirtied
// with temporary screenshots, and both agy and Claude Code can always read
// them without colliding with OS temp-folder deny rules such as Windows
// AppData/ or macOS /var/ & /private/). The same image pasted twice is stored
// once, very large images are scaled down (tokens), and files older than
// RETENTION are pruned on app startup and whenever a new one is saved.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const SCREENSHOT_DIR: &str = "tmp/screenshots";
pub const MAX_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_EDGE_PX: u32 = 2000;
pub const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// File extension for a pasted image's MIME type (None = not accepted).
pub(crate) fn extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn is_image_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp")
    )
}

/// Keeps only [A-Za-z0-9_-] (the frontend sends e.g.
/// "screenshot-20261125-173012"); falls back to "screenshot".
pub(crate) fn sanitize_base_name(hint: &str) -> String {
    let s: String = hint
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    if s.is_empty() {
        "screenshot".to_string()
    } else {
        s
    }
}

/// First "<base>.<ext>", "<base>-2.<ext>", ... that doesn't exist yet.
pub(crate) fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{base}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{base}-{n}.{ext}")))
        .find(|p| !p.exists())
        .expect("unbounded")
}

/// Scales PNG/JPEG images whose longer edge exceeds MAX_EDGE_PX down to it,
/// keeping the format. Anything else (or undecodable data) is kept as is.
pub(crate) fn downscale_if_needed(data: &[u8], ext: &str) -> Vec<u8> {
    let format = match ext {
        "png" => image::ImageFormat::Png,
        "jpg" => image::ImageFormat::Jpeg,
        _ => return data.to_vec(),
    };
    let Ok(img) = image::load_from_memory_with_format(data, format) else {
        return data.to_vec();
    };
    if img.width().max(img.height()) <= MAX_EDGE_PX {
        return data.to_vec();
    }
    let scaled = img.resize(MAX_EDGE_PX, MAX_EDGE_PX, image::imageops::FilterType::Triangle);
    let mut out = std::io::Cursor::new(Vec::new());
    let ok = if format == image::ImageFormat::Jpeg {
        // JPEG has no alpha channel.
        image::DynamicImage::ImageRgb8(scaled.to_rgb8()).write_to(&mut out, format).is_ok()
    } else {
        scaled.write_to(&mut out, format).is_ok()
    };
    if ok {
        out.into_inner()
    } else {
        data.to_vec()
    }
}

/// An already-saved file with exactly these bytes, if any.
fn find_duplicate(dir: &Path, data: &[u8]) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        is_image_file(p)
            && fs::metadata(p).map(|m| m.len() == data.len() as u64).unwrap_or(false)
            && fs::read(p).map(|b| b == data).unwrap_or(false)
    })
}

/// Deletes image files in `dir` last modified more than `max_age` before `now`.
pub(crate) fn prune_old(dir: &Path, now: SystemTime, max_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for path in entries.flatten().map(|e| e.path()) {
        if !is_image_file(&path) {
            continue;
        }
        let old = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if old && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub(crate) fn save_image(project_dir: &Path, data: &[u8], mime: &str, name_hint: &str) -> Result<PathBuf, String> {
    if data.is_empty() {
        return Err("empty image".into());
    }
    if data.len() > MAX_BYTES {
        return Err(format!("image too large ({} MB > 20 MB)", data.len() / (1024 * 1024)));
    }
    let ext = extension_for_mime(mime).ok_or_else(|| format!("unsupported image type: {mime}"))?;
    let dir = project_dir.join(SCREENSHOT_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    prune_old(&dir, SystemTime::now(), RETENTION);

    let bytes = downscale_if_needed(data, ext);
    if let Some(existing) = find_duplicate(&dir, &bytes) {
        return Ok(existing);
    }
    let path = unique_path(&dir, &sanitize_base_name(name_hint), ext);
    fs::write(&path, &bytes).map_err(|e| format!("cannot save {}: {e}", path.display()))?;
    Ok(path)
}

/// Decodes the %XX escapes the frontend uses for header values (a working
/// folder can contain non-ASCII characters, which HTTP-style headers can't).
pub(crate) fn percent_decode(s: &str) -> String {
    fn hex(c: u8) -> Option<u8> {
        (c as char).to_digit(16).map(|d| d as u8)
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Always store pasted screenshots under the agent-deck install root so
/// arbitrary tab working folders (e.g. Git repositories) are never modified
/// and both engines can read them under the install's tmp/ policy.
pub(crate) fn screenshot_root() -> PathBuf {
    crate::pty::get_default_cwd()
}

/// Prune screenshots older than RETENTION in `<project_root>/tmp/screenshots/`.
/// Called on app startup in addition to each save, so old files are cleaned up
/// even when the user hasn't pasted a new screenshot recently.
pub fn prune_screenshots_on_startup(project_root: &Path) -> usize {
    prune_old(&project_root.join(SCREENSHOT_DIR), SystemTime::now(), RETENTION)
}

/// Raw-body command: body = image bytes; headers x-mime / x-name
/// (percent-encoded; x-cwd is ignored — screenshots always go under the
/// install root's tmp/screenshots/). Returns the saved file's absolute path.
#[tauri::command]
pub fn save_pasted_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
            .unwrap_or_default()
    };
    let project_dir = screenshot_root();
    let path = save_image(&project_dir, data, &header("x-mime"), &header("x-name"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// RGBA pixels (as the OS clipboard hands them over) -> PNG bytes.
pub(crate) fn rgba_to_png(width: usize, height: usize, rgba: &[u8]) -> Option<Vec<u8>> {
    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba.to_vec())?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Saves the image currently on the OS clipboard, if there is one (None =
/// no image: the caller pastes text instead). Used for Ctrl+V in the
/// terminal on Windows, where xterm.js turns Ctrl+V into a ^V keystroke and
/// no paste event ever reaches the page, and as the macOS fallback when the
/// webview's paste event carries no image data.
#[tauri::command]
pub async fn save_clipboard_image(_cwd: String, name_hint: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(mut clipboard) = arboard::Clipboard::new() else {
            return Ok(None);
        };
        let Ok(img) = clipboard.get_image() else {
            return Ok(None);
        };
        let png = rgba_to_png(img.width, img.height, &img.bytes)
            .ok_or_else(|| "could not encode the clipboard image".to_string())?;
        let project_dir = screenshot_root();
        let path = save_image(&project_dir, &png, "image/png", &name_hint)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("agent-deck-img-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn jpg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 100, 50]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img).write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        out.into_inner()
    }

    #[test]
    fn mime_types() {
        assert_eq!(extension_for_mime("image/png"), Some("png"));
        assert_eq!(extension_for_mime("IMAGE/JPEG"), Some("jpg"));
        assert_eq!(extension_for_mime("image/webp"), Some("webp"));
        assert_eq!(extension_for_mime("text/plain"), None);
        assert_eq!(extension_for_mime("image/svg+xml"), None); // scripts inside: not accepted
    }

    #[test]
    fn base_name_is_sanitized() {
        assert_eq!(sanitize_base_name("screenshot-20261125-173012"), "screenshot-20261125-173012");
        assert_eq!(sanitize_base_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_base_name("スクショ"), "screenshot");
        assert_eq!(sanitize_base_name(""), "screenshot");
        assert!(sanitize_base_name(&"a".repeat(500)).len() <= 80);
    }

    #[test]
    fn saves_into_tmp_screenshots_with_the_hinted_name() {
        let root = tmpdir();
        let p = save_image(&root, &png(10, 10), "image/png", "screenshot-20261125-173012").unwrap();
        assert_eq!(p, root.join("tmp/screenshots/screenshot-20261125-173012.png"));
        assert!(p.exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn same_image_twice_is_stored_once() {
        let root = tmpdir();
        let a = save_image(&root, &png(10, 10), "image/png", "a").unwrap();
        let b = save_image(&root, &png(10, 10), "image/png", "b").unwrap();
        assert_eq!(a, b);
        assert_eq!(fs::read_dir(root.join(SCREENSHOT_DIR)).unwrap().count(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn different_images_with_the_same_name_get_suffixes() {
        let root = tmpdir();
        let a = save_image(&root, &png(10, 10), "image/png", "shot").unwrap();
        let b = save_image(&root, &png(11, 10), "image/png", "shot").unwrap();
        let c = save_image(&root, &png(12, 10), "image/png", "shot").unwrap();
        assert!(a.ends_with("shot.png") && b.ends_with("shot-2.png") && c.ends_with("shot-3.png"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn large_png_is_scaled_to_max_edge_keeping_aspect() {
        let root = tmpdir();
        let p = save_image(&root, &png(4000, 1000), "image/png", "big").unwrap();
        let img = image::open(&p).unwrap();
        assert_eq!((img.width(), img.height()), (2000, 500));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn large_jpeg_is_scaled_and_stays_jpeg() {
        let out = downscale_if_needed(&jpg(1000, 3000), "jpg");
        assert_eq!(image::guess_format(&out).unwrap(), image::ImageFormat::Jpeg);
        let img = image::load_from_memory(&out).unwrap();
        assert_eq!(img.height(), 2000);
    }

    #[test]
    fn small_images_and_other_formats_are_untouched() {
        let small = png(100, 100);
        assert_eq!(downscale_if_needed(&small, "png"), small);
        let gif_like = b"GIF89a-not-really".to_vec();
        assert_eq!(downscale_if_needed(&gif_like, "gif"), gif_like);
        let garbage = b"not a png".to_vec();
        assert_eq!(downscale_if_needed(&garbage, "png"), garbage);
    }

    #[test]
    fn rejects_empty_oversized_and_unsupported() {
        let root = tmpdir();
        assert!(save_image(&root, &[], "image/png", "x").is_err());
        assert!(save_image(&root, &vec![0u8; MAX_BYTES + 1], "image/png", "x").is_err());
        assert!(save_image(&root, &png(5, 5), "application/pdf", "x").is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn prunes_only_old_image_files() {
        let dir = tmpdir();
        fs::write(dir.join("old.png"), b"x").unwrap();
        fs::write(dir.join("new.png"), b"y").unwrap();
        fs::write(dir.join("notes.txt"), b"z").unwrap();
        let later = SystemTime::now() + Duration::from_secs(8 * 24 * 3600);
        // Everything is "8 days old" from `later`, but only images go.
        assert_eq!(prune_old(&dir, later, RETENTION), 2);
        assert!(dir.join("notes.txt").exists());
        assert!(!dir.join("old.png").exists());
        // Nothing is old relative to now.
        fs::write(dir.join("fresh.png"), b"q").unwrap();
        assert_eq!(prune_old(&dir, SystemTime::now(), RETENTION), 0);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn clipboard_rgba_becomes_a_png() {
        let rgba = vec![255u8; 4 * 3 * 2];
        let png_bytes = rgba_to_png(3, 2, &rgba).unwrap();
        let img = image::load_from_memory_with_format(&png_bytes, image::ImageFormat::Png).unwrap();
        assert_eq!((img.width(), img.height()), (3, 2));
        assert!(rgba_to_png(3, 2, &rgba[..5]).is_none(), "short buffer is rejected, not a panic");
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("%2FUsers%2F%E5%B0%8F%E6%9E%97%2Fwork"), "/Users/小林/work");
        assert_eq!(percent_decode("C%3A%5CUsers%5Cx"), "C:\\Users\\x");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zzend%"), "bad%zzend%");
        assert_eq!(percent_decode("%4"), "%4");
        // never slices inside a UTF-8 char; a lone byte decodes lossily
        assert_eq!(percent_decode("%あ%E3"), "%あ\u{FFFD}");
    }

    #[test]
    fn screenshot_root_is_always_install_root_and_startup_prune_works() {
        assert_eq!(screenshot_root(), crate::pty::get_default_cwd());
        let root = tmpdir();
        // No tmp/screenshots/ yet -> 0 removed, no error
        assert_eq!(prune_screenshots_on_startup(&root), 0);
        let dir = root.join(SCREENSHOT_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("fresh.png"), &png(5, 5)).unwrap();
        assert_eq!(prune_screenshots_on_startup(&root), 0);
        assert!(dir.join("fresh.png").exists());
        fs::remove_dir_all(root).ok();
    }
}
