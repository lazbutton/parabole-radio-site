// ---------- HOPPER : chaque morceau sur la plateforme de l'auditeur (hppr.fr, HOPPER_URL dans settings.ts) ----------
// La page hppr.fr d'un morceau et les plateformes où Hopper le trouve mot pour mot (rien sinon : un lien faux est pire
// qu'aucun), demandées à notre route src/pages/api/hopper.ts. Deux usages : le lien « Retrouver » sous chaque morceau
// d'HISTORIQUE (history.ts), et les logos des plateformes à droite du titre de ce qui passe, sur l'accueil
// (nowplaying.ts), qui mènent à hppr.fr/<id>/go/<plateforme>. Les réponses sont gardées tant que l'onglet est ouvert ;
// deux morceaux sont demandés à la fois ; un morceau dont la réponse n'est pas venue (Hopper occupé : 10 par minute sans
// clé partenaire) attend 2 minutes avant d'être redemandé. Un morceau déjà en cours de recherche n'est pas redemandé en
// même temps. Quand une réponse arrive, les emplacements qui l'attendent (data-key) se remplissent.
import type { Track } from "../lib/station/types";
import { HOPPER_URL } from "./settings";
import { escapeHtml, fetchJson, withQuery } from "./util";

type Found = { url: string; platforms: string[] };
const hopper = {
  answers: new Map<string, Found | null>(),
  later: new Map<string, number>(),
  queue: [] as Track[],
  asking: new Set<string>(),
  running: 0,
};
export const hopperKey = (t: Track) => t.artist + "|" + t.title;

// « Retrouver ↗ », sous un morceau d'HISTORIQUE
function hopperLink(url: string) {
  return `<a class="hppr" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Ouvrir ce titre sur ta plateforme (hppr.fr)">Retrouver ↗</a>`;
}
export function hopperSlot(t: Track | null) {
  if (!HOPPER_URL || !t || !t.artist || !t.title) return "";
  const found = hopper.answers.get(hopperKey(t));
  return `<span class="hppr-slot" data-key="${escapeHtml(hopperKey(t))}">${found ? hopperLink(found.url) : ""}</span>`;
}

// Les logos, à l'ancienne (le sprite d'Icons.astro, largeur pour 24 de haut) ; YouTube Music et Beatport en lettres.
// Apple Music prend le logo d'iTunes, son ancêtre : avec les deux, un seul.
const LOGOS: Record<string, { name: string; width?: number; text?: string }> = {
  spotify: { name: "Spotify", width: 24 },
  deezer: { name: "Deezer", width: 24 },
  apple: { name: "Apple Music", width: 24 },
  ytmusic: { name: "YouTube Music", text: "You<b>Tube</b>" },
  tidal: { name: "Tidal", width: 24 },
  soundcloud: { name: "SoundCloud", width: 33 },
  bandcamp: { name: "Bandcamp", width: 30 },
  itunes: { name: "iTunes", width: 24 },
  beatport: { name: "Beatport", text: "beatport" },
  discogs: { name: "Discogs", width: 24 },
};
function logos(found: Found) {
  return found.platforms
    .filter((p) => LOGOS[p] && !(p === "itunes" && found.platforms.includes("apple")))
    .map((p) => {
      const logo = LOGOS[p],
        art = logo.text
          ? `<span class="logo-mot" aria-hidden="true">${logo.text}</span>`
          : `<svg class="logo" viewBox="0 0 ${logo.width} 24" style="--r:${(logo.width! / 24).toFixed(3)}" aria-hidden="true"><use href="#logo-${p === "apple" ? "itunes" : p}"></use></svg>`;
      return `<a href="${escapeHtml(found.url)}/go/${p}" target="_blank" rel="noopener" title="${logo.name}" aria-label="Écouter sur ${logo.name}">${art}</a>`;
    })
    .join("");
}
/** Les logos du morceau dans un emplacement (vide tant que Hopper n'a pas répondu, ou s'il ne le trouve pas). */
export function fillLogos(slot: HTMLElement, t: Track | null) {
  const key = t && HOPPER_URL && t.artist && t.title ? hopperKey(t) : "",
    found = key ? hopper.answers.get(key) : null,
    state = key + "#" + (found ? found.platforms.join(",") : "");
  slot.dataset.key = key;
  if (slot.dataset.shown === state) return; // rien de neuf : les liens restent tels quels
  slot.dataset.shown = state;
  slot.innerHTML = found ? logos(found) : "";
  slot.hidden = !slot.innerHTML;
}

export function askHopper(tracks: (Track | null)[]) {
  if (!HOPPER_URL) return;
  for (const t of tracks) {
    if (!t || !t.artist || !t.title) continue;
    const key = hopperKey(t);
    if (
      hopper.answers.has(key) ||
      hopper.asking.has(key) ||
      (hopper.later.get(key) || 0) > Date.now() ||
      hopper.queue.some((q) => hopperKey(q) === key)
    )
      continue;
    hopper.queue.push(t);
  }
  while (hopper.running < 2 && hopper.queue.length) {
    const t = hopper.queue.shift()!,
      key = hopperKey(t);
    hopper.running++;
    hopper.asking.add(key);
    fetchJson<{ url: string | null; platforms?: string[] }>(
      withQuery(HOPPER_URL, "artist=" + encodeURIComponent(t.artist) + "&title=" + encodeURIComponent(t.title)),
    )
      .then(({ url, platforms }) => {
        const found = url ? { url, platforms: Array.isArray(platforms) ? platforms : [] } : null;
        hopper.answers.set(key, found);
        if (!found) return;
        document.querySelectorAll<HTMLElement>(".hppr-slot").forEach((slot) => {
          if (slot.dataset.key === key) slot.innerHTML = hopperLink(found.url);
        });
        document.querySelectorAll<HTMLElement>(".hppr-logos").forEach((slot) => {
          if (slot.dataset.key === key) fillLogos(slot, t);
        });
      })
      .catch(() => hopper.later.set(key, Date.now() + 120000))
      .finally(() => {
        hopper.running--;
        hopper.asking.delete(key);
        askHopper([]);
      });
  }
}
