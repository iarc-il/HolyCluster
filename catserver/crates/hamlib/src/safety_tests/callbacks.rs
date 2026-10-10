use std::sync::atomic::{AtomicUsize, Ordering};

use hamlib_sys as sys;

use crate::{CatalogError, ConfigDescriptor, ConfigToken, ffi};

fn token() -> ConfigToken {
    "fixture".parse().expect("valid fixture token")
}

#[test]
fn callback_captures_typed_error_and_stops_without_overwriting_it() {
    let mut state = ffi::CallbackState::<u8>::new();
    let result = ffi::invoke_callback(&mut state, "fixture", || {
        Err(CatalogError::NullMetadata {
            subject: "fixture",
            field: "value",
        })
    });
    assert_eq!(result, 0);
    let result = ffi::invoke_callback(&mut state, "fixture", || {
        Err(CatalogError::DuplicateToken {
            token: "later".into(),
        })
    });
    assert_eq!(result, 0);
    assert_eq!(
        state.finish("fixture"),
        Err(CatalogError::NullMetadata {
            subject: "fixture",
            field: "value",
        })
    );
}

#[test]
fn callback_captures_panic_without_unwinding() {
    let mut state = ffi::CallbackState::<u8>::new();
    let result = ffi::invoke_callback(
        &mut state,
        "fixture",
        || -> Result<Option<u8>, CatalogError> { panic!("fixture panic") },
    );
    assert_eq!(result, 0);
    assert_eq!(
        state.finish("fixture"),
        Err(CatalogError::CallbackPanic {
            operation: "fixture"
        })
    );
}

#[test]
fn duplicate_tokens_are_rejected_by_production_collection() {
    let first = ConfigDescriptor::Text {
        token: token(),
        label: "first".into(),
        tooltip: "T".into(),
        default: "D".into(),
    };
    let second = ConfigDescriptor::Text {
        token: token(),
        label: "second".into(),
        tooltip: "T".into(),
        default: "D".into(),
    };
    assert!(matches!(
        ffi::unique_descriptors(vec![first, second]),
        Err(CatalogError::DuplicateToken { token }) if token == "fixture"
    ));
}

static CLEANUPS: AtomicUsize = AtomicUsize::new(0);

fn fixture_cleanup(_: *mut sys::RIG) -> i32 {
    CLEANUPS.fetch_add(1, Ordering::SeqCst);
    0
}

fn succeeds() {}

fn errors() {
    let _error: Result<(), CatalogError> = Err(CatalogError::UnknownModel {
        model: crate::RigModelId::DUMMY,
    });
}

fn panics() {
    let _ = std::panic::catch_unwind(|| panic!("fixture panic"));
}

#[test]
fn temporary_rig_cleans_up_exactly_once_on_success_error_and_panic() {
    CLEANUPS.store(0, Ordering::SeqCst);
    for action in [succeeds, errors, panics] {
        let _rig = ffi::TemporaryRig::with_cleanup(
            std::ptr::NonNull::<sys::RIG>::dangling().as_ptr(),
            fixture_cleanup,
        );
        action();
    }
    assert_eq!(CLEANUPS.load(Ordering::SeqCst), 3);
}
