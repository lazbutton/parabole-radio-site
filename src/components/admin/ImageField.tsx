/**
 * L'image d'une fiche (cms/README.md, 9.3) : la photo d'un artiste, la pochette d'un show. Vide, une zone où glisser
 * un fichier, ou d'où le choisir ; pleine, l'image avec son texte alternatif et son crédit, et Remplacer, Modifier le
 * texte, Retirer.
 *
 * Un fichier choisi s'ouvre dans une fenêtre : l'aperçu cadré comme sur le site (en carré, on fait glisser l'image pour
 * choisir ce qui reste), le texte alternatif déjà proposé, le crédit. « Envoyer » dépose l'original directement dans le
 * Storage de Supabase, à une adresse que le serveur signe pour ce seul fichier (une fonction Vercel n'accepterait pas
 * plus de 4,5 Mo) ; le serveur en tire les versions du site, puis la fiche met l'image à sa place, tout de suite : pas
 * besoin d'enregistrer la fiche. L'ancienne image est effacée si rien d'autre ne s'en sert.
 */
import type { FieldErrors } from "@parabole/cms";
import { DotsHorizontalIcon, ExclamationTriangleIcon, ImageIcon, Pencil1Icon, TrashIcon, UploadIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, Callout, Checkbox, Dialog, DropdownMenu, Flex, IconButton, Progress, Text, TextArea, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type SubmitEvent } from "react";
import { Field, postForm } from "./sheet";
import { useNotify } from "./toast";
import type { MediaView, PlaceResponse, UploadSettings } from "./types";

const API = "/admin/api/media";
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
/** Le type d'un fichier que le système ne nomme pas, d'après son extension. */
const TYPES_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };
const ACCEPT = [...TYPES, ".jpg", ".jpeg", ".png", ".webp", ".avif"].join(",");
/** En dessous, l'image sera floue en grand (le fond de la page d'un artiste). */
const SMALL_SIDE = 800;
/** En dessous, le serveur la refuse (src/lib/admin/storage.ts, MIN_IMAGE_SIDE) : inutile de l'envoyer. */
const MIN_SIDE = 200;

export type ImageKind = "photo" | "pochette";
const WORDS: Record<ImageKind, { the: string; a: string; fresh: string; placed: string; removed: string; kept: string }> = {
  photo: { the: "la photo", a: "une photo", fresh: "Nouvelle photo", placed: "Photo en place", removed: "Photo retirée", kept: "La photo n'est pas retirée" },
  pochette: { the: "la pochette", a: "une pochette", fresh: "Nouvelle pochette", placed: "Pochette en place", removed: "Pochette retirée", kept: "La pochette n'est pas retirée" },
};

const fields = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  return data;
};
const firstError = (errors: FieldErrors) => errors.image ?? errors.form ?? Object.values(errors)[0] ?? "Le serveur a refusé.";
/** « 4,2 Mo », « 85 Ko » */
const weight = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} Ko` : `${(bytes / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Le type d'une image acceptée, ou null. */
function typeOf(file: File): string | null {
  if (TYPES.includes(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  return TYPES_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/**
 * Met une image à sa place sur une fiche (photo d'un artiste, pochette d'un show), ou l'en retire (null) : l'adresse
 * de la fiche, et la version qu'en a l'écran. Rend la réponse du serveur : l'image et la fiche à jour, ou les erreurs.
 */
export function placeImage(sheetUrl: string, intent: "photo" | "cover", image: MediaView | null, version: string) {
  return postForm<PlaceResponse>(sheetUrl, fields({ intent, media: image?.id ?? "", version }));
}

// ---------------------------------------------------------------------------------------------------------------
// L'envoi
// ---------------------------------------------------------------------------------------------------------------

/** Un fichier choisi, avant l'envoi : son aperçu dans le navigateur, et ses dimensions telles qu'il les montre. */
type Chosen = { file: File; type: string; preview: string; width: number | null; height: number | null };

/**
 * L'aperçu d'un fichier et ses dimensions, orientation EXIF comprise, comme le serveur la lira. Par l'événement load,
 * pas par decode() : Chrome remet le décodage à plus tard quand la page n'est pas affichée (un autre onglet devant).
 */
async function inspect(file: File, type: string): Promise<Chosen> {
  const preview = URL.createObjectURL(file);
  const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 15_000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    };
    // Un navigateur qui ne sait pas l'afficher (AVIF sur un vieux Safari) : le serveur saura peut-être la lire.
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = preview;
  });
  return { file, type, preview, width: size?.width ?? null, height: size?.height ?? null };
}

/**
 * Dépose l'original à l'adresse signée, comme uploadToSignedUrl du client Supabase (un formulaire : cacheControl, puis
 * le fichier), mais par XMLHttpRequest, qui donne la progression de l'envoi.
 */
function putFile(url: string, file: File, onPercent: (percent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => event.lengthComputable && onPercent((event.loaded / event.total) * 100);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      reject(new Error(request.status === 413 ? "L'image dépasse le poids permis par le stockage." : "Le stockage a refusé l'image. Réessaie, ou exporte-la en JPEG."));
    };
    request.onerror = () => reject(new Error("L'envoi vers le stockage a échoué. Vérifie la connexion, puis réessaie."));
    request.onabort = () => reject(new DOMException("Envoi annulé", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    request.send(body);
  });
}

type Step = "envoi" | "preparation" | "placement";
const STEPS: Record<Step, string> = { envoi: "Envoi", preparation: "Préparation des tailles pour le site…", placement: "Mise en place sur la fiche…" };

/** Le texte d'une image, tel que les fenêtres le saisissent. */
type Described = { alt: string; credit: string; decorative: boolean };
const describedFields = (text: Described) => ({ alt: text.alt, credit: text.credit, decorative: text.decorative ? "on" : "" });
/** La même règle que le serveur (readMediaText) : un texte alternatif, sauf pour une image décorative. */
const altMissing = (text: Described) => !text.decorative && !text.alt.trim();

// ---------------------------------------------------------------------------------------------------------------
// Le champ
// ---------------------------------------------------------------------------------------------------------------

type Props = {
  image: MediaView | null;
  kind: ImageKind;
  /** Carrée : recadrée à l'envoi (photo d'artiste, pochette). */
  shape: "square" | "free";
  /** Le texte alternatif proposé pour une nouvelle image : « Portrait de … ». */
  suggestion: string;
  uploads: UploadSettings;
  /** Pourquoi on ne peut pas encore en mettre une : la fiche n'est pas créée. */
  blocked?: string;
  /** Met l'image à sa place sur la fiche, ou l'en retire (null). Rend null si c'est fait, sinon la raison du refus. */
  onPlace(image: MediaView | null): Promise<string | null>;
  /** Le texte de l'image a changé. */
  onDescribed(image: MediaView): void;
};

export function ImageField({ image, kind, shape, suggestion, uploads, blocked, onPlace, onDescribed }: Props) {
  const notify = useNotify();
  const words = WORDS[kind];
  const picker = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [over, setOver] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [broken, setBroken] = useState(false);
  const open = uploads.ready && !blocked;

  // Une nouvelle image s'affiche de nouveau, même si la précédente manquait. Une image déjà en échec avant que React ne
  // prenne la page rendue par le serveur n'appellera plus onError : on regarde où elle en est.
  useEffect(() => {
    const element = picture.current;
    setBroken(Boolean(element?.complete && element.naturalWidth === 0));
  }, [image?.url]);
  // L'aperçu du fichier choisi vit le temps de la fenêtre.
  useEffect(() => (chosen ? () => URL.revokeObjectURL(chosen.preview) : undefined), [chosen]);

  async function choose(file: File | undefined) {
    if (!file || !open) return;
    const type = typeOf(file);
    if (!type)
      return notify({
        kind: "error",
        title: "Image refusée",
        description: /\.(heic|heif)$/i.test(file.name)
          ? "Une photo HEIC (iPhone) : exporte-la en JPEG, ou partage-la depuis l'app Photos, qui la convertit."
          : "Une image JPEG, PNG, WebP ou AVIF seulement.",
      });
    if (file.size > uploads.maxBytes)
      return notify({ kind: "error", title: "Image trop lourde", description: `${weight(file.size)} : ${uploads.maxBytes / 1_000_000} Mo au plus. Réduis-la avant de l'envoyer.` });
    setChosen(await inspect(file, type));
  }

  /** Glisser un fichier sur la zone, ou sur l'image pour la remplacer. */
  const drop = open
    ? {
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
          void choose(event.dataTransfer.files[0]);
        },
      }
    : {};

  return (
    <Flex direction="column" gap="3">
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void choose(file);
        }}
      />

      {image ? (
        <>
          <div className="admin-image" data-shape={shape} data-over={over || undefined} {...drop}>
            {broken ? (
              <div className="admin-image-missing">
                <ImageIcon width="22" height="22" aria-hidden />
                <Text size="1">Fichier introuvable sur le stockage</Text>
              </div>
            ) : (
              <img
                ref={picture}
                src={image.thumb}
                srcSet={image.thumb === image.url ? undefined : `${image.thumb} 400w, ${image.url} ${image.width ?? 1600}w`}
                sizes="(min-width: 1024px) 288px, 100vw"
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                alt={image.alt}
                onError={() => setBroken(true)}
              />
            )}
            {over && <span className="admin-image-hint">Lâche pour remplacer</span>}
          </div>
          <Flex direction="column" gap="1">
            <Text as="p" size="1" color="gray" className="admin-break">
              {image.alt ? `Texte alternatif : « ${image.alt} »` : "Image décorative : sans texte alternatif."}
            </Text>
            {image.credit && (
              <Text as="p" size="1" color="gray" className="admin-break">
                Crédit : {image.credit}
              </Text>
            )}
          </Flex>
          <Flex gap="2" align="center">
            <Button type="button" variant="soft" onClick={() => picker.current?.click()} disabled={!open}>
              <UploadIcon /> Remplacer
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton type="button" variant="soft" color="gray" aria-label={`Plus d'actions sur ${words.the}`}>
                  <DotsHorizontalIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" size="2">
                <DropdownMenu.Item onSelect={() => setEditing(true)}>
                  <Pencil1Icon /> Modifier le texte…
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" onSelect={() => setRemoving(true)}>
                  <TrashIcon /> Retirer {words.the}…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Flex>
        </>
      ) : open ? (
        <button type="button" className="admin-image-drop" data-shape={shape} data-over={over || undefined} onClick={() => picker.current?.click()} {...drop}>
          <span className="admin-empty-icon" aria-hidden>
            <ImageIcon width="22" height="22" />
          </span>
          <Text size="2" weight="medium">
            {over ? "Lâche l'image ici" : `Glisse ${words.a} ici`}
          </Text>
          <Text size="2" color="gray">
            ou clique pour choisir un fichier
          </Text>
          <Text size="1" color="gray">
            JPEG, PNG, WebP ou AVIF, {uploads.maxBytes / 1_000_000} Mo au plus{shape === "square" ? " ; recadrée en carré" : ""}
          </Text>
        </button>
      ) : (
        <div className="admin-image-drop" data-shape={shape} data-disabled>
          <span className="admin-empty-icon" aria-hidden>
            <ImageIcon width="22" height="22" />
          </span>
          <Text size="2" color="gray">
            {blocked ?? `Pas encore de ${words.the.replace(/^la /, "")}.`}
          </Text>
        </div>
      )}

      {!uploads.ready && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>L'envoi des images n'est pas encore branché : il manque la clé secrète de Supabase (réglage SUPABASE_SECRET_KEY).</Callout.Text>
        </Callout.Root>
      )}

      {chosen && (
        <NewImageDialog
          key={chosen.preview}
          chosen={chosen}
          kind={kind}
          shape={shape}
          suggestion={suggestion}
          onClose={() => setChosen(null)}
          onPlace={async (fresh) => {
            const refused = await onPlace(fresh);
            if (!refused) notify({ kind: "success", title: words.placed });
            return refused;
          }}
        />
      )}
      {image && editing && (
        <DescribeDialog
          image={image}
          kind={kind}
          onClose={() => setEditing(false)}
          onDone={(fresh) => {
            onDescribed(fresh);
            notify({ kind: "success", title: "Texte de l'image enregistré" });
          }}
        />
      )}
      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Retirer {words.the} ?</AlertDialog.Title>
          <AlertDialog.Description size="2">Elle disparaît de la fiche et du site. Son fichier est effacé s'il ne sert nulle part ailleurs.</AlertDialog.Description>
          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Annuler
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={async () => {
                  const refused = await onPlace(null);
                  notify(refused ? { kind: "error", title: words.kept, description: refused } : { kind: "success", title: words.removed });
                }}
              >
                <TrashIcon /> Retirer
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les fenêtres
// ---------------------------------------------------------------------------------------------------------------

/** Le texte alternatif, la case « Image décorative » et le crédit, communs aux deux fenêtres. */
function TextFields({ text, onChange, errors, disabled }: { text: Described; onChange(text: Described): void; errors: FieldErrors; disabled: boolean }) {
  return (
    <Flex direction="column" gap="3">
      <Field label="Texte alternatif" htmlFor="image-alt" hint="Ce que montre l'image, pour qui ne la voit pas : lu par les lecteurs d'écran." error={errors.alt}>
        <TextArea
          id="image-alt"
          value={text.decorative ? "" : text.alt}
          onChange={(event) => onChange({ ...text, alt: event.target.value })}
          placeholder={text.decorative ? "Image décorative : rien à décrire" : "Ex. : Éloïse aux platines, sourire, lumière orange"}
          disabled={disabled || text.decorative}
          rows={2}
          maxLength={300}
          color={errors.alt ? "red" : undefined}
        />
      </Field>
      <Text as="label" size="2">
        <Flex gap="2" align="center">
          <Checkbox checked={text.decorative} onCheckedChange={(checked) => onChange({ ...text, decorative: checked === true })} disabled={disabled} />
          Image décorative : rien à décrire
        </Flex>
      </Text>
      <Field label="Crédit" htmlFor="image-credit" optional error={errors.credit}>
        <TextField.Root
          id="image-credit"
          value={text.credit}
          onChange={(event) => onChange({ ...text, credit: event.target.value })}
          placeholder="© Prénom Nom"
          maxLength={120}
          disabled={disabled}
          color={errors.credit ? "red" : undefined}
          autoComplete="off"
        />
      </Field>
    </Flex>
  );
}

/**
 * Un fichier choisi : l'aperçu cadré, le texte, puis l'envoi, sa progression et la mise en place. Fermer la fenêtre
 * pendant l'envoi l'annule ; une image déjà préparée mais pas mise en place est retirée.
 */
function NewImageDialog({
  chosen,
  kind,
  shape,
  suggestion,
  onClose,
  onPlace,
}: {
  chosen: Chosen;
  kind: ImageKind;
  shape: "square" | "free";
  suggestion: string;
  onClose(): void;
  onPlace(image: MediaView): Promise<string | null>;
}) {
  const words = WORDS[kind];
  const [text, setText] = useState<Described>({ alt: suggestion, credit: "", decorative: false });
  const [focus, setFocus] = useState(0.5);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState<{ step: Step; percent: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sending = progress !== null;
  const { width, height } = chosen;
  // Le petit côté : celui du carré une fois recadrée, et celui que le serveur vérifie.
  const side = width && height ? Math.min(width, height) : null;
  const tooSmall = side !== null && side < MIN_SIDE;

  // Fermer l'onglet couperait l'envoi : le navigateur demande confirmation tant qu'il dure.
  useEffect(() => {
    if (!sending) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", hold);
    return () => removeEventListener("beforeunload", hold);
  }, [sending]);
  // La fenêtre fermée (ou la fiche quittée) arrête un envoi en cours.
  useEffect(() => () => controller.current?.abort(), []);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    // La fenêtre est rendue hors de la fiche, mais ses événements remontent jusqu'à elle : pas d'enregistrement de la fiche.
    event.stopPropagation();
    if (progress || tooSmall) return;
    if (altMissing(text)) return setErrors({ alt: "Décris l'image en quelques mots, ou coche « Image décorative »." });
    const abort = new AbortController();
    controller.current = abort;
    const stopped = () => abort.signal.aborted;
    setErrors({});
    setProgress({ step: "envoi", percent: 0 });
    let prepared: MediaView | null = null;
    try {
      const ticket = await postForm<{ ok: true; path: string; url: string }>(`${API}/upload`, fields({ type: chosen.type, size: String(chosen.file.size) }));
      if (!ticket.ok) throw new Error(firstError(ticket.errors));
      if (stopped()) return;
      await putFile(ticket.url, chosen.file, (percent) => setProgress({ step: "envoi", percent: Math.min(99, percent) }), abort.signal);
      setProgress({ step: "preparation", percent: 100 });
      const done = await postForm<{ ok: true; image: MediaView }>(
        `${API}/finalize`,
        fields({ path: ticket.path, shape, focus: String(focus), ...describedFields(text) }),
      );
      if (!done.ok) {
        setErrors(done.errors);
        throw new Error(done.errors.alt || done.errors.credit ? "Corrige le texte de l'image." : firstError(done.errors));
      }
      prepared = done.image;
      if (stopped()) throw new DOMException("Envoi annulé", "AbortError");
      setProgress({ step: "placement", percent: 100 });
      const refused = await onPlace(prepared);
      if (refused) throw new Error(refused);
      controller.current = null;
      onClose();
    } catch (error) {
      // Une image préparée qui n'a pas trouvé sa place ne reste pas dans le Storage.
      if (prepared) void postForm(`${API}/abandon`, fields({ id: prepared.id }));
      if (stopped()) return;
      setProgress(null);
      setErrors((current) => ({ ...current, image: error instanceof Error && error.message ? error.message : "Quelque chose s'est mal passé. Réessaie." }));
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (next) return;
        controller.current?.abort();
        onClose();
      }}
    >
      <Dialog.Content maxWidth="560px" aria-describedby={undefined}>
        <form noValidate onSubmit={send}>
          <Dialog.Title size="4">{words.fresh}</Dialog.Title>
          <div className="admin-image-dialog">
            <Flex direction="column" gap="2" className="admin-image-dialog-preview">
              <CropFrame src={chosen.preview} width={width} height={height} square={shape === "square"} focus={focus} onFocus={setFocus} disabled={sending} />
              <Text size="1" color="gray" className="admin-break">
                {[chosen.file.name, width && height ? `${width} × ${height}` : null, weight(chosen.file.size)].filter(Boolean).join(" · ")}
              </Text>
              {shape === "square" && width !== height && width && height && (
                <Text size="1" color="gray">
                  Fais glisser l'image pour choisir le cadrage.
                </Text>
              )}
              {!width && (
                <Text size="1" color="gray">
                  Ce navigateur ne sait pas l'afficher : elle sera recadrée au centre.
                </Text>
              )}
              {tooSmall ? (
                <Text size="1" color="red" role="alert">
                  Trop petite ({side} px) : il faut {MIN_SIDE} pixels de côté au moins.
                </Text>
              ) : (
                side !== null &&
                side < SMALL_SIDE && (
                  <Text size="1" color="amber">
                    Petite image ({side} px) : elle risque d'être floue en grand.
                  </Text>
                )
              )}
            </Flex>
            <TextFields text={text} onChange={setText} errors={errors} disabled={sending} />
          </div>

          {errors.image && (
            <Callout.Root color="red" size="1" mt="4" role="alert">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>{errors.image}</Callout.Text>
            </Callout.Root>
          )}
          {progress && (
            <Flex direction="column" gap="2" mt="4" aria-live="polite">
              <Text size="1" color="gray">
                {STEPS[progress.step]}
                {progress.step === "envoi" ? ` · ${Math.round(progress.percent)} %` : ""}
              </Text>
              <Progress size="1" value={progress.step === "envoi" ? progress.percent : undefined} aria-label={`Envoi de ${words.the}`} />
            </Flex>
          )}

          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray" disabled={progress?.step === "placement"}>
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={sending} disabled={tooSmall}>
              <UploadIcon /> Envoyer {words.the}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * L'aperçu, cadré comme sur le site. En carré, une image plus large que haute (ou l'inverse) ne montre qu'une partie :
 * on la fait glisser, à la souris ou au doigt, pour choisir laquelle ; au clavier, les flèches la déplacent.
 * `focus` va de 0 (à gauche, ou en haut) à 1 (à droite, ou en bas), comme le recadrage du serveur.
 */
function CropFrame({
  src,
  width,
  height,
  square,
  focus,
  onFocus,
  disabled,
}: {
  src: string;
  width: number | null;
  height: number | null;
  square: boolean;
  focus: number;
  onFocus(focus: number): void;
  disabled: boolean;
}) {
  const drag = useRef<{ from: number; focus: number; overflow: number } | null>(null);
  const movable = square && width !== null && height !== null && width !== height && !disabled;
  const wide = width !== null && height !== null && width > height;
  const position = !square ? undefined : wide ? `${focus * 100}% 50%` : `50% ${focus * 100}%`;
  const where = wide ? (focus < 0.34 ? "à gauche" : focus > 0.66 ? "à droite" : "au centre") : focus < 0.34 ? "en haut" : focus > 0.66 ? "en bas" : "au centre";

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!movable) return;
    const box = event.currentTarget.getBoundingClientRect();
    // Ce qui dépasse du cadre, à l'écran : l'image couvre le carré, son grand côté déborde.
    const overflow = box.width * (wide ? width! / height! : height! / width!) - box.width;
    drag.current = { from: wide ? event.clientX : event.clientY, focus, overflow };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.overflow <= 0) return;
    // L'image suit le doigt : la tirer vers la droite montre ce qui était à gauche.
    onFocus(clamp(current.focus - ((wide ? event.clientX : event.clientY) - current.from) / current.overflow));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.25 : 0.05;
    const next: Record<string, number> = { ArrowLeft: focus - step, ArrowUp: focus - step, ArrowRight: focus + step, ArrowDown: focus + step, Home: 0, End: 1 };
    if (!(event.key in next)) return;
    event.preventDefault();
    onFocus(clamp(next[event.key]!));
  };

  return (
    <div
      className="admin-crop"
      data-shape={square ? "square" : "free"}
      data-movable={movable || undefined}
      data-axis={wide ? "x" : "y"}
      {...(movable
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label": "Cadrage",
            "aria-orientation": wide ? ("horizontal" as const) : ("vertical" as const),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(focus * 100),
            "aria-valuetext": `Cadré ${where}`,
            onPointerDown: start,
            onPointerMove: move,
            onPointerUp: () => (drag.current = null),
            onPointerCancel: () => (drag.current = null),
            onKeyDown: keys,
          }
        : {})}
    >
      <img src={src} alt="" draggable={false} style={{ objectPosition: position }} />
    </div>
  );
}

/** Le texte alternatif et le crédit d'une image déjà en place, changés partout où elle sert. */
function DescribeDialog({ image, kind, onClose, onDone }: { image: MediaView; kind: ImageKind; onClose(): void; onDone(image: MediaView): void }) {
  const [text, setText] = useState<Described>({ alt: image.alt, credit: image.credit ?? "", decorative: !image.alt });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (altMissing(text)) return setErrors({ alt: "Décris l'image en quelques mots, ou coche « Image décorative »." });
    setBusy(true);
    const result = await postForm<{ ok: true; image: MediaView }>(`${API}/describe`, fields({ id: image.id, ...describedFields(text) }));
    setBusy(false);
    if (!result.ok) return setErrors(result.errors.alt || result.errors.credit ? result.errors : { image: firstError(result.errors) });
    onDone(result.image);
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Content maxWidth="480px" aria-describedby={undefined}>
        <form noValidate onSubmit={save}>
          <Dialog.Title size="4">Texte de {WORDS[kind].the}</Dialog.Title>
          <TextFields text={text} onChange={setText} errors={errors} disabled={busy} />
          {errors.image && (
            <Callout.Root color="red" size="1" mt="4" role="alert">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>{errors.image}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray" disabled={busy}>
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={busy}>
              Enregistrer le texte
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
