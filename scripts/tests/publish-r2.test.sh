#!/usr/bin/env bash
# Exercises the two pieces a release puts in front of the downloads page and
# every installed Firefox copy: scripts/extension-manifest.mjs (what
# latest.json, aliases.tsv and updates.json say) and scripts/publish-r2.sh
# (what goes into the bucket, and in what order), plus the pure version
# helpers of scripts/release.sh.
#
# publish-r2.sh runs for real with recording stand-ins on $PATH in place of
# `aws` and `curl`, so the ordering of the actual calls — versioned files,
# then aliases, then the manifests last — is checked rather than assumed.
# Nothing here touches the network, the real bucket, or any credential.
#
#   bash scripts/tests/publish-r2.test.sh
set -u

SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SCRIPTS=$(cd -- "$SELF_DIR/.." && pwd)
MANIFEST_JS=$SCRIPTS/extension-manifest.mjs
PUBLISH=$SCRIPTS/publish-r2.sh
RELEASE=$SCRIPTS/release.sh

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fails=0
ok()   { printf 'ok   %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; fails=$((fails + 1)); }
check() { # name actual expected
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi
}
contains() { # name haystack needle
    if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (no '$3' in: $2)"; fi
}
lacks() { # name haystack needle
    if printf '%s' "$2" | grep -qF -- "$3"; then bad "$1 (found '$3')"; else ok "$1"; fi
}

VERSION=0.3.0
PUBLIC=https://app-downloads.zebu.work
BASE_URL=$PUBLIC/extension/$VERSION

json() { # <json> <node expression over m>
    printf '%s' "$1" | node -e '
        let raw = ""; process.stdin.on("data", (c) => raw += c);
        process.stdin.on("end", () => { const m = JSON.parse(raw); const v = eval(process.argv[1]); console.log(typeof v === "string" ? v : JSON.stringify(v)); });
    ' "$2"
}

# ---------------------------------------------------------------------------
# Fixtures: the packages scripts/package.mjs and AMO produce
# ---------------------------------------------------------------------------

make_packages() { # dir [with-safari] [unsigned-firefox]
    local dir=$1 safari=${2:-yes} unsigned=${3:-no}
    rm -rf "$dir"; mkdir -p "$dir"
    printf 'chrome package\n' > "$dir/zebu-chrome-$VERSION.zip"
    printf 'firefox source zip\n' > "$dir/zebu-firefox-$VERSION.zip"
    [ "$unsigned" = yes ] || printf 'signed firefox xpi bytes\n' > "$dir/zebu-firefox-$VERSION.xpi"
    [ "$safari" = yes ] && printf 'safari package\n' > "$dir/zebu-safari-$VERSION.zip"
    return 0
}

UPLOAD=$TMP/upload
make_packages "$UPLOAD"

run_manifest() { out=$(node "$MANIFEST_JS" "$@" 2>&1); rc=$?; }

# ---------------------------------------------------------------------------
# latest.json
# ---------------------------------------------------------------------------

run_manifest --version "$VERSION" --dir "$UPLOAD" --base-url "$BASE_URL" \
    --aliases-out "$TMP/aliases.tsv" --updates-out "$TMP/updates.json" \
    --pub-date 2026-09-19T17:00:00Z --chrome-store "https://chromewebstore.google.com/detail/zebu/abc"
check "manifest builds from a full set of packages" "$rc" "0"
MANIFEST=$out
check "names the version being released" "$(json "$MANIFEST" 'm.version')" "$VERSION"
check "covers the three browsers" "$(json "$MANIFEST" 'Object.keys(m.builds).sort().join(",")')" "chrome,firefox,safari"
check "firefox serves the signed xpi, not the source zip" "$(json "$MANIFEST" 'm.builds.firefox.file')" "zebu-firefox-$VERSION.xpi"
check "every url sits under the immutable per-version prefix" \
    "$(json "$MANIFEST" 'Object.values(m.builds).every((b) => b.url.startsWith("'"$BASE_URL"'/"))')" "true"
check "sizes are the real byte counts" "$(json "$MANIFEST" 'm.builds.chrome.size')" "$(wc -c < "$UPLOAD/zebu-chrome-$VERSION.zip" | tr -d ' ')"
check "the store link rides along for chrome" "$(json "$MANIFEST" 'm.builds.chrome.store')" "https://chromewebstore.google.com/detail/zebu/abc"
check "pub_date is what was given" "$(json "$MANIFEST" 'm.pub_date')" "2026-09-19T17:00:00Z"

check "aliases map the stable names to the versioned files" \
    "$(sort "$TMP/aliases.tsv" | tr '\t' '=' | tr '\n' ' ')" \
    "zebu-chrome.zip=zebu-chrome-$VERSION.zip zebu-firefox.xpi=zebu-firefox-$VERSION.xpi zebu-safari.zip=zebu-safari-$VERSION.zip "

UPDATES=$(cat "$TMP/updates.json")
check "updates.json is keyed by the gecko id" "$(json "$UPDATES" 'Object.keys(m.addons).join()')" "extension@zebu.work"
check "updates.json links the versioned xpi" "$(json "$UPDATES" 'm.addons["extension@zebu.work"].updates[0].update_link')" "$BASE_URL/zebu-firefox-$VERSION.xpi"
check "updates.json carries the sha256 of the exact bytes" \
    "$(json "$UPDATES" 'm.addons["extension@zebu.work"].updates[0].update_hash')" \
    "sha256:$(shasum -a 256 "$UPLOAD/zebu-firefox-$VERSION.xpi" | cut -d' ' -f1)"

# ---------------------------------------------------------------------------
# What is refused
# ---------------------------------------------------------------------------

run_manifest --version "$VERSION" --dir "$UPLOAD" --base-url "$PUBLIC/extension/latest"
check "a base url that does not end in the version is refused" "$rc" "1"
contains "…and says why" "$out" "immutable"

make_packages "$TMP/nosafari" no
run_manifest --version "$VERSION" --dir "$TMP/nosafari" --base-url "$BASE_URL"
check "safari may be absent while its store pipeline does not exist" "$rc" "0"
check "…and the manifest then names two browsers" "$(json "$out" 'Object.keys(m.builds).sort().join(",")')" "chrome,firefox"

rm -rf "$TMP/nochrome"; cp -R "$UPLOAD" "$TMP/nochrome"; rm "$TMP/nochrome/zebu-chrome-$VERSION.zip"
run_manifest --version "$VERSION" --dir "$TMP/nochrome" --base-url "$BASE_URL"
check "a missing chrome package fails the whole manifest" "$rc" "1"
contains "…naming the browser" "$out" "no package for chrome"

make_packages "$TMP/unsigned" yes yes
run_manifest --version "$VERSION" --dir "$TMP/unsigned" --base-url "$BASE_URL" --updates-out "$TMP/u2.json"
check "updates.json refuses to point firefox at an unsigned zip" "$rc" "1"
contains "…and says so" "$out" "unsigned"

# ---------------------------------------------------------------------------
# publish-r2.sh: the plan, and the order of the real calls
# ---------------------------------------------------------------------------

STUBS=$TMP/bin; mkdir -p "$STUBS"
CALLS=$TMP/calls.log; : > "$CALLS"
cat > "$STUBS/aws" <<'STUB'
#!/usr/bin/env bash
# Records every put-object key in order; answers head-object with the local size.
if [ "$1" = s3api ] && [ "$2" = put-object ]; then
    key=""; while [ $# -gt 0 ]; do [ "$1" = --key ] && key=$2; shift; done
    printf 'put %s\n' "$key" >> "$CALLS_LOG"
    echo '"etag"'
    exit 0
fi
if [ "$1" = s3api ] && [ "$2" = head-object ]; then
    key=""; while [ $# -gt 0 ]; do [ "$1" = --key ] && key=$2; shift; done
    file=$(grep -F "	$key	" "$PLAN_FILE" | cut -f3)
    size=$(wc -c < "$file" | tr -d ' ')
    case $key in
        */latest/*) printf '%s\tattachment; filename="%s"\n' "$size" "$(basename "$file")" ;;
        *) printf '%s\tNone\n' "$size" ;;
    esac
    exit 0
fi
exit 1
STUB
cat > "$STUBS/curl" <<'STUB'
#!/usr/bin/env bash
# The public read-back: serve the manifest we were given, and say yes to every HEAD.
for a in "$@"; do case $a in -I) exit 0 ;; esac; done
cat "$MANIFEST_FILE"
STUB
chmod +x "$STUBS/aws" "$STUBS/curl"

printf '%s\n' "$MANIFEST" > "$TMP/latest.json"
plan=$(bash "$PUBLISH" publish --bucket app-downloads --base extension --version "$VERSION" \
    --dir "$UPLOAD" --manifest "$TMP/latest.json" --aliases "$TMP/aliases.tsv" \
    --also "firefox/updates.json=$TMP/updates.json" --public-base "$PUBLIC" --print-plan)
printf '%s\n' "$plan" > "$TMP/plan.tsv"

check "versioned files go up first, then the aliases, then the manifests" \
    "$(printf '%s\n' "$plan" | cut -f1 | uniq | tr '\n' ' ')" "versioned alias manifest "
check "latest.json and updates.json are the last two objects written" \
    "$(printf '%s\n' "$plan" | tail -2 | cut -f2 | tr '\n' ' ')" "extension/latest.json extension/firefox/updates.json "
check "every package is kept under its own version" \
    "$(printf '%s\n' "$plan" | grep -c "^versioned	extension/$VERSION/")" "4"
check "the three aliases are written from the versioned originals" \
    "$(printf '%s\n' "$plan" | grep '^alias' | cut -f2 | sort | tr '\n' ' ')" \
    "extension/latest/zebu-chrome.zip extension/latest/zebu-firefox.xpi extension/latest/zebu-safari.zip "

out=$(PATH="$STUBS:$PATH" CALLS_LOG="$CALLS" PLAN_FILE="$TMP/plan.tsv" MANIFEST_FILE="$TMP/latest.json" \
    AWS_ENDPOINT_URL=https://example.invalid \
    bash "$PUBLISH" publish --bucket app-downloads --base extension --version "$VERSION" \
    --dir "$UPLOAD" --manifest "$TMP/latest.json" --aliases "$TMP/aliases.tsv" \
    --also "firefox/updates.json=$TMP/updates.json" --public-base "$PUBLIC" 2>&1); rc=$?
check "a publish against the recording stand-ins succeeds" "$rc" "0"
check "the real calls follow the plan's order exactly" "$(cut -d' ' -f2 "$CALLS" | tr '\n' ' ')" "$(cut -f2 "$TMP/plan.tsv" | tr '\n' ' ')"
contains "the public read-back checked a versioned url" "$out" "ok  $BASE_URL/zebu-chrome-$VERSION.zip"

out=$(bash "$PUBLISH" publish --bucket app-downloads --base desktop --version "$VERSION" \
    --dir "$UPLOAD" --manifest "$TMP/latest.json" --print-plan 2>&1); rc=$?
check "the desktop prefix is refused here" "$rc" "1"
out=$(bash "$PUBLISH" publish --bucket app-downloads --base "extension/_dryrun/42" --version "$VERSION" \
    --dir "$UPLOAD" --manifest "$TMP/latest.json" --print-plan 2>&1); rc=$?
check "a dry run prefix is accepted" "$rc" "0"
check "…and writes only under its own run" "$(printf '%s\n' "$out" | cut -f2 | grep -vc '^extension/_dryrun/42/')" "0"
check "the publish script contains no delete of any kind" "$(grep -vE '^[[:space:]]*#' "$PUBLISH" | grep -cE 's3 rm|s3 sync|delete-object')" "0"

# ---------------------------------------------------------------------------
# release.sh: the pure helpers
# ---------------------------------------------------------------------------

# shellcheck disable=SC1090
. "$RELEASE"
check "bump patch" "$(bump_version 0.2.0 patch)" "0.2.1"
check "bump minor" "$(bump_version 0.2.9 minor)" "0.3.0"
check "bump major" "$(bump_version 1.9.9 major)" "2.0.0"
check "version_gt orders numerically, not lexically" "$(version_gt 0.10.0 0.9.0 && echo yes || echo no)" "yes"
check "version_gt refuses equal" "$(version_gt 0.3.0 0.3.0 && echo yes || echo no)" "no"
printf '{\n    "name": "x",\n    "version": "0.2.0",\n    "dependencies": { "y": { "version": "9.9.9" } }\n}\n' > "$TMP/pkg.json"
check "read_json_version reads the top-level version only" "$(read_json_version "$TMP/pkg.json")" "0.2.0"
write_json_version "$TMP/pkg.json" 0.3.0 "$TMP/pkg2.json"
check "write_json_version changes the top-level version only" "$(grep -c '"9.9.9"' "$TMP/pkg2.json"):$(read_json_version "$TMP/pkg2.json")" "1:0.3.0"

echo
if [ "$fails" = 0 ]; then echo "all passed"; exit 0; fi
echo "$fails failed"; exit 1
