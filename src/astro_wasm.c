/*
 * astro_wasm.c — обёртка Swiss Ephemeris для WebAssembly.
 *
 * Смысл: не гонять JSON на каждый шаг. JS выделяет типизированные массивы,
 * C-цикл пишет в них долготы/широты/скорости, наружу уходит только результат.
 *
 * Сборка: scripts/build-wasm.sh (emcc) и scripts/build-native.sh (gcc).
 * Единицы: jd — юлианская дата UT, шаг — сутки (дробные допустимы),
 * долготы/широты — градусы, скорость — градусы в сутки.
 */
#include <stdint.h>
#include <string.h>

#include "swephexp.h"

/* astro_init — задать путь к файлам эфемерид в виртуальной ФС Emscripten.
 * В браузере это "/ephe" (каталог из --preload-file), в нативном CLI — обычный. */
void astro_init(const char *ephe_path) {
	swe_set_ephe_path((char *)ephe_path);
}

/* astro_utc_to_jd — UTC → юлианская дата UT (с leap seconds внутри SE).
 * Возвращает 0 при ошибке (валидные JD для нашей эпохи всегда > 0). */
double astro_utc_to_jd(int year, int month, int day, int hour, int minute, double second) {
	double dret[2];
	char serr[256];
	serr[0] = '\0';
	if (swe_utc_to_jd(year, month, day, hour, minute, second, SE_GREG_CAL, dret, serr) < 0) {
		return 0.0;
	}
	return dret[1]; /* dret[0] — ET, dret[1] — UT */
}

/* astro_period — позиции планет на n_steps срезах, начиная с jd_start.
 * ids — массив идентификаторов SE (0=Солнце, 1=Луна, ...).
 * lon/lat/speed — массивы длины n_steps*n_ids, построчно (срез × планета).
 * Возвращает число посчитанных срезов; отрицательное — номер сбойного
 * элемента (step*n_ids + k + 1), чтобы JS понял, на чём остановились. */
int astro_period(double jd_start, double step_days, int n_steps,
                 const int32_t *ids, int n_ids,
                 double *lon, double *lat, double *speed) {
	char serr[256];
	int step, k;
	for (step = 0; step < n_steps; step++) {
		double jd = jd_start + (double)step * step_days;
		for (k = 0; k < n_ids; k++) {
			double xx[6];
			int32_t r;
			serr[0] = '\0';
			r = swe_calc_ut(jd, ids[k], SEFLG_SWIEPH | SEFLG_SPEED, xx, serr);
			if (r < 0) {
				return -(step * n_ids + k + 1);
			}
			{
				size_t o = (size_t)step * (size_t)n_ids + (size_t)k;
				lon[o] = xx[0];
				lat[o] = xx[1];
				speed[o] = xx[3];
			}
		}
	}
	return n_steps;
}

/* astro_houses — куспиды и углы домов. cusps — 13 double (индекс 1..12),
 * ascmc — 10 double (Asc, MC, ARMC, Vertex, ...). Возвращает код swe_houses. */
int astro_houses(double jd_ut, double geolat, double geolon, int hsys,
                 double *cusps, double *ascmc) {
	double cusp[13];
	double angles[10];
	int r = swe_houses(jd_ut, geolat, geolon, hsys, cusp, angles);
	if (r < 0) {
		return r;
	}
	memcpy(cusps, cusp, sizeof(cusp));
	memcpy(ascmc, angles, sizeof(angles));
	return r;
}

/* astro_version — версия Swiss Ephemeris в буфер (например, "2.10.03"). */
void astro_version(char *buf) {
	swe_version(buf);
}
