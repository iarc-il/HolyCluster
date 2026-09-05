#!/usr/bin/env bash
set -euo pipefail

crate_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
include_dir=${HAMLIB_INCLUDE_DIR:?set HAMLIB_INCLUDE_DIR to the Hamlib 4.7.2 include directory}
bindgen_bin=${BINDGEN_BIN:-bindgen}
output=${1:-"$crate_dir/src/bindings.rs"}

test "$("$bindgen_bin" --version)" = "bindgen 0.71.1"
test -f "$include_dir/hamlib/rig.h"
test -f "$include_dir/hamlib/riglist.h"
test "$(sha256sum "$include_dir/hamlib/rig.h" | cut -d' ' -f1)" = a2cfaedc3d92a641515ff58785db5bd1c30f62e562f63b8dadeee70202e000bd
test "$(sha256sum "$include_dir/hamlib/riglist.h" | cut -d' ' -f1)" = 08be8cf49b5c2f8ab5f2a328ec18269a4115db68b1361c497b8a97983bde00d1
"$bindgen_bin" "$crate_dir/wrapper.h" --output "$output" \
  --allowlist-type 's_rig|RIG|rig_caps|hamlib_sys_rig_caps_metadata|confparams|rig_errcode_e|rig_conf_e|rig_status_e' \
  --allowlist-type 'rig_model_t|freq_t|shortfreq_t|pbwidth_t|vfo_t|rmode_t|hamlib_token_t|rig_ptr_t|ptt_type_t|dcd_type_t|rig_port_t' \
  --allowlist-function 'hamlib_sys_rig_caps_metadata|rig(_(init|open|close|cleanup|set_conf|get_conf2|token_lookup|confparam_lookup|token_foreach|ext_(lookup|lookup_tok|token_lookup|func_foreach|level_foreach|parm_foreach)|set_freq|get_freq|set_mode|get_mode|set_vfo|get_vfo|load_all_backends|load_backend|check_backend|list_foreach|list_foreach_model|get_caps)|error2?)' \
  --allowlist-var '^RIG_MODEL_(NONE|DUMMY)$' \
  --allowlist-var '^RIG_VFO_(NONE|A|B|CURR)$' \
  --allowlist-var '^RIG_MODE_(NONE|AM|CW|USB|LSB|FM|PKTUSB|PKTLSB|RTTY|RTTYR)$' \
  --allowlist-var '^HAMLIB_SYS_RIG_(MODEL_DUMMY|VFO_(A|B|CURR)|MODE_(AM|CW|USB|LSB|FM|PKTUSB|PKTLSB|RTTY|RTTYR))$' \
  --opaque-type 's_rig|rig_caps' --no-layout-tests --no-doc-comments --no-recursive-allowlist -- -I"$include_dir"
