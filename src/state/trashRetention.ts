/**
 * How long a trashed task stays recoverable before it is purged for good.
 *
 * One day, down from three. A trashed row is not free: it is still stored here,
 * still stored in the cloud, and still read by every full sync pass — three
 * days of everything anybody deleted, carried around by every device on the
 * account.
 *
 * A day is the floor rather than an hour because of *how* the mistake is
 * noticed. Deleting the wrong thing is almost never seen at the time — the undo
 * toast covers that minute — it is seen the next time the list is opened, which
 * for a task manager is the next morning. A window that closes overnight would
 * purge exactly the rows somebody was about to come back for; one that lasts
 * until the next visit is the cheapest one that still catches the real mistake.
 */
export const TRASH_RETENTION_MS = 24 * 60 * 60 * 1000;
