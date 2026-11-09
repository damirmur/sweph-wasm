/**
 * worker.js — Web Worker для расчётов: прогресс и отмена без блокировки UI.
 *
 * Сообщения:
 *   {type:'init'}                                  → {type:'ready', version}
 *   {type:'calc', id, startJd, stepDays, steps, planets, chunkSteps}
 *        → {type:'progress', id, done, total} ... → {type:'done', id, ms, lon, lat, speed, steps, planets}
 *   {type:'cancel', id}                            → расчёт прерывается между пачками
 */
import createModule from '../dist/sweph.mjs';
import { createSweph } from '../src/sweph.js';

let swe = null;
const jobs = new Map();

async function ensure() {
	if (!swe) swe = await createSweph(createModule, { ephePath: '/ephe', moduleOptions: { locateFile: (p) => '/dist/' + p } });
	return swe;
}

self.onmessage = async (ev) => {
	const msg = ev.data || {};

	if (msg.type === 'init') {
		try {
			const s = await ensure();
			self.postMessage({ type: 'ready', version: s.version });
		} catch (err) {
			self.postMessage({ type: 'error', message: String(err) });
		}
		return;
	}

	if (msg.type === 'cancel') {
		const ac = jobs.get(msg.id);
		if (ac) ac.abort();
		return;
	}

	if (msg.type === 'calc') {
		const ac = new AbortController();
		jobs.set(msg.id, ac);
		try {
			const s = await ensure();
			const t0 = performance.now();
			const res = await s.period({
				startJd: msg.startJd,
				stepDays: msg.stepDays ?? 1,
				steps: msg.steps,
				planets: msg.planets,
				chunkSteps: msg.chunkSteps ?? 64,
				signal: ac.signal,
				onProgress: (p) => self.postMessage({ type: 'progress', id: msg.id, ...p }),
			});
			const ms = performance.now() - t0;
			self.postMessage(
				{ type: 'done', id: msg.id, ms, steps: res.steps, planets: res.planets, lon: res.lon, lat: res.lat, speed: res.speed },
				[res.lon.buffer, res.lat.buffer, res.speed.buffer],
			);
		} catch (err) {
			self.postMessage({ type: 'error', id: msg.id, name: err?.name || 'Error', message: String(err) });
		} finally {
			jobs.delete(msg.id);
		}
	}
};
