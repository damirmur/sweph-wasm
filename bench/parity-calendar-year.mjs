import path from 'node:path';
import createModule from '../dist/sweph.mjs';
import { createSweph } from '../src/sweph.js';
import { computeCalendar } from '../src/calendar.js';

const year = Number(process.env.YEAR || 2030);
const swe = await createSweph(createModule, {
	ephePath: '/ephe',
	moduleOptions: { locateFile: (p) => path.join(process.cwd(), 'dist', p) },
});

const t0 = performance.now();
const got = await computeCalendar(swe, {
	startMs: Date.UTC(year, 0, 1) - 24 * 3600 * 1000,
	endMs: Date.UTC(year, 11, 31, 23, 59) + 24 * 3600 * 1000,
	timeZone: 'UTC',
});
const ms = performance.now() - t0;

const api = await fetch(`http://127.0.0.1:8084/api/v1/calendar?year=${year}&month=0`).then((r) => r.json());
const want = api.data;

const key = (e) => `${e.t}|${(e.p || []).join(',')}|${e.a || ''}|${e.d}`;
const sort = (list) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
const wa = sort(want);
const ga = sort(got);
const fails = [];
if (wa.length !== ga.length) fails.push(`количество: ${wa.length} != ${ga.length}`);
for (let i = 0; i < Math.min(wa.length, ga.length); i++) {
	const w = wa[i];
	const g = ga[i];
	for (const f of ['t', 'p', 'a', 'de', 's', 'chS', 'end', 'r']) {
		if (JSON.stringify(w[f]) !== JSON.stringify(g[f])) fails.push(`[${i}] ${f}: ${JSON.stringify(w[f])} != ${JSON.stringify(g[f])} (${w.d})`);
	}
	const dt = Math.abs(Date.parse(w.d + 'Z') - Date.parse(g.d + 'Z'));
	if (dt > 60000) fails.push(`[${i}] date: ${w.d} != ${g.d} (${dt} мс)`);
}
console.log(JSON.stringify({ year, events: `${got.length}/${want.length}`, clientMs: Math.round(ms), diffs: fails.length }, null, 2));
if (fails.length) {
	for (const f of fails.slice(0, 15)) console.error('  ' + f);
	process.exit(1);
}
console.log('год: паритет ok');
