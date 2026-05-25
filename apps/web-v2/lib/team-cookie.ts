/**
 * Client-safe constants shared between server and client code.
 * Kept separate from `lib/team.ts` (which imports `next/headers`) so client
 * components can reference the cookie name without dragging in server-only
 * dependencies.
 */
export const TEAM_COOKIE = "nixway-team";
