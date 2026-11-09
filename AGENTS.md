# AGENTS.md — sweph-wasm

Swiss Ephemeris 2.10.03 в WebAssembly: bulk-расчёты периодов для astro3d.ru.
Код, комментарии и тексты — по-русски.

## Что внутри

| Путь | Что |
|---|---|
| `third_party/swisseph/` | 9 `.c` из upstream `v2.10.3final` + `include/*.h` (не менять вручную) |
| `src/astro_wasm.c` | C-обёртка: `astro_init`, `astro_utc_to_jd`, `astro_period`, `astro_positions`, `astro_house_pos`, `astro_natal`, `astro_houses`, `astro_version` |
| `src/sweph.js` | ES-обёртка: память, пачки, прогресс, отмена, типизированные массивы |
| `src/astro.js` | прикладной слой: натал, синастрия, natal-period, аспекты, баланс, дома |
| `web/worker.js` | Worker: `init` / `calc` / `cancel` → `ready` / `progress` / `done` / `error` |
| `web/bench.html`, `web/bench.js` | стенд для Playwright |
| `bench/bench.mjs` | Chromium + CPU throttling 1×/4×/6×, позиции и natal-period |
| `bench/parity.mjs` | wasm vs нативная сборка той же обёртки |
| `bench/parity-astro.mjs` | клиентский слой vs golden-фикстуры astro3d-e2e |
| `bench/native_cli.c` | нативный CLI для паритета |

## Сборка и проверка

```bash
./scripts/build-wasm.sh      # emcc, dist/sweph.{mjs,wasm,data}
./scripts/build-native.sh    # gcc, dist/native/astro-bench
node bench/parity.mjs        # max |Δ| wasm vs native, порог 1e-9°
node bench/parity-astro.mjs  # клиентский слой vs golden-фикстуры astro3d-e2e
node bench/bench.mjs         # замеры в Chromium (нужен playwright)
```

`emcc` берётся из `EMSDK_DIR` (по умолчанию `/tmp/opencode/emsdk`); если его нет —
`git clone https://github.com/emscripten-core/emsdk && ./emsdk install latest`.

## Правила

- Версия SE фиксируется тегом `v2.10.3final`: менять `third_party/swisseph` и
  `include/` только вместе, затем прогонять `bench/parity.mjs` — паритет с
  нативной сборкой должен остаться на уровне 1e-9°.
- Эфемериды `.se1` в git не хранятся (данные Astrodienst, ~2 МБ); их готовит
  `scripts/prepare-ephe.sh`.
- В C-цикле никаких аллокаций и JSON: только запись в переданные массивы.
  Всё, что можно посчитать в JS (аспекты, форматирование), — не в C.
- Между пачками `sweph.js` уступает событийный цикл только при наличии
  `AbortSignal` — иначе замер перестаёт быть чистым.
- `computeNatalPeriod` по умолчанию `refine: 'golden'` — это паритет с сервером
  (±1 с). `refine: 'newton'` быстрее в ~3 раза, но даёт до ±7 с и может
  добавить/убрать событие на границе периода; для golden-тестов его не включать.
- Любая правка `src/astro.js` проверяется `node bench/parity-astro.mjs`:
  натал, синастрия и natal-period должны совпасть с эталонами (1e-3°, даты ±1 с).
- Лицензия AGPL-3.0; любые новые бинарники (wasm, .data) должны сопровождаться
  исходниками этого репозитория и `NOTICE`.
