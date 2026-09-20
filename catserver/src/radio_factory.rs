use crate::{
    dummy::DummyRadio,
    hamlib_radio::HamlibRadio,
    radio_actor::RadioFactory,
    radio_config::{ActiveRadioBackend, RadioConfig, RadioRigConfig, ResolvedRadioModel},
    rig::{Radio, UnavailableRadio},
};

#[cfg(windows)]
use crate::omnirig::OmnirigRadio;

pub(crate) fn factory(config: RadioConfig, selected: ActiveRadioBackend) -> RadioFactory {
    std::sync::Arc::new(move || build(&config, &selected))
}

fn build(config: &RadioConfig, selected: &ActiveRadioBackend) -> Box<dyn Radio> {
    match selected {
        ActiveRadioBackend::Dummy => Box::new(DummyRadio::new()),
        ActiveRadioBackend::Configured(_) => radio(config.rig.as_ref()),
    }
}

fn radio(config: Option<&RadioRigConfig>) -> Box<dyn Radio> {
    let Some(config) = config else {
        return Box::new(UnavailableRadio::new("unconfigured"));
    };
    match crate::radio_config::resolve_model_id(&config.model_id) {
        Ok(ResolvedRadioModel::Hamlib(_)) => match config.hamlib_config() {
            Some(hamlib) => Box::new(HamlibRadio::new(hamlib)),
            None => Box::new(UnavailableRadio::new("hamlib")),
        },
        Ok(ResolvedRadioModel::Omnirig(slot)) => {
            #[cfg(windows)]
            {
                Box::new(OmnirigRadio::new(slot))
            }
            #[cfg(not(windows))]
            {
                let _ = slot;
                Box::new(UnavailableRadio::new("omnirig"))
            }
        }
        Err(_) => Box::new(UnavailableRadio::new("unconfigured")),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::factory;
    use crate::{
        freq::Freq,
        radio_config::{RadioConfig, RadioRigConfig},
        radio_manager::{ConnectionState, RadioManager},
        rig::Mode,
    };

    #[tokio::test]
    async fn initializes_and_operates_configured_single_hamlib_rig() {
        let config = RadioConfig {
            rig: Some(RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: BTreeMap::new(),
            }),
        };
        let selected = config.effective_backend(false);
        let manager = RadioManager::new(config.clone(), selected.clone()).unwrap();
        let radio_factory = factory(config.clone(), selected.clone());

        manager
            .replace(config, selected, move || radio_factory())
            .await
            .unwrap();

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.connection, ConnectionState::Connected);
        assert_eq!(snapshot.last_error, None);
        assert_eq!(snapshot.last_status.current_rig, 1);

        manager
            .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_100_000))
            .await
            .unwrap();
        assert_eq!(
            (
                manager.status().current_rig,
                manager.status().freq,
                manager.status().mode.as_str()
            ),
            (1, 7_100_000, "CW")
        );
        manager.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn unconfigured_radio_is_unavailable() {
        let config = RadioConfig::platform_default();
        let selected = config.effective_backend(false);
        let manager = RadioManager::new(config.clone(), selected.clone()).unwrap();
        let radio_factory = factory(config.clone(), selected.clone());

        manager
            .replace(config, selected, move || radio_factory())
            .await
            .unwrap();

        assert_eq!(manager.snapshot().connection, ConnectionState::Disconnected);
        assert!(manager.snapshot().last_error.is_some());
        manager.shutdown().await.unwrap();
    }
}
