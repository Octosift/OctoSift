#!/usr/bin/env bash
#
# Scan files for secrets and private details before they are committed.
#
# Usage:
#   scripts/leakcheck.sh          check the staged version of every staged file
#   scripts/leakcheck.sh --all    check every tracked or untracked, non-ignored file
#
# Fails on private key headers, common API key shapes, e-mail addresses outside
# the reserved example domains, and absolute home-directory paths. When
# LEAKCHECK_DENYLIST names a file, every line in it (one extended regular
# expression per line, case-insensitive; blank lines and lines starting with #
# are ignored) is also forbidden, in file contents and in file names.
#
# Findings are reported as file:line with the rule name only. The matching
# text is never printed, so a secret is not copied into terminal logs.

set -euo pipefail

mode="staged"
if [[ "${1:-}" == "--all" ]]; then
  mode="all"
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--all]" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Work inside the git directory so the scratch files never show up as
# untracked files in the scan itself.
git_dir="$(git rev-parse --absolute-git-dir)"
scratch="$(mktemp -d "${git_dir}/leakcheck.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

files_list="$scratch/files"
content_root="$scratch/content"
mkdir -p "$content_root"

if [[ "$mode" == "staged" ]]; then
  git diff --cached --name-only --diff-filter=ACMR -z >"$files_list"
  if [[ -s "$files_list" ]]; then
    # Export the staged blobs, so the check sees what will be committed rather
    # than whatever is currently in the working tree.
    xargs -0 git checkout-index --prefix="$content_root/" -- <"$files_list"
  fi
else
  git ls-files -z --cached --others --exclude-standard >"$files_list"
  while IFS= read -r -d '' path; do
    [[ -f "$path" ]] || continue
    mkdir -p "$content_root/$(dirname "$path")"
    cp "$path" "$content_root/$path"
  done <"$files_list"
fi

findings="$scratch/findings"
: >"$findings"

# Print "file:line" for every match of an extended regex, without the text.
report_matches() {
  local rule="$1" pattern="$2"
  (cd "$content_root" && grep -rIEn -- "$pattern" . 2>/dev/null || true) |
    awk -F: -v rule="$rule" '{ sub(/^\.\//, "", $1); print rule ": " $1 ":" $2 }' >>"$findings"
}

report_matches "private key" '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----'
report_matches "API key" '(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}'
report_matches "AWS access key" 'AKIA[0-9A-Z]{16}'
report_matches "Slack token" 'xox[bap]-[A-Za-z0-9-]{10,}'
report_matches "GitHub token" 'ghp_[A-Za-z0-9]{36}'
report_matches "bearer token" 'Bearer [A-Za-z0-9+/=._-]{20,}'
report_matches "home directory path" '/(Users|home)/'

# E-mail addresses are allowed only on reserved example domains.
(cd "$content_root" &&
  grep -rIEon -- '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' . 2>/dev/null ||
  true) |
  awk -F: '{
    address = tolower($3)
    domain = substr(address, index(address, "@") + 1)
    if (domain ~ /(^|\.)(example\.com|example\.invalid|octosift\.invalid)$/) next
    sub(/^\.\//, "", $1)
    print "e-mail address: " $1 ":" $2
  }' >>"$findings"

if [[ -n "${LEAKCHECK_DENYLIST:-}" ]]; then
  if [[ ! -r "$LEAKCHECK_DENYLIST" ]]; then
    echo "leakcheck: the denylist named by LEAKCHECK_DENYLIST cannot be read" >&2
    exit 1
  fi
  patterns="$scratch/denylist"
  grep -vE '^[[:space:]]*(#|$)' "$LEAKCHECK_DENYLIST" >"$patterns" || true
  if [[ -s "$patterns" ]]; then
    status=0
    (cd "$content_root" && grep -rIEin -f "$patterns" . 2>/dev/null) >"$scratch/deny-hits" || status=$?
    if [[ $status -gt 1 ]]; then
      echo "leakcheck: the denylist could not be applied (invalid pattern?)" >&2
      exit 1
    fi
    awk -F: '{ sub(/^\.\//, "", $1); print "denylisted term: " $1 ":" $2 }' \
      "$scratch/deny-hits" >>"$findings"
    # Only the count is reported: printing the name would print the term.
    name_hits="$(tr '\0' '\n' <"$files_list" | { grep -ciE -f "$patterns" || true; })"
    if [[ "$name_hits" -gt 0 ]]; then
      echo "denylisted term in file names: $name_hits file(s)" >>"$findings"
    fi
  fi
fi

if [[ -s "$findings" ]]; then
  echo "leakcheck: possible secrets or private details found:" >&2
  sort -u "$findings" >&2
  echo "leakcheck: remove them before committing." >&2
  exit 1
fi

echo "leakcheck: clean ($mode)"
