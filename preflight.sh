#!/bin/bash
# Pre-launch bootstrap for agent-deck (Mac/Linux), run automatically via
# agent_config.json's pre_launch_command before every agy session start.
# Creates the venv and builds skills on first run; keeps skills up to date
# on every subsequent run.
#
# Invoked non-interactively (agent-deck captures stdout/stderr, no TTY), so
# this must never block on user input — setup.py's own _prompt() helper
# degrades to an empty answer when AGENT_DECK_NONINTERACTIVE is set below
# (confirmed for real: relying on sys.stdin.isatty() alone was not a
# reliable enough signal on Windows and still hung indefinitely).
set -e
cd "$(dirname "$0")"
export AGENT_DECK_NONINTERACTIVE=1

echo "Checking configuration..."
python3 python/scripts/setup/setup.py config

# A venv whose interpreter exists but no longer runs is broken -- typically
# built from a Homebrew Python that a later `brew upgrade` removed
# (venv/bin/python3 -> a deleted python3.14), confirmed for real. Left as
# is, every venv-backed feature (catalog sync, Drive/Calendar scripts)
# silently fails with "venv not found". Move it aside so the first-time
# setup below rebuilds it from the current Python. An interpreter that's
# simply absent is left alone (nothing to repair -- init below handles a
# missing venv/ itself).
if { [ -L venv/bin/python3 ] || [ -e venv/bin/python3 ]; } \
        && ! venv/bin/python3 -c 'import sys' >/dev/null 2>&1; then
    echo "Python environment is broken (its base Python was removed or upgraded); rebuilding it..."
    rm -rf venv.broken
    mv venv venv.broken
fi

if [ ! -d "venv" ]; then
    echo "First-time setup (this can take a few minutes)..."
    python3 python/scripts/setup/setup.py init
fi

echo "Updating skills..."
if [ -x "venv/bin/python3" ]; then
    venv/bin/python3 python/scripts/setup/setup.py skills rebuild
else
    python3 python/scripts/setup/setup.py skills rebuild
fi
echo "Ready."
