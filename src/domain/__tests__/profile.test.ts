import { describe, expect, it } from "vitest";
import {
  avatarFromMetadata,
  avatarToBackfill,
  mergeProfileRow,
  profileFromAuthUser,
  type ProfileRow,
  type UserProfile,
} from "../auth";

/**
 * Why a profile picture came and went.
 *
 * Signing in put the provider's picture on screen straight from the session.
 * A few hundred milliseconds later the `profiles` row arrived and *replaced*
 * the whole user — and that row's `avatar_url` is null for every account whose
 * row was written before the picture existed, so the face blanked. Offline the
 * fetch never landed and the face stayed. Same account, same build, two
 * different answers depending on the network, which is exactly what "sometimes
 * it loads" means.
 */
const google = {
  id: "u1",
  email: "ada@example.com",
  created_at: "2026-01-05T09:00:00.000Z",
  user_metadata: {
    full_name: "Ada Lovelace",
    picture: "https://lh3.googleusercontent.com/a/ada",
  },
};

const stored: UserProfile = {
  id: "u1",
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  avatarUrl: "https://lh3.googleusercontent.com/a/ada",
  createdAt: "2026-01-05T09:00:00.000Z",
};

describe("the picture a provider hands over", () => {
  it("is read under whichever key that provider used", () => {
    expect(avatarFromMetadata({ avatar_url: "a" })).toBe("a");
    // Google sends `picture`, and Supabase does not always copy it across.
    expect(avatarFromMetadata({ picture: "b" })).toBe("b");
    expect(avatarFromMetadata({})).toBeNull();
    expect(avatarFromMetadata(null)).toBeNull();
  });

  it("ignores a key that is present but empty", () => {
    expect(avatarFromMetadata({ avatar_url: "   ", picture: "b" })).toBe("b");
  });
});

describe("who the session says is signed in", () => {
  it("carries the name and the face, with no request at all", () => {
    const user = profileFromAuthUser(google);
    expect(user.fullName).toBe("Ada Lovelace");
    expect(user.avatarUrl).toBe("https://lh3.googleusercontent.com/a/ada");
  });

  it("falls back to the address when the provider gave no name", () => {
    const user = profileFromAuthUser({ id: "u1", email: "ada@example.com" });
    expect(user.fullName).toBe("ada");
    expect(user.avatarUrl).toBeNull();
  });

  it("keeps what was already known and the session cannot say", () => {
    const user = profileFromAuthUser(
      { id: "u1", email: "ada@example.com" },
      { ...stored, role: "ADMIN" },
    );
    expect(user.role).toBe("ADMIN");
    expect(user.avatarUrl).toBe(stored.avatarUrl);
  });

  /*
   * This runs again on every token refresh, an hour into a session. The
   * session's copy of the name is whatever the provider said at sign-up, so
   * letting it win would put "Ada Lovelace" back over the name the user
   * changed twenty minutes ago — and there is no click to blame it on.
   */
  it("does not put the provider's name back over an edited one", () => {
    const user = profileFromAuthUser(google, { ...stored, fullName: "Ada L." });
    expect(user.fullName).toBe("Ada L.");
  });

  it("does not carry one account's details into another", () => {
    const user = profileFromAuthUser(
      { id: "u2", email: "grace@example.com" },
      stored,
    );
    expect(user.fullName).toBe("grace");
    expect(user.avatarUrl).toBeNull();
  });
});

describe("the stored row laid over it", () => {
  it("does not blank a face the row has never been told about", () => {
    const row: ProfileRow = {
      id: "u1",
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      avatar_url: null,
    };
    expect(mergeProfileRow(stored, row).avatarUrl).toBe(stored.avatarUrl);
  });

  it("wins wherever it actually says something", () => {
    const row: ProfileRow = {
      full_name: "Ada L.",
      avatar_url: "https://cdn.example.com/uploaded.png",
      role: "ADMIN",
    };
    const merged = mergeProfileRow(stored, row);
    expect(merged.fullName).toBe("Ada L.");
    expect(merged.avatarUrl).toBe("https://cdn.example.com/uploaded.png");
    expect(merged.role).toBe("ADMIN");
  });

  it("treats an empty string as nothing said", () => {
    expect(mergeProfileRow(stored, { full_name: "" }).fullName).toBe(
      "Ada Lovelace",
    );
  });

  it("leaves the user alone when there is no row at all", () => {
    expect(mergeProfileRow(stored, null)).toEqual(stored);
  });
});

describe("writing the face back", () => {
  it("offers it when the row has none", () => {
    expect(avatarToBackfill(stored, { avatar_url: null })).toBe(
      stored.avatarUrl,
    );
  });

  it("says nothing when the row already has one", () => {
    expect(avatarToBackfill(stored, { avatar_url: "x" })).toBeNull();
  });

  it("says nothing when there is no face to write", () => {
    expect(
      avatarToBackfill({ ...stored, avatarUrl: null }, { avatar_url: null }),
    ).toBeNull();
  });
});
