/*
 * native_cli.c — нативная сборка той же обёртки для проверки паритета с wasm.
 *
 *   ./dist/native/astro-bench <ephe> <jd_start> <step_days> <steps> <id> [id...]
 *
 * Печатает JSON: {"version":"2.10.03","steps":N,"n":K,"data":[jd,lon,lat,speed,...]}
 * Порядок data — построчно: срез × планета (как в astro_period).
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "swephexp.h"

void astro_init(const char *ephe_path);
void astro_version(char *buf);
int astro_period(double jd_start, double step_days, int n_steps,
                 const int32_t *ids, int n_ids,
                 double *lon, double *lat, double *speed);

int main(int argc, char **argv) {
	int i, n, steps, rc;
	double jd, step;
	int32_t *ids;
	double *lon, *lat, *speed;
	char version[256];

	if (argc < 6) {
		fprintf(stderr, "usage: %s <ephe> <jd_start> <step_days> <steps> <id> [id...]\n", argv[0]);
		return 2;
	}
	astro_init(argv[1]);
	jd = atof(argv[2]);
	step = atof(argv[3]);
	steps = atoi(argv[4]);
	n = argc - 5;

	ids = (int32_t *)malloc(sizeof(int32_t) * (size_t)n);
	lon = (double *)malloc(sizeof(double) * (size_t)n * (size_t)steps);
	lat = (double *)malloc(sizeof(double) * (size_t)n * (size_t)steps);
	speed = (double *)malloc(sizeof(double) * (size_t)n * (size_t)steps);
	if (!ids || !lon || !lat || !speed) {
		fprintf(stderr, "oom\n");
		return 3;
	}
	for (i = 0; i < n; i++) {
		ids[i] = (int32_t)atoi(argv[5 + i]);
	}

	rc = astro_period(jd, step, steps, ids, n, lon, lat, speed);
	if (rc < 0) {
		fprintf(stderr, "astro_period failed at %d\n", -rc);
		return 4;
	}

	astro_version(version);
	printf("{\"version\":\"%s\",\"steps\":%d,\"n\":%d,\"data\":[", version, steps, n);
	for (i = 0; i < steps * n; i++) {
		if (i) printf(",");
		printf("%.17g,%.17g,%.17g,%.17g", jd + (double)(i / n) * step, lon[i], lat[i], speed[i]);
	}
	printf("]}\n");

	free(ids);
	free(lon);
	free(lat);
	free(speed);
	return 0;
}
