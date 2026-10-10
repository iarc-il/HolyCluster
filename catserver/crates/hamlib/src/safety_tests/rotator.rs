use crate::Position;

#[test]
fn position_rejects_non_finite_values() {
    assert!(Position::new(f64::NAN, 0.0).is_err());
    assert!(Position::new(0.0, f64::INFINITY).is_err());
    assert_eq!(Position::new(-180.0, -91.0).unwrap().azimuth, -180.0);
    assert_eq!(Position::new(450.0, 91.0).unwrap().azimuth, 450.0);
}
