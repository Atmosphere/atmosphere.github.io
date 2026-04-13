#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# update-doc-versions.sh — Sync tutorial + website with Atmosphere release
#
# Usage: ./scripts/update-doc-versions.sh <release-version>
#   e.g.: ./scripts/update-doc-versions.sh 4.0.37
#
# Companion to the main repo's scripts/update-doc-versions.sh. This
# script runs inside the atmosphere.github.io repo and updates every
# stale version reference across the Starlight tutorial and the
# Async-IO landing site so a new release of atmosphere/atmosphere
# never leaves the docs site claiming SNAPSHOT or the previous tag.
#
# Release 4.0.36 shipped with 23 stale `4.0.36-SNAPSHOT` references
# in the tutorial because no automation existed here. This script is
# the permanent fix.
#
# Called automatically by:
#   - atmosphere/atmosphere's release-4x.yml workflow (cross-repo step)
#   - Manual invocation ahead of a release
# ──────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:?Usage: $0 <release-version>}"
# Resolve ROOT from the script's location so the script works when
# invoked from any cwd (including the main atmosphere repo's release
# workflow cross-repo step).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Validate version format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$'; then
    echo "Error: Invalid version format: $VERSION"
    echo "Expected: X.Y.Z or X.Y.Z-qualifier"
    exit 1
fi

echo ""
echo "Updating atmosphere.github.io to version $VERSION"
echo "============================================"
echo ""

UPDATED=0

# Helper: portable sed -i (macOS vs Linux)
sedi() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# ── 1. Maven <version> and <atmosphere.version> tags ──
# Handles both bare <version>X.Y.Z</version> and property-block
# <atmosphere.version>X.Y.Z</atmosphere.version> patterns. Atmosphere
# tutorial snippets use the property-block form almost exclusively.
echo "── docs/src/content/docs/**/*.md Maven snippets"
{ find "$ROOT/docs/src/content/docs" -name '*.md' -exec grep -lE '<(atmosphere\.)?version>[0-9]' {} + 2>/dev/null || true; } | while read -r f; do
    sedi -E "s|<version>[0-9]+\.[0-9]+\.[0-9]+[^<]*</version>|<version>${VERSION}</version>|g" "$f"
    sedi -E "s|<atmosphere\.version>[0-9]+\.[0-9]+\.[0-9]+[^<]*</atmosphere\.version>|<atmosphere.version>${VERSION}</atmosphere.version>|g" "$f"
    echo "   $f"
    UPDATED=$((UPDATED + 1))
done

# ── 2. Version references in prose inside backticks ──
# Matches phrases like "at time of writing, `4.0.36-SNAPSHOT` on `main`"
# that sit inside markdown prose. Only touches `4.0.x` patterns so we
# don't trample Java (`21`), Spring Boot (`4.0.5`), or Quarkus
# (`3.31.3`) version mentions. Uses plain sed -E with two passes to
# avoid BSD alternation issues inside character classes.
echo "── prose 4.0.x version references"
{ find "$ROOT/docs/src/content/docs" -name '*.md' -exec grep -lE '`4\.0\.[0-9]+' {} + 2>/dev/null || true; } | while read -r f; do
    # First pass: `4.0.NN-SNAPSHOT` → `VERSION`
    sedi -E "s|\`4\.0\.[0-9]+-SNAPSHOT\`|\`${VERSION}\`|g" "$f"
    # Second pass: `4.0.NN-RCn` → `VERSION`
    sedi -E "s|\`4\.0\.[0-9]+-RC[0-9]+\`|\`${VERSION}\`|g" "$f"
    # Third pass: bare `4.0.NN` → `VERSION` (only when it's clearly the
    # atmosphere release line; leave Spring Boot 4.0.5 alone by
    # requiring the third digit be 10+ which is the Atmosphere range)
    sedi -E "s|\`4\.0\.[1-9][0-9]+\`|\`${VERSION}\`|g" "$f"
    echo "   $f (prose)"
done

# ── 3. CLI install snippets / atmosphere command examples ──
# Covers any "atmosphere-X.Y.Z.tar.gz" or SDKMAN install lines.
echo "── CLI / install snippets"
{ find "$ROOT/docs/src/content/docs" -name '*.md' -exec grep -lE 'atmosphere-[0-9]+\.[0-9]+\.[0-9]+' {} + 2>/dev/null || true; } | while read -r f; do
    sedi -E "s/atmosphere-[0-9]+\.[0-9]+\.[0-9]+-SNAPSHOT/atmosphere-${VERSION}/g" "$f"
    sedi -E "s/atmosphere-[0-9]+\.[0-9]+\.[0-9]+-RC[0-9]+/atmosphere-${VERSION}/g" "$f"
    echo "   $f (cli snippet)"
    UPDATED=$((UPDATED + 1))
done

# ── 3b. JSON code-block response examples with "version": "X.Y.Z" ──
# Admin API and health check responses are documented with live JSON
# example bodies. Those aren't inline-code backticks, they're inside
# ```json blocks, so the prose regex misses them. Target the JSON
# property form specifically.
echo "── JSON response body version fields"
{ find "$ROOT/docs/src/content/docs" -name '*.md' -exec grep -lE '"version"[[:space:]]*:[[:space:]]*"4\.0\.' {} + 2>/dev/null || true; } | while read -r f; do
    sedi -E "s|\"version\"([[:space:]]*:[[:space:]]*)\"4\.0\.[0-9]+[^\"]*\"|\"version\"\1\"${VERSION}\"|g" "$f"
    echo "   $f (json example)"
    UPDATED=$((UPDATED + 1))
done

# ── 4. whats-new.md Current release callout ──
WHATS_NEW="$ROOT/docs/src/content/docs/whats-new.md"
if [ -f "$WHATS_NEW" ] && grep -q 'Current release' "$WHATS_NEW" 2>/dev/null; then
    sedi -E "s|(Current release[^\`]*\`)[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?(\`)|\1${VERSION}\3|g" "$WHATS_NEW"
    echo "   docs/src/content/docs/whats-new.md (Current release callout)"
fi

# ── 5. Astro website hero stat values ──
# The Async-IO landing site hero shows "N AI Runtimes" and similar
# counts. Runtime count is NOT a version bump and must be updated by
# a separate audit when a runtime is added/removed — NOT touched here.
# This script only touches version-string patterns.

# ── 6. website/ pinned version in Maven snippets (if any) ──
if [ -d "$ROOT/website/src" ]; then
    echo "── website/src pinned Maven snippets"
    { find "$ROOT/website/src" -name '*.astro' -o -name '*.mdx' -o -name '*.md' 2>/dev/null | xargs grep -l '<version>[0-9]' 2>/dev/null || true; } | while read -r f; do
        sedi "s|<version>[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^<]*</version>|<version>$VERSION</version>|g" "$f"
        echo "   $f"
        UPDATED=$((UPDATED + 1))
    done
fi

echo ""
echo "Done. Summary of changes:"
git -C "$ROOT" diff --stat | tail -20 || true
