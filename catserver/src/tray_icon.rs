use anyhow::Result;
use tokio::sync::mpsc::UnboundedSender;
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

pub fn run_tray_icon(quit_sender: UnboundedSender<()>) {
    let quit_menu_item = MenuItem::new("Quit", true, None);
    let tray_menu = Menu::new();
    tray_menu.append(&quit_menu_item).unwrap();
    let tray_icon = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("Holy Cluster")
        .with_title("Holy Cluster");
    let _tray_icon = add_icon_to_tray_icon(tray_icon).unwrap().build().unwrap();

    struct ExitEvent {}

    let menu_id = quit_menu_item.id().clone();
    let event_loop = winit::event_loop::EventLoop::<ExitEvent>::with_user_event()
        .build()
        .unwrap();
    let proxy = event_loop.create_proxy();

    MenuEvent::set_event_handler(Some({
        let proxy = proxy.clone();
        move |event: MenuEvent| {
            if *event.id() == menu_id {
                quit_sender.send(()).unwrap();
                proxy.send_event(ExitEvent {}).ok();
            }
        }
    }));

    struct App {}
    impl ApplicationHandler<ExitEvent> for App {
        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn user_event(&mut self, event_loop: &ActiveEventLoop, _event: ExitEvent) {
            event_loop.exit();
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
