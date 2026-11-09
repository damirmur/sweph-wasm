/**
 * bench.mjs — замер wasm-расчётов в Chromium с троттлингом CPU.
 *
 *   node bench/bench.mjs            # 1×/4×/6×, 1/5/10 лет
 *   node bench/bench.mjs --quick    # только 1× и 4×, 1 и 10 лет
 *
 * Поднимает статический сервер на 127.0.0.1:18100 (корень репозитория),
 * открывает web/bench.html и вызывает window.runBench в странице.
 * Результат — JSON в stdout; таблица для BENCH.md — в конце.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BENCH_PORT || 18100);
const quick = process.argv.includes('--quick');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.wasm': 'application/wasm',
	'.data': 'application/octet-stream',
	'.json': 'application/json',
	'.se1': 'application/octet-stream',
};

function serve() {
	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
			let p = decodeURIComponent(url.pathname);
			if (p === '/') p = '/web/bench.html';
			const file = path.join(root, p);
			if (!file.startsWith(root + path.sep)) {
				res.writeHead(403);
				res.end('forbidden');
				return;
			}
			const buf = await readFile(file);
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
			res.end(buf);
		} catch {
			res.writeHead(404);
			res.end('not found');
		}
	});
	return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function median(values) {
	const a = [...values].sort((x, y) => x - y);
	const m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const server = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const rates = quick ? [1, 4] : [1, 4, 6];
const yearsList = quick ? [1, 10] : [1, 5, 10];
const rows = [];

try {
	for (const rate of rates) {
		const context = await browser.newContext();
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate });
		page.on('console', (m) => {
			if (m.type() === 'error') console.error('[page]', m.text());
		});
		await page.goto(`http://127.0.0.1:${PORT}/web/bench.html`, { waitUntil: 'load' });
		await page.waitForFunction('window.benchReady === true', null, { timeout: 180000 });

		for (const years of yearsList) {
			const r = await page.evaluate(({ years }) => window.runBench({ years, repeats: 3 }), { years });
			rows.push({ rate, years, steps: r.steps, planets: r.planets, ms: Math.round(r.ms), runs: r.runs.map((x) => Math.round(x)), version: r.version });
			console.log(`×${rate}  ${years} лет  ${r.steps} срезов  ${Math.round(r.ms)} мс  (${r.runs.map((x) => Math.round(x)).join(', ')})`);
		}

		for (const years of quick ? [1, 10] : [1, 5, 10]) {
			const r = await page.evaluate(({ years }) => window.runNatalPeriodBench({ years }), { years });
			rows.push({ rate, years, natalPeriod: true, steps: r.steps, events: r.events, ms: Math.round(r.ms) });
			console.log(`×${rate}  natal-period ${years} лет  ${r.steps} срезов, ${r.events} событий  ${Math.round(r.ms)} мс`);
		}
		if (rate === 1 || rate === 6) {
			for (const years of [1, 10]) {
				const r = await page.evaluate(({ years }) => window.runNatalPeriodBench({ years, refine: 'newton' }), { years });
				rows.push({ rate, years, natalPeriod: true, newton: true, steps: r.steps, events: r.events, ms: Math.round(r.ms) });
				console.log(`×${rate}  natal-period (newton) ${years} лет  ${r.steps} срезов, ${r.events} событий  ${Math.round(r.ms)} мс`);
			}
		}

		if (rate === 1) {
			const w = await page.evaluate(() => window.runWorkerBench({ years: 1 }));
			console.log(`worker: 1 год — ${Math.round(w.ms)} мс, прогресс-событий: ${w.progress}`);
			const c = await page.evaluate(() => window.runCancelBench({ years: 10 }));
			console.log(`отмена: ${c.cancelled ? 'сработала' : 'НЕ сработала'} (${c.name})`);
			rows.push({ rate: 0, years: 1, steps: w.steps, planets: w.planets, ms: Math.round(w.ms), runs: [], version: w.version, worker: true, progress: w.progress });
			rows.push({ rate: 0, years: 10, cancel: c.cancelled, name: c.name });
		}
		await context.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log('\nJSON:');
console.log(JSON.stringify(rows, null, 2));

console.log('\nMarkdown:');
console.log('| CPU | Период | Срезов | Время, мс |');
console.log('|---|---|---|---|');
for (const r of rows.filter((x) => x.rate > 0 && !x.natalPeriod)) {
	console.log(`| ×${r.rate} | ${r.years} г. | ${r.steps} | ${r.ms} |`);
}
const w = rows.find((x) => x.worker);
if (w) console.log(`| ×1 (worker) | 1 г. | ${w.steps} | ${w.ms} |`);
console.log('\n| CPU | natal-period | Срезов | Событий | Время, мс |');
console.log('|---|---|---|---|---|');
for (const r of rows.filter((x) => x.natalPeriod)) {
	console.log(`| ×${r.rate}${r.newton ? ' newton' : ''} | ${r.years} г. | ${r.steps} | ${r.events} | ${r.ms} |`);
}
console.log(`\nмедиана по 3 прогонам (позиции); natal-period — один прогон; версия SE: ${rows[0]?.version}`);
