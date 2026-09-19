#!/usr/bin/env bash
# Cut a browser-extension release in one go: pick the next version, prove
# the tree is releasable, run the repo's own gate, write the version into
# package.json (and the lockfile), then commit, tag and push. The tag is what
# .github/workflows/release.yml builds, signs and publishes (docs/release.md).
#
#   scripts/release.sh                 # 0.2.0 -> 0.2.1
#   scripts/release.sh --minor         # 0.2.0 -> 0.3.0
#   scripts/release.sh --major         # 0.2.0 -> 1.0.0
#   scripts/release.sh 0.3.0           # exactly that
#   scripts/release.sh --dry-run       # print every step and diff, touch nothing
#   scripts/release.sh --skip-checks   # skip the gate (loud)
#
# The version lives in package.json only: build.mjs stamps it into every
# browser's manifest, and the workflow's first job refuses a tag that
# disagrees with it. A port of zebu-desktop's scripts/release.sh with the
# Tauri and Cargo files taken out; the pure helpers are shared in shape so
# scripts/tests/release.test.sh can source this file and call them.

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

PKG_JSON="package.json"
NPM_LOCK="package-lock.json"

DRY_RUN=0
SKIP_CHECKS=0
RELEASE_TMP=""

cleanup() { [ -n "$RELEASE_TMP" ] && rm -rf "$RELEASE_TMP"; return 0; }

log()  { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
would() { printf '\033[1;34m·\033[0m would %s\n' "$*"; }

usage() {
    cat <<'USAGE'
Usage: scripts/release.sh [X.Y.Z] [--major|--minor|--patch] [options]

Version (default: --patch, i.e. the next version — 0.2.0 becomes 0.2.1):
  X.Y.Z            release exactly this version (overrides the bump flags)
  --major          1.2.3 -> 2.0.0
  --minor          1.2.3 -> 1.3.0
  --patch          1.2.3 -> 1.2.4  (the default)

Options:
  -n, --dry-run    print every step and every file change, touch nothing
      --skip-checks  do not run the build, typecheck, tests and i18n check
  -h, --help       this text

Refuses to run if the tree is dirty, the branch is not main, main is behind
or diverged from origin/main, the tag already exists locally or on origin, or
the target version is not greater than the current one.
USAGE
}

# ---------------------------------------------------------------------------
# Pure version helpers (no side effects — the test suite calls these directly)
# ---------------------------------------------------------------------------

version_is_valid() {
    [[ ${1:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# bump_version <current> <major|minor|patch> -> the next version on stdout
bump_version() {
    local current=${1:-} mode=${2:-patch} major minor patch rest
    version_is_valid "$current" || return 1
    major=${current%%.*}
    rest=${current#*.}
    minor=${rest%%.*}
    patch=${rest#*.}
    case $mode in
        major) printf '%s.0.0\n' "$((10#$major + 1))" ;;
        minor) printf '%s.%s.0\n' "$((10#$major))" "$((10#$minor + 1))" ;;
        patch) printf '%s.%s.%s\n' "$((10#$major))" "$((10#$minor))" "$((10#$patch + 1))" ;;
        *) return 1 ;;
    esac
}

# version_gt <a> <b> — true when a is strictly newer than b.
version_gt() {
    local a=${1:-} b=${2:-}
    version_is_valid "$a" && version_is_valid "$b" || return 1
    [ "$a" != "$b" ] || return 1
    [ "$(printf '%s\n%s\n' "$a" "$b" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$b" ]
}

# read_json_version <file> — the value of the top-level "version" key only.
read_json_version() {
    awk '
        {
            line = $0
            bare = line
            gsub(/"([^"\\]|\\.)*"/, "@@", bare)
        }
        depth == 1 && line ~ /^[[:space:]]*"version"[[:space:]]*:/ {
            if (match(line, /:[[:space:]]*"[^"]*"/)) {
                v = substr(line, RSTART, RLENGTH)
                sub(/^:[[:space:]]*"/, "", v)
                sub(/"$/, "", v)
                print v
                exit
            }
        }
        { depth += gsub(/\{/, "{", bare) - gsub(/\}/, "}", bare) }
    ' "$1"
}

# write_json_version <file> <version> <out> — only the top-level "version" changed.
write_json_version() {
    awk -v ver="$2" '
        {
            line = $0
            bare = line
            gsub(/"([^"\\]|\\.)*"/, "@@", bare)
        }
        !done && depth == 1 && line ~ /^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"[^"]*"/ {
            sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"" ver "\"", line)
            done = 1
        }
        { print line; depth += gsub(/\{/, "{", bare) - gsub(/\}/, "}", bare) }
        END { if (!done) exit 1 }
    ' "$1" > "$3"
}

current_version() {
    local pkg
    pkg=$(read_json_version "$ROOT/$PKG_JSON")
    version_is_valid "$pkg" || die "cannot read a version from $PKG_JSON"
    printf '%s\n' "$pkg"
}

apply_version() {
    local version=$1 tmp
    RELEASE_TMP=$(mktemp -d)
    tmp=$RELEASE_TMP
    write_json_version "$ROOT/$PKG_JSON" "$version" "$tmp/$PKG_JSON" \
        || die "no top-level \"version\" key in $PKG_JSON"
    if [ "$DRY_RUN" = 1 ]; then
        would "change $PKG_JSON:"
        diff -u --label "a/$PKG_JSON" --label "b/$PKG_JSON" "$ROOT/$PKG_JSON" "$tmp/$PKG_JSON" \
            | sed -n '3,$p' | sed 's/^/    /' || true
    else
        cat "$tmp/$PKG_JSON" > "$ROOT/$PKG_JSON"
        note "$PKG_JSON -> $version"
    fi
}

update_lockfile() {
    local version=$1
    if [ "$DRY_RUN" = 1 ]; then
        would "run npm install --package-lock-only  (brings $NPM_LOCK to $version)"
        return 0
    fi
    log "Bringing the lockfile along"
    (cd "$ROOT" && npm install --package-lock-only --silent) \
        || die "npm install --package-lock-only failed"
    note "$NPM_LOCK -> $(read_json_version "$ROOT/$NPM_LOCK")"
}

verify_versions() {
    local version=$1 got
    for got in \
        "$PKG_JSON:$(read_json_version "$ROOT/$PKG_JSON")" \
        "$NPM_LOCK:$(read_json_version "$ROOT/$NPM_LOCK")"
    do
        [ "${got#*:}" = "$version" ] || die "${got%%:*} says ${got#*:}, not $version"
    done
}

# ---------------------------------------------------------------------------
# git, the network and the repo's gate
# ---------------------------------------------------------------------------

preflight() {
    local version=$1 current=$2 branch counts behind

    version_gt "$version" "$current" \
        || die "$version is not newer than the current $current"
    git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 \
        || die "$ROOT is not a git repository"
    git -C "$ROOT" remote get-url origin >/dev/null 2>&1 \
        || die "this repository has no 'origin' remote to push to"
    [ -z "$(git -C "$ROOT" status --porcelain)" ] \
        || die "the working tree is dirty — commit or stash first (git status)"
    branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)
    [ "$branch" = main ] \
        || die "on branch '$branch' — releases are cut from main"

    log "Fetching origin"
    git -C "$ROOT" fetch --quiet --tags origin \
        || die "git fetch origin failed — no network, or no access to origin"
    git -C "$ROOT" rev-parse --verify --quiet origin/main >/dev/null \
        || die "origin/main does not exist"
    counts=$(git -C "$ROOT" rev-list --left-right --count origin/main...HEAD)
    behind=${counts%%[[:space:]]*}
    [ "$behind" = 0 ] \
        || die "main is $behind commit(s) behind origin/main (or diverged) — pull and rebase first"

    if [ -n "$(git -C "$ROOT" ls-remote --tags origin "refs/tags/v$version" 2>/dev/null)" ]; then
        die "tag v$version already exists on origin — that version is already released"
    fi
    if git -C "$ROOT" rev-parse --verify --quiet "refs/tags/v$version" >/dev/null; then
        die "tag v$version already exists locally — delete it (git tag -d v$version) or pick another version"
    fi
}

run_checks() {
    if [ "$SKIP_CHECKS" = 1 ]; then
        warn "--skip-checks: the build, typecheck, tests and i18n check are NOT being run."
        warn "               The release workflow runs them anyway, so a failure here"
        warn "               becomes a failed build on a tag that is already public."
        return 0
    fi
    if [ "$DRY_RUN" = 1 ]; then
        would "run npm run build (all three targets)"
        would "run npm run typecheck"
        would "run npm test"
        would "run npm run i18n:check"
        would "run bash scripts/tests/publish-r2.test.sh"
        return 0
    fi
    log "npm run build"
    (cd "$ROOT" && npm run build) || die "npm run build failed"
    log "npm run typecheck"
    (cd "$ROOT" && npm run typecheck) || die "npm run typecheck failed"
    log "npm test"
    (cd "$ROOT" && npm test) || die "npm test failed"
    log "npm run i18n:check"
    (cd "$ROOT" && npm run i18n:check) || die "npm run i18n:check failed"
    log "release script tests"
    (cd "$ROOT" && bash scripts/tests/publish-r2.test.sh) || die "scripts/tests/publish-r2.test.sh failed"
}

commit_tag_push() {
    local version=$1
    local files=("$PKG_JSON" "$NPM_LOCK")
    if [ "$DRY_RUN" = 1 ]; then
        would "git add ${files[*]}"
        would "git commit -m 'Release $version'"
        would "git tag v$version"
        would "git push origin main v$version"
        return 0
    fi
    log "Committing, tagging and pushing"
    git -C "$ROOT" add -- "${files[@]}"
    git -C "$ROOT" commit --quiet -m "Release $version"
    git -C "$ROOT" tag "v$version"
    git -C "$ROOT" push --quiet origin main "v$version" \
        || die "push failed — the commit and tag v$version exist locally; fix and push again"
    note "pushed main and v$version"
}

repo_slug() {
    local url slug
    url=$(git -C "$ROOT" remote get-url origin 2>/dev/null) || url=""
    url=${url%.git}
    slug=${url##*github.com[:/]}
    case $url:$slug in
        *github.com*:*/*) printf '%s\n' "$slug" ;;
        *) printf 'zebu-time-tracker/zebu-chrome-extension\n' ;;
    esac
}

what_happens_next() {
    local version=$1 slug when="does now"
    slug=$(repo_slug)
    if [ "$DRY_RUN" = 1 ]; then when="would then do"; fi
    echo
    log "What the Release workflow $when"
    note "1. verify:  compares v$version with $PKG_JSON, runs the release-script tests"
    note "2. build:   Chrome, Firefox and Safari packages; Firefox signed by AMO when the secrets exist"
    note "3. stores:  Chrome Web Store upload when CWS_* secrets exist"
    note "4. publish: every package to $(printf 'https://app-downloads.zebu.work/extension/%s/' "$version"), aliases under extension/latest/, then latest.json and firefox/updates.json"
    echo
    note "Watch it:      https://github.com/$slug/actions"
    note "Not automated: the Safari App Store submission, and the Chrome Web Store review itself"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

main() {
    local mode=patch explicit="" version current
    while [ $# -gt 0 ]; do
        case $1 in
            --major|--minor|--patch) mode=${1#--} ;;
            -n|--dry-run) DRY_RUN=1 ;;
            --skip-checks) SKIP_CHECKS=1 ;;
            -h|--help) usage; exit 0 ;;
            -*) die "unknown option '$1' (see --help)" ;;
            *)
                [ -z "$explicit" ] || die "more than one version given"
                version_is_valid "$1" || die "'$1' is not a version of the form X.Y.Z"
                explicit=$1
                ;;
        esac
        shift
    done
    trap cleanup EXIT

    current=$(current_version)
    if [ -n "$explicit" ]; then version=$explicit; else version=$(bump_version "$current" "$mode"); fi
    log "Release $current -> $version"
    [ "$DRY_RUN" = 1 ] && note "(dry run: nothing is written, committed, tagged or pushed)"

    preflight "$version" "$current"
    run_checks
    apply_version "$version"
    update_lockfile "$version"
    [ "$DRY_RUN" = 1 ] || verify_versions "$version"
    commit_tag_push "$version"
    what_happens_next "$version"
}

case ${0##*/} in
    release.sh) main "$@" ;;
esac
