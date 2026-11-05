/**
 * La page d'envoi d'un résident (/envoyer/<jeton>, cms/README.md, 9.12) : sans compte, le lien seul l'ouvre. Sobre
 * comme l'admin, dont elle reprend les briques : Radix Themes, les étiquettes à cocher par filtre, la tracklist,
 * l'éditeur de texte, l'envoi des images. De haut en bas : le prochain bloc et sa deadline, les émissions de l'artiste
 * (envoyées, ou créneaux de la grille à remplir), puis sa fiche d'artiste (bio, photo). Une émission s'ouvre à la place
 * de la page, en formulaire.
 *
 * Le formulaire va par étapes numérotées, dans l'ordre où l'on gagne du temps : le type, puis le fichier, qui part
 * vers le seau R2 dès qu'on le choisit (AudioFields.tsx) pendant qu'on remplit le reste ; la présentation, l'ambiance et
 * les étiquettes, la tracklist, un mot pour l'équipe. Une étape faite prend sa coche. La barre du bas dit où en sont
 * les fichiers, ou ce qui manque encore. La fiche part ensuite, d'un coup, avec la liste des fichiers arrivés ; le
 * serveur vérifie tout (src/pages/api/envoi).
 */
import type { FieldErrors, ShowType } from "@parabole/cms";
import { ENERGY, LABELS } from "@parabole/cms/labels";
import { ArrowLeftIcon, CalendarIcon, ChatBubbleIcon, CheckCircledIcon, CheckIcon, DiscIcon, ExclamationTriangleIcon, ListBulletIcon, Pencil1Icon, PlusIcon } from "@radix-ui/react-icons";
import { AlertDialog, Badge, Button, Callout, Card, Flex, Heading, Progress, RadioCards, SegmentedControl, Text, TextArea, TextField, Theme } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import logo from "../../assets/logo-barre.png";
import { FacetPicker } from "../admin/FacetPicker";
import { abandonImage, ImageApiProvider, ImageField, type ImageApi } from "../admin/ImageField";
import { Field, filledPlaces, FormError, placeErrors, Section } from "../admin/sheet";
import { useTagChoices } from "../admin/tagChoices";
import { counted } from "../admin/text";
import { TextEditor } from "../admin/TextEditor";
import { ToastProvider, useNotify } from "../admin/toast";
import { trackRow, TracklistEditor, type TrackRow } from "../admin/TracklistEditor";
import type { MediaView } from "../admin/types";
import { call } from "./audio";
import { MainAudio, PartsField, type PartRow, type Sending } from "./AudioFields";
import type { EnvoiBlock, EnvoiPageData, EnvoiPart, EnvoiSheet } from "./types";

const ENERGY_STEPS = Array.from({ length: ENERGY.max - ENERGY.min + 1 }, (_, index) => String(ENERGY.min + index));

const TYPES: { value: ShowType; icon: ComponentType<{ width?: number; height?: number }>; hint: string; title: string }[] = [
  { value: "dj_set", icon: DiscIcon, hint: "Un mix, en un seul MP3.", title: "Ex. : Nuit club, deep house et disco" },
  { value: "podcast", icon: ChatBubbleIcon, hint: "Une émission parlée, en un seul MP3.", title: "Ex. : Les voix du quartier, épisode 3" },
  { value: "playlist", icon: ListBulletIcon, hint: "Des morceaux à enchaîner : leurs fichiers, ou le lien de ta playlist.", title: "Ex. : Dimanche matin, folk et soul" },
];

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** « le titre », « le fichier et le titre », « le bloc, le fichier et le titre » */
const sentence = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} et ${items.at(-1)}` : (items[0] ?? ""));

function deadlineText(block: EnvoiBlock): string {
  if (block.late) return `La deadline était le ${block.deadlineLabel} : envoie au plus vite, l'équipe prépare déjà la grille.`;
  const when = block.daysLeft <= 0 ? "aujourd'hui" : block.daysLeft === 1 ? "demain" : `dans ${block.daysLeft} jours`;
  return `À envoyer au plus tard le ${block.deadlineLabel} (${when}).`;
}

export default function EnvoiApp({ data }: { data: EnvoiPageData }) {
  const api = useMemo<ImageApi>(
    () => ({ base: "/api/envoi/media", extra: { jeton: data.jeton }, describe: false, unavailable: "Les images ne peuvent pas encore être envoyées d'ici : réessaie plus tard, ou envoie-la à l'équipe." }),
    [data.jeton],
  );
  // L'apparence suit la classe `dark` de la page (src/layouts/Envoi.astro), posée d'après le système.
  return (
    <Theme appearance="inherit" accentColor="indigo" grayColor="slate" radius="medium" scaling="100%" panelBackground="solid" className="admin-theme envoi-theme">
      <ToastProvider>
        <ImageApiProvider value={api}>
          <EnvoiPage initial={data} api={api} />
        </ImageApiProvider>
      </ToastProvider>
    </Theme>
  );
}

type Opened = { sheet: EnvoiSheet | null; key: number };

function EnvoiPage({ initial, api }: { initial: EnvoiPageData; api: ImageApi }) {
  const notify = useNotify();
  const [data, setData] = useState(initial);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const show = (next: Opened | null) => {
    setOpened(next);
    scrollTo({ top: 0 });
  };

  async function reload() {
    const result = await call<{ ok: true; page: EnvoiPageData }>(data.jeton, "page");
    if (result.ok) setData(result.page);
    else notify({ kind: "error", title: "La page ne s'est pas mise à jour", description: result.errors.form });
  }

  async function open(showId: string) {
    if (opening) return;
    setOpening(showId);
    const result = await call<{ ok: true; sheet: EnvoiSheet }>(data.jeton, "fiche", { showId });
    setOpening(null);
    if (!result.ok) {
      notify({ kind: "error", title: "Impossible d'ouvrir cette émission", description: result.errors.form });
      return void reload();
    }
    show({ sheet: result.sheet, key: Date.now() });
  }

  async function sent(first: boolean) {
    await reload();
    show(null);
    notify(
      first
        ? { kind: "success", title: "Émission envoyée", description: "L'équipe va l'écouter. Tu peux encore la corriger ici tant qu'elle n'est pas publiée." }
        : { kind: "success", title: "Émission mise à jour" },
    );
  }

  return (
    <main className="envoi-page">
      <header className="envoi-header">
        <span className="admin-logo">
          <img src={logo.src} width={22} height={22} alt="" />
        </span>
        <div>
          <Text as="p" size="2" color="gray">
            Parabole Radio{data.artist.group ? ` · groupe ${data.artist.group}` : ""}
          </Text>
          <Heading as="h1" size="6">
            {data.artist.name}
          </Heading>
        </div>
      </header>
      {!data.audioReady && (
        <Callout.Root color="amber" mb="4">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>Les fichiers son ne peuvent pas encore être envoyés d'ici : l'équipe finit de préparer la page. Réessaie un peu plus tard.</Callout.Text>
        </Callout.Root>
      )}
      {opened ? (
        <EnvoiForm key={opened.key} data={data} sheet={opened.sheet} api={api} onClose={() => show(null)} onSent={sent} />
      ) : (
        <>
          <Blocks data={data} />
          <Shows data={data} opening={opening} onOpen={(showId) => void open(showId)} onNew={() => show({ sheet: null, key: Date.now() })} />
          <ArtistSheet data={data} />
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bloc et les émissions
// ---------------------------------------------------------------------------------------------------------------

/** Le prochain bloc d'un résident d'un groupe, et sa deadline ; deux blocs entre une deadline et le début de son bloc. */
function Blocks({ data }: { data: EnvoiPageData }) {
  if (!data.blocks.length) return null;
  return (
    <Section title={data.blocks.length > 1 ? "Tes prochains passages" : "Ton prochain passage"}>
      <Flex direction="column" gap="3">
        {data.blocks.map((block) => {
          const sent = data.rows.filter((row) => row.sent && row.blockStart === block.start).length;
          return (
            <Card key={block.start} size="2">
              <Flex direction="column" gap="1">
                <Flex align="center" gap="2" wrap="wrap">
                  <CalendarIcon aria-hidden />
                  <Text size="3" weight="bold">
                    Bloc {block.label}
                  </Text>
                  {block.late && <Badge color="red">En retard</Badge>}
                </Flex>
                <Text size="2">{deadlineText(block)}</Text>
                <Text size="2" color={sent ? "green" : "gray"}>
                  {sent ? `${counted(sent, "émission envoyée", "émissions envoyées")} pour ce bloc.` : "Rien d'envoyé pour ce bloc."}
                </Text>
              </Flex>
            </Card>
          );
        })}
      </Flex>
    </Section>
  );
}

function Shows({ data, opening, onOpen, onNew }: { data: EnvoiPageData; opening: string | null; onOpen(showId: string): void; onNew(): void }) {
  return (
    <Section
      title="Tes émissions"
      aside={
        <Button onClick={onNew}>
          <PlusIcon /> Envoyer une émission
        </Button>
      }
    >
      {data.rows.length === 0 ? (
        <Text as="p" size="2" color="gray">
          Rien pour l'instant. Envoie ton émission dès qu'elle est prête : pas besoin d'attendre que ton créneau soit posé.
        </Text>
      ) : (
        <ul className="envoi-rows">
          {data.rows.map((row) => (
            <li key={row.showId} className="envoi-row">
              <div className="envoi-row-text">
                <Text as="p" size="2" weight="medium" truncate>
                  {row.title || "Sans titre"}
                </Text>
                <Text as="p" size="1" color="gray">
                  {[LABELS.showType[row.type], row.when ?? (row.block ? `pour le ${row.block}` : "pas encore de créneau")].join(" · ")}
                </Text>
                {(row.status || (row.slot && !row.sent)) && (
                  <Flex gap="2" wrap="wrap" mt="1">
                    {row.slot && !row.sent && <Badge color="amber">Créneau à remplir</Badge>}
                    {row.status && (
                      <Badge color="gray" variant="soft">
                        {row.status}
                      </Badge>
                    )}
                  </Flex>
                )}
              </div>
              <Button variant="soft" onClick={() => onOpen(row.showId)} loading={opening === row.showId} disabled={row.locked || (opening !== null && opening !== row.showId)}>
                {row.locked ? (
                  "Déjà partie"
                ) : row.sent ? (
                  <>
                    <Pencil1Icon /> Modifier
                  </>
                ) : (
                  "Remplir"
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.rows.length > 0 && (
        <Text as="p" size="1" color="gray" mt="2">
          Tu peux corriger une émission, ou remplacer son fichier, tant qu'elle n'est pas publiée.
        </Text>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La fiche d'artiste
// ---------------------------------------------------------------------------------------------------------------

/** La photo et la bio de l'artiste, telles qu'elles paraissent sur sa page : enregistrées tout de suite. */
function ArtistSheet({ data }: { data: EnvoiPageData }) {
  const notify = useNotify();
  const [bio, setBio] = useState(data.artist.bio);
  const [saved, setSaved] = useState(data.artist.bio);
  const [photo, setPhoto] = useState(data.artist.photo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function saveBio() {
    if (busy) return;
    setBusy(true);
    const result = await call<{ ok: true }>(data.jeton, "fiche-artiste", { bio });
    setBusy(false);
    if (!result.ok) {
      setError(result.errors.bio ?? result.errors.form);
      return notify({ kind: "error", title: "Bio pas enregistrée", description: result.errors.bio ?? result.errors.form });
    }
    setError(undefined);
    setSaved(bio);
    notify({ kind: "success", title: "Bio enregistrée", description: "Elle paraît tout de suite sur ta page du site." });
  }

  async function placePhoto(image: MediaView | null): Promise<string | null> {
    const result = await call<{ ok: true }>(data.jeton, "fiche-artiste", { photo: image ? image.id : null });
    if (!result.ok) return result.errors.photo ?? result.errors.form ?? "La photo n'a pas été enregistrée.";
    setPhoto(image);
    return null;
  }

  return (
    <Section title="Ta fiche d'artiste">
      <Text as="p" size="2" color="gray" mb="4">
        Ta photo et ta bio, telles qu'elles paraissent sur ta page du site. Ce que tu changes ici y passe tout de suite ; l'équipe peut aussi les retoucher.
      </Text>
      <Flex direction="column" gap="5">
        <Field label="Ta photo" optional>
          <ImageField compact image={photo} kind="photo" shape="square" suggestion={`Portrait de ${data.artist.name}`} uploads={data.images} onPlace={placePhoto} onDescribed={setPhoto} />
        </Field>
        <Flex direction="column" gap="2">
          <Text as="div" size="2" weight="medium">
            Ta bio
          </Text>
          <TextEditor id="envoi-bio" label="Ta bio" value={bio} onChange={setBio} error={error} placeholder="Qui tu es, ce que tu joues ou racontes, d'où tu viens…" />
          <Flex justify="end">
            <Button onClick={() => void saveBio()} loading={busy} disabled={bio === saved}>
              Enregistrer la bio
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le formulaire d'une émission
// ---------------------------------------------------------------------------------------------------------------

type Draft = {
  showId: string;
  version: string;
  type: ShowType | "";
  slot: boolean;
  when: string | null;
  blockStart: string;
  week: "" | "1" | "2";
  title: string;
  description: string;
  energy: string;
  tags: string[];
  tracks: TrackRow[];
  note: string;
  link: string;
  cover: MediaView | null;
};

/** Une ligne de tracklist remplie ; les vides ne partent pas au serveur. */
const filled = (line: TrackRow) => Boolean(line.artist.trim() || line.title.trim() || line.start.trim() || line.hopperUrl.trim());

function draftOf(sheet: EnvoiSheet | null, blocks: EnvoiBlock[]): Draft {
  if (!sheet)
    return {
      showId: "",
      version: "",
      type: "",
      slot: false,
      when: null,
      // Un seul bloc proposé : il est déjà choisi. Deux (l'un en retard) : on choisit.
      blockStart: blocks.length === 1 ? blocks[0]!.start : "",
      week: "",
      title: "",
      description: "",
      energy: "",
      tags: [],
      tracks: [],
      note: "",
      link: "",
      cover: null,
    };
  return {
    showId: sheet.showId,
    version: sheet.version,
    type: sheet.type,
    slot: sheet.slot,
    when: sheet.when,
    blockStart: sheet.blockStart ?? "",
    week: sheet.week,
    title: sheet.title,
    description: sheet.description,
    energy: sheet.energy,
    tags: sheet.tags,
    tracks: sheet.tracks.map((line) => trackRow(line)),
    note: sheet.note,
    link: sheet.link,
    cover: sheet.cover,
  };
}

const keptRow = (part: EnvoiPart): PartRow => ({ key: `p-${part.id}`, id: part.id, artist: part.artist, title: part.title, duration: part.duration, fileName: part.fileName, size: part.size, state: "kept", percent: 100 });

/** Ce qui compte pour savoir si le formulaire a changé : tout sauf les clés React et les lignes vides. */
const fingerprint = (draft: Draft, parts: PartRow[]) =>
  JSON.stringify({ ...draft, cover: draft.cover?.id ?? null, tracks: draft.tracks.filter(filled).map(({ key: _key, ...line }) => line), parts: parts.map((row) => [row.id, row.artist, row.title, row.state]) });

/** Le titre d'une étape : son numéro (une coche, une fois faite), son nom, « facultatif ». */
function StepTitle({ number, done, optional, children }: { number: number; done?: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <span className="envoi-step-title">
      <span className="envoi-step-number" data-done={done || undefined} aria-hidden>
        {done ? <CheckIcon /> : number}
      </span>
      <span>{children}</span>
      {optional && <span className="envoi-step-optional">facultatif</span>}
    </span>
  );
}

/** Une ligne d'information, avec son icône : le bloc visé, le créneau déjà posé. */
function InfoRow({ icon, title, detail, alert }: { icon: ReactNode; title: ReactNode; detail?: ReactNode; alert?: boolean }) {
  return (
    <div className="envoi-info">
      <span className="envoi-info-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <Text as="p" size="2" weight="medium">
          {title}
        </Text>
        {detail && (
          <Text as="p" size="1" color={alert ? "red" : "gray"}>
            {detail}
          </Text>
        )}
      </div>
    </div>
  );
}

function EnvoiForm({ data, sheet, api, onClose, onSent }: { data: EnvoiPageData; sheet: EnvoiSheet | null; api: ImageApi; onClose(): void; onSent(first: boolean): Promise<void> }) {
  const notify = useNotify();
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => draftOf(sheet, data.blocks));
  const [main, setMain] = useState<Sending | null>(null);
  const [parts, setParts] = useState<PartRow[]>(() => (sheet?.parts ?? []).map(keptRow));
  const [initial] = useState(() => fingerprint(draftOf(sheet, data.blocks), (sheet?.parts ?? []).map(keptRow)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));

  const isNew = !sheet;
  // Un créneau de la grille encore vide : le remplir, c'est envoyer l'émission pour la première fois.
  const filling = Boolean(sheet && sheet.slot && !sheet.main && !sheet.parts.length);
  const first = isNew || filling;
  const type = draft.type;
  const playlist = type === "playlist";
  const kind = TYPES.find((one) => one.value === type);
  const tags = useTagChoices(data, draft.tags, type);
  const block = data.blocks.find((one) => one.start === draft.blockStart) ?? null;
  // Le bloc se choisit pour un envoi sans créneau, tant qu'il est proposé ; un bloc passé reste tel quel.
  const choosesBlock = !draft.slot && data.blocks.length > 0 && (isNew || !sheet.blockStart || data.blocks.some((one) => one.start === sheet.blockStart));
  const uploading = main?.state === "sending" || parts.some((row) => row.state === "sending");
  const dirty = main !== null || fingerprint(draft, parts) !== initial;

  // Où en est chaque étape, pour sa coche et pour la barre du bas.
  const soundReady = playlist ? parts.some((row) => row.state === "kept" || row.state === "done") || Boolean(draft.link.trim()) : main ? main.state === "done" : Boolean(sheet?.main);
  const hasDetails = type !== "podcast" || tags.shown.length > 0;
  // Tant que le type n'est pas choisi, les étapes suivantes ne se montrent pas : on ne réclame que lui.
  const missing = [
    !type && "le type",
    choosesBlock && !block && "le bloc",
    type && !soundReady && !uploading && (playlist ? "les morceaux ou le lien" : "le fichier"),
    type && !draft.title.trim() && "le titre",
  ].filter((one): one is string => Boolean(one));
  const moving = parts.filter((row) => row.state === "sending");
  const progress =
    main?.state === "sending"
      ? { label: "Ton fichier part", percent: main.percent }
      : moving.length
        ? { label: `${counted(moving.length, "morceau part", "morceaux partent")}`, percent: Math.round(moving.reduce((sum, row) => sum + row.percent, 0) / moving.length) }
        : null;

  // Fermer ou recharger l'onglet perdrait la saisie : le navigateur le rappelle.
  useEffect(() => {
    if (!dirty) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", hold);
    return () => removeEventListener("beforeunload", hold);
  }, [dirty]);

  /** Une pochette envoyée à l'instant, pas encore partie avec la fiche. */
  const freshCover = (image: MediaView | null): image is MediaView => image !== null && image.id !== sheet?.cover?.id;

  async function placeCover(image: MediaView | null): Promise<string | null> {
    if (freshCover(draft.cover) && draft.cover.id !== image?.id) void abandonImage(draft.cover, api);
    set("cover", image);
    return null;
  }

  function leave() {
    if (freshCover(draft.cover)) void abandonImage(draft.cover, api);
    onClose();
  }

  const toggleTag = (id: string) => setDraft((current) => ({ ...current, tags: current.tags.includes(id) ? current.tags.filter((one) => one !== id) : [...current.tags, id] }));

  function refuse(problems: FieldErrors) {
    setErrors(problems);
    notify({ kind: "error", title: first ? "Pas encore envoyée" : "Pas encore enregistrée", description: problems.form ?? "Corrige ce qui est en rouge." });
    requestAnimationFrame(() => form.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  async function submit() {
    if (busy || uploading) return;
    const problems: FieldErrors = {};
    if (!type) problems.type = "Choisis DJ set, podcast ou playlist.";
    if (choosesBlock && !block) problems.blockStart = "Choisis le bloc de ton passage.";
    if (!draft.title.trim()) problems.title = "Donne un titre à ton émission.";
    if (type && !playlist) {
      if (main?.state === "error") problems.main = "Ton fichier n'est pas parti : réessaie, ou choisis-en un autre.";
      else if (!main && !sheet?.main) problems.main = "Ajoute ton fichier MP3.";
    }
    if (playlist) {
      if (parts.some((row) => row.state === "error")) problems.parts = "Retire les morceaux en rouge, ou renvoie-les.";
      else if (!parts.length && !draft.link.trim()) problems.parts = "Ajoute tes morceaux, ou le lien de ta playlist.";
    }
    if (Object.keys(problems).length) return refuse(problems);

    setBusy(true);
    const result = await call<{ ok: true; showId: string }>(data.jeton, "deposer", {
      form: {
        showId: draft.showId,
        version: draft.version,
        type,
        blockStart: choosesBlock && block ? block.start : "",
        week: draft.slot ? "" : draft.week,
        title: draft.title,
        description: draft.description,
        energy: type === "podcast" ? "" : draft.energy,
        tags: draft.tags,
        // La tracklist d'une playlist vient de ses morceaux : celle que l'équipe a pu poser reste.
        tracks: playlist ? (sheet?.tracks ?? []) : draft.tracks.filter(filled).map(({ key: _key, ...line }) => line),
        pasted: "",
        note: draft.note,
        link: playlist ? draft.link.trim() : "",
        main: !playlist && main?.state === "done" && main.id ? main.id : "",
        parts: playlist ? parts.filter((row) => row.id && (row.state === "kept" || row.state === "done")).map((row) => ({ id: row.id, artist: row.artist, title: row.title, duration: row.duration ?? "" })) : [],
        cover: freshCover(draft.cover) ? draft.cover.id : !draft.cover && sheet?.cover ? "none" : "",
      },
    });
    if (!result.ok) {
      setBusy(false);
      return refuse(placeErrors(result.errors, "tracks", filledPlaces(draft.tracks, filled)));
    }
    await onSent(first);
  }

  const back = () => (dirty || uploading ? setLeaving(true) : leave());

  // Les étapes montrées, dans l'ordre : leur numéro suit.
  const steps = (type ? ["emission", "son", "presentation", ...(hasDetails ? ["details"] : []), ...(playlist ? [] : ["tracklist"]), "note"] : ["emission"]) as string[];
  const number = (step: string) => steps.indexOf(step) + 1;

  return (
    <form
      ref={form}
      className="envoi-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      // Entrée dans un champ ne part pas : on envoie avec le bouton, une fois tout rempli.
      onKeyDown={(event) => event.key === "Enter" && event.target instanceof HTMLInputElement && event.preventDefault()}
      noValidate
    >
      <div className="envoi-form-head">
        <Button type="button" variant="ghost" color="gray" onClick={back}>
          <ArrowLeftIcon /> Retour
        </Button>
        <Heading as="h2" size="7" mt="3">
          {isNew ? "Envoyer une émission" : filling ? "Remplir ton créneau" : "Modifier ton émission"}
        </Heading>
        <Text as="p" size="2" color="gray" mt="1">
          {first
            ? "Choisis le type, puis ton fichier : il part pendant que tu remplis le reste."
            : "Corrige ce que tu veux, ou remplace le fichier, tant que l'émission n'est pas publiée."}
        </Text>
        <FormError message={errors.form} />
      </div>

      <Section title={<StepTitle number={number("emission")} done={Boolean(type) && (!choosesBlock || Boolean(block))}>Ton émission</StepTitle>}>
        <Flex direction="column" gap="5">
          {isNew ? (
            <Field label="Le type" error={errors.type}>
              <RadioCards.Root value={type} onValueChange={(value) => set("type", value as ShowType)} columns="3" size="1" className="envoi-types" aria-label="Le type">
                {TYPES.map((one) => (
                  <RadioCards.Item key={one.value} value={one.value}>
                    <Flex direction="column" align="center" gap="2" py="1">
                      <one.icon width={20} height={20} />
                      <Text size="2" weight="bold">
                        {LABELS.showType[one.value]}
                      </Text>
                    </Flex>
                  </RadioCards.Item>
                ))}
              </RadioCards.Root>
              <Text as="p" size="1" color="gray">
                {kind?.hint ?? "Les étapes suivantes s'adaptent à ce que tu envoies."}
              </Text>
            </Field>
          ) : (
            type && (
              <InfoRow
                icon={kind ? <kind.icon /> : null}
                title={LABELS.showType[type]}
                detail={kind?.hint}
              />
            )
          )}

          {draft.slot && draft.when && <InfoRow icon={<CalendarIcon />} title={`Ton créneau : ${draft.when}`} detail="Il est déjà dans la grille de Radio Cult." />}
          {choosesBlock &&
            (data.blocks.length === 1 && block ? (
              <InfoRow icon={<CalendarIcon />} title={`Ton passage : bloc ${block.label}`} detail={deadlineText(block)} alert={block.late} />
            ) : (
              <Field label="Ton bloc" error={errors.blockStart}>
                <RadioCards.Root value={draft.blockStart} onValueChange={(value) => set("blockStart", value)} columns={{ initial: "1", sm: "2" }} size="1">
                  {data.blocks.map((one) => (
                    <RadioCards.Item key={one.start} value={one.start}>
                      <Flex direction="column" width="100%">
                        <Text size="2" weight="bold">
                          {capital(one.label)}
                        </Text>
                        <Text size="1" color={one.late ? "red" : "gray"}>
                          {one.late ? `En retard : la deadline était le ${one.deadlineLabel}` : `À envoyer au plus tard le ${one.deadlineLabel}`}
                        </Text>
                      </Flex>
                    </RadioCards.Item>
                  ))}
                </RadioCards.Root>
              </Field>
            ))}
          {choosesBlock && block && (
            <Field label="Ta semaine" optional hint="Si tu sais déjà quelle semaine tu passes ; sinon, l'équipe s'en occupe." error={errors.week}>
              <SegmentedControl.Root value={draft.week || "0"} onValueChange={(value) => set("week", value === "1" || value === "2" ? value : "")} aria-label="Ta semaine" className="envoi-weeks">
                <SegmentedControl.Item value="0">Pas encore</SegmentedControl.Item>
                <SegmentedControl.Item value="1">{capital(block.weeks[0].replace(/^semaine /, ""))}</SegmentedControl.Item>
                <SegmentedControl.Item value="2">{capital(block.weeks[1].replace(/^semaine /, ""))}</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Field>
          )}
        </Flex>
      </Section>

      {!type && (
        <Text as="p" size="2" color="gray" className="envoi-next">
          Choisis le type de ton émission pour continuer.
        </Text>
      )}

      {type && (
        <Section title={<StepTitle number={number("son")} done={soundReady}>{playlist ? "Les morceaux" : "Le son"}</StepTitle>}>
          <Text as="p" size="2" color="gray" mb="4">
            {playlist
              ? "Glisse tes morceaux dans l'ordre de ta playlist, ou donne seulement son lien : l'équipe les enchaîne en un seul fichier."
              : "Choisis-le dès maintenant : il part pendant que tu remplis la suite."}
          </Text>
          {playlist ? (
            <Flex direction="column" gap="5">
              <PartsField jeton={data.jeton} showId={draft.showId} rows={parts} onChange={setParts} error={errors.parts} disabled={!data.audioReady} />
              <Field label="Le lien de ta playlist" htmlFor="envoi-link" optional hint="Spotify, Deezer, YouTube, SoundCloud, un WeTransfer, un Drive…" error={errors.link}>
                <TextField.Root id="envoi-link" type="url" inputMode="url" value={draft.link} onChange={(event) => set("link", event.target.value)} placeholder="https://" aria-invalid={errors.link ? true : undefined} />
              </Field>
            </Flex>
          ) : (
            <MainAudio jeton={data.jeton} showId={draft.showId} existing={sheet?.main ?? null} sending={main} onChange={setMain} error={errors.main} disabled={!data.audioReady} />
          )}
        </Section>
      )}

      {type && (
        <Section title={<StepTitle number={number("presentation")} done={Boolean(draft.title.trim())}>Sa présentation</StepTitle>}>
          <Text as="p" size="2" color="gray" mb="4">
            Ce qu'on lira sur la page de l'émission et sur SoundCloud.
          </Text>
          <Flex direction="column" gap="5">
            <Field label="Le titre" htmlFor="envoi-title" error={errors.title}>
              <TextField.Root id="envoi-title" size="3" value={draft.title} onChange={(event) => set("title", event.target.value)} placeholder={kind?.title} maxLength={200} aria-invalid={errors.title ? true : undefined} />
            </Field>
            <Flex direction="column" gap="1">
              <Text as="div" size="2" weight="medium">
                La description{" "}
                <Text size="1" color="gray" weight="regular">
                  facultatif
                </Text>
              </Text>
              <TextEditor id="envoi-description" label="Description" value={draft.description} onChange={(value) => set("description", value)} error={errors.description} placeholder="L'ambiance, les invités, l'occasion…" />
            </Flex>
            <Field label="La pochette" optional hint="Elle sert sur la page de l'émission et sur SoundCloud." error={errors.cover}>
              <ImageField
                compact
                image={draft.cover}
                kind="pochette"
                shape="square"
                suggestion={draft.title.trim() ? `Pochette de « ${draft.title.trim()} »` : ""}
                uploads={data.images}
                onPlace={placeCover}
                onDescribed={(image) => set("cover", image)}
              />
            </Field>
          </Flex>
        </Section>
      )}

      {type && hasDetails && (
        <Section title={<StepTitle number={number("details")} optional>Ambiance et étiquettes</StepTitle>}>
          <Text as="p" size="2" color="gray" mb="4">
            Elles rangent ton émission dans les filtres du site : on la retrouve par son genre, sa région, son humeur.
          </Text>
          <Flex direction="column" gap="5">
            {type !== "podcast" && (
              <Field label="Le mood" hint={`De ${LABELS.energy.low.toLowerCase()} (${ENERGY.min}) à ${LABELS.energy.high.toLowerCase()} (${ENERGY.max}).`} error={errors.energy}>
                <Flex align="center" gap="3" wrap="wrap">
                  <Text size="2" color="gray">
                    {LABELS.energy.low}
                  </Text>
                  <SegmentedControl.Root value={draft.energy} onValueChange={(value) => set("energy", value)} aria-label="Mood, de calme à énergique">
                    {ENERGY_STEPS.map((step) => (
                      <SegmentedControl.Item key={step} value={step}>
                        {step}
                      </SegmentedControl.Item>
                    ))}
                  </SegmentedControl.Root>
                  <Text size="2" color="gray">
                    {LABELS.energy.high}
                  </Text>
                </Flex>
              </Field>
            )}
            {tags.shown.map((facet) => (
              <Field key={facet.id} label={facet.name}>
                <FacetPicker facet={facet} names={tags.names} elsewhere={(tagId, groupId) => tags.elsewhere(tagId, facet.id, groupId)} value={draft.tags} onToggle={toggleTag} />
              </Field>
            ))}
            {errors.tags && (
              <Text size="1" color="red" role="alert">
                {errors.tags}
              </Text>
            )}
          </Flex>
        </Section>
      )}

      {type && !playlist && (
        <TracklistEditor
          title={
            <StepTitle number={number("tracklist")} optional>
              La tracklist
            </StepTitle>
          }
          rows={draft.tracks}
          onChange={(tracks) => set("tracks", tracks)}
          errors={errors}
          hopper={false}
          empty="Pas encore de morceau. Colle ta tracklist d'un coup (une ligne par morceau : « 12:30 Artiste – Titre »), ou ajoute les morceaux un par un."
        />
      )}

      {type && (
        <Section title={<StepTitle number={number("note")} optional>Un mot pour l'équipe</StepTitle>}>
          <Text as="p" size="2" color="gray" mb="3">
            L'équipe seule le lit : une précision sur le son, un invité, une date qui t'arrange…
          </Text>
          <TextArea id="envoi-note" aria-label="Un mot pour l'équipe" value={draft.note} onChange={(event) => set("note", event.target.value)} rows={3} maxLength={2000} placeholder="Ex. : le son coupe à 1:02:30, c'est voulu." />
          {errors.note && (
            <Text as="p" size="1" color="red" role="alert" mt="1">
              {errors.note}
            </Text>
          )}
        </Section>
      )}

      <div className="envoi-footer">
        <div className="envoi-footer-status" aria-live="polite">
          {progress ? (
            <>
              <Text as="p" size="2" weight="medium">
                {progress.label} : {progress.percent} %
              </Text>
              <Progress value={progress.percent} size="1" aria-hidden />
            </>
          ) : missing.length ? (
            <Text as="p" size="2" color="gray">
              Il manque {sentence(missing)}.
            </Text>
          ) : (
            <Text as="p" size="2" color="green">
              <CheckCircledIcon className="envoi-ready-icon" /> Tout est prêt.
            </Text>
          )}
        </div>
        <Flex gap="3" className="envoi-footer-actions">
          <Button type="button" size="3" variant="soft" color="gray" onClick={back}>
            Annuler
          </Button>
          <Button type="submit" size="3" loading={busy} disabled={uploading} className="envoi-submit">
            {first ? "Envoyer l'émission" : "Enregistrer"}
          </Button>
        </Flex>
      </div>

      <AlertDialog.Root open={leaving} onOpenChange={setLeaving}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Quitter sans envoyer ?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            {uploading ? "Des fichiers sont encore en route : ils seront perdus, comme le reste de ta saisie." : "Ce que tu as rempli ici sera perdu."}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Rester
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={leave}>
                Quitter
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </form>
  );
}
