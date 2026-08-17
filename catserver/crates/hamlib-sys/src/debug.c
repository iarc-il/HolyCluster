#include <stdarg.h>
#include <stdio.h>

#include <hamlib/rig.h>

static void (*hamlib_sys_log_callback)(int, const char *);

static int hamlib_sys_debug_callback(enum rig_debug_level_e level,
                                     rig_ptr_t arg,
                                     const char *format,
                                     va_list args)
{
    char message[8192];
    (void)arg;
    vsnprintf(message, sizeof(message), format, args);
    if (hamlib_sys_log_callback != NULL)
    {
        hamlib_sys_log_callback((int)level, message);
    }
    return 0;
}

void hamlib_sys_configure_debug(void (*callback)(int, const char *))
{
    hamlib_sys_log_callback = callback;
    rig_set_debug_callback(callback == NULL ? NULL : hamlib_sys_debug_callback, NULL);
    rig_set_debug(callback == NULL ? RIG_DEBUG_NONE : RIG_DEBUG_ERR);
}
