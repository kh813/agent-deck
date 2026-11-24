#!/bin/bash
# agent-deck 強制アップデート（v0.2.2-rc1 以前のインストールで一度だけ使う）
# One-time forced update for agent-deck installs at v0.2.2-rc1 or earlier,
# whose own Update menu can't work (see migrate_to_latest.py for why).
#
# Put this folder anywhere (e.g. inside the agent-deck folder) and
# double-click this file. If it isn't inside the agent-deck folder, it asks
# you to drag that folder into the window.

HERE="$(cd "$(dirname "$0")" && pwd)"

finish() {
    echo
    read -r -n 1 -p "何かキーを押すと閉じます / Press any key to close..." _
    echo
    exit "$1"
}

ROOT=""
for candidate in "$HERE" "$HERE/.."; do
    if [ -f "$candidate/agent_config.json" ]; then
        ROOT="$(cd "$candidate" && pwd)"
        break
    fi
done

if [ -z "$ROOT" ]; then
    echo "agent-deck のフォルダ（agent-deck.app が入っているフォルダ）をこのウィンドウにドラッグして Enter を押してください。"
    echo "Drag the agent-deck folder (the one containing agent-deck.app) into this window, then press Enter:"
    read -r ROOT
    # Finder drag-and-drop escapes spaces ("My\ Folder") and may add quotes.
    ROOT="${ROOT%"${ROOT##*[![:space:]]}"}"
    ROOT="${ROOT//\\ / }"
    ROOT="${ROOT#[\"\']}"; ROOT="${ROOT%[\"\']}"
fi

if [ ! -f "$ROOT/agent_config.json" ]; then
    echo "[ERROR] agent-deck のフォルダではありません / Not an agent-deck folder: $ROOT"
    finish 1
fi

PY="$ROOT/venv/bin/python3"
if ! "$PY" -c 'import googleapiclient' >/dev/null 2>&1; then
    # venv missing, or broken -- e.g. built from a Homebrew Python that has
    # since been upgraded away (venv/bin/python3 -> a deleted python3.14),
    # confirmed for real. Move a broken one aside (the app's preflight
    # recreates venv/ from scratch on its next launch when it's missing) and
    # run this one-time update from a temporary venv instead.
    BASE=""
    for cand in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3)" /usr/bin/python3; do
        if [ -n "$cand" ] && "$cand" -c 'import venv, sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
            BASE="$cand"; break
        fi
    done
    if [ -z "$BASE" ]; then
        echo "[ERROR] Python 3 が見つかりません / No usable Python 3 found."
        echo "        組織の ZIP をダウンロードし、agent-deck のフォルダに上書き展開してください。"
        echo "        Download the org ZIP and extract it over the agent-deck folder instead."
        finish 1
    fi
    if [ -e "$ROOT/venv" ] && ! "$PY" -c 'import sys' >/dev/null 2>&1; then
        BROKEN="$ROOT/venv.broken-$(date +%Y%m%d%H%M%S)"
        mv "$ROOT/venv" "$BROKEN"
        echo "==> 壊れた venv を退避しました（次回起動時に自動で作り直されます）: $BROKEN"
        echo "    Moved the broken venv aside (rebuilt automatically on next launch)."
    fi
    TMPDIR_MIG="$(mktemp -d)"
    echo "==> 一時的な Python 環境を準備しています（1 分ほどかかります）/ Preparing a temporary Python environment..."
    if ! "$BASE" -m venv "$TMPDIR_MIG/venv" || ! "$TMPDIR_MIG/venv/bin/python3" -m pip install -q --disable-pip-version-check \
            google-auth google-auth-oauthlib google-api-python-client tomli; then
        echo "[ERROR] Python 環境の準備に失敗しました / Failed to prepare the Python environment."
        finish 1
    fi
    PY="$TMPDIR_MIG/venv/bin/python3"
fi

"$PY" "$HERE/migrate_to_latest.py" "$ROOT"
status=$?
[ -n "$TMPDIR_MIG" ] && rm -rf "$TMPDIR_MIG"
if [ "$status" -eq 0 ]; then
    # Same as Initial_setup_for_Mac.command: a fresh bundle must not carry
    # quarantine, or macOS runs it translocated from a random path.
    xattr -cr "$ROOT/agent-deck.app" 2>/dev/null
    echo
    echo "agent-deck.app を起動してください / Now start agent-deck.app."
fi
finish "$status"
