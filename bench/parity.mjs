/**
 * parity.mjs — паритет wasm против нативной сборки той же обёртки.
 *
 * Обе стороны используют одну и ту же версию Swiss Ephemeris (2.10.03) и те же
 * файлы .se1; разница должна быть на уровне ошибки округления double.
 *
 *   ./scripts/build-native.sh && ./scripts/build-wasm.sh && node bench/parity.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createModule from '../dist/sweph.mjs';
import { createSweph, DEFAULT_PLANETS } from '../src/sweph.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = path.join(root, 'dist/native/astro-bench');
const ephe = path.join(root, 'ephe');

const swe = await createSweph(createModule, {
	ephePath: '/ephe',
	moduleOptions: { locateFile: (p) => path.join(root, 'dist', p) },
});
const startJd = swe.utcToJd({ year: 1990, month: 1, day: 1 });
const steps = 400;
const stepDays = 1;
const planets = DEFAULT_PLANETS;

const out = execFileSync(
	native,
	[ephe, String(startJd), String(stepDays), String(steps), ...planets.map(String)],
	{ maxBuffer: 64 * 1024 * 1024 },
);
const ref = JSON.parse(out.toString('utf8'));
const res = await swe.period({ startJd, stepDays, steps, planets });

if (ref.steps !== steps || ref.n !== planets.length) {
	throw new Error(`нативная сборка вернула ${ref.steps}×${ref.n}, ожидалось ${steps}×${planets.length}`);
}

let maxLon = 0, maxLat = 0, maxSpeed = 0;
let atLon = 0, atLat = 0, atSpeed = 0;
for (let i = 0; i < steps; i++) {
	for (let k = 0; k < planets.length; k++) {
		const idx = i * planets.length + k;
		const base = idx * 4;
		const dLon = Math.abs(res.lon[idx] - ref.data[base + 1]);
		const dLat = Math.abs(res.lat[idx] - ref.data[base + 2]);
		const dSpeed = Math.abs(res.speed[idx] - ref.data[base + 3]);
		if (dLon > maxLon) { maxLon = dLon; atLon = idx; }
		if (dLat > maxLat) { maxLat = dLat; atLat = idx; }
		if (dSpeed > maxSpeed) { maxSpeed = dSpeed; atSpeed = idx; }
	}
}

const report = {
	wasmVersion: swe.version,
	nativeVersion: ref.version,
	steps,
	planets: planets.length,
	points: steps * planets.length,
	maxAbsDiff: {
		lon: maxLon, lonAt: atLon,
		lat: maxLat, latAt: atLat,
		speed: maxSpeed, speedAt: atSpeed,
	},
};
console.log(JSON.stringify(report, null, 2));

const limit = 1e-9;
if (maxLon > limit || maxLat > limit || maxSpeed > limit) {
	console.error(`ПРОВАЛ: расхождение больше ${limit}°`);
	process.exit(1);
}
console.log('паритет: ok');
