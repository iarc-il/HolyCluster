#![deny(unsafe_code)]

#[allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    unsafe_code
)]
mod bindings;

pub use bindings::*;
