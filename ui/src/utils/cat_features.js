import { compare_version } from "@/utils.js";

export const NATIVE_UPDATER_MIN_VERSION = [1, 2, 0, 1];
export const ROTATOR_MIN_VERSION = [1, 2, 0, 1];
export const RTTY_TUNING_MIN_VERSION = [1, 3, 0, 0];

export function supports_cat_feature(local_version, minimum_version) {
    return compare_version(local_version, minimum_version) >= 0;
}
