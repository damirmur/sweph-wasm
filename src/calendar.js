/**
 * calendar.js — календарь событий на клиенте (порт pkg/astro/calendar.go).
 *
 * Зачем: годовое хранилище есть только для текущего и следующего года. Если
 * пользователь открыл 2030-й, сервер не должен считать 2,6 с — год строится
 * в браузере на том же wasm-движке. Структура событий — как в
 * /api/v1/calendar (компактные d/t/p/a/de/s/chS/end/r/h).
 *
 * Точность: те же шаги (сутки для ингрессий/аспектов, час для Луны) и то же
 * золотое сечение, что у сервера; даты — в поясе запроса с точностью до минуты.
 */
import { getShortestDiff, goldenSectionSearch, jdFromMs, MAJOR_ASPECTS } from './astro.js';

const PLANET_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
const PLANET_INDEX = new Map(PLANET_IDS.map((id, i) => [id, i]));
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const VOC_PLANETS = new Set([0, 2, 3, 4, 5, 6, 7, 8, 9]);

function normalizeSigned(a) {
	return ((a + 180) % 360 + 360) % 360 - 180;
}

function formatCalendarDate(ms, timeZone) {
	if (!timeZone || timeZone === 'UTC') {
		return new Date(ms).toISOString().slice(0, 16);
	}
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	}).formatToParts(new Date(ms));
	const get = (t) => parts.find((p) => p.type === t)?.value;
	return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function aspectCrossed(prevLon1, prevLon2, currLon1, currLon2, angle) {
	const prevShortest = getShortestDiff(prevLon1, prevLon2);
	const currShortest = getShortestDiff(currLon1, currLon2);

	if (angle > 0 && angle < 180) {
		return (prevShortest <= angle && currShortest >= angle)
			|| (prevShortest >= angle && currShortest <= angle);
	}
	if (prevShortest === angle || currShortest === angle) return true;

	const prevSigned = normalizeSigned(prevLon1 - prevLon2);
	const currSigned = normalizeSigned(currLon1 - currLon2);
	if (prevSigned === 0 || currSigned === 0) return true;
	if (prevSigned * currSigned < 0) {
		if (angle === 0) return prevShortest <= 90 && currShortest <= 90;
		return prevShortest >= 90 && currShortest >= 90;
	}
	return false;
}

/**
 * Считает календарь за диапазон [startMs, endMs] (UTC, как calcStart/calcEnd
 * у сервера: месяц/год уже с ±24 ч). Возвращает компактные события.
 */
export async function computeCalendar(swe, {
	startMs, endMs, timeZone = 'UTC', eventTypes = null, planets = null,
}) {
	const moonStart = startMs - 48 * HOUR_MS;
	const moonEnd = endMs + 72 * HOUR_MS;
	const stepsH = Math.floor((moonEnd - moonStart) / HOUR_MS) + 1;
	const n = PLANET_IDS.length;
	// Позиции по часам считаем через position(jdFromMs(t)), а не bulk-циклом:
	// сервер на каждом шаге делает dateToJulian (целые секунды), и постоянный
	// шаг 1/24 в bulk-цикле на границе часа иногда сдвигает событие на минуту.
	const hourLon = new Float64Array(stepsH * n);
	const hourSpeed = new Float64Array(stepsH * n);
	for (let i = 0; i < stepsH; i++) {
		const jd = jdFromMs(swe, moonStart + i * HOUR_MS);
		for (let k = 0; k < n; k++) {
			const p = swe.position(jd, PLANET_IDS[k]);
			hourLon[i * n + k] = p.lon;
			hourSpeed[i * n + k] = p.speed;
		}
	}
	const at = (idx, id) => {
		const o = idx * n + PLANET_INDEX.get(id);
		return { lon: hourLon[o], speed: hourSpeed[o] };
	};
	const planetLon = (id, ms) => swe.position(jdFromMs(swe, ms), id).lon;
	const planetSpeed = (id, ms) => swe.position(jdFromMs(swe, ms), id).speed;

	const findExactSignChange = (id, targetSign, a, b) => {
		const targetLon = targetSign * 30;
		return goldenSectionSearch(a, b, (ms) => Math.abs(normalizeSigned(planetLon(id, ms) - targetLon)));
	};
	const findExactAspect = (id1, id2, angle, a, b) => goldenSectionSearch(a, b,
		(ms) => Math.abs(getShortestDiff(planetLon(id1, ms), planetLon(id2, ms)) - angle));
	const findExactLunarDay = (targetDay, a, b) => {
		const targetAngle = (targetDay - 1) * 12;
		return goldenSectionSearch(a, b, (ms) => {
			let diff = planetLon(1, ms) - planetLon(0, ms);
			diff = ((diff % 360) + 360) % 360;
			return Math.abs(normalizeSigned(diff - targetAngle));
		});
	};
	const findExactStation = (id, a, b) => {
		let low = a;
		let high = b;
		for (let i = 0; i < 10; i++) {
			const mid = (low + high) / 2;
			const midSpeed = planetSpeed(id, mid);
			const lowSpeed = planetSpeed(id, low);
			if ((lowSpeed > 0 && midSpeed > 0) || (lowSpeed < 0 && midSpeed < 0)) low = mid;
			else high = mid;
		}
		return (low + high) / 2;
	};

	const events = [];
	const push = (ms, type, fields) => {
		events.push({ ms, type, ...fields });
	};

	// 1. Суточный цикл: ингрессии, станции, аспекты (без Луны).
	const days = Math.floor((endMs - startMs) / DAY_MS) + 1;
	let prev = new Map();
	for (let i = 0; i < days; i++) {
		const idx = 48 + i * 24;
		const curr = new Map();
		for (const id of PLANET_IDS) {
			const p = at(idx, id);
			curr.set(id, { lon: p.lon, sign: Math.trunc(p.lon / 30), speed: p.speed });
		}
		if (i === 0) {
			prev = curr;
			continue;
		}
		const tPrev = startMs + (i - 1) * DAY_MS;
		const tCurr = startMs + i * DAY_MS;

		for (const id of PLANET_IDS) {
			const a = prev.get(id);
			const b = curr.get(id);
			if (b.sign !== a.sign) {
				const exact = findExactSignChange(id, b.sign, tPrev, tCurr);
				push(exact, 'chS', { planets: [String(id)], sign: b.sign, degrees: [b.sign * 30] });
			}
			if (id !== 0 && id !== 1 && ((a.speed > 0 && b.speed < 0) || (a.speed < 0 && b.speed > 0))) {
				const exact = findExactStation(id, tPrev, tCurr);
				push(exact, 'r', {
					planets: [String(id)], sign: b.sign,
					aspect: b.speed < 0 ? 'R' : 'D', degrees: [Math.trunc(b.lon)],
				});
			}
		}

		for (let i1 = 0; i1 < PLANET_IDS.length; i1++) {
			for (let j1 = i1 + 1; j1 < PLANET_IDS.length; j1++) {
				const id1 = PLANET_IDS[i1];
				const id2 = PLANET_IDS[j1];
				if (id1 === 1 || id2 === 1) continue;
				const p1 = prev.get(id1);
				const p2 = prev.get(id2);
				const c1 = curr.get(id1);
				const c2 = curr.get(id2);
				const prevDiff = getShortestDiff(p1.lon, p2.lon);
				const currDiff = getShortestDiff(c1.lon, c2.lon);
				for (const asp of MAJOR_ASPECTS) {
					if (!aspectCrossed(p1.lon, p2.lon, c1.lon, c2.lon, asp.angle)) continue;
					if (Math.abs(prevDiff - asp.angle) > asp.orb && Math.abs(currDiff - asp.angle) > asp.orb) continue;
					const exact = findExactAspect(id1, id2, asp.angle, tPrev, tCurr);
					push(exact, 'exA', {
						planets: [String(id1), String(id2)], aspect: String(asp.angle),
						degrees: [Math.trunc(c1.lon), Math.trunc(c2.lon)],
					});
				}
			}
		}
		prev = curr;
	}

	// 2. Часовой цикл Луны: лунные дни, аспекты Луны, Луна без курса.
	let prevMoon = at(0, 1).lon;
	let prevSun = at(0, 0).lon;
	let diff = ((prevMoon - prevSun) % 360 + 360) % 360;
	let prevLunarDay = Math.trunc(diff / 12) + 1;
	let prevMoonSign = Math.trunc(prevMoon / 30);
	let prevPlanets = new Map();
	for (const id of PLANET_IDS) {
		if (id !== 1) prevPlanets.set(id, at(0, id).lon);
	}
	let vocStart = null;
	let vocIngress = null;

	for (let i = 1; i < stepsH; i++) {
		const tPrev = moonStart + (i - 1) * HOUR_MS;
		const tCurr = moonStart + i * HOUR_MS;
		const moon = at(i, 1).lon;
		const sun = at(i, 0).lon;
		diff = ((moon - sun) % 360 + 360) % 360;
		const lunarDay = Math.trunc(diff / 12) + 1;

		if (lunarDay !== prevLunarDay) {
			const targetDay = (prevLunarDay === 30 && lunarDay === 1) ? 1 : lunarDay;
			const exact = findExactLunarDay(targetDay, tPrev, tCurr);
			if (exact >= startMs && exact <= endMs) {
				push(exact, 'lunD', { sign: lunarDay });
			}
			prevLunarDay = lunarDay;
		}

		const moonSign = Math.trunc(moon / 30);
		const currPlanets = new Map();
		const stepVoc = [];
		for (const id of PLANET_IDS) {
			if (id === 1) continue;
			const plon = at(i, id).lon;
			currPlanets.set(id, plon);
			const prevDiff = getShortestDiff(prevMoon, prevPlanets.get(id));
			const currDiff = getShortestDiff(moon, plon);
			for (const asp of MAJOR_ASPECTS) {
				if (!aspectCrossed(prevMoon, prevPlanets.get(id), moon, plon, asp.angle)) continue;
				if (Math.abs(prevDiff - asp.angle) > asp.orb && Math.abs(currDiff - asp.angle) > asp.orb) continue;
				const exact = findExactAspect(1, id, asp.angle, tPrev, tCurr);
				if (exact >= startMs && exact <= endMs) {
					push(exact, 'exA', {
						planets: ['1', String(id)], aspect: String(asp.angle),
						degrees: [Math.trunc(moon), Math.trunc(plon)],
					});
				}
				if (VOC_PLANETS.has(id)) stepVoc.push(exact);
			}
		}

		const marks = [];
		if (moonSign !== prevMoonSign) {
			marks.push({ t: findExactSignChange(1, moonSign, tPrev, tCurr), ingress: true });
			prevMoonSign = moonSign;
		}
		for (const t of stepVoc) marks.push({ t, ingress: false });
		marks.sort((a, b) => (a.t - b.t) || (a.ingress === b.ingress ? 0 : (a.ingress ? 1 : -1)));

		for (const m of marks) {
			if (m.ingress) {
				if (vocStart === null || vocStart >= m.t) {
					// до ингрессии не было квалифаспекта
				} else if (m.t < startMs) {
					vocStart = null;
					vocIngress = null;
				} else if (m.t > endMs) {
					if (vocIngress === null) vocStart = null;
				} else if (vocIngress === null) {
					vocIngress = m.t;
				}
				continue;
			}
			if (vocIngress !== null && m.t >= vocIngress) {
				push(vocStart, 'noC', { planets: ['1'], changeSign: vocIngress, voidEnd: m.t });
				vocStart = m.t;
				vocIngress = null;
			} else if (vocStart === null || m.t > vocStart) {
				vocStart = m.t;
			}
		}

		prevMoon = moon;
		for (const [id, lon] of currPlanets) prevPlanets.set(id, lon);
	}

	// Компактная форма + фильтры (как ApplyFilter для событий).
	let list = events
		.filter((e) => !eventTypes || eventTypes.includes(e.type))
		.filter((e) => {
			if (!planets) return true;
			if (e.planets && e.planets.length) return e.planets.some((p) => planets.includes(Number(p)));
			return e.type === 'lunD' ? planets.includes(1) : true;
		})
		.map((e) => {
			const out = { d: formatCalendarDate(e.ms, timeZone), t: e.type };
			if (e.planets) out.p = e.planets;
			if (e.type === 'r') out.r = e.aspect === 'R' ? 1 : 0;
			else if (e.aspect) out.a = e.aspect;
			if (e.degrees) out.de = e.degrees;
			if (e.sign !== undefined && e.sign !== null) out.s = e.sign;
			if (e.changeSign) out.chS = formatCalendarDate(e.changeSign, timeZone);
			if (e.voidEnd) out.end = formatCalendarDate(e.voidEnd, timeZone);
			return out;
		});

	list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
	return list;
}

/** Год целиком с кэшем на страницу: month/start/end — выборка из года. */
export function createCalendarClient(swe) {
	const cache = new Map();
	return async function getCalendar({ year, month = 0, start = null, end = null, sign = null, timeZone = 'UTC' }) {
		const key = `${year}|${timeZone}`;
		if (!cache.has(key)) {
			const startMs = Date.UTC(year, 0, 1) - 24 * HOUR_MS;
			const endMs = Date.UTC(year, 11, 31, 23, 59) + 24 * HOUR_MS;
			cache.set(key, await computeCalendar(swe, { startMs, endMs, timeZone }));
		}
		let events = cache.get(key);
		if (start && end) {
			const from = Date.parse(start.length <= 10 ? start + 'T00:00:00Z' : start + 'Z');
			const to = Date.parse(end.length <= 10 ? end + 'T00:00:00Z' : end + 'Z');
			if (Number.isFinite(from) && Number.isFinite(to)) {
				events = events.filter((e) => {
					const ms = Date.parse(e.d + 'Z');
					return ms >= from && ms <= to;
				});
			}
		} else if (month > 0) {
			const from = Date.UTC(year, month - 1, 1) - 24 * HOUR_MS;
			const to = Date.UTC(year, month, 1) + 24 * HOUR_MS;
			events = events.filter((e) => {
				const ms = Date.parse(e.d + 'Z');
				return ms >= from && ms <= to;
			});
		}
		return sign === null || sign === undefined ? events : withHouses(events, sign);
	};
}

/** Полнознаковые дома относительно знака Асцендента (как ToCompactEventsForSign). */
function withHouses(events, ascSign) {
	return events.map((e) => {
		if (!e.p || !e.p.length || (e.t !== 'exA' && e.t !== 'chS' && e.t !== 'r')) return e;
		const houses = e.p.map((_, k) => {
			let s = -1;
			if (e.de && e.de.length > k) s = Math.trunc(e.de[k] / 30);
			else if (e.s !== undefined && k === 0) s = e.s;
			return s < 0 ? 0 : ((s - ascSign) % 12 + 12) % 12 + 1;
		});
		return { ...e, h: houses };
	});
}
