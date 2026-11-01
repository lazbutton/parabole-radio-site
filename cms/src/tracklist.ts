/**
 * Les minutages et la tracklist collée en texte, pour l'écran d'un show. Sans dépendance : ce module sert aussi dans
 * le navigateur (@parabole/cms/tracklist), où il remplit le tableau dès qu'on colle.
 */

/**
 * Un minutage en secondes : « 12:30 » (minutes et secondes, au-delà de 59 minutes aussi : « 75:30 ») ou
 * « 1:02:03 » (heures, minutes, secondes). Null si le texte n'en est pas un.
 */
export function parseTimecode(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d)(?::([0-5]\d))?$/.exec(text.trim());
  if (!match) return null;
  const [, first, second, third] = match;
  if (third === undefined) return Number(first) * 60 + Number(second);
  return Number(first) * 3600 + Number(second) * 60 + Number(third);
}

/** « 12:30 », ou « 1:02:03 » au-delà d'une heure. */
export function formatTimecode(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Un morceau tel qu'on le saisit : du texte, vérifié à l'enregistrement. */
export type TrackLine = { artist: string; title: string; start: string; hopperUrl: string };

const TIMECODE = String.raw`\d{1,4}:[0-5]\d(?::[0-5]\d)?`;
const IS_TIMECODE = new RegExp(String.raw`^[\[(]?(${TIMECODE})[\])]?$`);
const LEADING_TIME = new RegExp(String.raw`^[\[(]?(${TIMECODE})[\])]?(?:\s*[-–—|.]\s*|\s+)`);
const TRAILING_TIME = new RegExp(String.raw`\s*[\[(](${TIMECODE})[\])]$|\s+(${TIMECODE})$`);
const HOPPER_LINK = /https:\/\/hppr\.fr\/[^\s)\]]+/;
const NUMBERING = /^(?:#\d{1,3}\s+|\d{1,3}[.)]\s+)/;
const QUOTES: Record<string, string> = { '"': '"', "“": "”", "«": "»" };

/** Retire les guillemets qui entourent un titre : « "Tunnel" » donne « Tunnel ». */
function unquote(text: string): string {
  const close = QUOTES[text[0] ?? ""];
  return close && text.length > 1 && text.endsWith(close) ? text.slice(1, -1).trim() : text;
}

/** Une ligne copiée d'un tableur : numéro et minutage (facultatifs), artiste, titre, dans des cases séparées. */
function fromCells(cells: string[]): Omit<TrackLine, "hopperUrl"> {
  if (cells.length > 2 && /^#?\d{1,3}[.)]?$/.test(cells[0]!)) cells = cells.slice(1);
  const time = IS_TIMECODE.exec(cells[0] ?? "");
  const rest = time ? cells.slice(1) : cells;
  return { start: time ? time[1]! : "", artist: rest.length > 1 ? rest[0]! : "", title: rest.length > 1 ? rest.slice(1).join(" ") : (rest[0] ?? "") };
}

/** Une ligne de texte : « 12:30 Artiste – Titre », minutage au début ou à la fin, ou absent. */
function fromText(line: string): Omit<TrackLine, "hopperUrl"> {
  let start = "";
  const leading = LEADING_TIME.exec(line);
  if (leading) {
    start = leading[1]!;
    line = line.slice(leading[0].length);
  } else {
    const trailing = TRAILING_TIME.exec(line);
    if (trailing) {
      start = (trailing[1] ?? trailing[2])!;
      line = line.slice(0, trailing.index);
    }
  }
  line = line.replace(/^[-–—|]\s*/, "").trim();
  // Le premier tiret entouré d'espaces sépare l'artiste du titre ; à défaut, un tiret long collé (« A–B »).
  const separator = / [-–—] /.exec(line) ?? /[–—]/.exec(line);
  if (!separator) return { start, artist: "", title: line };
  return { start, artist: line.slice(0, separator.index).trim(), title: line.slice(separator.index + separator[0].length).trim() };
}

/**
 * Une tracklist collée, une ligne par morceau : « 12:30 Artiste – Titre ». Accepte aussi une numérotation
 * (« 1. », « #1 »), le minutage entre crochets ou en fin de ligne, un tiret simple ou long entouré d'espaces, les
 * cases d'un tableur (séparées par des tabulations) et un lien Hopper n'importe où sur la ligne ; un intitulé
 * (« Tracklist : ») est laissé de côté. Le premier tiret
 * entouré d'espaces sépare l'artiste du titre : « Jay-Z » reste entier, « Titre - Remix » aussi. Sans séparateur,
 * toute la ligne va dans le titre, à compléter.
 */
export function parseTracklist(text: string): TrackLine[] {
  const tracks: TrackLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    // Une ligne vide, ou un intitulé (« Tracklist : », sans tiret ni minutage) : rien à garder.
    if (!line || (line.endsWith(":") && !/ [-–—] |[–—\t]/.test(line) && !LEADING_TIME.test(line))) continue;
    let hopperUrl = "";
    const link = HOPPER_LINK.exec(line);
    if (link) {
      hopperUrl = link[0].replace(/[,.;]+$/, "");
      line = line.replace(link[0], "").trim();
    }
    const cells = line.split("\t").map((cell) => cell.trim()).filter(Boolean);
    const parsed = cells.length > 1 ? fromCells(cells) : fromText(line.replace(/\s+/g, " ").replace(NUMBERING, ""));
    const artist = unquote(parsed.artist);
    const title = unquote(parsed.title);
    if (artist || title) tracks.push({ artist, title, start: parsed.start, hopperUrl });
  }
  return tracks;
}
