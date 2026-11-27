import OmniRigError from "@/components/OmniRigError.jsx";
import Features from "@/components/addons/Features.jsx";
import Guide from "@/components/addons/Guide.jsx";
import Hero from "@/components/addons/Hero.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

it("names the product once and explains the outcome and start steps", () => {
    const { container } = render(
        <>
            <Hero />
            <Features />
            <Guide />
        </>,
    );
    expect(screen.getAllByRole("heading", { name: "CAT Control", exact: true })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Holy Cluster home" }).getAttribute("href")).toBe("/");
    expect(container.querySelector("img").getAttribute("alt")).toBe("");
    for (const heading of [
        "How it works",
        "Get started",
        "Open CAT Control",
        "Configure your radio",
    ]) {
        expect(screen.getByRole("heading", { name: heading })).not.toBeNull();
    }
    expect(
        screen.getByText(
            "CAT Control connects Holy Cluster to your radio through OmniRig or Hamlib.",
        ),
    ).not.toBeNull();
    expect(container.textContent).not.toMatch(/\bserver\b|WebSocket|desktop icon|We Handle/i);
});

it("shows the OmniRig cause, actions, and recovery without an explainer", () => {
    const { container } = render(<OmniRigError />);
    expect(screen.getByRole("heading", { name: "OmniRig required", exact: true })).not.toBeNull();
    expect(screen.getByText("Install OmniRig to use the OmniRig backend.")).not.toBeNull();
    expect(
        screen.getByText("Configure your radio in OmniRig, then restart CAT Control."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Download OmniRig" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue without CAT" })).not.toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toMatch(
        /What is OmniRig|COM component|standard interface|seamless/,
    );
});
