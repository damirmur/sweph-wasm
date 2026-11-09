/**
 * parity-astro.mjs — паритет клиентского слоя (src/astro.js) с эталонами API.
 *
 * Берёт golden-фикстуры astro3d-e2e и сравнивает:
 *   natal-period.json  — натал + транзиты + события enter/exact/leave;
 *   natal-coords.json  — натал (планеты, куспиды, аспекты, баланс);
 *   synastry.json      — две карты и межкартные аспекты.
 *
 *   E2E_GOLDEN=/path/to/golden node bench/parity-astro.mjs
 *
 * Допуски: 1e-3° (эталоны округлены до 4 знаков), даты событий — ±1 с.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createModule from '../dist/sweph.mjs';
import { createSweph } from '../src/sweph.js';
import { computeNatal, computeSynastry, computeNatalPeriod, jdFromMs } from '../src/astro.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenDir = process.env.E2E_GOLDEN
	|| '/home/dmyr/app/src/astro3d-e2e/internal/contract/testdata/golden';
const tol = 1e-3;
const fails = [];

const swe = await createSweph(createModule, {
	ephePath: '/ephe',
	moduleOptions: { locateFile: (p) => path.join(root, 'dist', p) },
});

function load(name) {
	const file = path.join(goldenDir, name + '.json');
	const doc = JSON.parse(readFileSync(file, 'utf8'));
	const q = new URLSearchParams(doc.path.split('?')[1] || '');
	return { body: doc.body, q };
}

function num(at, want, got, eps = tol) {
	if (typeof got !== 'number' || Math.abs(want - got) > eps) {
		fails.push(`${at}: ${want} != ${got}`);
	}
}
function eq(at, want, got) {
	if (want !== got) fails.push(`${at}: ${JSON.stringify(want)} != ${JSON.stringify(got)}`);
}
function deep(at, want, got) {
	if (want === null || typeof want !== 'object') {
		if (typeof want === 'number') num(at, want, got);
		else eq(at, want, got);
		return;
	}
	if (Array.isArray(want)) {
		if (!Array.isArray(got) || got.length !== want.length) {
			fails.push(`${at}: длина ${want.length} != ${got?.length}`);
			return;
		}
		want.forEach((v, i) => deep(`${at}[${i}]`, v, got[i]));
		return;
	}
	for (const k of Object.keys(want)) deep(`${at}.${k}`, want[k], got?.[k]);
}

function atUTC(date, time) {
	const [y, m, d] = date.split('-').map(Number);
	const [hh, mm] = (time || '12:00').split(':').map(Number);
	return Date.UTC(y, m - 1, d, hh, mm, 0);
}

function jdAt(ms) {
	return jdFromMs(swe, ms);
}

function compareNatal(at, want, got) {
	deep(`${at}.planets`, want.planets, got.planets);
	deep(`${at}.cusps`, want.cusps, got.cusps);
	deep(`${at}.balance`, want.balance, got.balance);
	const wa = [...(want.aspects || [])].sort((a, b) => `${a.planet_1_id}|${a.planet_2_id}|${a.type}`.localeCompare(`${b.planet_1_id}|${b.planet_2_id}|${b.type}`));
	const ga = [...(got.aspects || [])].sort((a, b) => `${a.planet_1_id}|${a.planet_2_id}|${a.type}`.localeCompare(`${b.planet_1_id}|${b.planet_2_id}|${b.type}`));
	if (wa.length !== ga.length) {
		fails.push(`${at}.aspects: ${wa.length} != ${ga.length}`);
		return;
	}
	for (let i = 0; i < wa.length; i++) {
		eq(`${at}.aspects[${i}].ids`, `${wa[i].planet_1_id}|${wa[i].planet_2_id}`, `${ga[i].planet_1_id}|${ga[i].planet_2_id}`);
		eq(`${at}.aspects[${i}].type`, wa[i].type, ga[i].type);
		num(`${at}.aspects[${i}].degree`, wa[i].degree, ga[i].degree);
	}
}

// ── natal-period ──────────────────────────────────────────────────────────
{
	const { body, q } = load('natal-period');
	const natalMs = atUTC(q.get('date'), q.get('time'));
	const startMs = Date.parse(q.get('start').replace(' ', 'T') + 'Z');
	const endMs = Date.parse(q.get('end').replace(' ', 'T') + 'Z');
	const natalJd = jdAt(natalMs);
	const startJd = jdAt(startMs);
	const endJd = jdAt(endMs);
	const res = await computeNatalPeriod(swe, {
		natal: { jd: natalJd, lat: Number(q.get('lat')), lon: Number(q.get('lon')), hsys: q.get('hsys') || 'P' },
		startJd, endJd, startMs,
		stepHours: Number(q.get('step') || 24),
		maxOrb: Number(q.get('max_orb') || 1),
		timeZone: 'UTC',
	});
	const want = body.data;
	compareNatal('natal-period.natal', want.natal, res.natal);
	deep('natal-period.transits.date', want.transits.date, res.transits.date);
	for (const id of Object.keys(want.transits.planets)) {
		deep(`natal-period.transits.planets.${id}`, want.transits.planets[id], res.transits.planets[id]);
	}

	const key = (e) => `${e.kind}|${e.transit_id}|${e.natal_id}|${e.angle}|${e.type}`;
	const wa = [...want.aspects].sort((a, b) => key(a).localeCompare(key(b)) || a.date.localeCompare(b.date));
	const ga = [...res.aspects].sort((a, b) => key(a).localeCompare(key(b)) || a.date.localeCompare(b.date));
	if (wa.length !== ga.length) {
		fails.push(`natal-period.aspects: ${wa.length} != ${ga.length}`);
	} else {
		for (let i = 0; i < wa.length; i++) {
			eq(`natal-period.aspects[${i}].key`, key(wa[i]), key(ga[i]));
			const dt = Math.abs(Date.parse(wa[i].date) - Date.parse(ga[i].date));
			if (dt > 1000) fails.push(`natal-period.aspects[${i}].date: ${wa[i].date} != ${ga[i].date} (${dt} мс)`);
			num(`natal-period.aspects[${i}].orb`, wa[i].orb, ga[i].orb);
		}
	}
	console.log(`natal-period: натал + ${res.transits.date.length} срезов + ${res.aspects.length} событий`);
}

// ── natal ─────────────────────────────────────────────────────────────────
{
	const { body, q } = load('natal-coords');
	const ms = atUTC(q.get('date'), q.get('time'));
	const res = computeNatal(swe, {
		jd: jdAt(ms),
		lat: Number(q.get('lat')),
		lon: Number(q.get('lon')),
		hsys: q.get('hsys') || 'P',
	});
	const data = {
		planets: res.planets.map((p) => [p.id, [p.lon, p.speed]]),
		cusps: res.cusps,
		aspects: res.aspects,
		balance: res.balance,
	};
	compareNatal('natal', body.data, data);
	console.log(`natal: ${res.planets.length} планет, ${res.aspects.length} аспектов`);
}

// ── synastry ──────────────────────────────────────────────────────────────
{
	const { body, q } = load('synastry');
	const res = computeSynastry(swe, {
		jd1: jdAt(atUTC(q.get('date1'), q.get('time1'))),
		jd2: jdAt(atUTC(q.get('date2'), q.get('time2'))),
		lat1: Number(q.get('lat')),
		lon1: Number(q.get('lon')),
		hsys: q.get('hsys') || 'P',
	});
	compareNatal('synastry.chart1', body.data.chart1, res.chart1);
	deep('synastry.chart2.planets', body.data.chart2.planets, res.chart2.planets);
	deep('synastry.chart2.cusps', body.data.chart2.cusps, res.chart2.cusps);
	deep('synastry.chart2.balance', body.data.chart2.balance, res.chart2.balance);
	if (body.data.aspects.length !== res.aspects.length) {
		fails.push(`synastry.aspects: ${body.data.aspects.length} != ${res.aspects.length}`);
	}
	console.log(`synastry: ${res.aspects.length} межкартных аспектов`);
}

if (fails.length) {
	console.error(`\nПРОВАЛ: ${fails.length} расхождений`);
	for (const f of fails.slice(0, 30)) console.error('  ' + f);
	process.exit(1);
}
console.log('\nпаритет с эталонами: ok');
