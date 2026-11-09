/**
 * bench.js — стенд для замера wasm-расчётов в браузере.
 * Playwright вызывает window.runBench / window.runWorkerBench.
 */
import createModule from '../dist/sweph.mjs';
import { createSweph, DEFAULT_PLANETS } from '../src/sweph.js';

let swePromise = null;
function swe() {
	// locateFile обязателен: по умолчанию emscripten ищет .wasm/.data рядом
	// со страницей (/web/), а они лежат в /dist/.
	if (!swePromise) swePromise = createSweph(createModule, { ephePath: '/ephe', moduleOptions: { locateFile: (p) => '/dist/' + p } });
	return swePromise;
}

function median(values) {
	const a = [...values].sort((x, y) => x - y);
	const m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Прямой расчёт в главном потоке (чистое время C-цикла + копирование). */
window.runBench = async ({ years = 1, stepDays = 1, planets = DEFAULT_PLANETS, chunkSteps = 64, repeats = 1 } = {}) => {
	const s = await swe();
	const steps = Math.round((years * 365.25) / stepDays);
	const startJd = s.utcToJd({ year: 2026, month: 1, day: 1 });
	const runs = [];
	let checksum = 0;
	for (let i = 0; i < repeats; i++) {
		const t0 = performance.now();
		const res = await s.period({ startJd, stepDays, steps, planets, chunkSteps });
		runs.push(performance.now() - t0);
		checksum = res.lon[0] + res.lon[res.lon.length - 1];
	}
	return {
		years, stepDays, steps, planets: planets.length, repeats,
		ms: median(runs), runs, checksum, version: s.version,
	};
};

/** Расчёт в Web Worker: прогресс и отмена. */
window.runWorkerBench = async ({ years = 1, stepDays = 1, planets = DEFAULT_PLANETS, chunkSteps = 64 } = {}) => {
	const s = await swe();
	const steps = Math.round((years * 365.25) / stepDays);
	const startJd = s.utcToJd({ year: 2026, month: 1, day: 1 });

	const worker = new Worker('/web/worker.js', { type: 'module' });
	try {
		await new Promise((resolve, reject) => {
			worker.onmessage = (ev) => {
				if (ev.data?.type === 'ready') resolve(ev.data);
				else if (ev.data?.type === 'error') reject(new Error(ev.data.message));
			};
			worker.postMessage({ type: 'init' });
		});

		const result = await new Promise((resolve, reject) => {
			let progress = 0;
			worker.onmessage = (ev) => {
				const m = ev.data;
				if (m.type === 'progress') progress++;
				else if (m.type === 'done') resolve({ ms: m.ms, progress, version: s.version });
				else if (m.type === 'error') reject(new Error(m.message));
			};
			worker.postMessage({ type: 'calc', id: 1, startJd, stepDays, steps, planets, chunkSteps });
		});
		return { years, steps, planets: planets.length, ...result };
	} finally {
		worker.terminate();
	}
};

/** Проверка отмены: стартуем длинный расчёт и отменяем после первого прогресса. */
window.runCancelBench = async ({ years = 10, stepDays = 1, planets = DEFAULT_PLANETS, chunkSteps = 32 } = {}) => {
	const s = await swe();
	const steps = Math.round((years * 365.25) / stepDays);
	const startJd = s.utcToJd({ year: 2026, month: 1, day: 1 });
	const worker = new Worker('/web/worker.js', { type: 'module' });
	try {
		await new Promise((resolve, reject) => {
			worker.onmessage = (ev) => {
				if (ev.data?.type === 'ready') resolve();
				else if (ev.data?.type === 'error') reject(new Error(ev.data.message));
			};
			worker.postMessage({ type: 'init' });
		});
		return await new Promise((resolve, reject) => {
			let sent = false;
			worker.onmessage = (ev) => {
				const m = ev.data;
				if (m.type === 'progress' && !sent) {
					sent = true;
					worker.postMessage({ type: 'cancel', id: 7 });
				} else if (m.type === 'error') {
					resolve({ cancelled: m.name === 'AbortError', name: m.name, afterChunks: m.done ?? null });
				} else if (m.type === 'done') {
					reject(new Error('отмена не сработала: расчёт завершился'));
				}
			};
			worker.postMessage({ type: 'calc', id: 7, startJd, stepDays, steps, planets, chunkSteps });
		});
	} finally {
		worker.terminate();
	}
};

window.benchReady = true;
document.getElementById('status').textContent = 'готов';
