#!/usr/bin/env bash
# build-native.sh — нативная сборка той же обёртки: эталон для проверки паритета.
#
#   ./scripts/build-native.sh
#   ./dist/native/astro-bench ephe <jd_start> <step_days> <steps> <id> [id...]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

mkdir -p dist/native
gcc -O2 -fPIC -Ithird_party/swisseph/include \
	bench/native_cli.c \
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
	-lm -o dist/native/astro-bench

echo "собрано: dist/native/astro-bench"
