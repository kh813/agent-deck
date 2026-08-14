#!/bin/bash
# Double-click this file to launch agent-deck on macOS.
#
# Clears the quarantine attribute on the sibling agent-deck.app before
# opening it. Without this, a freshly-downloaded-and-extracted app still
# carries com.apple.quarantine, so macOS "App Translocation" runs it from
# a randomized, ephemeral path (/private/var/folders/.../AppTranslocation/
# <UUID>/d/) instead of its real location -- confirmed for real: this
# breaks agy's per-folder trust memory, since that random path differs on
# every single launch, so the "trust this folder" prompt never stops
# reappearing. See docs/admin_guide.md and README.md for details.
cd "$(dirname "$0")"
xattr -cr ./agent-deck.app 2>/dev/null
open ./agent-deck.app
