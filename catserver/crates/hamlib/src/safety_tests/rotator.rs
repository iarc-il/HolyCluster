use crate::Position;

#[test]
fn position_rejects_invalid_values() {
    assert!(Position::new(-1.0, 0.0).is_err());
    assert!(Position::new(0.0, 91.0).is_err());
    assert!(Position::new(f64::NAN, 0.0).is_err());
    assert_eq!(Position::new(180.0, 45.0).unwrap().azimuth, 180.0);
}
