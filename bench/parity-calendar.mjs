/**
 * parity-calendar.mjs — клиентский календарь против golden-фикстуры API.
 *
 *   node bench/parity-calendar.mjs
 *
 * Фикстура: calendar-november (city=Москва, 2026-11, event_types=noC,exA).
 * Сравниваем набор событий и поля; даты — с допуском 1 минута.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createModule from '../dist/sweph.mjs';
import { createSweph } from '../src/sweph.js';
import { computeCalendar } from '../src/calendar.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenDir = process.env.E2E_GOLDEN
	|| '/home/dmyr/app/src/astro3d-e2e/internal/contract/testdata/golden';
const doc = JSON.parse(readFileSync(path.join(goldenDir, 'calendar-november.json'), 'utf8'));
const want = doc.body.data;

const swe = await createSweph(createModule, {
	ephePath: '/ephe',
	moduleOptions: { locateFile: (p) => path.join(root, 'dist', p) },
});

const startMs = Date.UTC(2026, 10, 1) - 24 * 3600 * 1000;
const endMs = Date.UTC(2026, 11, 1) + 24 * 3600 * 1000;
const t0 = performance.now();
const got = await computeCalendar(swe, {
	startMs, endMs, timeZone: 'Europe/Moscow', eventTypes: ['noC', 'exA'],
});
const ms = performance.now() - t0;

const key = (e) => `${e.t}|${(e.p || []).join(',')}|${e.a || ''}|${e.d}`;
const sort = (list) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
const wa = sort(want);
const ga = sort(got);

const fails = [];
if (wa.length !== ga.length) fails.push(`количество: ${wa.length} != ${ga.length}`);
for (let i = 0; i < Math.min(wa.length, ga.length); i++) {
	const w = wa[i];
	const g = ga[i];
	const fields = ['t', 'p', 'a', 'de', 's', 'chS', 'end', 'r'];
	for (const f of fields) {
		if (JSON.stringify(w[f]) !== JSON.stringify(g[f])) {
			fails.push(`[${i}] ${f}: ${JSON.stringify(w[f])} != ${JSON.stringify(g[f])} (${w.d})`);
		}
	}
	const dt = Math.abs(Date.parse(w.d + 'Z') - Date.parse(g.d + 'Z'));
	if (dt > 60000) fails.push(`[${i}] date: ${w.d} != ${g.d} (${dt} мс)`);
}

console.log(JSON.stringify({
	events: `${got.length}/${want.length}`,
	ms: Math.round(ms),
	diffs: fails.length,
}, null, 2));
if (fails.length) {
	for (const f of fails.slice(0, 20)) console.error('  ' + f);
	process.exit(1);
}
console.log('календарь: паритет ok');
