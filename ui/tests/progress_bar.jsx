import ProgressBar from "@/components/ui/ProgressBar.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

it("renders rounded, clamped progress with an accessible native value", () => {
    const { rerender } = render(<ProgressBar label="Download" value={32} max={128} />);
    const progress = screen.getByRole("progressbar", { name: "Download" });
    expect(progress.value).toBe(32);
    expect(progress.parentElement.className).toContain("rounded-full");
    expect(progress.nextElementSibling.style.width).toBe("25%");
    rerender(<ProgressBar label="Download" value={200} max={128} />);
    expect(progress.value).toBe(128);
    expect(progress.nextElementSibling.style.width).toBe("100%");
});

it("does not claim a percentage for indeterminate progress", () => {
    render(<ProgressBar label="Installing" />);
    const progress = screen.getByRole("progressbar", { name: "Installing" });
    expect(progress.hasAttribute("value")).toBe(false);
    expect(progress.nextElementSibling.className).toContain("animate-pulse");
});
