use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use crate::{
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_config::HamlibRigConfig,
    rig::{Mode, Radio, Slot, Status},
};

fn config(rig2: bool) -> (HamlibRigConfig, Option<HamlibRigConfig>) {
    (
        HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        },
        rig2.then(|| HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        }),
    )
}

#[test]
fn dummy_rigs_select_vfos_and_map_modes() {
    let (rig1, rig2) = config(true);
    let mut radio = HamlibRadio::new(rig1, rig2);
    radio.init().unwrap();
    radio.set_frequency(Slot::A, Freq::from_u32_hz(7_100_000));
    radio.set_mode(Mode::CW);
    assert_eq!(radio.get_status().freq, 7_100_000);
    assert_eq!(radio.get_status().mode, "CW");

    radio.set_rig(2);
    radio.set_frequency(Slot::B, Freq::from_u32_hz(14_200_000));
    radio.set_mode(Mode::Data);
    assert_eq!(radio.get_status().current_rig, 2);
    assert_eq!(radio.get_status().freq, 14_200_000);
    assert_eq!(radio.get_status().mode, "DIGI");
}

#[test]
fn dummy_ignores_a_persisted_serial_path() {
    let (mut rig1, rig2) = config(false);
    rig1.token_values
        .insert("rig_pathname".into(), "/dev/ttyS0".into());
    let mut radio = HamlibRadio::new(rig1, rig2);
    radio.init().unwrap();
    assert_eq!(radio.get_status().current_rig, 1);
}

#[test]
fn net_rigctl_covers_control_disconnect_and_restart_recovery() {
    let mut server = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
    let address = server.address();
    let (rig1, rig2) = net_config(address);
    let mut radio = HamlibRadio::new(rig1, rig2);

    // Opening the NET rigctl model exercises the real Hamlib network transport and
    // its protocol/capability handshake, rather than only exercising the dummy
    // backend in-process.
    radio.init().expect("NET rigctl initializes");
    assert_eq!(
        radio.get_status(),
        Status {
            freq: 7_100_000,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        }
    );

    radio.set_frequency(Slot::B, Freq::from_u32_hz(14_200_000));
    radio.set_mode(Mode::CW);
    assert_eq!(
        radio.get_status(),
        Status {
            freq: 14_200_000,
            status: "connected".into(),
            mode: "CW".into(),
            current_rig: 1,
        }
    );
    radio.set_mode(Mode::Data);
    assert_eq!(radio.get_status().mode, "DIGI");
    radio.set_mode(Mode::Rtty);
    assert_eq!(radio.get_status().mode, "RTTY");
    let commands = server.commands();
    assert!(
        commands.iter().any(|command| command == "V VFOB"),
        "NET rigctl did not receive the VFO B selection: {commands:?}"
    );
    assert!(
        commands
            .iter()
            .any(|command| command.starts_with("F ") && command.contains("14200000")),
        "NET rigctl did not receive the requested frequency: {commands:?}"
    );
    assert!(
        commands.iter().any(|command| command.starts_with("M CW ")),
        "NET rigctl did not receive the requested mode: {commands:?}"
    );
    assert!(
        commands
            .iter()
            .any(|command| command.starts_with("M PKTUSB ")),
        "NET rigctl did not receive the requested packet mode: {commands:?}"
    );
    assert!(
        commands
            .iter()
            .any(|command| command.starts_with("M RTTY ")),
        "NET rigctl did not receive the requested RTTY mode: {commands:?}"
    );

    // Close the active socket, matching the transport failure observed when a
    // rigctld process or its radio disappears.
    server.disconnect();
    let deadline = Instant::now() + Duration::from_secs(3);
    let disconnected = loop {
        let status = radio.get_status();
        if status.status == "disconnected" {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "NET rigctl remained connected after server disconnect: {status:?}"
        );
        thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(disconnected, Status::disconnected(1));

    // Restart the server on the configured endpoint. HamlibRadio retries after
    // five failed polls; the subsequent poll must observe the new connection.
    server.stop();
    let mut restarted = FakeRigctld::start(address, 14_074_000, "USB");
    for _ in 0..4 {
        assert_eq!(radio.get_status(), Status::disconnected(1));
    }
    assert_eq!(
        radio.get_status(),
        Status {
            freq: 14_074_000,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        }
    );
    assert!(
        restarted
            .commands()
            .iter()
            .any(|command| command == "\\dump_state"),
        "restart recovery did not perform a fresh NET rigctl handshake: {:?}",
        restarted.commands()
    );
    restarted.stop();
}

fn net_config(address: SocketAddr) -> (HamlibRigConfig, Option<HamlibRigConfig>) {
    let model_id = hamlib::Catalog::load()
        .expect("Hamlib catalog loads")
        .models()
        .iter()
        .find(|model| model.model() == "NET rigctl")
        .expect("NET rigctl model is registered")
        .id()
        .to_string();
    let mut token_values = BTreeMap::new();
    token_values.insert("rig_pathname".into(), address.to_string());
    // Disable Hamlib's read cache so each status poll exercises the live
    // endpoint and detects a lost rigctld connection immediately.
    token_values.insert("cache_timeout".into(), "0".into());
    (
        HamlibRigConfig {
            model_id,
            token_values,
        },
        None,
    )
}

#[test]
fn absent_second_rig_is_not_selected() {
    let (rig1, rig2) = config(false);
    let mut radio = HamlibRadio::new(rig1, rig2);
    radio.init().unwrap();
    radio.set_rig(2);
    assert_eq!(radio.get_status().current_rig, 1);
}

#[test]
fn invalid_second_rig_reports_its_slot_and_can_retry() {
    let (rig1, mut rig2) = config(true);
    rig2.as_mut().unwrap().model_id = "999999".into();
    let mut radio = HamlibRadio::new(rig1, rig2);
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
}

struct FakeRigctld {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    commands: Arc<Mutex<Vec<String>>>,
    active_streams: Arc<Mutex<Vec<TcpStream>>>,
    thread: Option<JoinHandle<()>>,
}

impl FakeRigctld {
    fn start(address: SocketAddr, frequency: u32, mode: &str) -> Self {
        let listener = TcpListener::bind(address).expect("fake rigctld binds");
        listener
            .set_nonblocking(true)
            .expect("fake rigctld listener is nonblocking");
        let address = listener.local_addr().expect("fake rigctld address");
        let stop = Arc::new(AtomicBool::new(false));
        let commands = Arc::new(Mutex::new(Vec::new()));
        let active_streams = Arc::new(Mutex::new(Vec::new()));
        let state = Arc::new(Mutex::new(FakeRigState::new(frequency, mode)));

        let thread_stop = Arc::clone(&stop);
        let thread_commands = Arc::clone(&commands);
        let thread_active_streams = Arc::clone(&active_streams);
        let thread_state = Arc::clone(&state);
        let thread = thread::spawn(move || {
            let mut clients = Vec::new();
            while !thread_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if thread_stop.load(Ordering::Acquire) {
                            let _ = stream.shutdown(Shutdown::Both);
                            break;
                        }
                        let active_stream = stream
                            .try_clone()
                            .expect("fake rigctld clones active client stream");
                        thread_active_streams.lock().unwrap().push(active_stream);
                        let client_commands = Arc::clone(&thread_commands);
                        let client_state = Arc::clone(&thread_state);
                        clients.push(thread::spawn(move || {
                            serve_client(stream, client_commands, client_state);
                        }));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1));
                    }
                    Err(error) => panic!("fake rigctld accept failed: {error}"),
                }
            }

            if let Ok(streams) = thread_active_streams.lock() {
                for stream in streams.iter() {
                    let _ = stream.shutdown(Shutdown::Both);
                }
            }
            for client in clients {
                let _ = client.join();
            }
        });

        Self {
            address,
            stop,
            commands,
            active_streams,
            thread: Some(thread),
        }
    }

    fn address(&self) -> SocketAddr {
        self.address
    }

    fn commands(&self) -> Vec<String> {
        self.commands.lock().unwrap().clone()
    }

    fn disconnect(&self) {
        let streams = self.active_streams.lock().unwrap();
        for stream in streams.iter() {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }

    fn stop(&mut self) {
        if self.thread.is_none() {
            return;
        }
        self.stop.store(true, Ordering::Release);
        if let Ok(streams) = self.active_streams.lock() {
            for stream in streams.iter() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
        if let Some(thread) = self.thread.take() {
            thread.join().expect("fake rigctld thread exits");
        }
    }
}

impl Drop for FakeRigctld {
    fn drop(&mut self) {
        self.stop();
    }
}

struct FakeRigState {
    frequency_a: u32,
    frequency_b: u32,
    current_vfo: String,
    mode: String,
}

impl FakeRigState {
    fn new(frequency: u32, mode: &str) -> Self {
        Self {
            frequency_a: frequency,
            frequency_b: frequency,
            current_vfo: "VFOA".into(),
            mode: mode.into(),
        }
    }

    fn current_frequency(&self) -> u32 {
        if self.current_vfo == "VFOB" {
            self.frequency_b
        } else {
            self.frequency_a
        }
    }

    fn set_current_frequency(&mut self, frequency: u32) {
        if self.current_vfo == "VFOB" {
            self.frequency_b = frequency;
        } else {
            self.frequency_a = frequency;
        }
    }
}

fn serve_client(
    mut stream: TcpStream,
    commands: Arc<Mutex<Vec<String>>>,
    state: Arc<Mutex<FakeRigState>>,
) {
    let reader = stream
        .try_clone()
        .expect("fake rigctld clones client stream");
    let mut reader = BufReader::new(reader);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let command = line.trim_end_matches(['\r', '\n']).to_owned();
        commands.lock().unwrap().push(command.clone());
        let quit = command == "q";
        let response = fake_response(&command, &state);
        if stream.write_all(response.as_bytes()).is_err() {
            break;
        }
        if quit {
            let _ = stream.shutdown(Shutdown::Both);
            break;
        }
    }
}

fn fake_response(command: &str, state: &Mutex<FakeRigState>) -> String {
    match command {
        // NET rigctl asks for power status before its capability handshake. A
        // negative response is the documented way to say that this endpoint
        // does not provide that optional command.
        "\\get_powerstat" => "RPRT -4\n".into(),
        "\\get_lock_mode" => "0\n0\n".into(),
        "\\chk_vfo" => "0\n".into(),
        "\\dump_state" => dump_state(),
        "v" => format!("{}\n", state.lock().unwrap().current_vfo),
        "f" => format!("{}\n", state.lock().unwrap().current_frequency()),
        command if command.starts_with("m") => {
            format!("{}\n2400\n", state.lock().unwrap().mode)
        }
        command if command.starts_with("V ") => {
            state.lock().unwrap().current_vfo = command[2..].trim().into();
            "RPRT 0\n".into()
        }
        command if command.starts_with("F") => {
            if let Ok(frequency) = command
                .split_whitespace()
                .last()
                .unwrap_or_default()
                .parse::<f64>()
            {
                state
                    .lock()
                    .unwrap()
                    .set_current_frequency(frequency as u32);
            }
            "RPRT 0\n".into()
        }
        command if command.starts_with("M ") => {
            if let Some(mode) = command.split_whitespace().nth(1) {
                state.lock().unwrap().mode = mode.into();
            }
            "RPRT 0\n".into()
        }
        "q" => "RPRT 0\n".into(),
        _ => "RPRT -4\n".into(),
    }
}

fn dump_state() -> String {
    // Protocol version 0 still requires the model, region, ranges, and the
    // scalar capability fields below. Zero-valued terminators keep this fake
    // deterministic while matching Hamlib's NET rigctl parser.
    [
        "0",
        "1",
        "0",
        "0 0 0 0 0 0 0",
        "0 0 0 0 0 0 0",
        "0 0",
        "0 0",
        "0",
        "0",
        "0",
        "0",
        "0 0 0 0 0 0 0",
        "0 0 0 0 0 0 0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
    ]
    .join("\n")
        + "\n"
}
