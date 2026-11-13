export function is_ios_client(navigator_object = window.navigator) {
    return (
        /iPhone|iPad|iPod/i.test(navigator_object.userAgent) ||
        (/Macintosh/i.test(navigator_object.userAgent) && navigator_object.maxTouchPoints > 1)
    );
}

export function is_mobile_client(navigator_object = window.navigator) {
    return (
        navigator_object.userAgentData?.mobile === true ||
        /Android/i.test(navigator_object.userAgent) ||
        is_ios_client(navigator_object)
    );
}

export function client_type(navigator_object = window.navigator) {
    return is_mobile_client(navigator_object) ? "mobile" : "desktop";
}

export function browser_type(navigator_object = window.navigator) {
    const brands =
        navigator_object.userAgentData?.brands?.map(({ brand }) => brand.toLowerCase()) ?? [];
    if (brands.some(brand => brand.includes("edge"))) return "edge";
    if (brands.some(brand => brand.includes("google chrome"))) return "chrome";
    if (brands.length > 0) return "other";

    const user_agent = navigator_object.userAgent;
    if (/EdgA|EdgiOS|Edg\//i.test(user_agent)) return "edge";
    if (/Firefox|FxiOS/i.test(user_agent)) return "firefox";
    if (/OPR|Opera|SamsungBrowser/i.test(user_agent)) return "other";
    if (/Chrome|CriOS/i.test(user_agent)) return "chrome";
    if (/Safari/i.test(user_agent)) return "safari";
    return "other";
}
