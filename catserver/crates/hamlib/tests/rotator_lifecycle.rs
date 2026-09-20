use hamlib::{Rotator, RotatorModelId};

#[test]
fn dummy_opens_controls_closes_and_reopens() {
    let closed = Rotator::new(RotatorModelId::DUMMY).expect("dummy rotator initializes");
    let mut open = closed.open().expect("dummy rotator opens");
    open.set_azimuth(450.0).expect("dummy sets extended azimuth");
    assert!(open.position().expect("dummy reads position").azimuth.is_finite());

    let mut reopened = open
        .close()
        .expect("dummy rotator closes")
        .open()
        .expect("dummy rotator reopens");
    reopened
        .set_azimuth(270.0)
        .expect("dummy sets normalized azimuth");
    assert!(
        reopened
            .position()
            .expect("dummy reads position")
            .azimuth
            .is_finite()
    );
    reopened.close().expect("dummy rotator closes again");
}
