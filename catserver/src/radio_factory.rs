use crate::{
    dummy::DummyRadio,
    hamlib_radio::HamlibRadio,
    radio_actor::RadioFactory,
    radio_config::{ActiveRadioBackend, RadioBackendKind, RadioConfig},
    rig::{Radio, UnavailableRadio},
};

#[cfg(windows)]
use crate::omnirig::OmnirigRadio;
#[cfg(not(windows))]
use crate::rigctld::RigctldRadio;

pub(crate) fn factory(config: RadioConfig, selected: ActiveRadioBackend) -> RadioFactory {
    std::sync::Arc::new(move || build(&config, &selected))
}

fn build(config: &RadioConfig, selected: &ActiveRadioBackend) -> Box<dyn Radio> {
    match selected {
        ActiveRadioBackend::Dummy => Box::new(DummyRadio::new()),
        ActiveRadioBackend::Configured(RadioBackendKind::Hamlib) => config
            .hamlib
            .clone()
            .map(HamlibRadio::new)
            .map(|radio| Box::new(radio) as Box<dyn Radio>)
            .unwrap_or_else(|| Box::new(UnavailableRadio::new("hamlib"))),
        #[cfg(windows)]
        ActiveRadioBackend::Configured(RadioBackendKind::Omnirig) => Box::new(OmnirigRadio::new()),
        #[cfg(not(windows))]
        ActiveRadioBackend::Configured(RadioBackendKind::Rigctld) => {
            Box::new(RigctldRadio::new("localhost".into(), 4532))
        }
        ActiveRadioBackend::Configured(backend) => Box::new(UnavailableRadio::new(match backend {
            RadioBackendKind::Omnirig => "omnirig",
            RadioBackendKind::Rigctld => "rigctld",
            RadioBackendKind::Hamlib => unreachable!(),
        })),
    }
}
