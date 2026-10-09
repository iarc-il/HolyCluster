#define _POSIX_C_SOURCE 200809L
#include <hamlib/rig.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static pthread_barrier_t gate;
static _Atomic unsigned callback_errors;
static int callback(enum rig_debug_level_e level, rig_ptr_t arg, const char *fmt, va_list ap) {
    char text[256];
    (void)level; (void)arg;
    vsnprintf(text, sizeof(text), fmt, ap);
    if (strncmp(text, "writer", 6)) ++callback_errors;
    /* Callback re-entry into error/history APIs must not deadlock. */
    if (strcmp(rigerror2(-RIG_EIO), "IO error\n")) ++callback_errors;
    if (!strstr(rigerror(-RIG_EIO), "IO error\n")) ++callback_errors;
    return 0;
}

static unsigned overflow_callbacks;
static int overflow_callback(enum rig_debug_level_e level, rig_ptr_t arg, const char *fmt, va_list ap) {
    char text[256];
    (void)level; (void)arg;
    vsnprintf(text, sizeof(text), fmt, ap);
    if (!strstr(text, "debugmsgsave overflow!!")) ++callback_errors;
    ++overflow_callbacks;
    /* This would deadlock if overflow logging held the history lock. */
    if (!strstr(rigerror(-RIG_EIO), "IO error\n")) ++callback_errors;
    return 0;
}

struct worker { int id; unsigned errors; };
static const char *short_refs[] = {"Invalid parameter\n", "IO error\n"};
static void *lifetime(void *arg) {
    struct worker *w = arg;
    for (unsigned i = 0; i < 1000; ++i) {
        const char *short_text = NULL, *history = NULL;
        char saved[DEBUGMSGSAVE_SIZE];
        if (w->id == 0) {
            short_text = rigerror2(-RIG_EINVAL);
            history = rigerror(-RIG_EINVAL);
            strcpy(saved, history);
        }
        pthread_barrier_wait(&gate);
        if (w->id == 1) {
            short_text = rigerror2(-RIG_EIO);
            history = rigerror(-RIG_EIO);
            if (strcmp(short_text, short_refs[1]) || !strstr(history, short_refs[1])) ++w->errors;
        }
        pthread_barrier_wait(&gate);
        if (w->id == 0 && (strcmp(short_text, short_refs[0]) || strcmp(history, saved))) ++w->errors;
        pthread_barrier_wait(&gate);
    }
    return NULL;
}
static int valid_history(char *snapshot) {
    char *save = NULL;
    for (char *line = strtok_r(snapshot, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
        char id, tail, extra; unsigned iteration;
        if (!strcmp(line, "Invalid parameter") || !strcmp(line, "IO error")) continue;
        if (sscanf(line, "writer%c:%u:writer%c%c", &id, &iteration, &tail, &extra) != 3
            || (id != 'A' && id != 'B') || id != tail || iteration >= 20000) return 0;
    }
    return 1;
}
static void *concurrent(void *arg) {
    struct worker *w = arg;
    pthread_barrier_wait(&gate);
    for (unsigned i = 0; i < 20000; ++i) {
        if (w->id < 2) {
            char id = w->id == 0 ? 'A' : 'B';
            rig_debug(RIG_DEBUG_TRACE, "writer%c:%08u:writer%c\n", id, i, id);
        } else if (w->id == 2) {
            char snapshot[DEBUGMSGSAVE_SIZE];
            strcpy(snapshot, rigerror(-RIG_EINVAL));
            size_t len = strlen(snapshot), suffix = strlen(short_refs[0]);
            if (len < suffix || strcmp(snapshot + len - suffix, short_refs[0]) || !valid_history(snapshot)) ++w->errors;
        } else {
            rig_debug_clear();
        }
    }
    return NULL;
}
static unsigned run(unsigned count, void *(*fn)(void *)) {
    pthread_t threads[4]; struct worker workers[4] = {{0,0},{1,0},{2,0},{3,0}};
    if (pthread_barrier_init(&gate, NULL, count)) exit(2);
    for (unsigned i=0; i<count; ++i) if (pthread_create(&threads[i], NULL, fn, &workers[i])) exit(2);
    unsigned errors = 0;
    for (unsigned i=0; i<count; ++i) {
        if (pthread_join(threads[i], NULL)) exit(2);
        errors += workers[i].errors;
    }
    pthread_barrier_destroy(&gate);
    return errors;
}
int main(void) {
    unsigned errors = 0;
    rig_debug_clear();
    for (unsigned i=0; i<20; ++i) {
        char line[64]; snprintf(line, sizeof(line), "history-%02u\n", i); add2debugmsgsave(line);
    }
    const char *history = rigerror(-RIG_EINVAL);
    if (strstr(history, "history-00\n")) ++errors;
    for (unsigned i=1; i<20; ++i) {
        char line[64]; snprintf(line, sizeof(line), "history-%02u\n", i);
        if (!strstr(history, line)) ++errors;
    }
    if (!strstr(history, short_refs[0])) ++errors;
    printf("retained_history mismatches=%u\n", errors);
    rig_debug_clear();
    unsigned lifetime_errors = run(2, lifetime);
    printf("cross_thread_storage calls=4000 mismatches=%u\n", lifetime_errors);
    errors += lifetime_errors;
    rig_debug_clear();
    rig_set_debug(RIG_DEBUG_TRACE);
    rig_set_debug_callback(callback, NULL);
    unsigned concurrent_errors = run(4, concurrent);
    rig_set_debug_callback(NULL, NULL);
    printf("concurrent_debug_history_clear calls=80000 mismatches=%u callback_mismatches=%u\n", concurrent_errors, callback_errors);
    errors += concurrent_errors;
    rig_debug_clear();
    rig_set_debug_callback(overflow_callback, NULL);
    char oversized[DEBUGMSGSAVE_SIZE + 1];
    memset(oversized, 'X', sizeof(oversized) - 1);
    oversized[sizeof(oversized) - 1] = 0;
    add2debugmsgsave(oversized);
    rig_set_debug_callback(NULL, NULL);
    if (overflow_callbacks != 1) ++errors;
    printf("overflow_callback calls=%u mismatches=%u\n", overflow_callbacks, callback_errors);
    errors += callback_errors;
    return errors == 0 ? 0 : 1;
}
