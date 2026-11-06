/**
 * Les vidéos de fond : celles qui passent au hasard derrière toutes les pages du site, l'une après l'autre (cms/README.md,
 * « Les vidéos de fond »). Une carte par vidéo, dans l'ordre de la liste : son image et son numéro, son titre (modifiable
 * sur place), sa durée et son poids, l'interrupteur « Dans la rotation », monter et descendre, et le menu (voir,
 * renommer, remplacer, supprimer). Chaque action répond par la liste à jour, que le routeur affiche.
 *
 * Ajouter une vidéo, ou remplacer celle d'une carte : le navigateur la lit d'abord (durée, cadre, et sa première image,
 * qui devient l'image d'attente), la dépose lui-même sur Vercel Blob avec un jeton signé par le serveur, puis le serveur
 * l'inscrit. Un envoi continue quand on change d'écran : sa progression est gardée hors de l'écran (uploads), une
 * notification annonce la fin, et la liste se met à jour si on la regarde.
 *
 * Au-dessus de la liste, le filtre cathodique posé sur tout le site : une case l'allume ou l'éteint, un curseur règle son
 * intensité (100 % : l'effet d'origine). Le site le prend avec la liste des vidéos, en une minute environ.
 */
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsHorizontalIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  Pencil1Icon,
  PlayIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { AlertDialog, Button, Callout, Card, Checkbox, Dialog, DropdownMenu, Flex, IconButton, Progress, Slider, Spinner, Switch, Text, TextField, Tooltip } from "@radix-ui/themes";
import { put } from "@vercel/blob/client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FieldErrors } from "@parabole/cms";
import { PageHeader } from "./AdminShell";
import { useRouter } from "./router";
import { postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { ClipRow, ClipsData, ClipsResponse, CrtView, Flash } from "./types";

const HREF = "/admin/videos";
const TITLE = "Vidéos de fond";

type Router = ReturnType<typeof useRouter>;
type Notify = (flash: Flash) => void;

/** Une vidéo plus lourde passe, mais chaque visiteur la télécharge : on le signale. */
const HEAVY_BYTES = 15_000_000;

/** Les types que le fond sait passer partout, et ceux qu'on reconnaît à l'extension quand le système n'en dit rien. */
const TYPES_BY_EXTENSION: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm" };
const ACCEPT = "video/mp4,video/webm,.mp4,.m4v,.webm";

const fields = (values: Record<string, string>, more: [string, string][] = []) => {
  const data = new FormData();
  for (const [name, value] of [...Object.entries(values), ...more]) data.append(name, value);
  return data;
};
const firstError = (errors: FieldErrors) => errors.video ?? errors.title ?? errors.form ?? Object.values(errors)[0] ?? "Le serveur a refusé.";
const messageOf = (error: unknown) => (error instanceof Error && error.message) || "Quelque chose s'est mal passé. Réessaie.";
const nameOf = (clip: ClipRow) => clip.title || "Sans titre";
const channelOf = (clip: ClipRow) => (clip.channel ? String(clip.channel).padStart(2, "0") : null);

/** Le titre proposé pour une vidéo : le nom du fichier, sans son extension ni ses soulignés. */
const titleOf = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** Le type d'une vidéo acceptée, ou null. */
function typeOf(file: File): string | null {
  if (file.type === "video/mp4" || file.type === "video/webm") return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  return TYPES_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Les envois en cours, gardés hors de l'écran
// ---------------------------------------------------------------------------------------------------------------

type Upload = { key: string; name: string; replacing: string | null; step: "lecture" | "envoi" | "inscription"; percent: number };

const NONE: Upload[] = [];
let uploads = NONE;
const listeners = new Set<() => void>();
const holdPage = (event: BeforeUnloadEvent) => event.preventDefault();

function setUploads(next: Upload[]) {
  // Fermer l'onglet couperait l'envoi : le navigateur demande confirmation tant qu'il en reste un.
  if (next.length && !uploads.length) addEventListener("beforeunload", holdPage);
  if (!next.length && uploads.length) removeEventListener("beforeunload", holdPage);
  uploads = next.length ? next : NONE;
  for (const listener of listeners) listener();
}
const patchUpload = (key: string, change: Partial<Upload>) => setUploads(uploads.map((one) => (one.key === key ? { ...one, ...change } : one)));
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const useUploads = () => useSyncExternalStore(subscribe, () => uploads, () => NONE);

const STEPS: Record<Upload["step"], string> = { lecture: "Lecture de la vidéo…", envoi: "Envoi", inscription: "Ajout à la liste…" };

// ---------------------------------------------------------------------------------------------------------------
// Lire, envoyer, inscrire
// ---------------------------------------------------------------------------------------------------------------

type Inspected = { duration: number | null; width: number; height: number; poster: Blob };

/** Lit une vidéo dans le navigateur : sa durée, son cadre, et sa première image en JPEG, qui sera l'image d'attente. */
function inspect(file: File): Promise<Inspected> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = () => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = (message: string) => {
      finish();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("La vidéo met trop longtemps à s'ouvrir dans le navigateur."), 30_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => fail("Ce navigateur ne sait pas lire cette vidéo, les visiteurs non plus sans doute : exporte-la en MP4 (H.264).");
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) return fail("Ce fichier n'a pas d'image : il faut une vidéo.");
      // Un dixième de seconde après le début : la toute première image n'est pas toujours prête à être copiée.
      video.currentTime = Math.min(0.1, Number.isFinite(video.duration) ? video.duration / 2 : 0.1);
    };
    video.onseeked = () => {
      const scale = Math.min(1, 640 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const facts = { duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null, width: video.videoWidth, height: video.videoHeight };
      canvas.toBlob(
        (poster) => {
          finish();
          if (poster) resolve({ ...facts, poster });
          else reject(new Error("La première image de la vidéo n'a pas pu être copiée."));
        },
        "image/jpeg",
        0.8,
      );
    };
    video.src = url;
  });
}

/** Dépose un fichier sur Vercel Blob, avec un jeton que le serveur signe pour lui seul. Rend son adresse. */
async function send(kind: "video" | "poster", body: Blob, type: string, onPercent?: (percent: number) => void): Promise<string> {
  const ticket = await postForm<{ ok: true; pathname: string; token: string }>(HREF, fields({ intent: "ticket", kind, type, size: String(body.size) }));
  if (!ticket.ok) throw new Error(firstError(ticket.errors));
  try {
    const blob = await put(ticket.pathname, body, {
      access: "public",
      token: ticket.token,
      contentType: type,
      multipart: body.size > 8_000_000,
      onUploadProgress: ({ percentage }) => onPercent?.(percentage),
    });
    return blob.url;
  } catch {
    throw new Error("L'envoi vers le stockage a échoué. Vérifie la connexion, puis réessaie.");
  }
}

/**
 * Ajoute une vidéo, ou remplace le fichier d'une carte : la lire, l'envoyer avec son image d'attente, l'inscrire. Rend
 * la réponse du serveur, ou lève une erreur au message lisible. Les fichiers déjà partis sont effacés en cas d'échec.
 */
async function uploadClip(file: File, type: string, replacing: ClipRow | null, step: (change: Partial<Upload>) => void) {
  const facts = await inspect(file);
  const sent: string[] = [];
  try {
    step({ step: "envoi", percent: 0 });
    const videoUrl = await send("video", file, type, (percent) => step({ percent: Math.min(99, percent) }));
    sent.push(videoUrl);
    const posterUrl = await send("poster", facts.poster, "image/jpeg");
    sent.push(posterUrl);
    step({ step: "inscription", percent: 100 });
    const result = await postForm<ClipsResponse>(
      HREF,
      fields({
        intent: replacing ? "replace" : "add",
        id: replacing?.id ?? "",
        title: titleOf(file.name),
        status: "published",
        videoUrl,
        posterUrl,
        mimeType: type,
        size: String(file.size),
        duration: facts.duration ? String(facts.duration) : "",
        width: String(facts.width),
        height: String(facts.height),
      }),
    );
    if (!result.ok) throw new Error(firstError(result.errors));
    return result;
  } catch (error) {
    // Le serveur efface aussi ce qu'il refuse ; ici, ce qu'un envoi interrompu a laissé.
    if (sent.length) void postForm(HREF, fields({ intent: "abandon" }, sent.map((url) => ["url", url])));
    throw error;
  }
}

/** La liste à jour : affichée si l'on regarde encore les vidéos, et oubliée des écrans gardés en mémoire. */
function showList(router: Router, data: ClipsData) {
  router.invalidate();
  if (location.pathname.replace(/\/+$/, "") === HREF) router.replace(HREF, { name: "clips", title: TITLE, data });
}

/** L'intensité d'origine du filtre cathodique, en pour cent. */
const CRT_DEFAULT = 100;

/**
 * Le filtre cathodique posé sur tout le site (lignes de balayage, phosphore, vignettage) : la case l'allume ou
 * l'éteint, le curseur règle son intensité, enregistrée quand on le lâche. La case change tout de suite à l'écran, et
 * revient en arrière si le serveur refuse.
 */
function CrtFilter({ crt, router, notify }: { crt: CrtView; router: Router; notify: Notify }) {
  const [on, setOn] = useState(crt.on);
  const [strength, setStrength] = useState(crt.strength);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(crt.on), [crt.on]);
  useEffect(() => setStrength(crt.strength), [crt.strength]);

  const save = async (values: Record<string, string>) => {
    setBusy(true);
    const result = await postForm<ClipsResponse>(HREF, fields({ intent: "look", ...values }));
    setBusy(false);
    if (result.ok) {
      showList(router, result.data);
      if (result.message) notify({ kind: "success", title: result.message });
      return;
    }
    setOn(crt.on);
    setStrength(crt.strength);
    notify({ kind: "error", title: "Rien n'a changé", description: result.errors.crtStrength ?? firstError(result.errors) });
  };
  const saveStrength = (value: number) => {
    setStrength(value);
    if (value !== crt.strength) void save({ crtStrength: String(value) });
  };

  return (
    <Card size="2" mb="5">
      <Flex direction="column" gap="3">
        <Text as="label" size="2" weight="medium">
          <Flex gap="2" align="center">
            <Checkbox
              checked={on}
              disabled={busy}
              onCheckedChange={(checked) => {
                setOn(checked === true);
                void save({ crtFilter: checked === true ? "on" : "off" });
              }}
            />
            Filtre cathodique sur tout le site
          </Flex>
        </Text>
        <Text size="1" color="gray">
          Les lignes de balayage, le phosphore et le coin sombre d'un vieux téléviseur, posés par-dessus tout le site (vidéo, en-tête, panneaux, rubriques).
          L'intensité les rend plus discrets ou plus marqués ; 100 % est l'effet d'origine.
        </Text>
        <Flex align="center" gap="3" wrap="wrap">
          <Text size="2" color={on ? undefined : "gray"}>
            Intensité
          </Text>
          <Slider
            value={[strength]}
            min={crt.min}
            max={crt.max}
            step={5}
            disabled={!on || busy}
            onValueChange={([value]) => setStrength(value ?? crt.strength)}
            onValueCommit={([value]) => value !== undefined && saveStrength(value)}
            aria-label="Intensité du filtre cathodique, en pour cent"
            style={{ flex: "1 1 200px", maxWidth: 360 }}
          />
          <Text size="2" color={on ? undefined : "gray"} className="admin-nowrap admin-tabular" style={{ minWidth: "4.5ch" }}>
            {strength} %
          </Text>
          {strength !== CRT_DEFAULT && (
            <Button variant="soft" color="gray" size="1" disabled={!on || busy} onClick={() => saveStrength(CRT_DEFAULT)}>
              <ReloadIcon /> Revenir à {CRT_DEFAULT} %
            </Button>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}

/** Lance l'envoi d'une vidéo choisie : il continue même si l'on quitte l'écran. */
function startUpload(file: File, replacing: ClipRow | null, maxBytes: number, router: Router, notify: Notify) {
  const type = typeOf(file);
  if (!type) return notify({ kind: "error", title: "Vidéo refusée", description: "Une vidéo MP4 (H.264) ou WebM seulement. Une vidéo .mov s'exporte en MP4 depuis la plupart des logiciels." });
  if (file.size > maxBytes)
    return notify({ kind: "error", title: "Vidéo trop lourde", description: `${Math.round(file.size / 1_000_000)} Mo : ${maxBytes / 1_000_000} Mo au plus. Réduis-la (640 px de large suffisent) avant de l'envoyer.` });
  if (file.size > HEAVY_BYTES) notify({ kind: "info", title: "Vidéo lourde", description: "Elle passera, mais chaque visiteur la télécharge : vise moins de 10 Mo." });
  const key = `${Date.now()}-${Math.random()}`;
  setUploads([...uploads, { key, name: file.name, replacing: replacing?.id ?? null, step: "lecture", percent: 0 }]);
  uploadClip(file, type, replacing, (change) => patchUpload(key, change))
    .then(
      (result) => {
        showList(router, result.data);
        notify({ kind: "success", title: result.message ?? "Vidéo ajoutée" });
      },
      (error) => notify({ kind: "error", title: replacing ? "Vidéo non remplacée" : "Vidéo non ajoutée", description: messageOf(error) }),
    )
    .finally(() => setUploads(uploads.filter((one) => one.key !== key)));
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------------------------------------------

export function ClipsScreen({ clips, uploads: canUpload, maxBytes, crt }: ClipsData) {
  const router = useRouter();
  const notify = useNotify();
  const running = useUploads();
  const picker = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<ClipRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClipRow | null>(null);
  const [removing, setRemoving] = useState<ClipRow | null>(null);
  const inRotation = clips.filter((clip) => clip.status === "published").length;
  const aside = clips.length - inRotation;

  /** Une action sur une carte : la liste à jour, ou le refus. */
  const act = async (clip: ClipRow, values: Record<string, string>) => {
    setBusy(clip.id);
    const result = await postForm<ClipsResponse>(HREF, fields({ id: clip.id, ...values }));
    setBusy(null);
    if (result.ok) {
      showList(router, result.data);
      if (result.message) notify({ kind: "success", title: result.message });
      return true;
    }
    notify({ kind: "error", title: "Rien n'a changé", description: firstError(result.errors) });
    return false;
  };

  const choose = (target: ClipRow | null) => {
    setReplacing(target);
    picker.current?.click();
  };

  return (
    <div className="admin-page">
      <PageHeader
        title={TITLE}
        description={clips.length ? `${counted(inRotation, "vidéo")} dans la rotation${aside ? ` · ${counted(aside, "mise de côté", "mises de côté")}` : ""}` : undefined}
        actions={
          <Button onClick={() => choose(null)} disabled={!canUpload}>
            <PlusIcon /> Ajouter une vidéo
          </Button>
        }
      />
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) startUpload(file, replacing, maxBytes, router, notify);
        }}
      />

      <Flex direction="column" gap="3" mb="5">
        <Callout.Root color="gray" variant="surface" size="1">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            Elles passent au hasard derrière toutes les pages du site, l'une après l'autre ; le numéro suit l'ordre de la liste. Une vidéo mise de côté reste ici
            sans passer sur le site. Le site prend chaque changement en une minute environ. À envoyer : MP4 (H.264) ou WebM, {maxBytes / 1_000_000} Mo au plus ;
            chaque visiteur la télécharge, 640 px de large suffisent.
          </Callout.Text>
        </Callout.Root>
        {!canUpload && (
          <Callout.Root color="amber" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              L'envoi de vidéos n'est pas encore branché : il faut relier un magasin Vercel Blob au projet (réglage BLOB_READ_WRITE_TOKEN). En attendant, tu
              peux renommer, ranger, mettre de côté ou supprimer les vidéos.
            </Callout.Text>
          </Callout.Root>
        )}
        {clips.length > 0 && !inRotation && (
          <Callout.Root color="red" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>Aucune vidéo dans la rotation : le fond du site reste noir.</Callout.Text>
          </Callout.Root>
        )}
      </Flex>

      <CrtFilter crt={crt} router={router} notify={notify} />

      {running.length > 0 && (
        <div className="admin-clips admin-clips-uploads" aria-live="polite">
          {running.map((upload) => (
            <div key={upload.key} className="admin-clip admin-clip-upload">
              <Flex direction="column" gap="2" p="4">
                <Flex align="center" gap="2">
                  <Spinner size="1" />
                  <Text size="2" weight="medium" truncate>
                    {upload.replacing ? `Remplacement : ${upload.name}` : upload.name}
                  </Text>
                </Flex>
                <Text size="1" color="gray">
                  {STEPS[upload.step]}
                  {upload.step === "envoi" ? ` · ${Math.round(upload.percent)} %` : ""}
                </Text>
                <Progress size="1" value={upload.step === "lecture" ? undefined : upload.percent} aria-label={`Envoi de ${upload.name}`} />
              </Flex>
            </div>
          ))}
        </div>
      )}

      {clips.length ? (
        <ol className="admin-clips">
          {clips.map((clip, index) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              first={index === 0}
              last={index === clips.length - 1}
              busy={busy === clip.id}
              canUpload={canUpload}
              replacing={running.some((upload) => upload.replacing === clip.id)}
              onAct={(values) => act(clip, values)}
              onPreview={() => setPreview(clip)}
              onReplace={() => choose(clip)}
              onDelete={() => setRemoving(clip)}
            />
          ))}
        </ol>
      ) : (
        <div className="admin-tracks-empty">
          <span className="admin-empty-icon" aria-hidden>
            <VideoIcon width="22" height="22" />
          </span>
          <Text size="3" weight="medium">
            Pas de vidéo de fond
          </Text>
          <Text size="2" color="gray">
            Sans vidéo, le fond du site reste noir.
          </Text>
          {canUpload && (
            <Button onClick={() => choose(null)}>
              <PlusIcon /> Ajouter la première
            </Button>
          )}
        </div>
      )}

      <PreviewDialog clip={preview} onClose={() => setPreview(null)} />
      <DeleteDialog
        clip={removing}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing!;
          setRemoving(null);
          await act(target, { intent: "delete" });
        }}
      />
    </div>
  );
}

function ClipCard({
  clip,
  first,
  last,
  busy,
  canUpload,
  replacing,
  onAct,
  onPreview,
  onReplace,
  onDelete,
}: {
  clip: ClipRow;
  first: boolean;
  last: boolean;
  busy: boolean;
  canUpload: boolean;
  replacing: boolean;
  onAct(values: Record<string, string>): Promise<boolean>;
  onPreview(): void;
  onReplace(): void;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(clip.title);
  // Échap abandonne la saisie : la perte du focus qui suit n'enregistre rien. Entrée enregistre une fois : la perte du
  // focus pendant l'envoi ne renvoie pas le titre.
  const cancelled = useRef(false);
  const sending = useRef(false);
  // « Renommer » choisi dans le menu : le menu ne rend pas le focus à son bouton, il va au champ du titre.
  const renaming = useRef(false);
  // Le statut demandé, montré tout de suite par l'interrupteur en attendant le serveur.
  const [wanted, setWanted] = useState<ClipRow["status"] | null>(null);
  const status = wanted ?? clip.status;
  const channel = channelOf(clip);
  const titleId = `clip-${clip.id}`;

  useEffect(() => {
    if (!editing) setDraft(clip.title);
  }, [clip.title, editing]);

  const edit = () => {
    cancelled.current = false;
    setEditing(true);
  };
  const rename = async () => {
    if (cancelled.current || sending.current) return;
    const title = draft.replace(/\s+/g, " ").trim();
    if (title === clip.title) return setEditing(false);
    sending.current = true;
    const saved = await onAct({ intent: "save", title });
    sending.current = false;
    if (saved) setEditing(false);
  };

  return (
    <li className="admin-clip" data-off={status === "draft" || undefined} aria-labelledby={titleId}>
      <button type="button" className="admin-clip-media" onClick={onPreview} aria-label={`Voir « ${nameOf(clip)} »`}>
        {clip.posterUrl ? (
          <img src={clip.posterUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <VideoIcon width="28" height="28" aria-hidden />
        )}
        <span className="admin-clip-channel">{channel ? `CH ${channel}` : "De côté"}</span>
        <span className="admin-clip-play" aria-hidden>
          <PlayIcon width="18" height="18" />
        </span>
      </button>

      <div className="admin-clip-body">
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <TextField.Root
              id={titleId}
              autoFocus
              size="2"
              value={draft}
              maxLength={200}
              placeholder="Titre de la vidéo"
              aria-label="Titre de la vidéo"
              readOnly={busy}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelled.current = true;
                  setDraft(clip.title);
                  setEditing(false);
                }
              }}
            />
          </form>
        ) : (
          <button type="button" id={titleId} className="admin-clip-title" onClick={edit} title="Renommer">
            {clip.title || <span className="admin-clip-untitled">Sans titre</span>}
          </button>
        )}
        <Text as="p" size="1" color="gray">
          {clip.facts}
          {clip.facts && " · "}
          {clip.origin === "site" ? "livrée avec le site" : `ajoutée le ${clip.added}`}
        </Text>
      </div>

      <div className="admin-clip-actions">
        <Text as="label" size="2" className="admin-clip-switch">
          <Switch
            size="1"
            checked={status === "published"}
            disabled={busy || replacing}
            onCheckedChange={async (on) => {
              const next = on ? "published" : "draft";
              setWanted(next);
              await onAct({ intent: "save", status: next });
              setWanted(null);
            }}
          />
          Dans la rotation
        </Text>
        <Flex gap="1" align="center" ml="auto">
          {(busy || replacing) && <Spinner size="1" />}
          <Tooltip content="Monter d'une place">
            <IconButton size="2" variant="ghost" color="gray" disabled={first || busy} aria-label="Monter d'une place" onClick={() => void onAct({ intent: "move", direction: "up" })}>
              <ArrowUpIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Descendre d'une place">
            <IconButton size="2" variant="ghost" color="gray" disabled={last || busy} aria-label="Descendre d'une place" onClick={() => void onAct({ intent: "move", direction: "down" })}>
              <ArrowDownIcon />
            </IconButton>
          </Tooltip>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="2" variant="ghost" color="gray" aria-label={`Plus d'actions pour « ${nameOf(clip)} »`}>
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="end"
              size="2"
              className="admin-menu"
              onCloseAutoFocus={(event) => {
                if (!renaming.current) return;
                renaming.current = false;
                event.preventDefault();
                requestAnimationFrame(() => (document.getElementById(titleId) as HTMLInputElement | null)?.select());
              }}
            >
              <DropdownMenu.Item onSelect={onPreview}>
                <PlayIcon /> Voir la vidéo
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  renaming.current = true;
                  edit();
                }}
              >
                <Pencil1Icon /> Renommer
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled={!canUpload || replacing} onSelect={onReplace}>
                <ReloadIcon /> Remplacer la vidéo…
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" disabled={replacing} onSelect={onDelete}>
                <TrashIcon /> Supprimer…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      </div>
    </li>
  );
}

/** La vidéo en grand, avec ses commandes, muette au départ comme sur le site. */
function PreviewDialog({ clip, onClose }: { clip: ClipRow | null; onClose(): void }) {
  return (
    <Dialog.Root
      open={clip !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="760px" aria-describedby={undefined}>
        <Dialog.Title size="4">
          {clip && channelOf(clip) ? `CH ${channelOf(clip)} · ` : ""}
          {clip ? nameOf(clip) : ""}
        </Dialog.Title>
        {clip && <video className="admin-clip-preview" src={clip.videoUrl} poster={clip.posterUrl ?? undefined} controls autoPlay muted playsInline loop />}
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Fermer
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Supprimer une vidéo, après confirmation : mettre de côté reste la voie douce. */
function DeleteDialog({ clip, onClose, onConfirm }: { clip: ClipRow | null; onClose(): void; onConfirm(): void }) {
  return (
    <AlertDialog.Root
      open={clip !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Supprimer « {clip ? nameOf(clip) : ""} » ?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          {clip?.origin === "upload"
            ? "Elle quitte le site et son fichier est effacé du stockage : pour la remettre, il faudra la renvoyer."
            : "Elle quitte le site. Son fichier, livré avec le site, n'est pas effacé, mais elle ne reviendra dans la liste que renvoyée."}{" "}
          Pour la garder sans la passer, mets-la plutôt de côté.
        </AlertDialog.Description>
        <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={onConfirm}>
              <TrashIcon /> Supprimer
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
