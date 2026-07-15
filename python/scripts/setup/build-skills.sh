#!/bin/bash
# Build all .skill packages from python/skills/ (bundled) and
# python/skills-personal/ (per-installation, gitignored, created by
# `my-skills create` / skill-catalog import).
# A `disabled/` subfolder under either root is excluded from the build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SKILLS_OUT="$PROJECT_ROOT/skills"
SKILL_ROOTS=("$PROJECT_ROOT/python/skills" "$PROJECT_ROOT/python/skills-personal")

mkdir -p "$SKILLS_OUT"
rm -f "$SKILLS_OUT"/*.skill

count=0
seen_skills=()
get_seen_dir() {
    local target="$1"
    [ "${#seen_skills[@]}" -eq 0 ] && return 0
    for item in "${seen_skills[@]}"; do
        local key="${item%%:*}"
        local val="${item#*:}"
        if [ "$key" = "$target" ]; then
            echo "$val"
            return 0
        fi
    done
    return 0
}

for root in "${SKILL_ROOTS[@]}"; do
    [ -d "$root" ] || continue
    while IFS= read -r -d '' skill_md; do
        dir="$(dirname "$skill_md")"
        name="$(basename "$dir")"

        prev_dir="$(get_seen_dir "$name")"
        if [ -n "$prev_dir" ]; then
            echo "  [WARN] Duplicate skill name '$name': $prev_dir vs $dir — keeping the first one." >&2
            continue
        fi
        seen_skills+=("$name:$dir")

        output="$SKILLS_OUT/$name.skill"
        (cd "$dir" && zip -j "$output" SKILL.md -q)
        echo "  Built: skills/$name.skill"
        count=$((count + 1))
    done < <(find "$root" -name "SKILL.md" -not -path "*/disabled/*" -print0 | sort -z)
done

echo ""
echo "Done: ${count} skill(s) → skills/"
