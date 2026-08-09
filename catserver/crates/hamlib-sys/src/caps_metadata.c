#include "../wrapper.h"

const struct hamlib_sys_rig_caps_metadata *hamlib_sys_rig_caps_metadata(
    const struct rig_caps *caps) {
    return (const struct hamlib_sys_rig_caps_metadata *)caps;
}

const struct hamlib_sys_rot_caps_metadata *hamlib_sys_rot_caps_metadata(
    const struct rot_caps *caps) {
    return (const struct hamlib_sys_rot_caps_metadata *)caps;
}
