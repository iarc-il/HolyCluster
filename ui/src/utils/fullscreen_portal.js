export function fullscreen_portal_target(is_fullscreen, fullscreen_element, body) {
    return is_fullscreen && fullscreen_element ? fullscreen_element : body;
}
