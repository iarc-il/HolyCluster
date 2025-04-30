use anyhow::Result;
use tokio::sync::broadcast::Sender;
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

#[derive(PartialEq, Eq, Clone)]
pub enum IconTrayEvent {
    Quit,
    OpenBrowser,
}

pub fn run_tray_icon(tray_sender: Sender<IconTrayEvent>) {
    let open_menu_item = MenuItem::new("Open", true, None);
    let quit_menu_item = MenuItem::new("Quit", true, None);
    let tray_menu = Menu::new();
    tray_menu
        .append_items(&[&open_menu_item, &quit_menu_item])
        .unwrap();
    let tray_icon = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("Holy Cluster")
        .with_title("Holy Cluster");
    let _tray_icon = add_icon_to_tray_icon(tray_icon).unwrap().build().unwrap();

    let quit_menu_id = quit_menu_item.id().clone();
    let open_menu_id = open_menu_item.id().clone();

    let event_loop = winit::event_loop::EventLoop::<IconTrayEvent>::with_user_event()
        .build()
        .unwrap();
    let proxy = event_loop.create_proxy();

    MenuEvent::set_event_handler(Some({
        let proxy = proxy.clone();
        move |event: MenuEvent| {
            let id = event.id();
            if id == &open_menu_id {
                let _ = tray_sender.send(IconTrayEvent::OpenBrowser);
            } else if id == &quit_menu_id {
                let _ = tray_sender.send(IconTrayEvent::Quit);
                proxy.send_event(IconTrayEvent::Quit).ok();
            }
        }
    }));

    struct App {}
    impl ApplicationHandler<IconTrayEvent> for App {
        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn user_event(&mut self, event_loop: &ActiveEventLoop, event: IconTrayEvent) {
            if event == IconTrayEvent::Quit {
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
