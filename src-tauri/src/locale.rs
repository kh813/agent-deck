// The OS's language settings, for picking the UI language.
//
// The frontend used navigator.language alone, which in Windows' WebView2 can
// report English on a Japanese setup, so Windows users got an English-only
// UI while macOS showed Japanese (reported 2026-11-25). On Windows this
// returns both the display (UI) language and the regional-format locale
// ("ja-JP" either way means Japanese); elsewhere the usual LANG-style env
// vars. The frontend combines these with navigator.language and an explicit
// Settings -> Language choice (src/lib/language.ts).

#[cfg(windows)]
fn os_locales_impl() -> Vec<String> {
    use windows_sys::Win32::Globalization::{
        GetUserDefaultLocaleName, GetUserDefaultUILanguage, LCIDToLocaleName,
    };
    const LEN: usize = 85; // LOCALE_NAME_MAX_LENGTH
    let mut out = Vec::new();
    let mut buf = [0u16; LEN];
    unsafe {
        let ui = GetUserDefaultUILanguage() as u32;
        let n = LCIDToLocaleName(ui, buf.as_mut_ptr(), LEN as i32, 0);
        if n > 1 {
            out.push(String::from_utf16_lossy(&buf[..(n - 1) as usize]));
        }
        let n = GetUserDefaultLocaleName(buf.as_mut_ptr(), LEN as i32);
        if n > 1 {
            out.push(String::from_utf16_lossy(&buf[..(n - 1) as usize]));
        }
    }
    out
}

#[cfg(not(windows))]
fn os_locales_impl() -> Vec<String> {
    locales_from_env(|k| std::env::var(k).ok())
}

/// LC_ALL / LC_MESSAGES / LANG, in POSIX precedence order, minus the
/// meaningless "C"/"POSIX" values.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn locales_from_env(get: impl Fn(&str) -> Option<String>) -> Vec<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|k| get(k))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && v != "C" && v != "POSIX" && !v.starts_with("C."))
        .collect()
}

#[tauri::command]
pub fn get_os_locales() -> Vec<String> {
    os_locales_impl()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn env_precedence_and_filtering() {
        assert_eq!(locales_from_env(env(&[("LANG", "ja_JP.UTF-8")])), vec!["ja_JP.UTF-8"]);
        assert_eq!(
            locales_from_env(env(&[("LC_ALL", "en_US.UTF-8"), ("LANG", "ja_JP.UTF-8")])),
            vec!["en_US.UTF-8", "ja_JP.UTF-8"]
        );
        assert!(locales_from_env(env(&[("LANG", "C"), ("LC_ALL", "C.UTF-8"), ("LC_MESSAGES", "POSIX")])).is_empty());
        assert!(locales_from_env(env(&[])).is_empty());
    }

    #[test]
    fn os_locales_never_panics_and_names_look_like_locales() {
        for l in get_os_locales() {
            assert!(!l.is_empty() && l.len() < 85, "{l:?}");
        }
    }

    // On the Windows CI runner (en-US) this exercises the real Win32 calls.
    #[cfg(windows)]
    #[test]
    fn windows_returns_ui_and_format_locales() {
        let l = get_os_locales();
        assert!(!l.is_empty(), "expected at least the UI language");
        assert!(l.iter().all(|s| s.contains('-')), "{l:?}");
    }
}
