import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Somebody's face, or the letter it falls back to.
 *
 * Two things made this flicker between the two, and both are handled here so
 * every place that draws a face behaves the same way.
 *
 * **The referrer.** A Google profile picture is served from
 * `lh3.googleusercontent.com`, which answers 403 to requests carrying a
 * referrer it does not recognise — and this app is `tauri://localhost` in the
 * desktop build and `http://localhost:1420` in the browser one. Whether it
 * refused depended on cache state, so the same URL loaded one launch and not
 * the next. `referrerPolicy="no-referrer"` is what those hosts expect.
 *
 * **A picture that does not arrive.** An `<img>` whose request fails renders
 * as a broken box or, inside a round clipped frame, as nothing at all — a
 * blank circle where a person used to be. On error the initial takes over,
 * which is the same thing an account with no picture shows, so a failure looks
 * like an absence rather than a fault.
 */
export function Avatar({
  src,
  name,
  className,
}: {
  src: string | null | undefined;
  /** Whose face it is: the alt text, and the source of the fallback letter. */
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves its own attempt — otherwise one bad picture would
  // poison every later one, including the one the user just uploaded.
  useEffect(() => setFailed(false), [src]);

  const initial = (name || "U").trim().charAt(0).toUpperCase() || "U";

  return (
    <div className={cn("avatar", className)}>
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
