#include <hamlib/rig.h>
#include <hamlib/riglist.h>

enum {
    HAMLIB_SYS_RIG_MODEL_DUMMY = RIG_MODEL_DUMMY,
    HAMLIB_SYS_RIG_VFO_A = RIG_VFO_A,
    HAMLIB_SYS_RIG_VFO_B = RIG_VFO_B,
    HAMLIB_SYS_RIG_VFO_CURR = RIG_VFO_CURR,
    HAMLIB_SYS_RIG_MODE_AM = RIG_MODE_AM,
    HAMLIB_SYS_RIG_MODE_CW = RIG_MODE_CW,
    HAMLIB_SYS_RIG_MODE_USB = RIG_MODE_USB,
    HAMLIB_SYS_RIG_MODE_LSB = RIG_MODE_LSB,
    HAMLIB_SYS_RIG_MODE_FM = RIG_MODE_FM,
};

struct hamlib_sys_rig_caps_metadata {
    rig_model_t rig_model;
    const char *model_name;
    const char *mfg_name;
    const char *version;
    const char *copyright;
    enum rig_status_e status;
};

const struct hamlib_sys_rig_caps_metadata *hamlib_sys_rig_caps_metadata(
    const struct rig_caps *caps);
