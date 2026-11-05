/**
 * La durée d'un MP3 d'après son début et son poids, pour la fiche d'une émission envoyée sur SoundCloud (cms/README.md,
 * 9.14) : juste après l'envoi, SoundCloud transcode encore et ne la donne pas. Rien que du calcul.
 *
 *   - l'étiquette ID3v2 du début est sautée (une pochette peut y peser lourd) ;
 *   - la première trame MPEG couche III, confirmée par la suivante, donne la version, la fréquence et le débit ;
 *   - son en-tête Xing ou Info (LAME l'écrit aussi pour un débit constant) ou VBRI donne le nombre de trames : la durée
 *     exacte ;
 *   - sans lui, un débit constant : le poids des trames divisé par le débit.
 * Null si le début ne se lit pas comme un MP3.
 */

/** Les débits de la couche III, en kbit/s, par index : MPEG-1, puis MPEG-2 et 2.5. */
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 1: [44_100, 48_000, 32_000], 2: [22_050, 24_000, 16_000], 2.5: [11_025, 12_000, 8_000] };

type Frame = { at: number; length: number; mpeg: 1 | 2 | 2.5; kbps: number; rate: number; mono: boolean; samples: number };

const ascii = (bytes: Uint8Array, at: number, length: number) => (at + length <= bytes.length ? String.fromCharCode(...bytes.subarray(at, at + length)) : "");
const uint32 = (bytes: Uint8Array, at: number) => (at + 4 <= bytes.length ? ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0 : 0);

/** La taille de l'étiquette ID3v2 du début (en-tête et pied compris), ou 0 s'il n'y en a pas. */
export function id3Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return 0;
  const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
  return 10 + size + ((bytes[5]! & 0x10) !== 0 ? 10 : 0);
}

/** La trame de couche III qui commence à cet octet, ou null. */
function frameAt(bytes: Uint8Array, at: number): Frame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1]! & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1]! >> 3) & 0x03;
  const layer = (bytes[at + 1]! >> 1) & 0x03;
  const index = bytes[at + 2]! >> 4;
  const rateIndex = (bytes[at + 2]! >> 2) & 0x03;
  if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) return null;
  const mpeg = version === 3 ? 1 : version === 2 ? 2 : 2.5;
  const kbps = KBPS[mpeg === 1 ? 1 : 2][index]!;
  const rate = RATES[mpeg][rateIndex]!;
  const samples = mpeg === 1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / rate) + ((bytes[at + 2]! >> 1) & 0x01);
  return { at, length, mpeg, kbps, rate, mono: bytes[at + 3]! >> 6 === 3, samples };
}

/** La première vraie trame à partir de là : la suivante doit commencer où elle finit (sauf au bout de ce qu'on a lu). */
function firstFrame(bytes: Uint8Array, from: number): Frame | null {
  for (let at = from; at + 4 <= bytes.length; at++) {
    const frame = frameAt(bytes, at);
    if (!frame) continue;
    const next = at + frame.length;
    if (next + 4 > bytes.length || frameAt(bytes, next)) return frame;
  }
  return null;
}

/** La durée en secondes d'un MP3 de ce poids, d'après son début ; null si elle ne se lit pas. */
export function mp3Seconds(head: Uint8Array, size: number): number | null {
  const frame = firstFrame(head, id3Size(head));
  if (!frame) return null;
  const fromFrames = (frames: number) => (frames > 0 ? Math.round((frames * frame.samples) / frame.rate) : null);
  // L'en-tête Xing ou Info suit les informations annexes de la trame, VBRI est toujours à 32 octets.
  const side = frame.mpeg === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = frame.at + 4 + side;
  if (["Xing", "Info"].includes(ascii(head, xing, 4)) && uint32(head, xing + 4) & 1) {
    const seconds = fromFrames(uint32(head, xing + 8));
    if (seconds) return seconds;
  }
  const vbri = frame.at + 4 + 32;
  if (ascii(head, vbri, 4) === "VBRI") {
    const seconds = fromFrames(uint32(head, vbri + 14));
    if (seconds) return seconds;
  }
  const seconds = Math.round(((size - frame.at) * 8) / (frame.kbps * 1000));
  return seconds > 0 ? seconds : null;
}

/** Ce qu'on garde du début d'un son : l'étiquette ID3 entière, puis 64 Ko de trames ; 8 Mo au plus. */
const AFTER_TAG = 64 * 1024;
const MAX_HEAD = 8 * 1024 * 1024;

/**
 * Le même flux, qui garde une copie de son début pendant qu'il passe : la durée se lit ensuite, sans relire le fichier
 * dans le seau.
 */
export function keepHead(source: ReadableStream<Uint8Array>): { stream: ReadableStream<Uint8Array>; head(): Uint8Array } {
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let wanted = AFTER_TAG;
  let sized = false;
  const head = () => {
    const bytes = new Uint8Array(kept);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return bytes;
  };
  const stream = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (kept < wanted) {
          chunks.push(chunk.slice(0, Math.min(chunk.byteLength, MAX_HEAD - kept)));
          kept += chunks.at(-1)!.byteLength;
          if (!sized && kept >= 10) {
            sized = true;
            wanted = Math.min(id3Size(head()) + AFTER_TAG, MAX_HEAD);
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, head };
}
