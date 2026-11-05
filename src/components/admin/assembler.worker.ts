/// <reference lib="webworker" />
/**
 * L'encodeur MP3 de l'outil d'assemblage (cms/README.md, 9.13), dans un Web Worker : LAME compilé en WebAssembly
 * (wasm-media-encoders 0.7.0, son WASM est dans le paquet), en 320 kbit/s constants, stéréo, à la fréquence reçue.
 * La page reste fluide pendant l'encodage. Le son arrive par morceaux de quelques secondes (deux canaux en
 * Float32Array, transférés), dans l'ordre ; chaque morceau encodé est accusé (« taken »), ce qui règle le débit de la
 * page. À la fin, le MP3 entier repart d'un bloc.
 */
import { createMp3Encoder } from "wasm-media-encoders";

/** La fréquence du son reçu, celle du MP3 rendu : 44,1 kHz (celle du MP3 de Radio Cult), ou 48 kHz. */
type Incoming = { type: "start"; sampleRate: 44_100 | 48_000 } | { type: "chunk"; left: Float32Array; right: Float32Array } | { type: "end" };

const queue: Incoming[] = [];
let running = false;
let encoder: Awaited<ReturnType<typeof createMp3Encoder>> | null = null;
const parts: Uint8Array[] = [];

/** Un message après l'autre, dans l'ordre d'arrivée : l'encodeur garde l'état du son entre deux morceaux. */
async function drain() {
  if (running) return;
  running = true;
  try {
    for (let message = queue.shift(); message; message = queue.shift()) {
      if (message.type === "start") {
        encoder = await createMp3Encoder();
        encoder.configure({ channels: 2, sampleRate: message.sampleRate, bitrate: 320, outputSampleRate: message.sampleRate });
        parts.length = 0;
        continue;
      }
      if (!encoder) throw new Error("L'encodeur n'est pas prêt.");
      if (message.type === "chunk") {
        const out = encoder.encode([message.left, message.right]);
        // Le tableau rendu appartient à l'encodeur : on en garde une copie.
        if (out.length) parts.push(out.slice());
        self.postMessage({ type: "taken", samples: message.left.length });
        continue;
      }
      const last = encoder.finalize();
      if (last.length) parts.push(last.slice());
      const blob = new Blob(parts as BlobPart[], { type: "audio/mpeg" });
      parts.length = 0;
      self.postMessage({ type: "done", blob });
    }
  } catch (failure) {
    self.postMessage({ type: "error", message: failure instanceof Error ? failure.message : String(failure) });
  } finally {
    running = false;
  }
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  queue.push(event.data);
  void drain();
};
