#!/usr/bin/env bash
# DSH-UI installer for macOS and Linux.
#
# Downloads the official DeepSeek Harness source at the commit pinned in dsh-ui.json, applies
# patches/dsh-ui.patch, installs dependencies and builds with a private Node and pnpm, writes the
# launcher, then installs the community plugins listed in dsh-ui.json that the profile lacks.
# Re-running is safe: a finished install of the same version is detected and skipped, and an
# interrupted one resumes.
#
# Every expansion next to Chinese text is braced: macOS's bash 3.2 in a UTF-8 locale would
# otherwise read the first byte of a full-width character as part of the variable name.
set -euo pipefail

usage() {
  cat <<'EOF'
用法: install.sh [选项]

  --dir <目录>       安装目录，默认 ~/.dsh-ui
  --home <目录>      DSH 数据目录（DSH_HOME）。默认沿用上次安装记下的目录；第一次安装用 <安装目录>/data；已有目录会先备份
  --profile <名称>   插件装进哪个配置。默认沿用上次的；第一次安装用 web
  --skip-plugins     不装社区插件
  --prepare-only     只下载源码并打补丁，不装依赖、不构建；之后再运行一次本脚本会接着装
  --force            同一版本已装好也重新下载构建（旧目录改名保留）
  -h, --help         显示这段说明

环境变量:
  DSH_UI_TARBALL_URL  官方源码包的下载地址，换镜像时用
  DSH_UI_NODE_MIRROR  Node 安装包的下载根地址，默认 https://nodejs.org/dist
  DSH_UI_REPO_URL     本仓库源码包的下载地址，单独下载本脚本运行时用
EOF
}

say() { printf '%s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "需要 ${1}，请先安装"; }
# macOS without the Command Line Tools has stub git and cc that only open an install prompt.
usable() { "$1" --version >/dev/null 2>&1; }

INSTALL_ARGS=("$@")
DIR="$HOME/.dsh-ui"
HOME_ARG=""
PROFILE_ARG=""
SKIP_PLUGINS=no
PREPARE_ONLY=no
FORCE=no
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || die "--dir 需要一个目录"; DIR="$2"; shift 2 ;;
    --home) [ $# -ge 2 ] || die "--home 需要一个目录"; HOME_ARG="$2"; shift 2 ;;
    --profile) [ $# -ge 2 ] || die "--profile 需要一个名称"; PROFILE_ARG="$2"; shift 2 ;;
    --skip-plugins) SKIP_PLUGINS=yes; shift ;;
    --prepare-only) PREPARE_ONLY=yes; shift ;;
    --force) FORCE=yes; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "不认识的参数 ${1}（--help 查看用法）" ;;
  esac
done

# Binary additions/deletions in the release patch require git apply; POSIX patch cannot apply them.
usable git || die "需要可用的 Git（git --version 必须成功）：发行补丁包含二进制文件变更，不能使用 patch 替代。macOS 请安装 Xcode 命令行工具（xcode-select --install）；Linux 请安装 git。"

# Run from a checkout of this repository; when piped from curl, fetch the repository first.
ROOT=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ -z "$ROOT" ] || [ ! -f "$ROOT/dsh-ui.json" ]; then
  need curl; need tar
  REPO_URL="${DSH_UI_REPO_URL:-https://codeload.github.com/iroha1145/DSH-Modern-UI/tar.gz/main}"
  FETCHED="$(mktemp -d)"
  trap 'rm -rf "$FETCHED"' EXIT
  say "下载 DSH-UI 仓库 …"
  curl -fsSL --retry 3 "$REPO_URL" | tar -xz -C "$FETCHED" --strip-components 1
  bash "$FETCHED/scripts/install.sh" ${INSTALL_ARGS[@]+"${INSTALL_ARGS[@]}"}
  exit 0
fi
MANIFEST="$ROOT/dsh-ui.json"

# Values sit one per line in dsh-ui.json, so a plain match is enough before Node is available.
json_value() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$MANIFEST" | head -n 1; }
COMMIT="$(json_value commit)"
TARBALL_URL="${DSH_UI_TARBALL_URL:-$(json_value tarball)}"
TARBALL_SHA="$(json_value tarballSha256)"
PATCH_FILE="$ROOT/$(json_value file)"
PATCH_SHA="$(json_value sha256)"
NODE_VERSION="$(json_value runtime)"
PNPM_VERSION="$(json_value pnpm)"
[ -n "$COMMIT" ] && [ -n "$PATCH_SHA" ] && [ -n "$NODE_VERSION" ] && [ -n "$PNPM_VERSION" ] || die "读不懂 ${MANIFEST}"
[[ "$TARBALL_SHA" =~ ^[a-f0-9]{64}$ ]] || die "清单缺少有效的官方源码包校验值"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

need curl; need tar
[ "$(sha256_of "$PATCH_FILE")" = "$PATCH_SHA" ] || die "补丁文件的校验值不对，可能下载不完整或被改了换行符：${PATCH_FILE}"

# Resolve existing ancestors physically without creating the requested directory.
# Determine the actual containing directory's case rules, including Linux
# case-folded directories. Prefer existing entries; probe only an empty directory.
case_insensitive_dir() {
  local base="$1" entry name alternate candidate listed exact probe
  while [ ! -d "$base" ]; do base="$(dirname "$base")"; done
  for entry in "$base"/* "$base"/.[!.]* "$base"/..?*; do
    [ -e "$entry" ] && [ ! -L "$entry" ] || continue
    name="$(basename "$entry")"
    alternate="$(printf '%s' "$name" | LC_ALL=C tr '[:lower:]' '[:upper:]')"
    [ "$alternate" != "$name" ] || alternate="$(printf '%s' "$name" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
    [ "$alternate" != "$name" ] || continue
    candidate="${base%/}/$alternate"
    # Distinct hard links with different spelling are still case-sensitive.
    exact=no
    for listed in "$base"/* "$base"/.[!.]* "$base"/..?*; do
      [ "$listed" != "$candidate" ] || exact=yes
    done
    [ "$exact" = no ] || return 1
    [ "$entry" -ef "$candidate" ]; return
  done
  (
    probe=''
    trap '[ -z "$probe" ] || rmdir -- "$probe"' EXIT
    trap 'exit 2' HUP INT TERM
    probe="$(mktemp -d "${base%/}/.dsh-case-a-XXXXXXXX")" || exit 2
    candidate="${probe%/*}/$(basename "$probe" | LC_ALL=C tr '[:lower:]' '[:upper:]')"
    if [ "$probe" -ef "$candidate" ]; then result=0; else result=1; fi
    rmdir -- "$probe" || exit 2
    probe=''
    exit "$result"
  )
}
canonical_dir() {
  local path="$1" parent leaf target entry physical depth="${2:-0}"
  [ "$depth" -lt 80 ] || die "目录链接过深或循环：$path"
  case "$path" in /*) ;; *) path="$PWD/$path" ;; esac
  if [ -d "$path" ]; then
    physical="$(cd -P -- "$path" && pwd -P)" || return
    [ "$physical" = / ] && { printf '/\n'; return; }
    parent="$(canonical_dir "$(dirname "$physical")" "$((depth + 1))")" || return
    # pwd -P can retain caller casing on case-insensitive volumes. Recover the
    # actual directory entry by filesystem identity, without folding case on Linux.
    for entry in "${parent%/}"/* "${parent%/}"/.[!.]* "${parent%/}"/..?*; do
      if [ ! -L "$entry" ] && [ "$entry" -ef "$physical" ]; then
        printf '%s\n' "$entry"; return
      fi
    done
    # A parent that may be entered but not listed (a 0711 home or mount point)
    # hides its entries; keep the name pwd -P reported under the resolved parent.
    if [ ! -r "$parent" ] && [ "${parent%/}/${physical##*/}" -ef "$physical" ]; then
      printf '%s\n' "${parent%/}/${physical##*/}"; return
    fi
    die "无法确认目录的真实位置：$path（上级目录不可读，或该目录已不存在）"
  fi
  [ "$path" = / ] && { printf '/\n'; return; }
  path="${path%/}"
  parent="$(canonical_dir "$(dirname "$path")" "$((depth + 1))")" || return
  leaf="$(basename "$path")"
  case "$leaf" in .) printf '%s\n' "$parent"; return ;; ..) dirname "$parent"; return ;; esac
  path="${parent%/}/$leaf"
  if [ -L "$path" ]; then
    target="$(readlink "$path")"
    case "$target" in /*) ;; *) target="${parent%/}/$target" ;; esac
    canonical_dir "$target" "$((depth + 1))"
  elif [ -e "$path" ]; then die "数据路径不是目录：$path"
  else printf '%s\n' "$path"; fi
}
# Shell case conversion cannot model Unicode filename equivalence. For new paths
# containing non-ASCII bytes, compare empty replicas on the same filesystem.
probe_within() (
  local child="$1" parent="$2" common="$2" probe='' candidate target child_tail parent_tail result=1
  while :; do
    case "$child/" in "${common%/}/"*) [ -d "$common" ] && break ;; esac
    common="$(dirname "$common")"
  done
  child_tail="${child#"${common%/}/"}"
  parent_tail="${parent#"${common%/}/"}"
  # Never let a replica path escape the exclusively created probe directory.
  for candidate in "$child_tail" "$parent_tail"; do
    case "$candidate" in ''|/*|..|../*|*/../*|*/..) exit 2 ;; esac
  done
  trap '[ -z "$probe" ] || rm -rf -- "$probe"' EXIT
  trap 'exit 2' HUP INT TERM
  probe="$(mktemp -d "${common%/}/.dsh-path-XXXXXXXX")" || exit 2
  candidate="$probe/$child_tail"
  target="$probe/$parent_tail"
  mkdir -p -- "$candidate" "$target" || exit 2
  while [ "$candidate" != "$probe" ]; do
    if [ "$candidate" -ef "$target" ]; then result=0; break; fi
    candidate="$(dirname "$candidate")"
  done
  rm -rf -- "$probe" || exit 2
  probe=''
  exit "$result"
)
within() {
  local LC_ALL=C child="$1" parent="$2" folded_child folded_parent common result existing_child existing_parent
  case "$child/" in "${parent%/}/"*) return 0 ;; esac
  # canonical_dir already resolves every existing component. New tails below
  # different physical ancestors cannot become aliases across those branches.
  # In particular, an independent external home never needs writes at / or /Users.
  existing_child="$child"
  existing_parent="$parent"
  while [ ! -d "$existing_child" ]; do existing_child="$(dirname "$existing_child")"; done
  while [ ! -d "$existing_parent" ]; do existing_parent="$(dirname "$existing_parent")"; done
  [ "$existing_child" -ef "$existing_parent" ] || return 1
  folded_child="$(printf '%s' "$child" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  folded_parent="$(printf '%s' "$parent" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  case "$folded_child/" in
    "${folded_parent%/}/"*) ;;
    *)
      # Existing physical paths already have their real spelling. Only missing
      # paths with non-ASCII names require the filesystem equivalence probe.
      if [ ! -d "$child" ] || [ ! -d "$parent" ]; then
        case "$child$parent" in
          *[!\ -~]*)
            if probe_within "$child" "$parent"; then return 0; else result=$?; fi
            [ "$result" -eq 1 ] || die "无法检查目录的真实关系"
            ;;
        esac
      fi
      return 1 ;;
  esac
  # Only unresolved case aliases need a volume check. Keep the requested spelling.
  common="$parent"
  while :; do
    case "$child/" in "${common%/}/"*) break ;; esac
    common="$(dirname "$common")"
  done
  if case_insensitive_dir "$common"; then return 0; else result=$?; fi
  [ "$result" -eq 1 ] || die "无法检查目录的大小写规则：$common"
  return 1
}
DIR="$(canonical_dir "$DIR")"

# The install directory holds only what this script writes; refuse to spread into anything else.
if [ -d "$DIR" ]; then
  for entry in "$DIR"/* "$DIR"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "$(basename "$entry")" in
      data|data-backups|install.conf|install.conf.tmp|runtime|dsh|dsh.old-*|dsh-ui|dsh-ui.state|launch.conf|launch.conf.tmp|overlays|upstream-*.tar.gz|upstream-*.tar.gz.part) ;;
      *) die "${DIR} 里已经有别的文件（$(basename "$entry")），不像是 DSH-UI 的安装目录。换一个 --dir" ;;
    esac
  done
fi
RUNTIME="$DIR/runtime"
DSH="$DIR/dsh"
STATE_FILE="$DIR/dsh-ui.state"
STAMP="$COMMIT $PATCH_SHA"

# A rerun keeps the data directory and profile recorded by the previous install.
DSH_UI_HOME=""
DSH_UI_PROFILE=""
if [ -f "$DIR/launch.conf" ]; then
  # shellcheck disable=SC1091 # written by this script
  . "$DIR/launch.conf"
fi
# Desired install settings survive prepare-only and failed builds; launch.conf stays active.
if [ -f "$DIR/install.conf" ]; then
  . "$DIR/install.conf"
fi
HOME_DIR="${HOME_ARG:-${DSH_UI_HOME:-$DIR/data}}"
PROFILE="${PROFILE_ARG:-${DSH_UI_PROFILE:-$(json_value profile)}}"
HOME_DIR="$(canonical_dir "$HOME_DIR")"
within "$DIR" "$HOME_DIR" && die "数据目录不能包含安装目录；无法安全备份"
if within "$HOME_DIR" "$DIR" && ! within "$HOME_DIR" "$DIR/data"; then
  die "数据目录不能位于安装器管理的目录；安装目录内只能使用 data 子目录"
fi
# Also check managed directories that themselves point outside the install root.
for managed in "$DIR/runtime" "$DIR/dsh" "$DIR/data-backups" "$DIR/overlays" "$DIR"/dsh.old-*; do
  managed="$(canonical_dir "$managed")"
  if within "$HOME_DIR" "$managed" || within "$managed" "$HOME_DIR"; then
    die "数据目录不能与安装器管理的目录重叠：$managed"
  fi
done
mkdir -p "$DIR" "$HOME_DIR"
# Snapshot existing data before any plugin or application can write the new event vocabulary.
# Stop all DSH processes using this home before running the installer.
if [ ! -f "$DIR/install.conf" ] || [ -n "$HOME_ARG" ]; then
  if [ -n "$(ls -A "$HOME_DIR")" ]; then
    mkdir -p "$DIR/data-backups"
    backup="$(mktemp -d "$DIR/data-backups/home-XXXXXXXX")"
    tar -czf "$backup/data.tar.gz.part" -C "$HOME_DIR" .
    mv "$backup/data.tar.gz.part" "$backup/data.tar.gz"
    say "数据备份：${backup}/data.tar.gz；回退前请先停止所有使用此目录的 DSH"
  fi
fi
{
  printf 'DSH_UI_HOME=%q\n' "$HOME_DIR"
  printf 'DSH_UI_PROFILE=%q\n' "$PROFILE"
} > "$DIR/install.conf.tmp"
mv "$DIR/install.conf.tmp" "$DIR/install.conf"


state="$(cat "$STATE_FILE" 2>/dev/null || true)"
will_build=yes
if [ "$PREPARE_ONLY" = yes ] || { [ "$FORCE" = no ] && [ "$state" = "done $STAMP" ]; }; then
  will_build=no
fi
if [ "$will_build" = yes ] && ! usable cc; then
  case "$(uname -s)" in
    Darwin) die "构建要用 C 编译器。请先运行 xcode-select --install 装好命令行工具，再重跑本脚本" ;;
    *) die "构建要用 C 编译器。请先装好 gcc 或 clang（例如 Debian/Ubuntu 的 build-essential），再重跑本脚本" ;;
  esac
fi

free_kb="$(df -Pk "$DIR" | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ] && [ "$free_kb" -lt 4194304 ]; then
  say "提示: ${DIR} 所在磁盘只剩 $((free_kb / 1024)) MB，完整安装大约需要 3 GB。"
fi

# Private Node from the official release (it carries the headers the native addon build needs,
# and npm), checked against the release's SHASUMS256.txt; pnpm is pinned next to it.
case "$(uname -s)" in
  Darwin) node_os=darwin ;;
  Linux) node_os=linux ;;
  *) die "不支持的系统 $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) node_arch=arm64 ;;
  x86_64|amd64) node_arch=x64 ;;
  *) die "不支持的处理器架构 $(uname -m)" ;;
esac
NODE_DIR="$RUNTIME/node"
NODE_BIN="$NODE_DIR/bin/node"
mkdir -p "$RUNTIME"
runtime_valid() {
  [ -x "$1/bin/node" ] && [ -x "$1/bin/npm" ] && [ -f "$1/lib/node_modules/npm/bin/npm-cli.js" ] &&
    [ -f "$1/include/node/node.h" ] && [ -f "$1/include/node/node_api.h" ] && [ -f "$1/include/node/node_api_types.h" ] && [ -f "$1/include/node/common.gypi" ] &&
    [ "$("$1/bin/node" -p 'process.versions.node' 2>/dev/null || true)" = "$NODE_VERSION" ] &&
    "$1/bin/node" "$1/lib/node_modules/npm/bin/npm-cli.js" --version >/dev/null 2>&1 &&
    PATH="$1/bin:$PATH" "$1/bin/npm" --version >/dev/null 2>&1
}
# Recover a switch interrupted after the old runtime was moved aside.
if [ ! -e "$NODE_DIR" ] && [ -d "$RUNTIME/node.previous" ]; then
  mv "$RUNTIME/node.previous" "$NODE_DIR"
fi
if ! runtime_valid "$NODE_DIR" || [ "$(cat "$NODE_DIR/.complete" 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  node_name="node-v${NODE_VERSION}-${node_os}-${node_arch}"
  node_base="${DSH_UI_NODE_MIRROR:-https://nodejs.org/dist}/v${NODE_VERSION}"
  stage="$(mktemp -d "$RUNTIME/node-stage-XXXXXXXX")"
  trap 'rm -rf "$stage"' EXIT
  say "下载 Node ${NODE_VERSION} …"
  curl -fL --retry 3 -o "$stage/archive.tar.gz" "${node_base}/${node_name}.tar.gz"
  expected="$(curl -fsSL --retry 3 "${node_base}/SHASUMS256.txt" | awk -v f="${node_name}.tar.gz" '$2 == f {print $1}')"
  [ -n "$expected" ] && [ "$(sha256_of "$stage/archive.tar.gz")" = "$expected" ] || die "Node 安装包的校验值对不上；原运行时已保留，重跑安装器可重试"
  mkdir "$stage/node"
  tar -xzf "$stage/archive.tar.gz" -C "$stage/node" --strip-components 1
  runtime_valid "$stage/node" || die "Node 运行时缺少可用的 node、npm 或编译头文件；原运行时已保留"
  printf '%s\n' "$NODE_VERSION" > "$stage/node/.complete"
  rm -rf "$RUNTIME/node.previous"
  if [ -e "$NODE_DIR" ]; then mv "$NODE_DIR" "$RUNTIME/node.previous"; fi
  if ! mv "$stage/node" "$NODE_DIR"; then
    [ ! -d "$RUNTIME/node.previous" ] || mv "$RUNTIME/node.previous" "$NODE_DIR"
    die "Node 切换失败；请重跑安装器"
  fi
  rm -rf "$stage"
  trap - EXIT
fi
export PATH="$NODE_DIR/bin:$RUNTIME/node_modules/.bin:$PATH"
if [ ! -x "$RUNTIME/node_modules/.bin/pnpm" ] || [ "$("$RUNTIME/node_modules/.bin/pnpm" -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  say "安装 pnpm ${PNPM_VERSION} …"
  "$NODE_DIR/bin/npm" install --prefix "$RUNTIME" --no-audit --no-fund --loglevel=error "pnpm@${PNPM_VERSION}"
fi
say "Node $("$NODE_BIN" -v)，pnpm $(pnpm -v)"

# DSH source: download, patch, install dependencies, build. dsh-ui.state records how far a
# previous run got, so an interrupted install resumes and a finished one is not repeated.
if [ "$FORCE" = no ] && [ "$state" = "done $STAMP" ]; then
  say "DSH-UI 这个版本已经装好，跳过下载和构建"
else
  if [ "$FORCE" = no ] && { [ "$state" = "prepared $STAMP" ] || [ "$state" = "building $STAMP" ]; }; then
    say "接着上次准备好的源码继续"
  else
    if [ -e "$DSH" ]; then
      case "$state" in
        extracting*|prepared*|building*)
          rm -rf "$DSH" ;;
        done*)
          [ "$FORCE" = yes ] || die "${DSH} 里装的是另一个版本。加 --force 重新安装，旧目录会改名保留"
          # Reserve a unique sibling even when several reinstalls share a second.
          backup="$(mktemp -d "$DSH.old-$(date +%Y%m%d%H%M%S)-XXXXXXXX")"
          rmdir -- "$backup"
          mv "$DSH" "$backup"
          say "旧目录已改名为 ${backup}，确认新版本没问题后可以删掉" ;;
        *)
          die "${DSH} 已经存在，但不是本安装器建的，为安全起见不覆盖。换一个 --dir，或先把它移走" ;;
      esac
    fi
    tarball="$DIR/upstream-$COMMIT.tar.gz"
    if [ ! -s "$tarball" ]; then
      say "下载官方 DeepSeek Harness 源码（${COMMIT}）…"
      curl -fL --retry 3 -o "$tarball.part" "$TARBALL_URL"
      mv "$tarball.part" "$tarball"
    fi
    if [ "$(sha256_of "$tarball")" != "$TARBALL_SHA" ]; then
      rm -f "$tarball"
      die "官方源码包的校验值不对；已清除不完整缓存，重新运行安装器可重试"
    fi
    got="$(gzip -dc "$tarball" | git get-tar-commit-id 2>/dev/null || true)"
    if [ -n "$got" ] && [ "$got" != "$COMMIT" ]; then
      rm -f "$tarball"
      die "下载到的源码包对应提交 ${got}，不是 ${COMMIT}"
    fi
    printf 'extracting %s\n' "$STAMP" > "$STATE_FILE"
    mkdir -p "$DSH"
    tar -xzf "$tarball" -C "$DSH" --strip-components 1
    say "打补丁 …"
    # The ceiling keeps git from treating an enclosing repository as the patch root; the
    # config keeps the patched files byte for byte, including binary file deletions.
    (cd "$DSH" && GIT_CEILING_DIRECTORIES="$DIR" git -c core.autocrlf=false -c core.eol=lf \
      apply --whitespace=nowarn "$PATCH_FILE")
    printf 'prepared %s\n' "$STAMP" > "$STATE_FILE"
    rm -f "$tarball"
  fi
  if [ "$PREPARE_ONLY" = yes ]; then
    say "源码已准备好：${DSH}。再运行一次本脚本（不带 --prepare-only）会接着装依赖和构建"
    exit 0
  fi
  printf 'building %s\n' "$STAMP" > "$STATE_FILE"
  say "安装依赖并构建（第一次要几分钟）…"
  # lefthook's install hook needs a git checkout; this tree is a plain download.
  (cd "$DSH" && LEFTHOOK=0 pnpm install --frozen-lockfile \
    && GIT_CEILING_DIRECTORIES="$DIR" DSH_CLIENT_COMMIT_HASH="$COMMIT" pnpm run build)
  printf 'done %s\n' "$STAMP" > "$STATE_FILE"
fi

if [ "$PREPARE_ONLY" = yes ]; then
  exit 0
fi

# The launcher comes before the plugins, so it exists even when a plugin step needs fixing.
cp "$ROOT/scripts/launch.sh" "$DIR/dsh-ui"
chmod +x "$DIR/dsh-ui"
{
  printf 'DSH_UI_HOME=%q\n' "$HOME_DIR"
  printf 'DSH_UI_PROFILE=%q\n' "$PROFILE"
} > "$DIR/launch.conf.tmp"
mv "$DIR/launch.conf.tmp" "$DIR/launch.conf"

if [ "$SKIP_PLUGINS" = no ]; then
  "$NODE_BIN" "$ROOT/scripts/plugins.mjs" --dsh "$DSH" --home "$HOME_DIR" --profile "$PROFILE" --manifest "$MANIFEST"
fi

say ""
say "装好了。启动：${DIR}/dsh-ui"
say "它会打印一个带 token 的本机地址，用浏览器打开即可。数据目录：${HOME_DIR}"
