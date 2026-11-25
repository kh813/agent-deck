fn main() {
    // Windows test binaries: `cargo test --lib` exits with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) because the test harness exe
    // doesn't get tauri-build's app manifest (Common-Controls v6), which only
    // goes into the app's own binary -- confirmed on windows-latest
    // 2026-11-25. With AGENT_DECK_EMBED_TEST_MANIFEST=1 (set only by
    // .github/workflows/test.yml) the same manifest is linked into every
    // target instead, following Tauri's own examples/api/build.rs. Release
    // builds never set it, so the shipped exe is built exactly as before.
    println!("cargo:rerun-if-env-changed=AGENT_DECK_EMBED_TEST_MANIFEST");
    let target_is_msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if target_is_msvc && std::env::var("AGENT_DECK_EMBED_TEST_MANIFEST").as_deref() == Ok("1") {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let attrs = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attrs).expect("tauri-build failed");
    } else {
        tauri_build::build()
    }
}
