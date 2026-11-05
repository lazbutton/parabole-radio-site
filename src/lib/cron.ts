/**
 * Les tâches planifiées de Vercel (vercel.json, /api/cron/…) : Vercel les appelle avec « Authorization: Bearer
 * <CRON_SECRET> ». Sans ce réglage, ou avec un autre en-tête, une tâche ne fait rien.
 */
import { CRON_SECRET } from "astro:env/server";
import { timingSafeEqual } from "node:crypto";

/** CRON_SECRET est réglé : sans lui, aucune tâche planifiée ne s'exécute. */
export const cronReady = () => Boolean(CRON_SECRET);

/** L'appel vient de Vercel : son en-tête, comparé en temps constant. */
export function fromVercel(request: Request): boolean {
  if (!CRON_SECRET) return false;
  const sent = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}
