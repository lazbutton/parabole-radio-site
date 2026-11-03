/**
 * Les réponses de l'API de Radio Cult (https://www.radiocult.fm/docs/api), traduites pour l'import de la programmation
 * (index.ts) : les créneaux, leurs artistes, les descriptions (TipTap) en Markdown, les réseaux d'un artiste en liens.
 * Rien que des fonctions sans base ni réseau : le site lit Radio Cult, puis passe ses réponses ici.
 */
import { toParisInput } from "../paris.ts";
import type { ArtistLink, ShowType } from "../schema.ts";

/** Un artiste de Radio Cult. `name` est vide pour les fiches sans nom, que l'import laisse de côté. */
export type RadioCultArtist = { id: string; name: string; slug: string; bio: string | null; links: ArtistLink[] };

/** Un créneau de la programmation. */
export type RadioCultSlot = {
  /** Ce que garde show.radiocult_event_id (slotKey). */
  key: string;
  /** La série d'un créneau répété ; null pour un créneau seul. */
  series: string | null;
  title: string;
  start: Date;
  end: Date;
  /** « live », « mix » ou « playlist ». */
  media: string;
  /** En Markdown. */
  description: string | null;
  /** Ses artistes, dans l'ordre de Radio Cult. */
  artists: RadioCultArtist[];
};

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
function instant(value: unknown): Date | null {
  const at = typeof value === "string" ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/** Le jour, à Paris : « 2026-11-03 ». */
const parisDay = (at: Date) => toParisInput(at).slice(0, 10);

/**
 * La clé d'un créneau, gardée par le show qu'il devient. Un créneau seul garde son identifiant, même déplacé. Celui
 * d'une occurrence d'un créneau répété est fabriqué à la lecture (« <série>-r_index-<début> ») et change dès que la
 * série bouge : la clé est donc la série et le jour, à Paris. Une série avancée d'une heure garde ses shows.
 */
export const slotKey = (series: string, start: Date, recurring: boolean) => (recurring ? `${series}@${parisDay(start)}` : series);

/**
 * Les créneaux d'une réponse de /schedule. Leurs artistes viennent de la réponse elle-même (expand=artist) ou de la
 * liste de /artists, quand elle a été lue ; sinon, aucun. Un créneau sans identifiant ni heures valables est ignoré.
 */
export function slotsFromRadioCult(schedules: unknown, artists?: unknown): RadioCultSlot[] {
  const byId = new Map(
    list(artists)
      .map(artistFromRadioCult)
      .filter((one): one is RadioCultArtist => one !== null)
      .map((one) => [one.id, one]),
  );
  const seen = new Set<string>();
  const slots: RadioCultSlot[] = [];
  for (const raw of list(schedules)) {
    const series = text(raw?.originalId) || text(raw?.id);
    const start = instant(raw?.startDateUtc ?? raw?.start);
    const end = instant(raw?.endDateUtc ?? raw?.end);
    if (!series || !start || !end || end <= start) continue;
    const recurring = raw?.isRecurring === true;
    let key = slotKey(series, start, recurring);
    // Deux occurrences d'une série le même jour : la seconde prend aussi son heure.
    if (seen.has(key)) key = `${series}@${toParisInput(start)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const expanded = list(raw?.artists)
      .map(artistFromRadioCult)
      .filter((one): one is RadioCultArtist => one !== null);
    const linked = expanded.length
      ? expanded
      : list(raw?.artistIds)
          .map((id) => byId.get(text(id)))
          .filter((one): one is RadioCultArtist => one !== undefined);
    slots.push({
      key,
      series: recurring ? series : null,
      title: text(raw?.title).slice(0, 200),
      start,
      end,
      media: text(raw?.media?.type),
      description: markdownFrom(raw?.description),
      artists: linked.filter((one, index) => linked.findIndex((other) => other.id === one.id) === index),
    });
  }
  return slots;
}

/** Un artiste d'une réponse de /artists, ou d'un créneau. Null sans identifiant. */
export function artistFromRadioCult(raw: any): RadioCultArtist | null {
  const id = text(raw?.id);
  if (!id) return null;
  return { id, name: text(raw?.name).slice(0, 200), slug: text(raw?.slug), bio: markdownFrom(raw?.description), links: linksFrom(raw?.socials) };
}

/**
 * Le type d'un show tiré de son créneau : un set enregistré (mix) ou un direct font un DJ set, une playlist reste une
 * playlist ; un titre qui dit « podcast » fait un podcast. L'équipe corrige au besoin.
 */
export function showTypeOf(slot: Pick<RadioCultSlot, "title" | "media">): ShowType {
  if (/\bpodcasts?\b/i.test(slot.title)) return "podcast";
  return slot.media === "playlist" ? "playlist" : "dj_set";
}

// ---------------------------------------------------------------------------------------------------------------
// Les liens d'un artiste
// ---------------------------------------------------------------------------------------------------------------

/** Une adresse web complète, ou null : « soundcloud.com/x » reçoit « https:// », le reste (javascript:…) est refusé. */
function webAddress(value: unknown): string | null {
  const typed = text(value);
  if (!typed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") && url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

/** Un nom de compte (« @parabole », ou l'adresse du profil), réduit au nom seul s'il en a le format. */
function handle(value: unknown, format: RegExp): string | null {
  const name = text(value)
    .replace(/^@+/, "")
    .replace(/^(https?:\/\/)?(www\.)?(instagram|twitter|x)\.com\//i, "")
    .replace(/[/?#].*$/, "");
  return format.test(name) ? name : null;
}

/** Les réseaux d'un artiste de Radio Cult, en liens de fiche, dans l'ordre utile à un DJ. */
export function linksFrom(socials: any): ArtistLink[] {
  const instagram = handle(socials?.instagramHandle, /^[A-Za-z0-9._]{1,30}$/);
  const x = handle(socials?.twitterHandle, /^[A-Za-z0-9_]{1,15}$/);
  const links: [string, string | null][] = [
    ["SoundCloud", webAddress(socials?.soundcloud)],
    ["Mixcloud", webAddress(socials?.mixcloud)],
    ["Instagram", instagram && `https://www.instagram.com/${instagram}/`],
    ["Site", webAddress(socials?.site)],
    ["Facebook", webAddress(socials?.facebook)],
    ["X", x && `https://x.com/${x}`],
  ];
  return links.filter((link): link is [string, string] => Boolean(link[1])).map(([label, url]) => ({ label, url }));
}

// ---------------------------------------------------------------------------------------------------------------
// Les descriptions : TipTap (JSON) en Markdown
// ---------------------------------------------------------------------------------------------------------------

/** Les signes que Markdown lirait autrement : le texte de Radio Cult reste du texte. */
const escapeInline = (value: string) => value.replace(/([\\`*_[\]<>])/g, "\\$1");
const escapeLineStart = (value: string) => value.replace(/^(\s*)(\d+)\.(\s)/gm, "$1$2\\.$3").replace(/^(\s*)([#>+-])(\s|$)/gm, "$1\\$2$3");

/** Le texte d'une ligne : gras, italique, barré, code et liens (http et https seulement). */
function inline(nodes: unknown): string {
  return list(nodes)
    .map((node) => {
      if (node?.type === "hardBreak") return "\\\n";
      if (node?.type !== "text") return inline(node?.content);
      const raw = typeof node.text === "string" ? node.text : "";
      const marks = new Set(list(node.marks).map((mark) => mark?.type));
      // Les espaces restent hors des marques : « ** gras** » ne serait pas du gras.
      const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw) ?? [];
      if (!core) return raw;
      let out = marks.has("code") ? `\`${core.replace(/`/g, "'")}\`` : escapeInline(core);
      if (marks.has("bold")) out = `**${out}**`;
      if (marks.has("italic")) out = `*${out}*`;
      if (marks.has("strike")) out = `~~${out}~~`;
      const href = list(node.marks).find((mark) => mark?.type === "link")?.attrs?.href;
      const url = typeof href === "string" && /^https?:\/\//i.test(href) ? webAddress(href) : null;
      if (url) out = `[${out}](${url.replace(/[()]/g, (sign) => encodeURIComponent(sign))})`;
      return lead + out + trail;
    })
    .join("");
}

/** Les blocs d'un document : paragraphes, titres, listes, citations, code, séparateurs. */
function blocks(nodes: unknown): string[] {
  const out: string[] = [];
  for (const node of list(nodes)) {
    switch (node?.type) {
      case "paragraph": {
        const line = escapeLineStart(inline(node.content).trim());
        if (line) out.push(line);
        break;
      }
      case "heading": {
        const line = inline(node.content).trim();
        if (line) out.push(`${"#".repeat(Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 6))} ${line}`);
        break;
      }
      case "bulletList":
      case "orderedList": {
        let number = Number(node.attrs?.start) || 1;
        const items = list(node.content).map((item) => {
          const marker = node.type === "orderedList" ? `${number++}.` : "-";
          return `${marker} ${blocks(item?.content).join("\n").replace(/\n/g, "\n   ")}`;
        });
        if (items.length) out.push(items.join("\n"));
        break;
      }
      case "blockquote": {
        const quote = blocks(node.content).join("\n\n");
        if (quote) out.push(quote.replace(/^/gm, "> "));
        break;
      }
      case "codeBlock": {
        const code = list(node.content)
          .map((child) => (typeof child?.text === "string" ? child.text : ""))
          .join("")
          .replace(/```/g, "'''");
        if (code.trim()) out.push("```\n" + code + "\n```");
        break;
      }
      case "horizontalRule":
        out.push("---");
        break;
      default:
        out.push(...blocks(node?.content));
    }
  }
  return out;
}

/** Une description de Radio Cult (TipTap) en Markdown, ou null si elle est vide. 20 000 signes au plus, comme l'admin. */
export function markdownFrom(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const markdown = blocks((doc as { type?: string }).type === "doc" ? (doc as { content?: unknown }).content : [doc]).join("\n\n").trim();
  return markdown ? markdown.slice(0, 20_000) : null;
}
