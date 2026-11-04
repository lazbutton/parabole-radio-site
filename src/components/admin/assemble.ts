/**
 * L'assemblage d'une playlist dans le navigateur (cms/README.md, 9.13) : chaque morceau est décodé à son tour
 * (decodeAudioData, ramené à 44,1 kHz stéréo), ses silences du début et de la fin sont retirés, puis il est enchaîné
 * au précédent en fondu à puissance constante, et le son part par morceaux de 4 s vers l'encodeur MP3 du Web Worker
 * (assembler.worker.ts). Seuls le morceau en cours et la fin du précédent restent en mémoire : une playlist d'une heure
 * ne pèse pas plus lourd que deux morceaux. Le calcul (fondus, silences, frise) vient de @parabole/cms/assemblage,
 * testé à part ; la frise rendue est celle du son produit.
 */
import { crossfade, fadeInGain, fadeOutGain, SAMPLE_RATE, silences, timeline, type Slot } from "@parabole/cms/assemblage";

/** Un morceau à assembler : son nom (pour les messages) et de quoi lire son fichier. */
export type AssemblyInput = { name: string; load(signal: AbortSignal): Promise<ArrayBuffer> };

export type AssemblyStep = { index: number; total: number; phase: "lecture" | "décodage" | "enchaînement" } | { phase: "finalisation" };

export type AssemblyResult = { blob: Blob; slots: Slot[]; total: number };

const CHUNK = SAMPLE_RATE * 4;
/** Les morceaux de son envoyés à l'encodeur sans accusé : au-delà, la page attend (≈ 45 Mo). */
const IN_FLIGHT = 8;

type Stereo = [Float32Array, Float32Array];

/** Ramène un son à 44,1 kHz stéréo (OfflineAudioContext s'en charge, au besoin en dupliquant un canal mono). */
async function resample(buffer: AudioBuffer): Promise<Stereo> {
  if (buffer.sampleRate !== SAMPLE_RATE || buffer.numberOfChannels !== 2) {
    const context = new OfflineAudioContext(2, Math.max(1, Math.ceil((buffer.length * SAMPLE_RATE) / buffer.sampleRate)), SAMPLE_RATE);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    buffer = await context.startRendering();
  }
  return [buffer.getChannelData(0), buffer.getChannelData(1)];
}

/**
 * Un AIFF, que Chrome et Firefox ne décodent pas : PCM gros-boutiste, 8, 16, 24 ou 32 bits (le format des fichiers
 * exportés pour les platines). Null s'il n'en est pas un.
 */
function readAiff(data: ArrayBuffer): AudioBuffer | null {
  const view = new DataView(data);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (data.byteLength < 12 || tag(0) !== "FORM" || (tag(8) !== "AIFF" && tag(8) !== "AIFC")) return null;
  let channels = 0;
  let frames = 0;
  let bits = 0;
  let rate = 0;
  let sound = -1;
  for (let at = 12; at + 8 <= data.byteLength; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4);
    if (id === "COMM") {
      channels = view.getUint16(at + 8);
      frames = view.getUint32(at + 10);
      bits = view.getUint16(at + 14);
      // La fréquence, un flottant de 80 bits : exposant sur 15 bits, mantisse sur 64.
      const exponent = (view.getUint16(at + 16) & 0x7fff) - 16383;
      const mantissa = view.getUint32(at + 18) * 2 ** 32 + view.getUint32(at + 22);
      rate = Math.round(mantissa * 2 ** (exponent - 63));
      if (tag(8) === "AIFC" && tag(at + 26) !== "NONE" && tag(at + 26) !== "twos") return null;
    } else if (id === "SSND") sound = at + 16 + view.getUint32(at + 8);
    at += 8 + size + (size % 2);
  }
  if (!channels || !frames || !rate || sound < 0 || ![8, 16, 24, 32].includes(bits)) return null;
  const bytes = bits / 8;
  const buffer = new AudioBuffer({ length: frames, numberOfChannels: channels, sampleRate: rate });
  const scale = 2 ** (bits - 1);
  for (let channel = 0; channel < channels; channel++) {
    const out = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      const at = sound + (frame * channels + channel) * bytes;
      if (at + bytes > data.byteLength) break;
      const value = bits === 8 ? view.getInt8(at) : bits === 16 ? view.getInt16(at) : bits === 24 ? (view.getInt8(at) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at + 2) : view.getInt32(at);
      out[frame] = value / scale;
    }
  }
  return buffer;
}

/** Décode un fichier son, quel que soit son format courant, en 44,1 kHz stéréo. */
async function decode(data: ArrayBuffer, name: string): Promise<Stereo> {
  const aiff = /\.aiff?$/i.test(name) ? readAiff(data) : null;
  if (aiff) return resample(aiff);
  try {
    const context = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    return await resample(await context.decodeAudioData(data));
  } catch {
    throw new Error(`« ${name} » ne se décode pas dans ce navigateur : exporte-le en WAV, FLAC ou MP3.`);
  }
}

/**
 * Assemble les morceaux dans l'ordre, avec un fondu enchaîné de `fade` secondes (raccourci pour un morceau court) et,
 * si demandé, sans leurs silences. Rend le MP3, la frise (le départ de chaque morceau) et la durée totale.
 */
export async function assemble(inputs: AssemblyInput[], { fade, trim, onStep, signal }: { fade: number; trim: boolean; onStep(step: AssemblyStep): void; signal: AbortSignal }): Promise<AssemblyResult> {
  const worker = new Worker(new URL("./assembler.worker.ts", import.meta.url), { type: "module" });
  let inFlight = 0;
  let wake: (() => void) | null = null;
  let finished: ((blob: Blob) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  const done = new Promise<Blob>((resolve, reject) => {
    finished = resolve;
    failed = reject;
  });
  // Un échec qu'on n'attend plus (une erreur de décodage est déjà partie) ne doit pas rester sans réponse.
  done.catch(() => {});
  worker.onmessage = (event: MessageEvent<{ type: "taken" } | { type: "done"; blob: Blob } | { type: "error"; message: string }>) => {
    const message = event.data;
    if (message.type === "taken") {
      inFlight--;
      wake?.();
    } else if (message.type === "done") finished?.(message.blob);
    else failed?.(new Error(`L'encodage a échoué : ${message.message}`));
  };
  worker.onerror = () => failed?.(new Error("L'encodeur MP3 ne s'est pas chargé dans ce navigateur."));
  const stop = () => {
    worker.terminate();
    failed?.(new DOMException("Assemblage annulé", "AbortError"));
  };
  signal.addEventListener("abort", stop, { once: true });

  /** Envoie du son à l'encodeur, par morceaux de 4 s, en attendant qu'il suive. */
  const emit = async ([left, right]: Stereo) => {
    for (let at = 0; at < left.length; at += CHUNK) {
      while (inFlight >= IN_FLIGHT) {
        await Promise.race([new Promise<void>((resolve) => (wake = resolve)), done.then(() => undefined)]);
        signal.throwIfAborted();
      }
      const l = left.slice(at, at + CHUNK);
      const r = right.slice(at, at + CHUNK);
      inFlight++;
      worker.postMessage({ type: "chunk", left: l, right: r }, [l.buffer, r.buffer]);
    }
  };

  try {
    worker.postMessage({ type: "start", sampleRate: SAMPLE_RATE });
    const lengths: number[] = [];
    // La fin du morceau précédent, gardée pour le fondu avec le suivant.
    let tail: Stereo | null = null;
    for (const [index, input] of inputs.entries()) {
      signal.throwIfAborted();
      onStep({ index, total: inputs.length, phase: "lecture" });
      const data = await input.load(signal);
      onStep({ index, total: inputs.length, phase: "décodage" });
      const [left, right] = await decode(data, input.name);
      const cut = trim ? silences([left, right], SAMPLE_RATE) : { start: 0, end: 0 };
      const body: Stereo = [left.subarray(cut.start, left.length - cut.end), right.subarray(cut.start, right.length - cut.end)];
      const length = body[0].length;
      lengths.push(length / SAMPLE_RATE);
      onStep({ index, total: inputs.length, phase: "enchaînement" });

      let head = 0;
      if (tail) {
        // Le fondu avec le précédent : la frise le calcule pareil (crossfade), en secondes.
        const previous = lengths[index - 1]!;
        const overlap = Math.min(tail[0].length, Math.round(crossfade(fade, previous, length / SAMPLE_RATE) * SAMPLE_RATE), Math.floor(length / 2));
        const plain = tail[0].length - overlap;
        if (plain > 0) await emit([tail[0].subarray(0, plain), tail[1].subarray(0, plain)]);
        const mixed: Stereo = [new Float32Array(overlap), new Float32Array(overlap)];
        for (let i = 0; i < overlap; i++) {
          const progress = (i + 0.5) / overlap;
          const out = fadeOutGain(progress);
          const into = fadeInGain(progress);
          mixed[0][i] = tail[0][plain + i]! * out + body[0][i]! * into;
          mixed[1][i] = tail[1][plain + i]! * out + body[1][i]! * into;
        }
        await emit(mixed);
        head = overlap;
        tail = null;
      }
      // La fin de ce morceau attend le suivant : au plus le fondu, au plus la moitié du morceau (le début, au plus
      // l'autre moitié, a servi au fondu précédent).
      const last = index === inputs.length - 1;
      const keep = last ? 0 : Math.min(Math.round(fade * SAMPLE_RATE), Math.floor(length / 2));
      await emit([body[0].subarray(head, length - keep), body[1].subarray(head, length - keep)]);
      if (keep > 0) tail = [body[0].slice(length - keep), body[1].slice(length - keep)];
    }
    onStep({ phase: "finalisation" });
    worker.postMessage({ type: "end" });
    const blob = await done;
    const { slots, total } = timeline(lengths, fade);
    return { blob, slots, total };
  } finally {
    signal.removeEventListener("abort", stop);
    worker.terminate();
  }
}
