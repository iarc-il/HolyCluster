export function is_mobile_client(navigator_object = window.navigator) {
	return (
		navigator_object.userAgentData?.mobile === true ||
		/Android|iPhone|iPad|iPod/i.test(navigator_object.userAgent)
	);
}

export function client_type(navigator_object = window.navigator) {
	return is_mobile_client(navigator_object) ? "mobile" : "desktop";
}
