import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "@/ui/components/Avatar";

/**
 * A picture that does not arrive has to look like an absence, not a fault.
 *
 * Inside a round, clipped frame a failed `<img>` renders as nothing at all —
 * an empty circle where a person used to be. Google's avatar host is the one
 * that makes this a live problem: it answers 403 to a request carrying a
 * referrer it does not know, which for a desktop build is every request, and
 * whether it refused depended on what was cached.
 */
describe("a face", () => {
  it("sends no referrer, because the hosts that serve these refuse one", () => {
    render(<Avatar src="https://lh3.googleusercontent.com/a/ada" name="Ada" />);

    const img = screen.getByRole("img", { name: "Ada" });
    expect(img.getAttribute("referrerPolicy")).toBe("no-referrer");
  });

  it("falls back to the initial when the picture will not load", () => {
    render(<Avatar src="https://lh3.googleusercontent.com/a/ada" name="Ada" />);

    act(() => {
      fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("shows the initial when there is no picture at all", () => {
    render(<Avatar src={null} name="ada@example.com" />);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("gives a new picture its own attempt", () => {
    const view = render(<Avatar src="https://old.example/a" name="Ada" />);
    act(() => {
      fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    });
    expect(screen.queryByRole("img")).toBeNull();

    // One bad URL must not poison the next one — the picture the user just
    // uploaded would otherwise never be tried.
    view.rerender(<Avatar src="https://new.example/a" name="Ada" />);
    expect(screen.getByRole("img", { name: "Ada" })).toBeTruthy();
  });
});
