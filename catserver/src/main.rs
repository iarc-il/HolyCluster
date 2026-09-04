#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::Result;

mod application;
mod args;
mod dummy;
mod dummy_rotator;
mod freq;
mod hamlib_radio;
#[cfg(windows)]
mod omnirig;
#[cfg(windows)]
mod pstrotator;
mod radio_actor;
pub mod radio_config;
mod radio_factory;
pub mod radio_manager;
mod reporting;
mod rig;
mod rotator;
#[cfg(not(windows))]
mod rotctld;
mod server;
mod startup_radio;
mod tracing_setup;
mod tray_icon;
mod updater;
mod utils;

#[cfg(test)]
mod hamlib_radio_tests;
#[cfg(test)]
mod radio_actor_regression_tests;
#[cfg(test)]
mod radio_config_tests;
#[cfg(test)]
mod radio_manager_tests;
#[cfg(test)]
mod startup_radio_tests;
#[cfg(test)]
mod updater_tests;

fn main() -> Result<()> {
    let args = argh::from_env();
    let _sentry = tracing_setup::configure(tracing_setup::reporting_enabled(&args));
    let result = application::run(args);
    if let Err(error) = &result {
        tracing::error!(?error, "Catserver terminated unexpectedly");
    }
    result
}
