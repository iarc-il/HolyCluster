use anyhow::Result;
use tokio::sync::broadcast::{Receiver, Sender};
use tray_icon::{
    TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};
use winit::{application::ApplicationHandler, event_loop::ActiveEventLoop};

#[cfg(windows)]
fn add_icon_to_tray_icon(tray_icon: TrayIconBuilder) -> Result<TrayIconBuilder> {
    use tray_icon::Icon;
    Ok(tray_icon.with_icon(Icon::from_resource(1, Some((32, 32)))?))
}

#[cfg(not(windows))]
fn add_icon_to_tray_icon(tray_icon: TrayIconBuilder) -> Result<TrayIconBuilder> {
    Ok(tray_icon)
}

#[derive(PartialEq, Eq, Clone, Debug)]
pub enum UserEvent {
    Quit,
    OpenBrowser,
}

pub fn run_tray_icon(
    instance_name: &str,
    tray_sender: Sender<UserEvent>,
    mut tray_receiver: Receiver<UserEvent>,
) {
    let open_menu_item = MenuItem::new("Open", true, None);
    let quit_menu_item = MenuItem::new("Quit", true, None);
    let tray_menu = Menu::new();
    let instance_title = if !instance_name.is_empty() {
        format!("Holy Cluster - {instance_name}")
    } else {
        "Holy Cluster".into()
    };
    tray_menu
        .append_items(&[&open_menu_item, &quit_menu_item])
        .unwrap();
    let tray_icon = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip(&instance_title)
        .with_title(&instance_title);
    let _tray_icon = add_icon_to_tray_icon(tray_icon).unwrap().build().unwrap();

    let quit_menu_id = quit_menu_item.id().clone();
    let open_menu_id = open_menu_item.id().clone();

    let event_loop = winit::event_loop::EventLoop::<UserEvent>::with_user_event()
        .build()
        .unwrap();
    let proxy = event_loop.create_proxy();

    MenuEvent::set_event_handler(Some({
        let proxy = proxy.clone();
        move |event: MenuEvent| {
            let id = event.id();
            if id == &open_menu_id {
                let _ = tray_sender.send(UserEvent::OpenBrowser);
            } else if id == &quit_menu_id {
                let _ = tray_sender.send(UserEvent::Quit).unwrap();
                proxy.send_event(UserEvent::Quit).unwrap();
            }
        }
    }));

    let proxy_clone = proxy.clone();
    std::thread::spawn(move || {
        while let Ok(event) = tray_receiver.blocking_recv() {
            if event == UserEvent::Quit {
                let _ = proxy_clone.send_event(UserEvent::Quit);
                break;
            }
        }
    });

    struct App {}
    impl ApplicationHandler<UserEvent> for App {
        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
            if event == UserEvent::Quit {
                event_loop.exit();
            }
        }

        fn window_event(
            &mut self,
            _event_loop: &ActiveEventLoop,
            _window_id: winit::window::WindowId,
            _event: winit::event::WindowEvent,
        ) {
        }
    }

    let mut app = App {};
    event_loop.run_app(&mut app).unwrap();
}
