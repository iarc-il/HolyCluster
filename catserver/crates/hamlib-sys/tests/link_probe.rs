#[test]
fn rigerror_and_rig_ok_are_available() {
    assert_eq!(hamlib_sys::HAMLIB_SYS_RIG_MODEL_DUMMY, 1);
    // SAFETY: `rigerror` accepts Hamlib's valid `RIG_OK` error code and returns static storage.
    let message = unsafe { hamlib_sys::rigerror(hamlib_sys::rig_errcode_e_RIG_OK as i32) };
    assert!(!message.is_null());
}
