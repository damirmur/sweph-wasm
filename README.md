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

## Прикладной слой (`src/astro.js`)

Порт `pkg/astro` (swisseph_build): натал, синастрия, транзитный период,
аспекты, баланс, дома. Структуры ответа совпадают с `/api/v1/*`, поэтому
результат можно подставить вместо серверного.

```js
import { computeNatalPeriod } from './src/astro.js';

const res = await computeNatalPeriod(swe, {
  natal: { jd: natalJd, lat: 55.75, lon: 37.61 },
  startJd, endJd, startMs, stepHours: 24, maxOrb: 1,
  refine: 'newton',            // 'golden' — паритет с сервером, 'newton' — скорость
  timeZone: 'Europe/Moscow',
});
// res.natal, res.transits, res.aspects — как в /api/v1/natal-period
```

- `golden` — золотое сечение по секундной сетке, даты совпадают с сервером
  в пределах 1 с (паритетные тесты).
- `newton` — метод Ньютона, 4–6 вызовов вместо 20; даты отличаются до ~7 с,
  зато 1 год считается за 0,99 с даже при троттлинге ×6.

## Календарь

`src/calendar.js` — порт `pkg/astro/calendar.go`: ингрессии, станции, точные
аспекты, лунные дни и «Луна без курса» на том же wasm-движке. Год считается
один раз и кэшируется на странице; структура — компактные события
`{d,t,p,a,de,s,chS,end,r,h}` как в `/api/v1/calendar`.

```js
import { createCalendarClient } from './src/calendar.js';
const getCalendar = createCalendarClient(swe);
const events = await getCalendar({ year: 2030, month: 1, timeZone: 'UTC' });
```

## Замеры и паритет

```bash
npm i                 # playwright для замеров (браузеры уже в ~/.cache/ms-playwright)
node bench/bench.mjs         # Chromium, CPU throttling 1×/4×/6×, позиции и natal-period
node bench/parity.mjs        # wasm vs нативная сборка, max |Δ|
node bench/parity-astro.mjs  # клиентский слой vs golden-фикстуры astro3d-e2e
```

Результаты — [`BENCH.md`](BENCH.md).

## Лицензия

**AGPL-3.0** — см. [`LICENSE`](LICENSE). Внутри — Swiss Ephemeris 2.10.03
(© Astrodienst AG, авторы Dieter Koch и Alois Treindl), условия и Corresponding
Source — в [`NOTICE`](NOTICE).
