/**
 * L'outil d'assemblage d'une playlist (cms/README.md, 9.13), dans la fiche d'une émission « playlist ». Les morceaux
 * du curateur (reçus dans le seau) et ceux que l'équipe glisse depuis son ordinateur (téléchargés de son côté : l'outil
 * ne télécharge rien) sont rangés dans l'ordre de la playlist :
 *   - avec une liste, lue sur Deezer ou YouTube depuis le lien du curateur, ou collée, chaque fichier va à sa place
 *     (rapprocher) ; une place restée vide ou mal remplie se choisit dans un menu ; la setlist prend l'artiste et le
 *     titre de la liste ;
 *   - sans liste, les morceaux se rangent par glisser, et la setlist prend ce qu'on a écrit sur chaque ligne.
 * « Assembler » les enchaîne dans le navigateur (assemble.ts : fondu enchaîné, silences retirés, MP3 320 encodé dans un
 * Web Worker), dépose le MP3 dans le seau, puis en fait le son de l'émission ; la setlist minutée remplace la tracklist
 * si on le veut. L'onglet doit rester ouvert jusqu'au bout.
 */
import { DEFAULT_FADE, MAX_FADE, rapprocher, setlist, timeline, type ListedTrack } from "@parabole/cms/assemblage";
import { audioRefusal, PART_ACCEPT, trackFromFileName } from "@parabole/cms/envois";
import { formatTimecode, parseTracklist } from "@parabole/cms/tracklist";
import { ClipboardIcon, Cross2Icon, DownloadIcon, DragHandleDots2Icon, ExclamationTriangleIcon, LayersIcon, ReaderIcon, UploadIcon } from "@radix-ui/react-icons";
import { AlertDialog, Badge, Button, Callout, Checkbox, Dialog, Flex, IconButton, Progress, Select, Slider, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { audioDuration, putAudio } from "../envoi/audio";
import { assemble, type AssemblyStep } from "./assemble";
import { fields } from "./ImageField";
import { postForm, Section } from "./sheet";
import { useSortable } from "./sortable";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { AssemblyResponse, AssemblyTicket, AudioView, PlaylistResponse, ShowSheet } from "./types";

/** Un morceau de l'outil : un fichier du curateur, dans le seau, ou un fichier glissé par l'équipe. */
type Piece = { key: string; part: AudioView | null; file: File | null; name: string; artist: string; title: string; duration: number | null };

type PlaylistList = { source: string; tracks: ListedTrack[] };

type Running = AssemblyStep | { phase: "dépôt"; percent: number } | { phase: "enregistrement" };

const pieceOf = (part: AudioView): Piece => ({ key: `p:${part.id}`, part, file: null, name: part.fileName, artist: part.artist, title: part.title, duration: part.seconds });
const label = (track: { artist: string; title: string }) => [track.artist, track.title].filter(Boolean).join(" – ") || "Sans titre";
const minutes = (seconds: number | null) => (seconds ? formatTimecode(seconds) : "");

let counter = 0;

/** Où en est l'assemblage, en mots et en pour cent. */
function progressOf(running: Running): { text: string; percent: number } {
  switch (running.phase) {
    case "lecture":
    case "décodage":
    case "enchaînement": {
      const offset = { lecture: 0, décodage: 0.2, enchaînement: 0.5 }[running.phase];
      return { text: `Morceau ${running.index + 1} sur ${running.total} : ${running.phase}…`, percent: Math.round(((running.index + offset) / running.total) * 80) };
    }
    case "finalisation":
      return { text: "Finalisation du MP3…", percent: 82 };
    case "dépôt":
      return { text: `Dépôt du MP3 dans le seau : ${running.percent} %`, percent: 85 + Math.round(running.percent * 0.13) };
    case "enregistrement":
      return { text: "Enregistrement dans la fiche…", percent: 99 };
  }
}

export function Assembler({ url, sheet, dirty, onAssembled }: { url: string; sheet: ShowSheet; dirty: boolean; onAssembled(sheet: ShowSheet): void }) {
  const notify = useNotify();
  const [pieces, setPieces] = useState<Piece[]>(() => sheet.envoi.parts.map(pieceOf));
  const [list, setList] = useState<PlaylistList | null>(null);
  const [manual, setManual] = useState<Record<number, string | null>>({});
  const [reading, setReading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [fade, setFade] = useState(DEFAULT_FADE);
  const [trim, setTrim] = useState(true);
  const [replace, setReplace] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [over, setOver] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const link = sheet.envoi.submission?.link ?? null;
  const sortable = useSortable(pieces, setPieces);

  // Un fichier du curateur effacé ailleurs dans la fiche quitte l'outil.
  useEffect(() => {
    const kept = new Set(sheet.envoi.parts.map((part) => part.id));
    setPieces((current) => current.filter((piece) => !piece.part || kept.has(piece.part.id)));
  }, [sheet.envoi.parts]);
  // Fermer l'onglet couperait l'assemblage.
  useEffect(() => {
    if (!running) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", hold);
    return () => removeEventListener("beforeunload", hold);
  }, [running]);
  useEffect(() => () => controller.current?.abort(), []);

  // Avec une liste : chaque place reçoit son fichier, d'après le rapprochement, sauf celles choisies à la main.
  const placement = useMemo(() => {
    if (!list) return null;
    const matching = rapprocher(list.tracks, pieces.map((piece) => ({ id: piece.key, name: piece.name, artist: piece.artist, title: piece.title, duration: piece.duration })));
    const assigned = list.tracks.map((_, index) => (Object.hasOwn(manual, index) ? (manual[index] ?? null) : null));
    const used = new Set(assigned.filter((key): key is string => Boolean(key)));
    matching.places.forEach((key, index) => {
      if (!Object.hasOwn(manual, index) && key && !used.has(key)) {
        assigned[index] = key;
        used.add(key);
      }
    });
    return { assigned, unplaced: pieces.filter((piece) => !used.has(piece.key)) };
  }, [list, pieces, manual]);
  const byKey = useMemo(() => new Map(pieces.map((piece) => [piece.key, piece])), [pieces]);

  /** Ce qui sera assemblé, dans l'ordre, avec l'artiste et le titre de la setlist. */
  const chosen = useMemo(
    () =>
      list && placement
        ? placement.assigned.flatMap((key, index) => {
            const piece = key ? byKey.get(key) : undefined;
            return piece ? [{ piece, artist: list.tracks[index]!.artist, title: list.tracks[index]!.title }] : [];
          })
        : pieces.map((piece) => ({ piece, artist: piece.artist, title: piece.title })),
    [list, placement, pieces, byKey],
  );
  const unknown = chosen.filter((one) => one.piece.duration === null).length;
  const estimate = timeline(
    chosen.map((one) => one.piece.duration ?? 0),
    fade,
  ).total;
  const missing = placement ? placement.assigned.filter((key) => !key).length : 0;

  async function add(files: File[]) {
    const accepted = files.filter((file) => !audioRefusal(file.name, file.size, "part"));
    if (accepted.length < files.length) notify({ kind: "error", title: "Fichiers ignorés", description: "Un morceau en MP3, M4A, WAV, AIFF ou FLAC, 200 Mo au plus." });
    const fresh = await Promise.all(
      accepted.map(async (file) => {
        const { artist, title } = trackFromFileName(file.name);
        return { key: `l:${++counter}`, part: null, file, name: file.name, artist, title, duration: await audioDuration(file) } satisfies Piece;
      }),
    );
    setPieces((current) => [...current, ...fresh]);
  }

  const drop = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(false);
      void add([...event.dataTransfer.files]);
    },
  };

  async function readList() {
    if (!link) return;
    setReading(true);
    setListError(null);
    const result = await postForm<PlaylistResponse>("/admin/api/playlist", fields({ url: link }));
    setReading(false);
    if (result.ok) {
      setManual({});
      setList({ source: `lue sur ${result.platform}${result.title ? ` (« ${result.title} »)` : ""}`, tracks: result.tracks });
      return;
    }
    setListError("error" in result ? result.error : (result.errors.form ?? "La liste n'a pas pu être lue."));
  }

  function usePasted() {
    const tracks = parseTracklist(pasted).map((line) => ({ artist: line.artist, title: line.title, duration: null }));
    if (!tracks.length) return notify({ kind: "error", title: "Aucun morceau reconnu", description: "Une ligne par morceau : « Artiste – Titre »." });
    setManual({});
    setList({ source: "collée", tracks });
    setPasting(false);
    setListError(null);
  }

  const update = (key: string, change: Partial<Piece>) => setPieces((current) => current.map((piece) => (piece.key === key ? { ...piece, ...change } : piece)));
  const remove = (key: string) => setPieces((current) => current.filter((piece) => piece.key !== key));

  async function start() {
    if (replace && sheet.form.tracks.length && !confirming) return setConfirming(true);
    setConfirming(false);
    const abort = new AbortController();
    controller.current = abort;
    setRunning({ index: 0, total: chosen.length, phase: "lecture" });
    try {
      const result = await assemble(
        chosen.map(({ piece }) => ({
          name: piece.name,
          load: async (signal) => {
            if (piece.file) return piece.file.arrayBuffer();
            const answer = await fetch(piece.part!.listen, { signal });
            if (!answer.ok) throw new Error(`« ${piece.name} » ne se lit pas dans le seau (${answer.status}).`);
            return answer.arrayBuffer();
          },
        })),
        { fade, trim, signal: abort.signal, onStep: setRunning },
      );
      const ticket = await postForm<AssemblyTicket>(url, fields({ intent: "assembly-ticket", size: String(result.blob.size) }));
      if (!ticket.ok) throw new Error(ticket.errors.form ?? "Le seau refuse le dépôt.");
      setRunning({ phase: "dépôt", percent: 0 });
      await putAudio(ticket.url, result.blob, ticket.mime, (percent) => setRunning({ phase: "dépôt", percent }), abort.signal);
      setRunning({ phase: "enregistrement" });
      const data = fields({ intent: "assembly-register", file: ticket.id, duration: String(result.total) });
      if (replace) data.set("tracks", JSON.stringify(setlist(chosen, result.slots)));
      const saved = await postForm<AssemblyResponse>(url, data);
      if (!saved.ok) throw new Error(saved.errors.form ?? "L'enregistrement a échoué.");
      onAssembled(saved.sheet);
      notify({ kind: "success", title: "Playlist assemblée", description: `${formatTimecode(result.total)}, ${counted(chosen.length, "morceau", "morceaux")}. Écoute le son dans le panneau Son, puis valide-le.` });
    } catch (failure) {
      if (abort.signal.aborted) notify({ kind: "info", title: "Assemblage annulé" });
      else notify({ kind: "error", title: "Assemblage impossible", description: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      controller.current = null;
      setRunning(null);
    }
  }

  const progress = running ? progressOf(running) : null;
  const busy = running !== null;

  return (
    <Section
      title="Assembler la playlist"
      count={
        chosen.length > 0 && (
          <Badge color="gray" radius="full">
            {chosen.length}
          </Badge>
        )
      }
    >
      <Text as="p" size="2" color="gray" mb="4">
        Les morceaux du curateur et ceux que tu glisses ici, enchaînés en un seul MP3 320 avec un fondu ; la setlist minutée en sort toute seule.
      </Text>

      <div className="admin-assembly-block">
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Text size="2" weight="medium">
            La liste de la playlist
            {list && (
              <Text size="2" color="gray" weight="regular">
                {" "}
                · {list.source}, {counted(list.tracks.length, "morceau", "morceaux")}
              </Text>
            )}
          </Text>
          <Flex gap="2" wrap="wrap">
            {link && (
              <Button type="button" size="1" variant="soft" onClick={() => void readList()} loading={reading} disabled={busy}>
                <ReaderIcon /> Lire la liste du lien
              </Button>
            )}
            <Button type="button" size="1" variant="soft" color="gray" onClick={() => setPasting(true)} disabled={busy}>
              <ClipboardIcon /> Coller une liste
            </Button>
            {list && (
              <Button type="button" size="1" variant="ghost" color="gray" onClick={() => setList(null)} disabled={busy}>
                Sans liste
              </Button>
            )}
          </Flex>
        </Flex>
        {link && (
          <Text as="p" size="1" color="gray" mt="1" className="admin-break">
            Lien du curateur :{" "}
            <a href={link} target="_blank" rel="noopener noreferrer" className="admin-link-text">
              {link.replace(/^https:\/\/(www\.)?/, "")}
            </a>
            {" "}· télécharge les morceaux de ton côté, puis glisse-les ci-dessous.
          </Text>
        )}
        {!list && !link && (
          <Text as="p" size="1" color="gray" mt="1">
            Sans liste, les morceaux s'enchaînent dans l'ordre ci-dessous, que tu changes par glisser.
          </Text>
        )}
        {listError && (
          <Callout.Root size="1" color="amber" mt="2">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{listError}</Callout.Text>
          </Callout.Root>
        )}
      </div>

      {list && placement ? (
        <>
          <ol className="admin-assembly-rows">
            {list.tracks.map((track, index) => {
              const key = placement.assigned[index] ?? null;
              const piece = key ? byKey.get(key) : undefined;
              const gap = piece?.duration && track.duration ? Math.abs(piece.duration - track.duration) : 0;
              return (
                <li key={index} className="admin-assembly-row" data-missing={!piece || undefined}>
                  <span className="admin-track-number">{index + 1}</span>
                  <div className="admin-assembly-text">
                    <Text as="p" size="2" weight="medium" className="admin-break">
                      {label(track)}
                    </Text>
                    <Text as="p" size="1" color={gap > 15 ? "amber" : "gray"}>
                      {[minutes(track.duration), gap > 15 ? `le fichier dure ${minutes(piece!.duration)}` : ""].filter(Boolean).join(" · ") || " "}
                    </Text>
                  </div>
                  <Select.Root value={key ?? "aucun"} onValueChange={(value) => setManual((current) => ({ ...current, [index]: value === "aucun" ? null : value }))} disabled={busy}>
                    <Select.Trigger variant="soft" color={piece ? "gray" : "amber"} className="admin-assembly-file" aria-label={`Fichier du morceau ${index + 1}`} />
                    <Select.Content position="popper">
                      <Select.Item value="aucun">{piece ? "Aucun fichier" : "Manquant : choisir un fichier…"}</Select.Item>
                      {piece && <Select.Item value={piece.key}>{piece.name}</Select.Item>}
                      {placement.unplaced.map((other) => (
                        <Select.Item key={other.key} value={other.key}>
                          {other.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </li>
              );
            })}
          </ol>
          {placement.unplaced.length > 0 && (
            <div className="admin-assembly-block">
              <Text as="p" size="1" weight="medium" color="amber" mb="1">
                {counted(placement.unplaced.length, "fichier non rangé", "fichiers non rangés")} : choisis leur place dans la liste, ou ils ne seront pas assemblés.
              </Text>
              <ul className="admin-assembly-loose">
                {placement.unplaced.map((piece) => (
                  <li key={piece.key}>
                    <Text size="1" className="admin-break">
                      {piece.name}
                      {piece.duration ? ` · ${minutes(piece.duration)}` : ""}
                    </Text>
                    {!piece.part && (
                      <IconButton type="button" size="1" variant="ghost" color="gray" onClick={() => remove(piece.key)} aria-label={`Retirer ${piece.name}`} disabled={busy}>
                        <Cross2Icon />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        pieces.length > 0 && (
          <ol className="admin-assembly-rows" ref={(element) => void (sortable.container.current = element)}>
            {pieces.map((piece, index) => (
              <li key={piece.key} className="admin-assembly-row admin-assembly-free" data-sort-index={index} data-dragging={sortable.dragging === index || undefined}>
                <span className="admin-grip" aria-hidden {...(busy ? {} : sortable.handle(index))}>
                  <DragHandleDots2Icon />
                </span>
                <span className="admin-track-number">{index + 1}</span>
                <span className="admin-assembly-cells">
                  <input className="admin-cell" value={piece.artist} onChange={(event) => update(piece.key, { artist: event.target.value })} placeholder="Artiste" aria-label={`Artiste du morceau ${index + 1}`} disabled={busy} />
                  <input className="admin-cell" value={piece.title} onChange={(event) => update(piece.key, { title: event.target.value })} placeholder="Titre" aria-label={`Titre du morceau ${index + 1}`} disabled={busy} />
                </span>
                <Text size="1" color="gray" className="admin-assembly-name" title={piece.name}>
                  {[minutes(piece.duration), piece.part ? "du curateur" : "ajouté"].filter(Boolean).join(" · ")}
                </Text>
                <Flex gap="1">
                  {piece.part && (
                    <IconButton size="1" variant="ghost" color="gray" asChild>
                      <a href={piece.part.download} download aria-label={`Télécharger ${piece.name}`} title="Télécharger">
                        <DownloadIcon />
                      </a>
                    </IconButton>
                  )}
                  <IconButton type="button" size="1" variant="ghost" color="gray" onClick={() => remove(piece.key)} aria-label={`Retirer ${piece.name} de l'assemblage`} title="Retirer de l'assemblage" disabled={busy}>
                    <Cross2Icon />
                  </IconButton>
                </Flex>
              </li>
            ))}
          </ol>
        )
      )}

      <div
        className="admin-assembly-drop"
        data-over={over || undefined}
        data-disabled={busy || undefined}
        onClick={busy ? undefined : () => picker.current?.click()}
        {...(busy ? {} : drop)}
      >
        <UploadIcon aria-hidden />
        <Text size="2">{over ? "Lâche les morceaux ici" : "Glisse ici les morceaux téléchargés de ton côté, ou clique pour les choisir"}</Text>
        <input
          ref={picker}
          type="file"
          accept={PART_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      <div className="admin-assembly-settings">
        <Flex direction="column" gap="2" className="admin-assembly-fade">
          <Text as="label" size="2" weight="medium" htmlFor="assembly-fade">
            Fondu enchaîné : {fade} s
          </Text>
          <Slider id="assembly-fade" min={0} max={MAX_FADE} step={1} value={[fade]} onValueChange={([value]) => setFade(value ?? DEFAULT_FADE)} disabled={busy} aria-label="Fondu enchaîné, en secondes" />
        </Flex>
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox checked={trim} onCheckedChange={(checked) => setTrim(checked === true)} disabled={busy} />
            Retirer les silences au début et à la fin des morceaux
          </Flex>
        </Text>
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox checked={replace} onCheckedChange={(checked) => setReplace(checked === true)} disabled={busy} />
            Remplacer la tracklist par la setlist minutée
          </Flex>
        </Text>
      </div>

      {progress ? (
        <div className="admin-assembly-progress" aria-live="polite">
          <Flex justify="between" align="center" gap="3">
            <Text size="2" weight="medium">
              {progress.text}
            </Text>
            <Button type="button" size="1" variant="soft" color="gray" onClick={() => controller.current?.abort()}>
              Annuler
            </Button>
          </Flex>
          <Progress value={progress.percent} />
          <Text size="1" color="gray">
            Garde cet onglet ouvert jusqu'au bout.
          </Text>
        </div>
      ) : (
        <Flex justify="between" align="center" gap="3" wrap="wrap" className="admin-assembly-go">
          <Text size="2" color="gray">
            {chosen.length
              ? `${counted(chosen.length, "morceau", "morceaux")} · ${unknown ? "au moins " : "environ "}${formatTimecode(estimate)}${missing ? ` · ${counted(missing, "manquant", "manquants")}` : ""}`
              : "Aucun morceau à assembler pour l'instant."}
          </Text>
          <Button type="button" onClick={() => void start()} disabled={!chosen.length || dirty || !sheet.envoi.ready} title={dirty ? "Enregistre d'abord la fiche." : undefined}>
            <LayersIcon /> Assembler
          </Button>
        </Flex>
      )}
      {dirty && !busy && (
        <Text as="p" size="1" color="gray" mt="1">
          Enregistre d'abord la fiche : l'assemblage la met à jour.
        </Text>
      )}

      <Dialog.Root open={pasting} onOpenChange={setPasting}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>Coller la liste de la playlist</Dialog.Title>
          <Dialog.Description size="2" mb="3">
            Une ligne par morceau, « Artiste – Titre » : copiée depuis Spotify, Apple Music, un message du curateur…
          </Dialog.Description>
          <TextArea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={10} placeholder={"Kerri Chandler – Rain\nÉtienne de Crécy – Prix choc"} />
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={usePasted}>
              Ranger d'après cette liste
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Remplacer la tracklist ?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            La tracklist actuelle ({counted(sheet.form.tracks.length, "morceau", "morceaux")}) sera remplacée par la setlist minutée de l'assemblage.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Annuler
              </Button>
            </AlertDialog.Cancel>
            <Button onClick={() => void start()}>Assembler et remplacer</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Section>
  );
}
