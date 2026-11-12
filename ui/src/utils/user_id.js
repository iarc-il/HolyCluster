export const USER_ID_STORAGE_KEY = "holycluster_user_id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function get_user_id() {
    try {
        const stored = window.localStorage.getItem(USER_ID_STORAGE_KEY);
        if (UUID_V4.test(stored ?? "")) return stored.toLowerCase();

        const user_id = crypto.randomUUID();
        window.localStorage.setItem(USER_ID_STORAGE_KEY, user_id);
        return user_id;
    } catch {
        return null;
    }
}
