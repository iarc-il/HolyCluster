extern HAMLIB_EXPORT(void) hamlib_debug_history_clear(void);
#define rig_debug_clear() hamlib_debug_history_clear()
#ifndef __cplusplus
#ifdef __GNUC__
// doing the debug macro with a dummy sprintf allows gcc to check the format string
#define rig_debug(debug_level,fmt,...) do { char hamlib_debug_message_[DEBUGMSGSAVE_SIZE]; snprintf(hamlib_debug_message_,sizeof(hamlib_debug_message_),fmt,##__VA_ARGS__);rig_debug(debug_level,fmt,##__VA_ARGS__); add2debugmsgsave(hamlib_debug_message_); } while(0)
#endif
#endif
