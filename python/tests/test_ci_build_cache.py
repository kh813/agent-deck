"""CI build cache wiring (.github/workflows). The release build only gets a
warm Rust cache if build-cache.yml (on main) builds the same way and saves
under the same key release.yml restores -- checked here so the two can't
drift apart silently (a miss just means a slow ~10 min build, nobody would
notice)."""
import re
from pathlib import Path

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def text(name):
    return (WF / name).read_text(encoding="utf-8")


def rust_cache_block(src):
    m = re.search(r"uses: Swatinem/rust-cache@v2\n((?:\s+.*\n)+?)(?:\n|\s+- )", src)
    assert m, "rust-cache step missing"
    return m.group(1)


def matrix_args(src):
    return dict(re.findall(r'platform: "([\w-]+)"\n\s+args: "([^"]*)"', src))


def test_release_restores_the_cache_build_cache_saves():
    rel, warm = rust_cache_block(text("release.yml")), rust_cache_block(text("build-cache.yml"))
    for block in (rel, warm):
        assert "workspaces: src-tauri" in block
        assert "shared-key: release-${{ matrix.platform }}" in block
    assert "save-if: false" in rel, "a tag's cache is only visible to that tag"
    assert "save-if" not in warm


def test_cache_restored_before_the_build():
    rel = text("release.yml")
    assert rel.index("Swatinem/rust-cache@v2") < rel.index("npm run tauri build")


def test_warm_build_matches_release_build():
    rel, warm = text("release.yml"), text("build-cache.yml")
    assert matrix_args(rel) == matrix_args(warm) == {
        "macos-latest": "--target aarch64-apple-darwin", "windows-latest": ""}
    assert "npm run tauri build -- ${{ matrix.args }} --no-bundle" in warm
    assert "npm run tauri build -- ${{ matrix.args }}" in rel
    # same toolchain setup (target list) -> same cache key
    tgt = "targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin' || '' }}"
    assert tgt in rel and tgt in warm


def test_warm_runs_on_main_when_dependencies_change():
    warm = text("build-cache.yml")
    assert "branches: [main]" in warm
    for p in ("src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "workflow_dispatch", "schedule"):
        assert p in warm


def test_warm_never_publishes():
    warm = text("build-cache.yml")
    assert "action-gh-release" not in warm and "contents: write" not in warm


def test_test_workflow_caches_and_saves_only_from_main():
    block = rust_cache_block(text("test.yml"))
    assert "shared-key: test-${{ matrix.platform }}" in block
    assert "save-if: ${{ github.ref == 'refs/heads/main' }}" in block
