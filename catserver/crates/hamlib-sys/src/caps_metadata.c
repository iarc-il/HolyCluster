#include "../wrapper.h"

const struct hamlib_sys_rig_caps_metadata *hamlib_sys_rig_caps_metadata(
    const struct rig_caps *caps) {
    return (const struct hamlib_sys_rig_caps_metadata *)caps;
}

const struct hamlib_sys_rot_caps_metadata *hamlib_sys_rot_caps_metadata(
    const struct rot_caps *caps) {
    return (const struct hamlib_sys_rot_caps_metadata *)caps;
}

int hamlib_sys_rot_caps_can_get_position(const struct rot_caps *caps) {
    return caps->get_position != 0;
}

int hamlib_sys_rot_caps_can_set_position(const struct rot_caps *caps) {
    return caps->set_position != 0;
}

azimuth_t hamlib_sys_rot_caps_min_az(const struct rot_caps *caps) {
    return caps->min_az;
}

azimuth_t hamlib_sys_rot_caps_max_az(const struct rot_caps *caps) {
    return caps->max_az;
}
