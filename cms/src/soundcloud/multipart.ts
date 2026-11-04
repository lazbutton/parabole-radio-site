/**
 * Un corps multipart/form-data en flux, avec sa longueur exacte (cms/README.md, 9.14) : le MP3 d'une émission passe du
 * seau à SoundCloud sans être gardé en mémoire (il pèse jusqu'à 750 Mo), et SoundCloud reçoit un Content-Length juste
 * plutôt qu'un envoi par morceaux. Un fichier qui ne fait pas la taille annoncée arrête l'envoi.
 */
import { randomBytes } from "node:crypto";

/** Un champ texte, ou un fichier : son nom, son type, sa taille exacte, et de quoi le lire. */
export type Part = { name: string; value: string } | { name: string; fileName: string; type: string; size: number; open(): ReadableStream<Uint8Array> | Uint8Array };

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");

/** Les guillemets et retours à la ligne d'un nom de champ ou de fichier, encodés comme le font les navigateurs. */
const quoted = (text: string) => text.replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** Le corps, sa longueur en octets, et son Content-Type (avec la frontière). */
export function multipart(parts: Part[], boundary = `----parabole${randomBytes(12).toString("hex")}`): { body: ReadableStream<Uint8Array>; length: number; type: string } {
  let length = 0;
  const pieces = parts.map((part) => {
    const file = "open" in part;
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(part.name)}"` + (file ? `; filename="${quoted(part.fileName)}"\r\nContent-Type: ${part.type}` : "") + "\r\n\r\n",
    );
    const value = file ? null : encoder.encode(part.value);
    length += head.byteLength + (file ? part.size : value!.byteLength) + CRLF.byteLength;
    return { head, value, part };
  });
  const tail = encoder.encode(`--${boundary}--\r\n`);
  length += tail.byteLength;

  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (const { head, value, part } of pieces) {
      yield head;
      if (value) yield value;
      else if ("open" in part) {
        const source = part.open();
        let sent = 0;
        if (source instanceof Uint8Array) {
          sent = source.byteLength;
          yield source;
        } else {
          const reader = source.getReader();
          for (let read = await reader.read(); !read.done; read = await reader.read()) {
            sent += read.value.byteLength;
            yield read.value;
          }
        }
        if (sent !== part.size) throw new Error(`« ${part.fileName} » ne fait pas la taille annoncée (${sent} octets sur ${part.size}).`);
      }
      yield CRLF;
    }
    yield tail;
  }

  const iterator = chunks();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (failure) {
        controller.error(failure);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return { body, length, type: `multipart/form-data; boundary=${boundary}` };
}
