#define rig_debug_clear() { debugmsgsave[0] = debugmsgsave2[0] = debugmsgsave3[0] = 0; };
#ifndef __cplusplus
#ifdef __GNUC__
// doing the debug macro with a dummy sprintf allows gcc to check the format string
#define rig_debug(debug_level,fmt,...) do { snprintf(debugmsgsave2,sizeof(debugmsgsave2),fmt,__VA_ARGS__);rig_debug(debug_level,fmt,##__VA_ARGS__); add2debugmsgsave(debugmsgsave2); } while(0)
#endif
#endif
