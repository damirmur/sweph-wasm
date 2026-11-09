# sweph-wasm

Swiss Ephemeris в WebAssembly для [astro3d.ru](https://astro3d.ru): bulk-расчёты
позиций планет за период без JSON на каждый шаг. C-цикл пишет в типизированные
массивы, JS выделяет память и копирует результат; расчёт идёт в Web Worker с
прогрессом и отменой.

Репозиторий — spike/движок, а не готовый клиент: логика карт, аспектов и событий
остаётся в `astro-core` / будущем клиентском слое.

## Сборка

Нужны `emcc` (emsdk), `gcc`, `node` 18+.

```bash
./scripts/build-wasm.sh      # dist/sweph.{mjs,wasm,data} + ephe/ (2 МБ)
./scripts/build-native.sh    # dist/native/astro-bench — эталон для паритета
```

`prepare-ephe.sh` берёт `sepl_18.se1`, `semo_18.se1`, `seas_18.se1` из локального
каталога `/home/dmyr/app/data/ephe`, иначе качает с `astro.com`. В git эфемериды
не хранятся.

## Использование

```js
import createModule from './dist/sweph.mjs';
import { createSweph, DEFAULT_PLANETS } from './src/sweph.js';

const swe = await createSweph(createModule, { ephePath: '/ephe' });
const startJd = swe.utcToJd({ year: 2026, month: 1, day: 1 });
const res = await swe.period({
  startJd, stepDays: 1, steps: 365, planets: DEFAULT_PLANETS,
  onProgress: ({ done, total }) => console.log(done, '/', total),
});
// res.lon / res.lat / res.speed — Float64Array(steps * planets.length)
```

В Worker — `web/worker.js`: сообщения `init` / `calc` / `cancel`, обратно
`ready` / `progress` / `done` / `error`.

## Замеры и паритет

```bash
npm i                 # playwright для замеров (браузеры уже в ~/.cache/ms-playwright)
node bench/bench.mjs  # Chromium, CPU throttling 1×/4×/6×, 1/5/10 лет
node bench/parity.mjs # wasm vs нативная сборка, max |Δ| по долготе/широте/скорости
```

Результаты первого прогона — [`BENCH.md`](BENCH.md).

## Лицензия

**AGPL-3.0** — см. [`LICENSE`](LICENSE). Внутри — Swiss Ephemeris 2.10.03
(© Astrodienst AG, авторы Dieter Koch и Alois Treindl), условия и Corresponding
Source — в [`NOTICE`](NOTICE).
