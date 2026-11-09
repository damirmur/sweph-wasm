/**
 * sweph.js — обёртка над wasm-сборкой Swiss Ephemeris.
 *
 * Задача: считать позиции планет за период пачками, без JSON на каждый шаг.
 * C-цикл пишет в типизированные массивы, JS только выделяет память и копирует
 * результат. Пачки (chunkSteps) дают прогресс и отмену между вызовами.
 *
 *   import createModule from '../dist/sweph.mjs';
 *   import { createSweph } from './sweph.js';
 *   const swe = await createSweph(createModule);
 *   const res = await swe.period({ startJd, steps: 365, planets: [0, 1, 2] });
 *
 * Единицы: jd — юлианская дата UT, шаг — сутки, долготы/скорости — градусы.
 */

/** Идентификаторы планет Swiss Ephemeris (совпадают с pkg/astro). */
export const PLANETS = Object.freeze({
	sun: 0,
	moon: 1,
	mercury: 2,
	venus: 3,
	mars: 4,
	jupiter: 5,
	saturn: 6,
	uranus: 7,
	neptune: 8,
	pluto: 9,
	node: 10,
	lilith: 12,
});

/** Рабочий набор по умолчанию — 12 тел, как в astro-core. */
export const DEFAULT_PLANETS = Object.freeze([
	PLANETS.sun, PLANETS.moon, PLANETS.mercury, PLANETS.venus, PLANETS.mars,
	PLANETS.jupiter, PLANETS.saturn, PLANETS.uranus, PLANETS.neptune,
	PLANETS.pluto, PLANETS.node, PLANETS.lilith,
]);

const HOURS_PER_DAY = 24;

/** Пишет C-строку в память модуля, возвращает указатель (освобождать вручную). */
function writeCString(mod, value) {
	const bytes = new TextEncoder().encode(String(value) + '\0');
	const ptr = mod._malloc(bytes.length);
	mod.HEAPU8.set(bytes, ptr);
	return ptr;
}

/** Копирует C-строку из памяти модуля. */
function readCString(mod, ptr, maxLen = 256) {
	const bytes = new Uint8Array(mod.HEAPU8.buffer, ptr, maxLen);
	let end = bytes.indexOf(0);
	if (end < 0) end = maxLen;
	return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Создаёт обёртку.
 * @param {Function} factory — эмскриптеновский модуль (default export dist/sweph.mjs)
 * @param {{ephePath?: string, chunkSteps?: number}} [opts]
 */
export async function createSweph(factory, opts = {}) {
	const mod = await factory(opts.moduleOptions ?? {});
	const ephePath = opts.ephePath ?? '/ephe';
	const defaultChunk = opts.chunkSteps ?? 64;

	const pathPtr = writeCString(mod, ephePath);
	mod._astro_init(pathPtr);
	mod._free(pathPtr);

	const versionPtr = mod._malloc(256);
	mod._astro_version(versionPtr);
	const version = readCString(mod, versionPtr);
	mod._free(versionPtr);

	/** UTC → юлианская дата UT (leap seconds считает сам SE). */
	function utcToJd({ year, month, day, hour = 0, minute = 0, second = 0 }) {
		const jd = mod._astro_utc_to_jd(year, month, day, hour, minute, second);
		if (!(jd > 0)) throw new Error('astro_utc_to_jd: некорректная дата');
		return jd;
	}

	/** Дома и углы. Возвращает {cusps: Float64Array(13), ascmc: Float64Array(10)}. */
	function houses({ jd, lat, lon, hsys = 'P' }) {
		const cuspsPtr = mod._malloc(13 * 8);
		const ascmcPtr = mod._malloc(10 * 8);
		try {
			const code = typeof hsys === 'string' ? hsys.charCodeAt(0) : hsys;
			const r = mod._astro_houses(jd, lat, lon, code, cuspsPtr, ascmcPtr);
			if (r < 0) throw new Error('astro_houses: код ' + r);
			return {
				cusps: mod.HEAPF64.slice(cuspsPtr >> 3, (cuspsPtr >> 3) + 13),
				ascmc: mod.HEAPF64.slice(ascmcPtr >> 3, (ascmcPtr >> 3) + 10),
			};
		} finally {
			mod._free(cuspsPtr);
			mod._free(ascmcPtr);
		}
	}

	// Буферы для одиночных вызовов (уточнение точных аспектов): выделяем один
	// раз, чтобы золотое сечение не аллоцировало память на каждой итерации.
	const posIdsPtr = mod._malloc(4);
	const posLonPtr = mod._malloc(8);
	const posLatPtr = mod._malloc(8);
	const posSpeedPtr = mod._malloc(8);

	/** Позиция одной планеты на моменте jd (без домов). */
	function position(jd, id) {
		mod.HEAP32[posIdsPtr >> 2] = id;
		const r = mod._astro_positions(jd, posIdsPtr, 1, posLonPtr, posLatPtr, posSpeedPtr);
		if (r < 0) throw new Error('astro_positions: код ' + r);
		return {
			lon: mod.HEAPF64[posLonPtr >> 3],
			lat: mod.HEAPF64[posLatPtr >> 3],
			speed: mod.HEAPF64[posSpeedPtr >> 3],
		};
	}

	/** Номер дома для готовой позиции (синастрия: планеты второй карты в домах первой). */
	function housePos({ armc, lat, eps, hsys = 'P', lon, planetLat = 0 }) {
		const code = typeof hsys === 'string' ? hsys.charCodeAt(0) : hsys;
		return mod._astro_house_pos(armc, lat, eps, code, lon, planetLat);
	}

	/** Натальная карта: куспиды, углы, планеты с номерами домов. */
	function natal({ jd, lat, lon, hsys = 'P', planets = DEFAULT_PLANETS }) {
		const ids = Array.from(planets);
		const n = ids.length;
		const cuspsPtr = mod._malloc(13 * 8);
		const ascmcPtr = mod._malloc(10 * 8);
		const idsPtr = mod._malloc(n * 4);
		const lonPtr = mod._malloc(n * 8);
		const latPtr = mod._malloc(n * 8);
		const speedPtr = mod._malloc(n * 8);
		const housePtr = mod._malloc(n * 4);
		try {
			mod.HEAP32.set(Int32Array.from(ids), idsPtr >> 2);
			const code = typeof hsys === 'string' ? hsys.charCodeAt(0) : hsys;
			const r = mod._astro_natal(jd, lat, lon, code, idsPtr, n, cuspsPtr, ascmcPtr, lonPtr, latPtr, speedPtr, housePtr);
			if (r !== 0) throw new Error('astro_natal: код ' + r);
			const lonView = mod.HEAPF64;
			const houseView = mod.HEAP32;
			const points = ids.map((id, i) => ({
				id,
				lon: lonView[(lonPtr >> 3) + i],
				lat: lonView[(latPtr >> 3) + i],
				speed: lonView[(speedPtr >> 3) + i],
				house: houseView[(housePtr >> 2) + i],
			}));
			return {
				cusps: lonView.slice(cuspsPtr >> 3, (cuspsPtr >> 3) + 13),
				ascmc: lonView.slice(ascmcPtr >> 3, (ascmcPtr >> 3) + 10),
				planets: points,
			};
		} finally {
			mod._free(cuspsPtr);
			mod._free(ascmcPtr);
			mod._free(idsPtr);
			mod._free(lonPtr);
			mod._free(latPtr);
			mod._free(speedPtr);
			mod._free(housePtr);
		}
	}

	/**
	 * Позиции планет за период.
	 * @param {object} p
	 * @param {number} p.startJd — юлианская дата первого среза
	 * @param {number} [p.stepDays=1] — шаг в сутках (1/24 = час)
	 * @param {number} p.steps — число срезов
	 * @param {number[]} [p.planets] — ids SE
	 * @param {number} [p.chunkSteps] — размер пачки (прогресс/отмена)
	 * @param {(p:{done:number,total:number})=>void} [p.onProgress]
	 * @param {AbortSignal} [p.signal]
	 * @returns {Promise<{lon:Float64Array,lat:Float64Array,speed:Float64Array,steps:number,planets:number[]}>}
	 */
	async function period({
		startJd, stepDays = 1, steps, planets = DEFAULT_PLANETS,
		chunkSteps = defaultChunk, onProgress, signal,
	}) {
		if (!(steps > 0)) throw new Error('period: steps должен быть > 0');
		const ids = Array.from(planets);
		const nIds = ids.length;
		if (!nIds) throw new Error('period: пустой список планет');

		const lon = new Float64Array(steps * nIds);
		const lat = new Float64Array(steps * nIds);
		const speed = new Float64Array(steps * nIds);

		const idsPtr = mod._malloc(nIds * 4);
		mod.HEAP32.set(Int32Array.from(ids), idsPtr >> 2);

		try {
			for (let offset = 0; offset < steps; offset += chunkSteps) {
				if (signal?.aborted) {
					const err = new Error('period: отменено');
					err.name = 'AbortError';
					throw err;
				}
				const n = Math.min(chunkSteps, steps - offset);
				const size = n * nIds;
				const lonPtr = mod._malloc(size * 8);
				const latPtr = mod._malloc(size * 8);
				const speedPtr = mod._malloc(size * 8);
				try {
					const r = mod._astro_period(
						startJd + offset * stepDays, stepDays, n,
						idsPtr, nIds, lonPtr, latPtr, speedPtr,
					);
					if (r < 0) throw new Error('astro_period: сбой на элементе ' + (-r));
					lon.set(mod.HEAPF64.slice(lonPtr >> 3, (lonPtr >> 3) + size), offset * nIds);
					lat.set(mod.HEAPF64.slice(latPtr >> 3, (latPtr >> 3) + size), offset * nIds);
					speed.set(mod.HEAPF64.slice(speedPtr >> 3, (speedPtr >> 3) + size), offset * nIds);
				} finally {
					mod._free(lonPtr);
					mod._free(latPtr);
					mod._free(speedPtr);
				}
				onProgress?.({ done: offset + n, total: steps });
				// Уступаем событийному циклу, чтобы воркер успел принять 'cancel'
				// и UI — прогресс. Без signal не уступаем: это чистый замер.
				if (signal) await new Promise((resolve) => setTimeout(resolve, 0));
			}
		} finally {
			mod._free(idsPtr);
		}

		return { lon, lat, speed, steps, planets: ids };
	}

	return { version, utcToJd, houses, position, housePos, natal, period, hoursPerDay: HOURS_PER_DAY };
}
