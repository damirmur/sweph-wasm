/**
 * astro.js — прикладной слой над sweph.js: натал, синастрия, транзитный период.
 *
 * Порт pkg/astro (swisseph_build) на JS: те же формулы, порядок обхода и
 * структуры ответа, чтобы клиентские расчёты совпадали с /api/v1/*.
 * C-часть (sweph.js) отдаёт только позиции и дома — аспекты и события считаем
 * здесь, на типизированных массивах.
 *
 * Единицы: jd — юлианская дата UT, ms — unix-время, углы — градусы.
 */

/** Идентификаторы планет в порядке astro-core (GetPlanetIDs). */
export const PLANET_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
export const DEFAULT_TRANSIT_PLANETS = PLANET_IDS;

const PLANET_NAMES = Object.freeze({
	0: 'Sun', 1: 'Moon', 2: 'Mercury', 3: 'Venus', 4: 'Mars',
	5: 'Jupiter', 6: 'Saturn', 7: 'Uranus', 8: 'Neptune', 9: 'Pluto',
	10: 'Mean Node', 12: 'Lilith',
});

/** Английские имена аспектов по углу (AspectDict). */
export const ASPECT_NAMES = Object.freeze({
	0: 'Conjunction', 30: 'Semi-sextile', 60: 'Sextile', 72: 'Quintile',
	90: 'Square', 120: 'Trine', 135: 'Sesquiquadrate', 180: 'Opposition',
});

/** Мажорные аспекты с орбами — как MajorAspects в pkg/astro/aspects.go. */
export const MAJOR_ASPECTS = Object.freeze([
	{ name: 'Conjunction', angle: 0, orb: 6.0 },
	{ name: 'Sextile', angle: 60, orb: 4.0 },
	{ name: 'Square', angle: 90, orb: 5.0 },
	{ name: 'Trine', angle: 120, orb: 6.0 },
	{ name: 'Opposition', angle: 180, orb: 4.0 },
]);

export const MAJOR_ASPECT_ANGLES = Object.freeze([0, 60, 90, 120, 180]);

export function planetName(id) {
	return PLANET_NAMES[id] ?? '';
}

export function aspectName(angle) {
	return ASPECT_NAMES[angle] ?? String(Math.round(angle));
}

/** Конфигурации аспектов для заданных углов и единого орба (AspectConfigs). */
export function aspectConfigs(angles, orb) {
	return angles.map((angle) => ({ name: aspectName(angle), angle, orb }));
}

/** Кратчайшее расстояние между долготами (0..180). */
export function getShortestDiff(lon1, lon2) {
	let diff = Math.abs(lon1 - lon2);
	if (diff > 180) diff = 360 - diff;
	return diff;
}

/** Проверка аспекта по набору конфигураций (CalculateAspectWith). */
export function calculateAspectWith(lon1, lon2, configs = MAJOR_ASPECTS) {
	const diff = getShortestDiff(lon1, lon2);
	for (const cfg of configs) {
		const exactDiff = Math.abs(diff - cfg.angle);
		if (exactDiff <= cfg.orb) return { name: cfg.name, angle: cfg.angle, orb: exactDiff };
	}
	return null;
}

/** Проверка мажорного аспекта (CalculateAspect). */
export function calculateAspect(lon1, lon2) {
	return calculateAspectWith(lon1, lon2, MAJOR_ASPECTS);
}

/** Аспекты внутри одной карты (buildAspects). */
export function buildAspects(planets) {
	const list = [];
	for (let i = 0; i < planets.length; i++) {
		for (let j = i + 1; j < planets.length; j++) {
			const p1 = planets[i];
			const p2 = planets[j];
			const asp = calculateAspect(p1.lon, p2.lon);
			if (!asp) continue;
			list.push({
				planet_1_id: p1.id,
				planet_2_id: p2.id,
				planet_1: planetName(p1.id),
				planet_2: planetName(p2.id),
				type: asp.name,
				degree: asp.orb,
				orb: asp.orb,
			});
		}
	}
	list.sort((a, b) => (a.planet_1_id === b.planet_1_id
		? a.planet_2_id - b.planet_2_id
		: a.planet_1_id - b.planet_1_id));
	return list;
}

/** Баланс стихий и крестов по планетам 0–9 (ComputeBalance). */
export function computeBalance(planets) {
	const elements = ['fire', 'earth', 'air', 'water'];
	const crosses = ['cardinal', 'fixed', 'mutable'];
	const out = {
		planets: [],
		elements: { fire: 0, earth: 0, air: 0, water: 0 },
		crosses: { cardinal: 0, fixed: 0, mutable: 0 },
		grid: {},
	};
	for (const el of elements) {
		out.grid[el] = {};
		for (const cr of crosses) out.grid[el][cr] = [];
	}
	for (const p of planets) {
		if (p.id < 0 || p.id > 9) continue;
		let sign = Math.trunc(p.lon / 30) % 12;
		if (sign < 0) sign += 12;
		const el = elements[sign % 4];
		const cr = crosses[sign % 3];
		out.planets.push(p.id);
		out.elements[el]++;
		out.crosses[cr]++;
		out.grid[el][cr].push(p.id);
	}
	out.planets.sort((a, b) => a - b);
	return out;
}

/** Номер дома (1–12) для долготы по куспидам 1..12 (HouseOfLongitude). */
export function houseOfLongitude(lon, cusps) {
	if (!cusps || cusps.length < 12) return 0;
	for (let h = 1; h <= 12; h++) {
		const start = cusps[h - 1];
		const end = cusps[h % 12];
		if (inClockwiseArc(lon, start, end)) return h;
	}
	return 0;
}

function inClockwiseArc(lon, start, end) {
	const s = mod360(start);
	let e = mod360(end);
	const l = mod360(lon);
	if (e <= s) e += 360;
	const ll = l < s ? l + 360 : l;
	return ll < e;
}

function mod360(v) {
	const r = v % 360;
	return r < 0 ? r + 360 : r;
}

/** Линейная интерполяция долготы по кратчайшему пути (interpLon). */
export function interpLon(a, b, f) {
	let diff = (b - a) % 360;
	if (diff > 180) diff -= 360;
	else if (diff < -180) diff += 360;
	return mod360(a + diff * f);
}

/** Минимум функции на отрезке [aMs, bMs] золотым сечением (20 итераций). */
export function goldenSectionSearch(aMs, bMs, f) {
	const resphi = 2 - (1 + Math.sqrt(5)) / 2; // 0.381966, как в Go
	let tA = aMs;
	let tB = bMs;
	let c = tA + resphi * (tB - tA);
	let d = tB - resphi * (tB - tA);
	let fc = f(c);
	let fd = f(d);
	for (let i = 0; i < 20; i++) {
		if (fc < fd) {
			tB = d;
			d = c;
			fd = fc;
			c = tA + resphi * (tB - tA);
			fc = f(c);
		} else {
			tA = c;
			c = d;
			fc = fd;
			d = tB - resphi * (tB - tA);
			fd = f(d);
		}
	}
	return Math.round((tA + tB) / 2);
}

/** JD из unix-ms с точностью до секунды — как dateToJulian в Go (секунды целые). */
export function jdFromMs(swe, ms) {
	const d = new Date(ms);
	return swe.utcToJd({
		year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
		hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
	});
}

/** RFC3339 как Go: без долей секунды, с Z или смещением пояса. */
export function formatRFC3339(ms, timeZone = 'UTC') {
	const whole = Math.floor(ms / 1000) * 1000;
	if (!timeZone || timeZone === 'UTC') {
		return new Date(whole).toISOString().replace('.000Z', 'Z');
	}
	const d = new Date(whole);
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	}).formatToParts(d);
	const get = (t) => parts.find((p) => p.type === t)?.value;
	const y = get('year');
	const mo = get('month');
	const da = get('day');
	const hh = get('hour');
	const mi = get('minute');
	const ss = get('second');
	const asUTC = Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(hh), Number(mi), Number(ss));
	const offMin = Math.round((asUTC - whole) / 60000);
	const sign = offMin >= 0 ? '+' : '-';
	const abs = Math.abs(offMin);
	const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
	return `${y}-${mo}-${da}T${hh}:${mi}:${ss}${off}`;
}

/** Натальная карта: позиции, дома, аспекты, баланс (ComputeNatal + ToNatalData). */
export function computeNatal(swe, { jd, lat, lon, hsys = 'P', planets = PLANET_IDS }) {
	const chart = swe.natal({ jd, lat, lon, hsys, planets });
	const points = chart.planets.map((p) => ({ id: p.id, lon: p.lon, speed: p.speed, house: p.house }));
	const cusps = Array.from(chart.cusps.slice(1, 13));
	return {
		planets: points,
		cusps,
		aspects: buildAspects(points),
		balance: computeBalance(points),
		ascmc: Array.from(chart.ascmc),
	};
}

/** Компактный блок natal для ответа (ToNatalData). */
export function toNatalData(chart) {
	return {
		planets: chart.planets.map((p) => [p.id, [p.lon, p.speed]]),
		cusps: chart.cusps,
		aspects: chart.aspects,
		balance: chart.balance,
	};
}

/** Синастрия: две карты и межкартные аспекты (ComputeSynastry). */
export function computeSynastry(swe, { jd1, jd2, lat1, lon1, hsys = 'P', planets = PLANET_IDS }) {
	const a = computeNatal(swe, { jd: jd1, lat: lat1, lon: lon1, hsys, planets });
	const b = swe.natal({ jd: jd2, lat: lat1, lon: lon1, hsys, planets });
	const armc = a.ascmc[2];
	const eps = swe.position(jd1, -1).lon; // SE_ECL_NUT: eps[0] лежит в lon

	const planetsB = b.planets.map((p) => ({
		id: p.id,
		lon: p.lon,
		speed: p.speed,
		house: swe.housePos({ armc, lat: lat1, eps, hsys, lon: p.lon, planetLat: p.lat }),
	}));

	const aspects = [];
	for (const pB of planetsB) {
		for (const pA of a.planets) {
			const asp = calculateAspect(pB.lon, pA.lon);
			if (!asp) continue;
			aspects.push({
				planet_1_id: pB.id,
				planet_2_id: pA.id,
				planet_1: planetName(pB.id) + ' (Transit)',
				planet_2: planetName(pA.id) + ' (Natal)',
				type: asp.name,
				degree: asp.orb,
				orb: asp.orb,
			});
		}
	}
	aspects.sort((x, y) => (x.planet_1_id === y.planet_1_id
		? x.planet_2_id - y.planet_2_id
		: x.planet_1_id - y.planet_1_id));

	// Как в ComputeSynastry/ToSynastryData: у chart1 аспекты межкартные,
	// у chart2 — дома первой карты и никаких аспектов.
	const chart1 = {
		planets: a.planets.map((p) => [p.id, [p.lon, p.speed]]),
		cusps: a.cusps,
		aspects,
		balance: computeBalance(a.planets),
	};
	const chart2 = {
		planets: planetsB.map((p) => [p.id, [p.lon, p.speed]]),
		cusps: a.cusps,
		balance: computeBalance(planetsB),
	};
	return { chart1, chart2, aspects };
}

/**
 * Натальная карта + транзиты за период (ComputeNatalPeriod).
 *
 * @param {object} swe — обёртка createSweph
 * @param {object} p
 * @param {{jd:number, lat:number, lon:number, hsys?:string}} p.natal
 * @param {number} p.startJd
 * @param {number} p.endJd
 * @param {number} [p.stepHours=24]
 * @param {number[]} [p.transitPlanets]
 * @param {number} [p.maxOrb=1]
 * @param {number[]} [p.aspectAngles]
 * @param {string} [p.timeZone='UTC']
 * @returns {{natal:object, transits:{date:string[],planets:Object}, aspects:object[]}}
 */
export async function computeNatalPeriod(swe, {
	natal: natalInput,
	startJd, endJd, startMs, stepHours = 24,
	transitPlanets = DEFAULT_TRANSIT_PLANETS,
	maxOrb = 1,
	aspectAngles = MAJOR_ASPECT_ANGLES,
	timeZone = 'UTC',
	refine = 'golden',
}) {
	const prof = { natal: 0, positions: 0, loop: 0, exact: 0, exactCalls: 0 };
	const tNatal = performance.now();
	const natal = computeNatal(swe, natalInput);
	prof.natal = performance.now() - tNatal;
	const cusps = natal.cusps;
	const natalLons = natal.planets.map((p) => p.lon);
	const natalIDs = natal.planets.map((p) => p.id);
	const cfgs = aspectConfigs(aspectAngles, maxOrb);
	const stepDays = stepHours / 24;
	const steps = Math.floor((endJd - startJd) / stepDays + 1e-9) + 1;
	if (steps < 1) throw new Error('natal-period: пустой период');

	const series = { date: [], planets: {} };
	const seriesRows = transitPlanets.map((id) => {
		const key = String(id);
		series.planets[key] = [];
		return series.planets[key];
	});

	const tPos = performance.now();
	const positions = await swe.period({ startJd, stepDays, steps, planets: transitPlanets, chunkSteps: steps });
	prof.positions = performance.now() - tPos;
	const nT = transitPlanets.length;

	const startMsVal = startMs ?? msFromJd(swe, startJd);
	const stepMs = stepHours * 3600 * 1000;

	// Плоский массив состояний: строковые ключи в Map на 1,3 млн итераций
	// съедают больше времени, чем сам расчёт. Индекс — (tid*16+ni)*256+angle.
	const stateSlots = [];
	const usedStates = [];
	const events = [];

	const halfWindowMs = stepHours * 3600 * 1000;

	const tLoop = performance.now();
	for (let slice = 0; slice < steps; slice++) {
		const sliceMs = startMsVal + slice * stepMs;
		const transitLons = new Array(nT);
		const transitSpeeds = new Array(nT);
		for (let i = 0; i < nT; i++) {
			transitLons[i] = positions.lon[slice * nT + i];
			transitSpeeds[i] = positions.speed[slice * nT + i];
		}

		series.date.push(formatRFC3339(sliceMs, timeZone));
		for (let i = 0; i < nT; i++) {
			seriesRows[i].push([
				transitLons[i],
				transitSpeeds[i],
				houseOfLongitude(transitLons[i], cusps),
			]);
		}

		for (let ti = 0; ti < nT; ti++) {
			const tid = transitPlanets[ti];
			const lt = transitLons[ti];
			for (let ni = 0; ni < natalIDs.length; ni++) {
				const nid = natalIDs[ni];
				const ln = natalLons[ni];
				const diff = getShortestDiff(lt, ln);
				for (const cfg of cfgs) {
					const d = Math.abs(diff - cfg.angle);
					const key = (tid * 16 + ni) * 256 + cfg.angle;
					let st = stateSlots[key];
					if (!st) {
						st = { transitID: tid, natalID: nid, natalLon: ln, cfg, inside: false, hasMin: false };
						stateSlots[key] = st;
						usedStates.push(st);
					}
					if (slice === 0) {
						st.prevMs = sliceMs;
						st.prevLonT = lt;
						st.prevD = d;
						st.inside = d <= maxOrb;
						if (st.inside) {
							st.minD = d;
							st.minMs = sliceMs;
							st.minJd = startJd + slice * stepDays;
							st.minLonT = lt;
							st.hasMin = true;
						}
						continue;
					}
					const insidePrev = st.inside;
					const insideNow = d <= maxOrb;
					if (insideNow && !insidePrev) {
						let f = 0;
						if (st.prevD !== d) f = (st.prevD - maxOrb) / (st.prevD - d);
						const et = st.prevMs + f * (sliceMs - st.prevMs);
						events.push(makeEvent(et, tid, nid, cfg, maxOrb, 'enter', timeZone));
					}
					if (insideNow) {
						if (!st.hasMin || d < st.minD) {
							st.minD = d;
							st.minMs = sliceMs;
							st.minJd = startJd + slice * stepDays;
							st.minLonT = lt;
							st.hasMin = true;
						}
					}
					if (!insideNow && insidePrev) {
						let f = 0;
						if (d !== st.prevD) f = (maxOrb - st.prevD) / (d - st.prevD);
						const xt = st.prevMs + f * (sliceMs - st.prevMs);
						if (st.hasMin) {
							const tEx = performance.now();
							prof.exactCalls++;
							const exact = findExact(swe, tid, ln, cfg.angle, st.minJd, st.minMs, halfWindowMs, refine);
							prof.exact += performance.now() - tEx;
							if (exact.ms >= startMsVal && exact.ms <= startMsVal + (steps - 1) * stepMs) {
								events.push(makeEvent(exact.ms, tid, nid, cfg, exact.orb, 'exact', timeZone));
							}
						}
						events.push(makeEvent(xt, tid, nid, cfg, maxOrb, 'leave', timeZone));
						st.inside = false;
						st.hasMin = false;
						st.minD = 0;
					}
					st.prevD = d;
					st.prevMs = sliceMs;
					st.prevLonT = lt;
					st.inside = insideNow;
				}
			}
		}
	}

	prof.loop = performance.now() - tLoop;
	// Эпизоды, не закрывшиеся к концу периода.
	const endMs = startMsVal + (steps - 1) * stepMs;
	for (const st of usedStates) {
		if (st.inside && st.hasMin) {
			const exact = findExact(swe, st.transitID, st.natalLon, st.cfg.angle, st.minJd, st.minMs, halfWindowMs, refine);
			if (exact.ms >= startMsVal && exact.ms <= endMs) {
				events.push(makeEvent(exact.ms, st.transitID, st.natalID, st.cfg, exact.orb, 'exact', timeZone));
			}
		}
	}

	return { natal: toNatalData(natal), transits: series, aspects: events, profile: prof };
}

// Точный момент аспекта. Сервер ищет минимум |орб| золотым сечением (20 вызовов
// swe_calc_ut на событие); здесь — метод Ньютона по знаковой разности долгот:
// обычно 4–5 вызовов и та же точность до секунды. Если скорость у нуля
// (станция) или шаг выходит за окно, откатываемся на золотое сечение.
function findExact(swe, transitID, natalLon, angle, approxJd, approxMs, halfWindowMs, refine = 'golden') {
	const lo = approxMs - halfWindowMs;
	const hi = approxMs + halfWindowMs;
	const posAt = (ms) => swe.position(approxJd + (ms - approxMs) / 86400000, transitID);
	const orbAt = (ms) => Math.abs(getShortestDiff(posAt(ms).lon, natalLon) - angle);
	if (!(hi > lo)) return { ms: approxMs, orb: orbAt(approxMs) };
	if (refine !== 'newton') {
		// Как сервер: dateToJulian в Go отбрасывает доли секунды, поэтому
		// золотое сечение идёт по секундной сетке — иначе даты разъезжаются
		// на несколько секунд с /api/v1/natal-period.
		const orbSec = (ms) => Math.abs(getShortestDiff(
			swe.position(jdFromMs(swe, ms), transitID).lon, natalLon,
		) - angle);
		const ms = goldenSectionSearch(lo, hi, orbSec);
		return { ms, orb: orbSec(ms) };
	}

	const start = posAt(approxMs);
	const signed = normalizeSigned(start.lon - natalLon);
	const target = Math.abs(normalizeSigned(signed + angle)) < Math.abs(normalizeSigned(signed - angle))
		? -angle
		: angle;

	let t = approxMs;
	for (let i = 0; i < 6; i++) {
		const p = posAt(t);
		const f = normalizeSigned(p.lon - natalLon) - target;
		const df = p.speed / 86400000;
		if (!Number.isFinite(df) || Math.abs(df) < 1e-12) break;
		const next = t - f / df;
		if (next < lo || next > hi) break;
		t = next;
		if (Math.abs(f) < 1e-7) break;
	}

	// Проверка: Ньютон мог уйти на соседнюю ветку аспекта.
	if (orbAt(t) > orbAt(approxMs)) {
		const ms = goldenSectionSearch(lo, hi, orbAt);
		return { ms, orb: orbAt(ms) };
	}
	return { ms: Math.round(t), orb: orbAt(t) };
}

function normalizeSigned(a) {
	const r = ((a + 180) % 360 + 360) % 360 - 180;
	return r;
}

function makeEvent(ms, transitID, natalID, cfg, orb, kind, timeZone) {
	return {
		date: formatRFC3339(ms, timeZone),
		transit_id: transitID,
		natal_id: natalID,
		type: cfg.name,
		angle: cfg.angle,
		orb,
		kind,
	};
}

/** Обратное преобразование JD → unix-ms (для форматирования срезов). */
export function msFromJd(swe, jd) {
	// JD 2440587.5 = 1970-01-01T00:00:00Z; сутки = 86400000 мс.
	return Math.round((jd - 2440587.5) * 86400000);
}
