/**
 * Un cache court, en mémoire, côté serveur. Une réponse de la station sert `ttl` millisecondes à toutes les requêtes
 * qui arrivent sur la même instance de la fonction, et des requêtes simultanées n'en font qu'une. Devant la fonction,
 * le cache de Vercel (Cache-Control s-maxage) fait le reste : un seul appel à la station pour tous les auditeurs.
 * Une erreur n'est pas gardée : la requête suivante redemande.
 */
type Entry = { at: number; value?: unknown; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();

export function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry && "value" in entry && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T);
  if (entry?.pending) return entry.pending as Promise<T>;
  const pending = load().then(
    (value) => {
      entries.set(key, { at: Date.now(), value });
      return value;
    },
    (error) => {
      entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { at: entry?.at ?? 0, pending });
  return pending;
}

/** Une réponse JSON avec sa règle de cache. */
export const json = (body: unknown, cacheControl: string, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
