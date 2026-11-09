#!/usr/bin/env bash
# build-wasm.sh — сборка Swiss Ephemeris в WebAssembly (ES-модуль + .wasm + .data).
#
#   EMSDK_DIR=/path/to/emsdk ./scripts/build-wasm.sh
#
# Требует emcc (emsdk). Эфемериды кладутся в ephe/ и вшиваются в sweph.data
# через --preload-file (2 МБ, в браузере читаются из MEMFS по /ephe).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

"$root/scripts/prepare-ephe.sh"

if ! command -v emcc >/dev/null 2>&1; then
	emsdk_dir="${EMSDK_DIR:-/tmp/opencode/emsdk}"
	if [ -f "$emsdk_dir/emsdk_env.sh" ]; then
		# shellcheck disable=SC1090
		source "$emsdk_dir/emsdk_env.sh" >/dev/null 2>&1
	fi
fi
if ! command -v emcc >/dev/null 2>&1; then
	echo "нет emcc: установите emsdk и повторите (EMSDK_DIR=…)" >&2
	exit 1
fi

mkdir -p dist

# shellcheck disable=SC2086
emcc -O3 \
	src/astro_wasm.c \
	third_party/swisseph/swedate.c \
	third_party/swisseph/swehouse.c \
	third_party/swisseph/swejpl.c \
	third_party/swisseph/swemmoon.c \
	third_party/swisseph/swemplan.c \
	third_party/swisseph/sweph.c \
	third_party/swisseph/swephlib.c \
	third_party/swisseph/swecl.c \
	third_party/swisseph/swehel.c \
	-Ithird_party/swisseph/include \
	-o dist/sweph.mjs \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createSwephModule \
	-sENVIRONMENT=web,worker,node \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=67108864 \
	-sSTACK_SIZE=1048576 \
	-sFORCE_FILESYSTEM=1 \
	-sEXPORTED_FUNCTIONS=_astro_init,_astro_utc_to_jd,_astro_period,_astro_positions,_astro_house_pos,_astro_natal,_astro_houses,_astro_version,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF64,HEAP32 \
	--preload-file ephe@/ephe

ls -lh dist/sweph.mjs dist/sweph.wasm dist/sweph.data 2>/dev/null || ls -lh dist/
