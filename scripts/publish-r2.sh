#!/usr/bin/env bash
# Publishes a built release of the browser extension to the Cloudflare R2
# bucket the downloads page and Firefox's updater read
# (https://app-downloads.zebu.work), and verifies it by reading it back.
# Copied from zebu-desktop's scripts/publish-r2.sh (board #287) with the
# prefix, the manifest check and one extra kind of object changed; the
# ordering, the no-delete rule and the dry-run shape are the same.
#
#   scripts/publish-r2.sh publish \
#       --bucket app-downloads --base extension --version 0.3.0 \
#       --dir upload --manifest latest.json --aliases aliases.tsv \
#       --also firefox/updates.json=updates.json \
#       --public-base https://app-downloads.zebu.work [--print-plan]
#
# ---------------------------------------------------------------------------
# Ordering is the whole point
# ---------------------------------------------------------------------------
# The plan is executed strictly in three phases:
#
#   1. `<base>/<version>/…`   every built package (.zip, .xpi)
#   2. `<base>/latest/…`      the stable names a download page links to
#   3. `<base>/latest.json`   the downloads manifest, and with it every
#      `--also` object (Firefox's `<base>/firefox/updates.json`), LAST
#
# An installed Firefox copy must never learn about a version before its
# .xpi is there, so the manifests go up only once everything they name is
# uploaded. They only ever name phase-1 URLs (enforced in
# scripts/extension-manifest.mjs): updates.json carries the sha256 of the
# exact bytes, so an alias caught mid-overwrite would fail as a hash error,
# not as a 404.
#
# ---------------------------------------------------------------------------
# Dry runs
# ---------------------------------------------------------------------------
# A dry run is the same code, the same credentials and the same ordering with
# `--base extension/_dryrun/<run id>` instead of `--base extension`. One variable
# is the only difference, so the rehearsal exercises the route the real thing
# takes, and a dry run can never write `extension/latest.json`,
# `extension/latest/*` or a real version folder.
#
# ---------------------------------------------------------------------------
# This script never deletes anything
# ---------------------------------------------------------------------------
# There is no delete, no `s3 rm`, and no `s3 sync` (which mirrors, and would
# remove real releases to match a source directory). Uploads are individual
# `s3api put-object` calls. Scratch objects under `extension/_dryrun/` are left
# for a bucket lifecycle rule to expire; a workflow that cannot delete cannot
# delete the wrong thing however wrong its variables get.
#
# ---------------------------------------------------------------------------
# Never printed
# ---------------------------------------------------------------------------
# The R2 endpoint carries the account id. It is passed to the AWS CLI through
# AWS_ENDPOINT_URL in the environment and never appears on a command line, in
# the plan, or in a log line here. No `set -x` in this file.
#
# `AWS_BIN`/`CURL_BIN`/`NODE_BIN` exist so scripts/tests/publish-r2.test.sh
# can run the real logic against recording stand-ins; they default to the
# real tools.
set -u

AWS_BIN=${AWS_BIN:-aws}
CURL_BIN=${CURL_BIN:-curl}
NODE_BIN=${NODE_BIN:-node}

die() { printf 'publish-r2: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }

bucket=''
base=''
version=''
dir=''
manifest=''
aliases=''
public_base=''
print_plan=false
also=''

parse_args() {
    while [ $# -gt 0 ]; do
        case $1 in
            --bucket)      [ $# -ge 2 ] || die "--bucket needs a value"; bucket=$2; shift 2 ;;
            --base)        [ $# -ge 2 ] || die "--base needs a value"; base=$2; shift 2 ;;
            --version)     [ $# -ge 2 ] || die "--version needs a value"; version=$2; shift 2 ;;
            --dir)         [ $# -ge 2 ] || die "--dir needs a value"; dir=$2; shift 2 ;;
            --manifest)    [ $# -ge 2 ] || die "--manifest needs a value"; manifest=$2; shift 2 ;;
            --aliases)     [ $# -ge 2 ] || die "--aliases needs a value"; aliases=$2; shift 2 ;;
            --public-base) [ $# -ge 2 ] || die "--public-base needs a value"; public_base=$2; shift 2 ;;
            # key=file, repeatable: written in the manifest phase, after every package
            --also)        [ $# -ge 2 ] || die "--also needs key=file"; also="$also$2"$'\n'; shift 2 ;;
            --print-plan)  print_plan=true; shift ;;
            *) die "unknown option '$1'" ;;
        esac
    done
}

# --- content types and caching ---------------------------------------------

content_type_for() {
    case $1 in
        *.json)      printf 'application/json' ;;
        *.zip)       printf 'application/zip' ;;
        *.xpi)       printf 'application/x-xpinstall' ;;
        *.crx)       printf 'application/x-chrome-extension' ;;
        *.sig)       printf 'text/plain' ;;
        *.dmg)       printf 'application/x-apple-diskimage' ;;
        *.exe)       printf 'application/vnd.microsoft.portable-executable' ;;
        *.msi)       printf 'application/x-msi' ;;
        *.AppImage)  printf 'application/x-executable' ;;
        *.tar.gz)    printf 'application/gzip' ;;
        *.deb)       printf 'application/vnd.debian.binary-package' ;;
        *.rpm)       printf 'application/x-rpm' ;;
        *)           printf 'application/octet-stream' ;;
    esac
}

# Versioned keys are written once and never again, so they may be cached
# forever. The aliases move every release, and the manifest is polled by every
# install on every launch — it must revalidate or a new version stays
# invisible behind Cloudflare's cache for as long as it is fresh.
cache_control_for_phase() {
    case $1 in
        versioned) printf 'public, max-age=31536000, immutable' ;;
        alias)     printf 'public, max-age=300' ;;
        manifest)  printf 'no-cache' ;;
    esac
}

# An alias has a stable name so a download page can link to it forever, but
# nobody wants a file called `mac.dmg` sitting in their Downloads folder with
# no way to tell which version it is. The object carries the versioned name it
# was copied from, and the browser saves it under that instead — the link and
# the saved file are allowed to disagree, and here they should.
#
# Only the aliases. A versioned key is already named for its version, and the
# manifest must stay a document the updater reads rather than a download.
content_disposition_for() { # phase file
    [ "$1" = alias ] || return 0
    printf 'attachment; filename="%s"' "$(basename -- "$2")"
}

# --- the plan ---------------------------------------------------------------

# Emits `phase<TAB>key<TAB>local file` lines, in the order they must be
# uploaded. Building it as data (rather than uploading as we walk) is what
# lets --print-plan and the tests see exactly what a run would write.
build_plan() {
    local f name
    for f in "$dir"/*; do
        [ -f "$f" ] || continue
        name=$(basename -- "$f")
        printf 'versioned\t%s/%s/%s\t%s\n' "$base" "$version" "$name" "$f"
    done | sort -t'	' -k2,2

    if [ -n "$aliases" ]; then
        while IFS=$'\t' read -r alias_name source_name; do
            [ -n "${alias_name:-}" ] || continue
            [ -f "$dir/$source_name" ] || die "alias $alias_name names $source_name, which is not in $dir"
            printf 'alias\t%s/latest/%s\t%s\n' "$base" "$alias_name" "$dir/$source_name"
        done < "$aliases"
    fi

    printf 'manifest\t%s/latest.json\t%s\n' "$base" "$manifest"

    local pair key file
    while IFS= read -r pair; do
        [ -n "${pair:-}" ] || continue
        key=${pair%%=*}; file=${pair#*=}
        [ -n "$key" ] && [ "$key" != "$pair" ] || die "--also wants key=file, got '$pair'"
        [ -f "$file" ] || die "--also $key names $file, which does not exist"
        printf 'manifest\t%s/%s\t%s\n' "$base" "$key" "$file"
    done <<EOF
$also
EOF
}

# --- publish ----------------------------------------------------------------

upload_one() { # phase key file
    local phase=$1 key=$2 file=$3 disposition
    local -a extra=()

    # An array, not `${var:+--flag "$var"}`: the value contains spaces and
    # would be split into several arguments, leaving aws to reject a stray
    # `filename="…"`.
    disposition=$(content_disposition_for "$phase" "$file")
    [ -n "$disposition" ] && extra=(--content-disposition "$disposition")

    "$AWS_BIN" s3api put-object \
        --bucket "$bucket" \
        --key "$key" \
        --body "$file" \
        --content-type "$(content_type_for "$key")" \
        --cache-control "$(cache_control_for_phase "$phase")" \
        ${extra[@]+"${extra[@]}"} \
        --output text --query ETag >/dev/null \
        || die "upload failed: $key"
}

# Read back what we just wrote, from the API. A wrong prefix, a truncated
# upload or a credential scoped to the wrong bucket all show up here.
verify_object() { # phase key file
    local phase=$1 key=$2 file=$3 read_back remote disposition local_size want
    # Size and download name in one head-object: the alias check is about a
    # header on the object we just wrote, not a second thing to go and fetch.
    read_back=$("$AWS_BIN" s3api head-object --bucket "$bucket" --key "$key" \
        --output text --query '[ContentLength,ContentDisposition]' 2>/dev/null) \
        || die "verify: $key is not in the bucket after upload"
    remote=$(printf '%s' "$read_back" | cut -f1)
    disposition=$(printf '%s' "$read_back" | cut -f2-)

    local_size=$(wc -c < "$file" | tr -d ' ')
    [ "$remote" = "$local_size" ] || die "verify: $key is $remote bytes in the bucket, $local_size locally"

    if [ "$phase" = alias ]; then
        # The whole of the versioned-filename behaviour is this one header, so
        # it is read back rather than assumed from having passed the flag. A
        # silent failure stays invisible until someone finds `mac.dmg` in their
        # Downloads folder with no way to tell which version it is.
        want=$(basename -- "$file")
        case $disposition in
            *"filename=\"$want\""*) ;;
            *) die "verify: $key would download as ${disposition:-its own key}, wanted $want" ;;
        esac
        note "  ok  $key ($local_size bytes, downloads as $want)"

        return 0
    fi

    note "  ok  $key ($local_size bytes)"
}

# Fetch the manifest over the public hostname and HEAD every URL in it. This
# is the check that catches a wrong prefix or a bucket that is not actually
# public — the two failures the API-side check cannot see. Every string
# anywhere in the document that starts with the public base is a URL the
# downloads page or an installed copy will follow, so all of them are tried.
verify_public() {
    [ -n "$public_base" ] || return 0
    local body urls url
    # The query string is part of Cloudflare's cache key, so this always
    # reaches the object we just wrote rather than a cached predecessor.
    body=$("$CURL_BIN" -fsS --max-time 30 "$public_base/$base/latest.json?_=$$") \
        || die "verify: cannot fetch $public_base/$base/latest.json"

    # shellcheck disable=SC2016  # the JS below is deliberately unexpanded
    urls=$(printf '%s' "$body" | PUBLIC_BASE="$public_base" "$NODE_BIN" -e '
        let raw = "";
        process.stdin.on("data", (c) => { raw += c; });
        process.stdin.on("end", () => {
            const m = JSON.parse(raw);
            if (!m.version || !m.builds || Object.keys(m.builds).length === 0) {
                console.error("manifest has no version/builds");
                process.exit(1);
            }
            const urls = new Set();
            const walk = (v) => {
                if (typeof v === "string") { if (v.startsWith(process.env.PUBLIC_BASE + "/")) urls.add(v); }
                else if (v && typeof v === "object") Object.values(v).forEach(walk);
            };
            walk(m);
            if (urls.size === 0) { console.error("manifest names no URL under the public base"); process.exit(1); }
            for (const u of urls) console.log(u);
        });
    ') || die "verify: the published manifest is not a usable downloads manifest"

    while IFS= read -r url; do
        [ -n "$url" ] || continue
        "$CURL_BIN" -fsS -I --max-time 30 "$url" >/dev/null || die "verify: $url in the manifest does not resolve"
        note "  ok  $url"
    done <<EOF
$urls
EOF
}

cmd_publish() {
    [ -n "$bucket" ] || die "--bucket is required"
    [ -n "$version" ] || die "--version is required"
    [ -n "$dir" ] || die "--dir is required"
    [ -n "$manifest" ] || die "--manifest is required"
    [ -d "$dir" ] || die "--dir '$dir' is not a directory"
    [ -f "$manifest" ] || die "--manifest '$manifest' does not exist"
    # Only two destinations exist. Anything else — including an empty or
    # half-built prefix, which is why this is a whole-string match and not a
    # prefix test — is refused before a single object is written.
    case $base in
        extension|extension/_dryrun/?*) ;;
        *) die "--base '${base}' is neither 'extension' nor 'extension/_dryrun/<run id>'" ;;
    esac

    local plan
    plan=$(build_plan) || exit 1

    if [ "$print_plan" = true ]; then
        printf '%s\n' "$plan"
        return 0
    fi

    [ -n "${AWS_ENDPOINT_URL:-}" ] || die "AWS_ENDPOINT_URL is not set (the R2 endpoint)"

    local phase key file last_phase=''
    while IFS=$'\t' read -r phase key file; do
        [ -n "${phase:-}" ] || continue
        if [ "$phase" != "$last_phase" ]; then
            note "-- $phase"
            last_phase=$phase
        fi
        upload_one "$phase" "$key" "$file"
        note "  put $key"
    done <<EOF
$plan
EOF

    note "-- verifying"
    while IFS=$'\t' read -r phase key file; do
        [ -n "${phase:-}" ] || continue
        verify_object "$phase" "$key" "$file"
    done <<EOF
$plan
EOF
    verify_public
    note "published $version to $base"
}

main() {
    [ $# -ge 1 ] || die "usage: publish-r2.sh publish [options]"
    local command=$1; shift
    parse_args "$@"
    case $command in
        publish) cmd_publish ;;
        *) die "unknown command '$command'" ;;
    esac
}

# Sourcing this file (as the tests do) defines the helpers without running
# anything; executing it runs main.
case ${0##*/} in
    publish-r2.sh) main "$@" ;;
esac
