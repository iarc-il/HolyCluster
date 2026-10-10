use std::sync::Barrier;

use crate::{HamlibError, ffi::hamlib_result};

#[test]
fn concurrent_errors_copy_the_requested_native_diagnostic() {
    let gate = Barrier::new(2);
    let cases = [
        (-1, "Invalid parameter"),
        (-4, "Feature not implemented"),
        (-5, "Communication timed out"),
        (-6, "IO error"),
    ];
    let mismatches = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..2)
            .map(|id| {
                let gate = &gate;
                let cases = &cases;
                scope.spawn(move || {
                    gate.wait();
                    let mut mismatches = 0;
                    for iteration in 0..20_000 {
                        let (expected_code, expected_short) = cases[(iteration * 2 + id) % 4];
                        match hamlib_result("diagnostic regression", expected_code) {
                            Err(HamlibError::Call {
                                code,
                                short_message,
                                message,
                                ..
                            }) if code == expected_code
                                && short_message == expected_short
                                && message.ends_with(&format!("{expected_short}\n")) => {}
                            _ => mismatches += 1,
                        }
                    }
                    mismatches
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .sum::<usize>()
    });
    println!("Rust wrapper calls=40000 mismatches={mismatches}");
    assert_eq!(mismatches, 0);
}
