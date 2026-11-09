#!/usr/bin/env bash
# prepare-ephe.sh — файлы эфемерид для wasm (sepl/semo/seas, 1800–2399, ~2 МБ).
#
# Берём локальную копию (общий каталог с astro-core), иначе качаем с astro.com.
# Каталог ephe/ в git не хранится: это данные Astrodienst, а не наш код.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dst="$root/ephe"
src="${EPHE_SRC:-/home/dmyr/app/data/ephe}"
files=(sepl_18.se1 semo_18.se1 seas_18.se1)

mkdir -p "$dst"
for f in "${files[@]}"; do
	if [ -s "$dst/$f" ]; then
		continue
	fi
	if [ -s "$src/$f" ]; then
		cp "$src/$f" "$dst/$f"
		echo "эфемериды: $f (локально из $src)"
	else
		curl -fsSL --max-time 120 "https://www.astro.com/ftp/swisseph/ephe/$f" -o "$dst/$f"
		echo "эфемериды: $f (скачано с astro.com)"
	fi
done
du -sh "$dst"
