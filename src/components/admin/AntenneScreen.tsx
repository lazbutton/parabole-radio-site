/**
 * L'antenne libre, l'écran de la régie (CHAT_EN_DIRECT.md, section 5) : ce que les auditeurs écrivent dans le bandeau et
 * sur la page 888, et de quoi le modérer. En haut, les réglages, toujours visibles (ouverte ou fermée, mode lent,
 * différé, mode prudent, messages au bandeau, liens), et « Vider l'antenne ». Dessous, quatre onglets : En direct (les
 * messages, et Écrire en tant que Parabole), À traiter (les messages en attente et les signalés), Personnes (les
 * exclusions et les bannissements), Mots (la liste de la régie).
 *
 * L'écran redemande ses données toutes les 2 secondes tant que l'onglet est visible ; chaque action répond par l'écran à
 * jour, que le routeur affiche. La base diffuse elle-même chez les auditeurs ce que la régie décide ici.
 */
import { ChatBubbleIcon, DotsHorizontalIcon, ExclamationTriangleIcon, InfoCircledIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  Select,
  Separator,
  Spinner,
  Switch,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import type { FieldErrors } from "@parabole/cms";
import { PageHeader } from "./AdminShell";
import { useRouter } from "./router";
import { postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { AntenneData, AntenneResponse, ChatAuthorRow, ChatColor, ChatMessageRow, Flash } from "./types";

const HREF = "/admin/antenne";
const TITLE = "Antenne libre";
/** Comme sur le site : 160 caractères au plus, comme un SMS. */
const MAX = 160;

type Router = ReturnType<typeof useRouter>;
type BadgeColor = ComponentProps<typeof Badge>["color"];

/** Les sept couleurs du télétexte, lisibles sur le fond clair comme sur le sombre (les échelles de Radix). */
const PSEUDO_COLORS: Record<ChatColor, string> = {
  red: "var(--red-11)",
  green: "var(--grass-11)",
  yellow: "var(--amber-11)",
  blue: "var(--blue-11)",
  magenta: "var(--plum-11)",
  cyan: "var(--cyan-11)",
  white: "var(--gray-12)",
};
const STATUSES: Record<ChatMessageRow["status"], { label: string; color: BadgeColor }> = {
  visible: { label: "À l'antenne", color: "green" },
  held: { label: "En attente", color: "amber" },
  refused: { label: "Refusé", color: "gray" },
  removed: { label: "Brouillé", color: "red" },
};
const TERM_ACTIONS: Record<AntenneData["terms"][number]["action"], { label: string; color: BadgeColor }> = {
  refuse: { label: "Refuser", color: "red" },
  hold: { label: "Mettre en attente", color: "amber" },
  mask: { label: "Masquer", color: "gray" },
};
const LINKS: Record<AntenneData["settings"]["links"], string> = { none: "Aucun", music: "Plateformes de musique", all: "Tous" };

const fields = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  return data;
};
const firstError = (errors: FieldErrors) => errors.form ?? Object.values(errors)[0] ?? "Le serveur a refusé.";
/** « 10 min », « 1 h », « 24 h » */
const minutesLabel = (minutes: number) => (minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`);
/** « Direct », « 5 s » */
const secondsLabel = (seconds: number, none: string) => (seconds ? `${seconds} s` : none);

/** L'écran à jour : affiché si l'on regarde encore l'antenne. */
function showData(router: Router, data: AntenneData) {
  if (location.pathname.replace(/\/+$/, "") === HREF) router.replace(HREF, { name: "antenne", title: TITLE, data });
}

/** Redemande l'écran toutes les 2 secondes tant que l'onglet est visible ; reprend dès qu'il le redevient. */
function usePolling(router: Router) {
  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (stopped || document.hidden) {
        running = false;
        return;
      }
      running = true;
      try {
        const response = await fetch(HREF, { headers: { Accept: "application/json" } });
        // Une session expirée renvoie vers la connexion, en HTML : on n'affiche rien de neuf, et on réessaie.
        if (response.ok && (response.headers.get("content-type") ?? "").includes("application/json")) {
          const screen = (await response.json()) as { name?: string; data?: AntenneData };
          if (!stopped && screen.name === "antenne" && screen.data) showData(router, screen.data);
        }
      } catch {
        // Pas de réseau un instant : le tour suivant réessaie.
      }
      if (!stopped) timer = setTimeout(() => void loop(), 2000);
      else running = false;
    };
    timer = setTimeout(() => void loop(), 2000);
    const wake = () => {
      if (document.hidden || running || stopped) return;
      clearTimeout(timer);
      void loop();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [router]);
}

/** L'heure du serveur, à la seconde, quand un message est en différé : pour son compte à rebours. */
function useServerNow(serverNow: number, ticking: boolean) {
  const skew = useMemo(() => serverNow - Date.now(), [serverNow]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return Date.now() + skew;
}

export function AntenneScreen(data: AntenneData) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [banning, setBanning] = useState<{ id: string; pseudo: string } | null>(null);
  usePolling(router);
  const { settings, messages, held, reported, people, terms } = data;
  const now = useServerNow(
    data.now,
    messages.some((row) => row.status === "visible" && row.onAir > data.now),
  );
  const toHandle = held.length + reported.length;

  /** Une action de la régie : l'écran à jour et un mot de confirmation, ou le refus. */
  const act = async (key: string, values: Record<string, string>): Promise<boolean> => {
    setBusy(key);
    const result = await postForm<AntenneResponse>(HREF, fields(values));
    setBusy(null);
    if (result.ok) {
      showData(router, result.data);
      if (result.message) notify({ kind: "success", title: result.message });
      return true;
    }
    notify({ kind: "error", title: "Rien n'a changé", description: firstError(result.errors) } satisfies Flash);
    return false;
  };

  /** Les gestes qu'on peut faire sur un message, partagés par les onglets. */
  const handlers: MessageHandlers = {
    busy,
    now,
    mute: data.choices.mute,
    act,
    onBan: (row) => {
      if (row.authorId) setBanning({ id: row.authorId, pseudo: row.pseudo });
    },
  };

  return (
    <div className="admin-page">
      <PageHeader
        title={TITLE}
        description={
          <>
            {settings.open ? "Ouverte" : "Fermée"}
            {toHandle ? ` · ${counted(toHandle, "message à traiter", "messages à traiter")}` : ""}
            {settings.cleared ? ` · vidée le ${settings.cleared}` : ""}
          </>
        }
        actions={
          <Button variant="soft" color="red" onClick={() => setClearing(true)} disabled={busy === "vider"}>
            Vider l'antenne
          </Button>
        }
      />

      <SettingsCard data={data} busy={busy === "reglages"} onChange={(values) => act("reglages", { intent: "reglages", ...values })} />

      <Tabs.Root defaultValue="direct" mt="5">
        <Tabs.List>
          <Tabs.Trigger value="direct">En direct</Tabs.Trigger>
          <Tabs.Trigger value="traiter">À traiter{toHandle ? ` (${toHandle})` : ""}</Tabs.Trigger>
          <Tabs.Trigger value="personnes">Personnes{people.length ? ` (${people.length})` : ""}</Tabs.Trigger>
          <Tabs.Trigger value="mots">Mots{terms.length ? ` (${terms.length})` : ""}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="direct">
          <TeamWriter busy={busy === "ecrire"} onPost={(text) => act("ecrire", { intent: "ecrire", text })} />
          {messages.length ? (
            <MessageList rows={messages} handlers={handlers} context="direct" />
          ) : (
            <Empty title="Pas encore de message" text="Les messages des auditeurs arrivent ici dès qu'ils passent à l'antenne, avec ceux que les règles refusent." />
          )}
        </Tabs.Content>

        <Tabs.Content value="traiter">
          {toHandle ? (
            <Flex direction="column" gap="5" mt="4">
              {held.length > 0 && (
                <Group title="En attente de la régie" count={held.length}>
                  <MessageList rows={held} handlers={handlers} context="held" />
                </Group>
              )}
              {reported.length > 0 && (
                <Group title="Signalés par les auditeurs" count={reported.length}>
                  <MessageList rows={reported} handlers={handlers} context="reported" />
                </Group>
              )}
            </Flex>
          ) : (
            <Empty title="Rien à traiter" text="Les messages en attente (mode prudent, mots « en attente ») et ceux que les auditeurs signalent arrivent ici." />
          )}
        </Tabs.Content>

        <Tabs.Content value="personnes">
          {people.length ? (
            <PeopleList people={people} busy={busy} onLift={(person) => act(person.id, { intent: "lever", author: person.id, pseudo: person.pseudo })} />
          ) : (
            <Empty title="Personne n'est exclu ni banni" text="Exclure ou bannir se fait depuis un message, dans « En direct » ou « À traiter »." />
          )}
        </Tabs.Content>

        <Tabs.Content value="mots">
          <TermsPanel terms={terms} busy={busy} act={act} />
        </Tabs.Content>
      </Tabs.Root>

      <ClearDialog
        open={clearing}
        onClose={() => setClearing(false)}
        onConfirm={() => {
          setClearing(false);
          void act("vider", { intent: "vider" });
        }}
      />
      <BanDialog
        target={banning}
        onClose={() => setBanning(null)}
        onConfirm={async (reason) => {
          const target = banning!;
          setBanning(null);
          await act(target.id, { intent: "bannir", author: target.id, pseudo: target.pseudo, reason });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les réglages
// ---------------------------------------------------------------------------------------------------------------

/** Les réglages, toujours visibles : chacun part dès qu'on le change. L'écran montre tout de suite la valeur voulue. */
function SettingsCard({ data, busy, onChange }: { data: AntenneData; busy: boolean; onChange(values: Record<string, string>): Promise<boolean> }) {
  const { settings, choices } = data;
  const [wanted, setWanted] = useState<Record<string, string>>({});
  const value = (name: keyof AntenneData["settings"]) => wanted[name] ?? String(settings[name]);
  const change = async (name: string, next: string) => {
    setWanted((current) => ({ ...current, [name]: next }));
    await onChange({ [name]: next });
    // La réponse du serveur fait foi : refusé, le réglage revient à sa valeur.
    setWanted((current) => {
      const rest = { ...current };
      delete rest[name];
      return rest;
    });
  };
  return (
    <Card size="2">
      <Flex direction="column" gap="4">
        <Flex wrap="wrap" gap="5" align="center">
          <Setting label="Antenne ouverte" hint="Fermée : le carton « interruption momentanée » chez les auditeurs.">
            <Switch checked={value("open") === "true"} onCheckedChange={(on) => void change("open", String(on))} aria-label="Antenne ouverte" />
          </Setting>
          <Setting label="Messages au bandeau" hint="Sinon, les messages ne passent que sur la page 888.">
            <Switch checked={value("ticker") === "true"} onCheckedChange={(on) => void change("ticker", String(on))} aria-label="Messages au bandeau" />
          </Setting>
          <Setting label="Mode prudent" hint="Les deux premiers messages d'un nouveau pseudo attendent la régie.">
            <Switch checked={value("careful") === "true"} onCheckedChange={(on) => void change("careful", String(on))} aria-label="Mode prudent" />
          </Setting>
          {busy && <Spinner size="2" />}
        </Flex>
        <Separator size="4" />
        <Flex wrap="wrap" gap="4">
          <Setting label="Mode lent" hint="Un message toutes les N secondes par personne.">
            <Select.Root value={value("slowSeconds")} onValueChange={(next) => void change("slowSeconds", next)}>
              <Select.Trigger aria-label="Mode lent" />
              <Select.Content>
                {choices.slow.map((seconds) => (
                  <Select.Item key={seconds} value={String(seconds)}>
                    {secondsLabel(seconds, "Désactivé")}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Setting>
          <Setting label="Différé" hint="Le temps de couper un message avant qu'il passe.">
            <Select.Root value={value("delaySeconds")} onValueChange={(next) => void change("delaySeconds", next)}>
              <Select.Trigger aria-label="Différé" />
              <Select.Content>
                {choices.delay.map((seconds) => (
                  <Select.Item key={seconds} value={String(seconds)}>
                    {secondsLabel(seconds, "Direct")}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Setting>
          <Setting label="Liens" hint="Les plateformes de musique : SoundCloud, Bandcamp, YouTube, Hopper…">
            <Select.Root value={value("links")} onValueChange={(next) => void change("links", next)}>
              <Select.Trigger aria-label="Liens" />
              <Select.Content>
                {(Object.keys(LINKS) as (keyof typeof LINKS)[]).map((links) => (
                  <Select.Item key={links} value={links}>
                    {LINKS[links]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Setting>
          <Setting label="Signalements" hint="À partir de combien un message est brouillé en attendant la régie.">
            <Select.Root value={value("reportThreshold")} onValueChange={(next) => void change("reportThreshold", next)}>
              <Select.Trigger aria-label="Signalements avant brouillage" />
              <Select.Content>
                {[1, 2, 3, 5, 10].map((count) => (
                  <Select.Item key={count} value={String(count)}>
                    {count}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Setting>
        </Flex>
      </Flex>
    </Card>
  );
}

function Setting({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1" maxWidth="260px">
      <Flex align="center" gap="2">
        {children}
        <Text size="2" weight="medium">
          {label}
        </Text>
      </Flex>
      <Text size="1" color="gray">
        {hint}
      </Text>
    </Flex>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les messages
// ---------------------------------------------------------------------------------------------------------------

type MessageHandlers = {
  busy: string | null;
  /** L'heure du serveur, en millisecondes. */
  now: number;
  /** Les durées d'exclusion permises, en minutes. */
  mute: number[];
  act(key: string, values: Record<string, string>): Promise<boolean>;
  onBan(row: ChatMessageRow): void;
};

/** Écrire en tant que Parabole : la case PARABOLE à la place du pseudo, sans passer par la modération. */
function TeamWriter({ busy, onPost }: { busy: boolean; onPost(text: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const left = MAX - [...text].length;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || left < 0) return;
        if (await onPost(text)) setText("");
      }}
    >
      <Flex gap="2" align="center" mt="4" mb="2">
        <TextField.Root
          size="2"
          value={text}
          placeholder="Écrire en tant que Parabole…"
          aria-label="Écrire en tant que Parabole"
          onChange={(event) => setText(event.target.value)}
          style={{ flex: 1 }}
        >
          <TextField.Slot>
            <ChatBubbleIcon />
          </TextField.Slot>
          {left <= 20 && (
            <TextField.Slot>
              <Text size="1" color={left < 0 ? "red" : "gray"}>
                {left}
              </Text>
            </TextField.Slot>
          )}
        </TextField.Root>
        <Button type="submit" loading={busy} disabled={!text.trim() || left < 0}>
          Envoyer
        </Button>
      </Flex>
    </form>
  );
}

function MessageList({ rows, handlers, context }: { rows: ChatMessageRow[]; handlers: MessageHandlers; context: "direct" | "held" | "reported" }) {
  return (
    <Flex direction="column" asChild>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row, index) => (
          <li key={row.id}>
            {index > 0 && <Separator size="4" />}
            <MessageRow row={row} handlers={handlers} context={context} />
          </li>
        ))}
      </ol>
    </Flex>
  );
}

function MessageRow({ row, handlers, context }: { row: ChatMessageRow; handlers: MessageHandlers; context: "direct" | "held" | "reported" }) {
  const { busy, now, act } = handlers;
  const status = STATUSES[row.status];
  const waiting = row.status === "visible" && row.onAir > now ? Math.ceil((row.onAir - now) / 1000) : 0;
  const disabled = busy === row.id || (row.authorId !== null && busy === row.authorId);
  const send = (intent: string) => void act(row.id, { intent, id: row.id });

  let actions: ReactNode = null;
  if (row.status === "held")
    actions = (
      <>
        <Button size="1" variant="soft" color="green" disabled={disabled} onClick={() => send("publier")}>
          Publier
        </Button>
        <Button size="1" variant="soft" color="gray" disabled={disabled} onClick={() => send("rejeter")}>
          Rejeter
        </Button>
      </>
    );
  else if (row.status === "visible")
    actions = (
      <>
        {context === "reported" && (
          <Button size="1" variant="soft" color="gray" disabled={disabled} onClick={() => send("garder")}>
            Garder
          </Button>
        )}
        <Button size="1" variant="soft" color="red" disabled={disabled} onClick={() => send("supprimer")}>
          {waiting ? "Couper" : "Supprimer"}
        </Button>
      </>
    );
  else if (row.status === "removed")
    actions = (
      <>
        {context === "reported" && (
          <Button size="1" variant="soft" color="gray" disabled={disabled} onClick={() => send("garder")}>
            Laisser brouillé
          </Button>
        )}
        <Button size="1" variant="soft" color="gray" disabled={disabled} onClick={() => send("publier")}>
          Rendre l'antenne
        </Button>
      </>
    );

  return (
    <Flex direction="column" gap="1" py="3">
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
          {row.time}
        </Text>
        {row.team ? (
          <Badge size="1" color="indigo" variant="solid">
            PARABOLE
          </Badge>
        ) : (
          <Text size="2" weight="bold" style={{ color: PSEUDO_COLORS[row.color] }}>
            {row.pseudo}
          </Text>
        )}
        <Badge size="1" color={status.color} variant="soft">
          {status.label}
        </Badge>
        {waiting > 0 && (
          <Badge size="1" color="amber" variant="outline">
            passe dans {waiting} s
          </Badge>
        )}
        {row.first && (
          <Badge size="1" color="blue" variant="soft">
            Première fois
          </Badge>
        )}
        {row.reports > 0 && (
          <Badge size="1" color="orange" variant="soft">
            {counted(row.reports, "signalement")}
          </Badge>
        )}
        <Flex gap="2" align="center" ml="auto">
          {disabled && <Spinner size="1" />}
          {actions}
          {row.authorId && !row.team && <SanctionMenu row={row} handlers={handlers} disabled={disabled} />}
        </Flex>
      </Flex>
      <Text size="2" color={row.status === "visible" ? undefined : "gray"} style={{ overflowWrap: "anywhere", textDecoration: row.status === "removed" ? "line-through" : undefined }}>
        {row.body}
      </Text>
      {row.reason && row.status !== "visible" && (
        <Text size="1" color="gray">
          {row.decidedBy === "team" ? "La régie : " : row.decidedBy === "reports" ? "Les signalements : " : "Les règles : "}
          {row.reason}
        </Text>
      )}
    </Flex>
  );
}

/** Exclure un moment, ou bannir : la personne derrière le message. */
function SanctionMenu({ row, handlers, disabled }: { row: ChatMessageRow; handlers: MessageHandlers; disabled: boolean }) {
  const author = row.authorId!;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={disabled}>
        <IconButton size="1" variant="ghost" color="gray" aria-label={`Sanctionner ${row.pseudo}`}>
          <DotsHorizontalIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" size="2" className="admin-menu">
        <DropdownMenu.Label>{row.pseudo}</DropdownMenu.Label>
        {handlers.mute.map((minutes) => (
          <DropdownMenu.Item key={minutes} onSelect={() => void handlers.act(author, { intent: "exclure", author, pseudo: row.pseudo, minutes: String(minutes) })}>
            Exclure {minutesLabel(minutes)}
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator />
        <DropdownMenu.Item color="red" onSelect={() => handlers.onBan(row)}>
          Bannir…
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les personnes, les mots
// ---------------------------------------------------------------------------------------------------------------

function PeopleList({ people, busy, onLift }: { people: ChatAuthorRow[]; busy: string | null; onLift(person: ChatAuthorRow): void }) {
  return (
    <Flex direction="column" mt="4" asChild>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {people.map((person, index) => (
          <li key={person.id}>
            {index > 0 && <Separator size="4" />}
            <Flex align="center" gap="3" py="3" wrap="wrap">
              <Text size="2" weight="bold" style={{ color: PSEUDO_COLORS[person.color] }}>
                {person.pseudo}
              </Text>
              {person.banned ? (
                <Badge size="1" color="red" variant="soft">
                  Banni
                </Badge>
              ) : (
                <Badge size="1" color="amber" variant="soft">
                  Exclu jusqu'à {person.mutedUntil}
                </Badge>
              )}
              <Text size="1" color="gray">
                {person.banned && person.bannedOn ? `le ${person.bannedOn}` : ""}
                {person.banned && person.bannedReason ? ` · ${person.bannedReason}` : ""}
                {` · vu ${person.lastSeen}`}
              </Text>
              <Button size="1" variant="soft" color="gray" ml="auto" loading={busy === person.id} onClick={() => onLift(person)}>
                Lever
              </Button>
            </Flex>
          </li>
        ))}
      </ol>
    </Flex>
  );
}

/** La liste de mots : ajouter (le mot, ce qu'il fait, partout dans un mot ou non, une note) et retirer. */
function TermsPanel({ terms, busy, act }: { terms: AntenneData["terms"]; busy: string | null; act: MessageHandlers["act"] }) {
  const [term, setTerm] = useState("");
  const [action, setAction] = useState<keyof typeof TERM_ACTIONS>("refuse");
  const [anywhere, setAnywhere] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Flex direction="column" gap="4" mt="4">
      <Callout.Root color="gray" variant="surface" size="1">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          Les mots se comparent sans majuscules ni accents, les chiffres ramenés aux lettres (« c0nn4rd ») et les lettres séparées recollées (« c.o.n »). En mot
          entier par défaut : « con » n'arrête ni « concert » ni « conseil ». La liste vise les injures haineuses et les insultes dirigées contre quelqu'un, pas
          les gros mots : « putain ce son est lourd » doit passer.
        </Callout.Text>
      </Callout.Root>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!term.trim()) return;
          const added = await act("mot", { intent: "mot-ajouter", term, action, anywhere: String(anywhere), note });
          if (added) {
            setTerm("");
            setNote("");
            setAnywhere(false);
          }
        }}
      >
        <Flex gap="2" align="center" wrap="wrap">
          <TextField.Root size="2" value={term} placeholder="Mot ou expression" aria-label="Mot ou expression" maxLength={60} onChange={(event) => setTerm(event.target.value)} style={{ minWidth: 200, flex: 1 }} />
          <Select.Root value={action} onValueChange={(next) => setAction(next as keyof typeof TERM_ACTIONS)}>
            <Select.Trigger aria-label="Ce que fait ce mot" />
            <Select.Content>
              {(Object.keys(TERM_ACTIONS) as (keyof typeof TERM_ACTIONS)[]).map((key) => (
                <Select.Item key={key} value={key}>
                  {TERM_ACTIONS[key].label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={anywhere} onCheckedChange={(checked) => setAnywhere(checked === true)} />
              Partout dans un mot
            </Flex>
          </Text>
          <TextField.Root size="2" value={note} placeholder="Note (facultative)" aria-label="Note" maxLength={200} onChange={(event) => setNote(event.target.value)} style={{ minWidth: 160, flex: 1 }} />
          <Button type="submit" loading={busy === "mot"} disabled={!term.trim()}>
            <PlusIcon /> Ajouter
          </Button>
        </Flex>
      </form>
      {terms.length ? (
        <Flex direction="column" asChild>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {terms.map((one, index) => (
              <li key={one.id}>
                {index > 0 && <Separator size="4" />}
                <Flex align="center" gap="3" py="2" wrap="wrap">
                  <Text size="2" weight="bold">
                    {one.term}
                  </Text>
                  <Badge size="1" color={TERM_ACTIONS[one.action].color} variant="soft">
                    {TERM_ACTIONS[one.action].label}
                  </Badge>
                  {one.anywhere && (
                    <Badge size="1" color="gray" variant="outline">
                      partout dans un mot
                    </Badge>
                  )}
                  {one.note && (
                    <Text size="1" color="gray">
                      {one.note}
                    </Text>
                  )}
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    ml="auto"
                    aria-label={`Retirer « ${one.term} » de la liste`}
                    disabled={busy === one.id}
                    onClick={() => void act(one.id, { intent: "mot-retirer", id: one.id })}
                  >
                    <TrashIcon />
                  </IconButton>
                </Flex>
              </li>
            ))}
          </ul>
        </Flex>
      ) : (
        <Empty title="La liste est vide" text="Sans mot dans la liste, seules les règles de forme, les liens et les coordonnées filtrent les messages." />
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les petits morceaux
// ---------------------------------------------------------------------------------------------------------------

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <Text as="p" size="2" weight="bold" mb="1">
        {title} ({count})
      </Text>
      {children}
    </section>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="admin-tracks-empty" style={{ marginTop: "var(--space-4)" }}>
      <span className="admin-empty-icon" aria-hidden>
        <ChatBubbleIcon width="22" height="22" />
      </span>
      <Text size="3" weight="medium">
        {title}
      </Text>
      <Text size="2" color="gray">
        {text}
      </Text>
    </div>
  );
}

/** Vider l'antenne, après confirmation. */
function ClearDialog({ open, onClose, onConfirm }: { open: boolean; onClose(): void; onConfirm(): void }) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Vider l'antenne ?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Les messages partent dans la neige chez tous les auditeurs, dans le bandeau comme sur la page 888 ; les nouveaux venus ne verront que ce qui suit. Ils
          restent ici, pour la régie.
        </AlertDialog.Description>
        <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={onConfirm}>
              Vider l'antenne
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** Bannir, avec une raison facultative : elle reste à l'écran « Personnes ». */
function BanDialog({ target, onClose, onConfirm }: { target: { id: string; pseudo: string } | null; onClose(): void; onConfirm(reason: string): void }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (target) setReason("");
  }, [target]);
  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Bannir {target?.pseudo} ?</Dialog.Title>
        <Dialog.Description size="2">
          Ce pseudo ne pourra plus écrire, et ses messages de la dernière demi-heure sont brouillés. Un nouveau pseudo depuis la même adresse est refusé pendant
          24 heures. On peut lever le bannissement à l'écran « Personnes ».
        </Dialog.Description>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(reason);
          }}
        >
          <Flex direction="column" gap="3" mt="4">
            <TextField.Root size="2" value={reason} placeholder="Raison (facultative)" aria-label="Raison du bannissement" maxLength={200} onChange={(event) => setReason(event.target.value)} />
            <Callout.Root color="red" size="1">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>Une adresse partagée (lycée, bureau, réseau mobile) peut bloquer d'autres auditeurs pendant ces 24 heures.</Callout.Text>
            </Callout.Root>
            <Flex gap="3" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  Annuler
                </Button>
              </Dialog.Close>
              <Button type="submit" color="red">
                Bannir
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
