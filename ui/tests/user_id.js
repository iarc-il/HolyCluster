import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_ID_STORAGE_KEY, get_user_id } from "@/utils/user_id.js";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("anonymous user identity", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it("creates and persists one browser identity", () => {
        vi.spyOn(crypto, "randomUUID").mockReturnValue(USER_ID);

        expect(get_user_id()).toBe(USER_ID);
        expect(get_user_id()).toBe(USER_ID);
        expect(localStorage.getItem(USER_ID_STORAGE_KEY)).toBe(USER_ID);
        expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    });

    it("replaces an invalid stored identity", () => {
        localStorage.setItem(USER_ID_STORAGE_KEY, "invalid");
        vi.spyOn(crypto, "randomUUID").mockReturnValue(USER_ID);

        expect(get_user_id()).toBe(USER_ID);
        expect(localStorage.getItem(USER_ID_STORAGE_KEY)).toBe(USER_ID);
    });

    it("returns null when storage is unavailable", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("denied", "SecurityError");
        });

        expect(get_user_id()).toBeNull();
    });
});
