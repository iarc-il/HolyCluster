#define _POSIX_C_SOURCE 200809L
#include <hamlib/rig.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const int codes[] = {-RIG_EINVAL, -RIG_ENIMPL, -RIG_ETIMEOUT, -RIG_EIO};
static char refs[4][256];
static pthread_barrier_t gate;
static int coordinated;
static unsigned iterations;
struct sample { unsigned iteration; int code; char actual[256]; };
struct worker { int id; unsigned mismatches, wrong_code, other, samples; struct sample sample[8]; };
static void check(struct worker *w, unsigned i, unsigned idx, const char *actual) {
    if (!strcmp(actual, refs[idx])) return;
    ++w->mismatches;
    int known = 0;
    for (unsigned j=0; j<4; ++j) if (!strcmp(actual, refs[j])) known=1;
    if (known) ++w->wrong_code; else ++w->other;
    if (w->samples<8) {
        struct sample *s=&w->sample[w->samples++];
        s->iteration=i; s->code=codes[idx];
        snprintf(s->actual,sizeof(s->actual),"%s",actual);
    }
}
static void *run(void *arg) {
    struct worker *w=arg;
    char copied[256];
    pthread_barrier_wait(&gate);
    for (unsigned i=0; i<iterations; ++i) {
        unsigned idx=(i*2+w->id)%4;
        if (!coordinated) {
            const char *p=rigerror2(codes[idx]);
            strcpy(copied,p); /* Safe with patched thread-local storage. The unpatched
                                 baseline intentionally exercises its known data race (UB). */
            check(w,i,idx,copied);
        } else {
            /* Deliberately order A return, B return/copy, A copy. No overlapping writes. */
            const char *p=NULL;
            if (w->id==0) p=rigerror2(codes[idx]);
            pthread_barrier_wait(&gate);
            if (w->id==1) { p=rigerror2(codes[idx]); strcpy(copied,p); check(w,i,idx,copied); }
            pthread_barrier_wait(&gate);
            if (w->id==0) { strcpy(copied,p); check(w,i,idx,copied); }
            pthread_barrier_wait(&gate);
        }
    }
    return NULL;
}
static void escaped(const char *s) {
    putchar('"');
    for (;*s;++s) {
        if (*s=='\n') fputs("\\n",stdout);
        else if (*s=='\r') fputs("\\r",stdout);
        else if (*s=='"' || *s=='\\') { putchar('\\'); putchar(*s); }
        else if ((unsigned char)*s<32) printf("\\x%02x",(unsigned char)*s);
        else putchar(*s);
    }
    putchar('"');
}
int main(int argc,char **argv) {
    if (argc!=3) return 2;
    coordinated=!strcmp(argv[1],"coordinated");
    if (!coordinated && strcmp(argv[1],"normal")) return 2;
    iterations=(unsigned)strtoul(argv[2],NULL,10);
    if (!iterations || iterations>1000000) return 2;
    printf("hamlib_version=%s\nmode=%s iterations_per_thread=%u\n",hamlib_version,argv[1],iterations);
    for(unsigned i=0;i<4;++i) {
        strcpy(refs[i],rigerror2(codes[i]));
        printf("reference code=%d text=",codes[i]); escaped(refs[i]); puts("");
    }
    struct worker workers[2]={{.id=0},{.id=1}};
    pthread_t threads[2];
    int rc=pthread_barrier_init(&gate,NULL,2);
    if(rc) { fprintf(stderr,"barrier init failed: %d\n",rc); return 3; }
    for(int i=0;i<2;++i) if ((rc=pthread_create(&threads[i],NULL,run,&workers[i]))) { fprintf(stderr,"pthread_create failed: %d\n",rc); exit(3); }
    for(int i=0;i<2;++i) if ((rc=pthread_join(threads[i],NULL))) { fprintf(stderr,"pthread_join failed: %d\n",rc); exit(3); }
    unsigned total=0;
    for(int i=0;i<2;++i) {
        struct worker *w=&workers[i]; total+=w->mismatches;
        printf("thread=%d calls=%u mismatches=%u exact_other_code=%u mixed_or_incomplete=%u\n",i,iterations,w->mismatches,w->wrong_code,w->other);
        for(unsigned j=0;j<w->samples;++j) {
            struct sample *s=&w->sample[j];
            printf("sample thread=%d iteration=%u requested=%d actual=",i,s->iteration,s->code); escaped(s->actual); puts("");
        }
    }
    printf("TOTAL calls=%u mismatches=%u\n",iterations*2,total);
    pthread_barrier_destroy(&gate);
    return total == 0 ? 0 : 1; /* Incorrect diagnostics must fail the regression. */
}
