#include <hamlib/rig.h>
#include <string.h>

/* Link-only probe. Runtime validation requires a real Windows host. */
int main(void) {
    rig_debug_clear();
    if (strcmp(rigerror2(-RIG_EIO), "IO error\n")) return 1;
    if (!strstr(rigerror(-RIG_EINVAL), "Invalid parameter\n")) return 1;
    return 0;
}
