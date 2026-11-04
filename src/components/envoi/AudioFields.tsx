/**
 * Les champs son de la page d'envoi : le son d'un set ou d'un podcast (un MP3), et les morceaux d'une playlist (des
 * fichiers, dans l'ordre). Un fichier part vers le seau dès qu'on le choisit, avec sa progression : on remplit le reste
 * pendant ce temps. Le formulaire n'est envoyé qu'une fois tous les fichiers arrivés.
 */
import { audioRefusal, MAIN_ACCEPT, MAX_MAIN_BYTES, MAX_PARTS, PART_ACCEPT, trackFromFileName, WANTED_KBPS } from "@parabole/cms/envois";
import { formatTimecode } from "@parabole/cms/tracklist";
import { CheckCircledIcon, Cross2Icon, DragHandleDots2Icon, ExclamationTriangleIcon, UploadIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex, IconButton, Progress, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { weight } from "../admin/ImageField";
import { useSortable } from "../admin/sortable";
import { counted } from "../admin/text";
import { audioDuration, call, mp3Kbps, putAudio } from "./audio";

/**
 * Un fichier qui part, ou parti : son ticket une fois signé, sa progression, son état. `retry` : l'envoi a échoué en
 * route (la connexion, le serveur), le même fichier peut repartir ; sinon il a été refusé, il en faut un autre.
 */
export type Sending = { key: string; id: string | null; fileName: string; size: number; percent: number; state: "sending" | "done" | "error"; error?: string; retry?: boolean };

/** Un morceau d'une playlist : déjà reçu (« kept »), ou envoyé à l'instant. */
export type PartRow = { key: string; id: string | null; artist: string; title: string; duration: number | null; fileName: string; size: string; state: "kept" | Sending["state"]; percent: number; error?: string };

let counter = 0;
const nextKey = () => `f${++counter}`;

/** Annonce un fichier au serveur (qui signe son dépôt), puis le dépose dans le seau. */
async function send(jeton: string, file: File, role: "main" | "part", showId: string, onPercent: (percent: number) => void, signal: AbortSignal): Promise<string> {
  const ticket = await call<{ ok: true; id: string; url: string; mime: string }>(jeton, "fichier", { role, fileName: file.name, size: file.size, showId });
  if (!ticket.ok) throw new Error(ticket.errors.file ?? ticket.errors.form ?? "Le serveur a refusé ce fichier.");
  await putAudio(ticket.url, file, ticket.mime, onPercent, signal);
  return ticket.id;
}

/** Retient l'onglet tant qu'un envoi est en cours : le fermer couperait l'envoi. */
function useHoldWhile(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", hold);
    return () => removeEventListener("beforeunload", hold);
  }, [active]);
}

/** Glisser des fichiers sur un élément : s'il est survolé, et les gestionnaires à poser dessus. */
function useDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [over, setOver] = useState(false);
  const handlers = disabled
    ? {}
    : {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          onFiles([...event.dataTransfer.files]);
        },
      };
  return { over: over && !disabled, handlers };
}

/** Le champ de fichier caché, et de quoi l'ouvrir. */
function usePicker(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      onChange={(event) => {
        onFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

/**
 * La zone où glisser des fichiers, ou d'où les choisir : grande tant qu'il n'y a rien, en ligne (« compact ») pour en
 * ajouter d'autres. Toute la zone se clique ; au clavier, son bouton fait de même (son clic remonte jusqu'à elle).
 */
function DropZone({
  title,
  hint,
  label,
  compact,
  disabled,
  drop,
  onPick,
}: {
  title: string;
  hint: string;
  label: string;
  compact?: boolean;
  disabled?: boolean;
  drop: ReturnType<typeof useDrop>;
  onPick(): void;
}) {
  return (
    <div className="envoi-drop" data-compact={compact || undefined} data-over={drop.over || undefined} data-disabled={disabled || undefined} onClick={disabled ? undefined : onPick} {...drop.handlers}>
      <span className="envoi-drop-icon" aria-hidden>
        <UploadIcon width={18} height={18} />
      </span>
      <div className="envoi-drop-text">
        <Text as="p" size="2" weight="medium">
          {drop.over ? "Lâche ici" : title}
        </Text>
        <Text as="p" size="1" color="gray">
          {hint}
        </Text>
      </div>
      <Button type="button" variant={compact ? "soft" : "solid"} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

/** Le son d'un set ou d'un podcast : un seul MP3. Le précédent reste tant qu'un nouveau n'est pas arrivé. */
export function MainAudio({
  jeton,
  showId,
  existing,
  sending,
  onChange,
  error,
  disabled,
}: {
  jeton: string;
  showId: string;
  existing: { fileName: string; status: string; size: string } | null;
  sending: Sending | null;
  onChange(sending: Sending | null): void;
  error?: string;
  disabled?: boolean;
}) {
  const [warning, setWarning] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const last = useRef<File | null>(null);
  const busy = sending?.state === "sending";
  useHoldWhile(busy);
  useEffect(() => () => controller.current?.abort(), []);
  const picker = usePicker(MAIN_ACCEPT, false, (files) => void choose(files[0]));
  const drop = useDrop((files) => void choose(files[0]), disabled || busy);

  async function choose(file: File | undefined) {
    if (!file) return;
    setWarning(null);
    const refused = audioRefusal(file.name, file.size, "main");
    if (refused) return onChange({ key: nextKey(), id: null, fileName: file.name, size: file.size, percent: 0, state: "error", error: refused });
    const kbps = await mp3Kbps(file).catch(() => null);
    setWarning(kbps && kbps < WANTED_KBPS ? `Ce MP3 est en ${kbps} kbit/s : si tu peux, exporte-le en ${WANTED_KBPS} kbit/s.` : null);
    void upload(file);
  }

  async function upload(file: File) {
    last.current = file;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    let current: Sending = { key: nextKey(), id: null, fileName: file.name, size: file.size, percent: 0, state: "sending" };
    onChange(current);
    try {
      const id = await send(jeton, file, "main", showId, (percent) => onChange((current = { ...current, percent: Math.min(99, percent) })), abort.signal);
      onChange({ ...current, id, percent: 100, state: "done" });
    } catch (failure) {
      if (abort.signal.aborted) return;
      onChange({ ...current, state: "error", retry: true, error: failure instanceof Error ? failure.message : "L'envoi n'a pas abouti." });
    }
  }

  /** Laisse tomber le fichier qui part, ou qui n'est pas parti : celui d'avant, s'il y en a un, reste. */
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setWarning(null);
    onChange(null);
  }

  const name = sending?.fileName ?? existing?.fileName ?? "";
  return (
    <Flex direction="column" gap="2">
      {picker.element}
      {sending || existing ? (
        <div className="envoi-file" data-state={sending?.state ?? "kept"} data-over={drop.over || undefined} {...drop.handlers}>
          <span className="envoi-file-icon" aria-hidden>
            {sending?.state === "error" ? <ExclamationTriangleIcon /> : busy ? <UploadIcon /> : <CheckCircledIcon />}
          </span>
          <div className="envoi-file-main">
            <Text as="p" size="2" weight="medium" truncate title={name}>
              {drop.over ? "Lâche pour le remplacer" : name}
            </Text>
            {busy ? (
              <>
                <Progress value={sending.percent} size="1" aria-label={`Envoi de ${sending.fileName}`} />
                <Text as="p" size="1" color="gray">
                  {sending.percent} % de {weight(sending.size)} · garde la page ouverte
                </Text>
              </>
            ) : sending?.state === "error" ? (
              <Text as="p" size="1" color="red">
                {sending.error}
              </Text>
            ) : sending ? (
              <Text as="p" size="1" color="green">
                Arrivé en entier · {weight(sending.size)}
              </Text>
            ) : (
              <Text as="p" size="1" color="gray">
                {[existing?.size, existing?.status].filter(Boolean).join(" · ")}
              </Text>
            )}
          </div>
          <Flex gap="2" className="envoi-file-actions">
            {busy ? (
              <Button type="button" size="1" variant="soft" color="gray" onClick={cancel}>
                Annuler
              </Button>
            ) : sending?.state === "error" ? (
              <>
                <Button type="button" size="1" variant="soft" onClick={() => (sending.retry && last.current ? void upload(last.current) : picker.open())} disabled={disabled}>
                  {sending.retry ? "Réessayer" : "Un autre fichier"}
                </Button>
                <IconButton type="button" size="1" variant="ghost" color="gray" onClick={cancel} aria-label="Laisser tomber ce fichier">
                  <Cross2Icon />
                </IconButton>
              </>
            ) : (
              <Button type="button" size="1" variant="soft" onClick={picker.open} disabled={disabled}>
                Remplacer
              </Button>
            )}
          </Flex>
        </div>
      ) : (
        <DropZone
          title="Glisse ton fichier ici"
          hint={`Un MP3 en ${WANTED_KBPS} kbit/s, ${MAX_MAIN_BYTES / 1_000_000} Mo au plus.`}
          label="Choisir le fichier"
          disabled={disabled}
          drop={drop}
          onPick={picker.open}
        />
      )}
      {warning && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{warning}</Callout.Text>
        </Callout.Root>
      )}
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}

/** Les morceaux d'une playlist, dans l'ordre : on en glisse plusieurs d'un coup, puis on les range. */
export function PartsField({ jeton, showId, rows, onChange, error, disabled }: { jeton: string; showId: string; rows: PartRow[]; onChange(rows: PartRow[]): void; error?: string; disabled?: boolean }) {
  const latest = useRef(rows);
  latest.current = rows;
  const update = (key: string, change: Partial<PartRow>) => {
    latest.current = latest.current.map((row) => (row.key === key ? { ...row, ...change } : row));
    onChange(latest.current);
  };
  const sortable = useSortable(rows, onChange);
  const controllers = useRef(new Map<string, AbortController>());
  useHoldWhile(rows.some((row) => row.state === "sending"));
  useEffect(() => () => controllers.current.forEach((controller) => controller.abort()), []);
  const full = rows.length >= MAX_PARTS;
  const picker = usePicker(PART_ACCEPT, true, (files) => void add(files));
  const drop = useDrop((files) => void add(files), disabled || full);

  async function add(files: File[]) {
    const room = MAX_PARTS - latest.current.length;
    const chosen = files.slice(0, Math.max(0, room));
    const fresh: PartRow[] = await Promise.all(
      chosen.map(async (file) => {
        const { artist, title } = trackFromFileName(file.name);
        const refused = audioRefusal(file.name, file.size, "part");
        return { key: nextKey(), id: null, artist, title, duration: refused ? null : await audioDuration(file), fileName: file.name, size: weight(file.size), state: refused ? "error" : "sending", percent: 0, error: refused ?? undefined };
      }),
    );
    latest.current = [...latest.current, ...fresh];
    onChange(latest.current);
    // Deux envois à la fois : assez pour avancer, sans saturer la connexion.
    const queue = fresh.flatMap((row, index) => (row.state === "sending" ? [{ row, file: chosen[index]! }] : []));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { row, file } = next;
        const abort = new AbortController();
        controllers.current.set(row.key, abort);
        try {
          const id = await send(jeton, file, "part", showId, (percent) => update(row.key, { percent: Math.min(99, percent) }), abort.signal);
          update(row.key, { id, percent: 100, state: "done" });
        } catch (failure) {
          if (!abort.signal.aborted) update(row.key, { state: "error", error: failure instanceof Error ? failure.message : "L'envoi n'a pas abouti." });
        } finally {
          controllers.current.delete(row.key);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  const remove = (key: string) => {
    controllers.current.get(key)?.abort();
    latest.current = latest.current.filter((row) => row.key !== key);
    onChange(latest.current);
  };

  const total = rows.reduce((sum, row) => sum + (row.duration ?? 0), 0);
  const moving = rows.filter((row) => row.state === "sending").length;
  return (
    <Flex direction="column" gap="3">
      {picker.element}
      {rows.length > 0 && (
        <div>
          <Flex justify="between" align="baseline" gap="2" wrap="wrap" mb="2">
            <Text size="2" weight="medium">
              {counted(rows.length, "morceau", "morceaux")}
              {total ? ` · ${formatTimecode(total)}` : ""}
            </Text>
            <Text size="1" color="gray">
              {moving ? `${moving} en route…` : "Range-les par la poignée."}
            </Text>
          </Flex>
          <ol className="envoi-parts" ref={(element) => void (sortable.container.current = element)}>
            {rows.map((row, index) => (
              <li key={row.key} className="envoi-part" data-sort-index={index} data-dragging={sortable.dragging === index || undefined} data-state={row.state}>
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <span className="envoi-part-number">{index + 1}</span>
                <span className="envoi-part-fields">
                  <input className="admin-cell" value={row.artist} onChange={(event) => update(row.key, { artist: event.target.value })} placeholder="Artiste" aria-label={`Artiste du morceau ${index + 1}`} />
                  <input className="admin-cell" value={row.title} onChange={(event) => update(row.key, { title: event.target.value })} placeholder="Titre" aria-label={`Titre du morceau ${index + 1}`} />
                </span>
                <span className="envoi-part-state">
                  {row.state === "sending" ? (
                    <Progress value={row.percent} size="1" aria-label={`Envoi de ${row.fileName}`} />
                  ) : row.state === "error" ? (
                    <Text size="1" color="red" title={row.error}>
                      {row.error}
                    </Text>
                  ) : (
                    <Text size="1" color="gray" title={row.fileName}>
                      {[row.duration ? formatTimecode(row.duration) : "", row.size].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </span>
                <IconButton type="button" size="1" variant="ghost" color="gray" onClick={() => remove(row.key)} aria-label={`Retirer le morceau ${index + 1}`}>
                  <Cross2Icon />
                </IconButton>
              </li>
            ))}
          </ol>
        </div>
      )}
      <DropZone
        compact={rows.length > 0}
        title={rows.length ? "D'autres morceaux ?" : "Glisse tes morceaux ici, tous d'un coup"}
        hint={full ? `${MAX_PARTS} morceaux au plus : la playlist est complète.` : `MP3, M4A, WAV, AIFF ou FLAC, ${MAX_PARTS} au plus. Tu les ranges ensuite par glisser.`}
        label={rows.length ? "Ajouter" : "Choisir les morceaux"}
        disabled={disabled || full}
        drop={drop}
        onPick={picker.open}
      />
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
