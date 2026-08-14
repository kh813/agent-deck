#!/bin/bash
# One-time setup: double-click this file ONCE, right after downloading and
# extracting a fresh agent-deck-mac.zip, instead of double-clicking
# agent-deck.app directly.
#
# Clears the quarantine attribute on the sibling agent-deck.app before
# opening it. Without this, a freshly-downloaded-and-extracted app still
# carries com.apple.quarantine, so macOS "App Translocation" runs it from
# a randomized, ephemeral path (/private/var/folders/.../AppTranslocation/
# <UUID>/d/) instead of its real location -- confirmed for real: this
# breaks agy's per-folder trust memory, since that random path differs on
# every single launch, so the "trust this folder" prompt never stops
# reappearing. See docs/admin_guide.md and README.md for details.
#
# Once quarantine is cleared here, agent-deck.app itself no longer
# translocates -- future launches just double-click agent-deck.app
# directly, no need to come back to this file. So after opening the app,
# this script moves itself into tmp/ to get out of the way instead of
# lingering in the main folder forever.
cd "$(dirname "$0")"
xattr -cr ./agent-deck.app 2>/dev/null
open ./agent-deck.app

mkdir -p tmp
mv -f -- "$0" "tmp/$(basename "$0")" 2>/dev/null
