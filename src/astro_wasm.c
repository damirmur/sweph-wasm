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

/* astro_positions — позиции на одном срезе (для уточнения точных аспектов).
 * Та же семантика, что у astro_period с n_steps=1, но без цикла по срезам. */
int astro_positions(double jd_ut, const int32_t *ids, int n_ids,
                    double *lon, double *lat, double *speed) {
	char serr[256];
	int k;
	for (k = 0; k < n_ids; k++) {
		double xx[6];
		int32_t r;
		serr[0] = '\0';
		r = swe_calc_ut(jd_ut, ids[k], SEFLG_SWIEPH | SEFLG_SPEED, xx, serr);
		if (r < 0) {
			return -(k + 1);
		}
		lon[k] = xx[0];
		lat[k] = xx[1];
		speed[k] = xx[3];
	}
	return n_ids;
}

/* astro_house_pos — номер дома для уже посчитанной позиции (для синастрии:
 * планеты второй карты ставятся в дома первой). */
int astro_house_pos(double armc, double geolat, double eps, int hsys,
                    double lon, double lat) {
	double xx[6];
	char serr[256];
	xx[0] = lon;
	xx[1] = lat;
	xx[2] = 0.0;
	xx[3] = 0.0;
	xx[4] = 0.0;
	xx[5] = 0.0;
	serr[0] = '\0';
	return (int)swe_house_pos(armc, geolat, eps, hsys, xx, serr);
}

/* astro_natal — натальная карта: дома + планеты с номерами домов.
 * cusps — 13 double (1..12), ascmc — 10 double; массивы планет — n_ids.
 * Возвращает 0 или отрицательный номер сбойной планеты. */
int astro_natal(double jd_ut, double geolat, double geolon, int hsys,
                const int32_t *ids, int n_ids,
                double *cusps, double *ascmc,
                double *lon, double *lat, double *speed, int *house) {
	double cusp[13];
	double angles[10];
	double armc, eps[6];
	char serr[256];
	int k;

	serr[0] = '\0';
	if (swe_houses(jd_ut, geolat, geolon, hsys, cusp, angles) < 0) {
		return -1;
	}
	memcpy(cusps, cusp, sizeof(cusp));
	memcpy(ascmc, angles, sizeof(angles));
	armc = angles[2];

	serr[0] = '\0';
	if (swe_calc_ut(jd_ut, SE_ECL_NUT, SEFLG_SWIEPH, eps, serr) < 0) {
		return -1;
	}

	for (k = 0; k < n_ids; k++) {
		double xx[6];
		serr[0] = '\0';
		if (swe_calc_ut(jd_ut, ids[k], SEFLG_SWIEPH | SEFLG_SPEED, xx, serr) < 0) {
			return -(k + 1);
		}
		lon[k] = xx[0];
		lat[k] = xx[1];
		speed[k] = xx[3];
		house[k] = (int)swe_house_pos(armc, geolat, eps[0], hsys, xx, serr);
	}
	return 0;
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
