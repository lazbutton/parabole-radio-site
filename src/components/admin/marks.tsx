/**
 * Les petites marques que partagent les écrans : le statut (publié, brouillon), l'état d'une émission (à traiter, en
 * attente, en ligne), le type d'un show en vignette, et la touche de commande du clavier (⌘ sur Mac, Ctrl ailleurs).
 */
import { LABELS } from "@parabole/cms/labels";
import { ChatBubbleIcon, DiscIcon, ListBulletIcon } from "@radix-ui/react-icons";
import { Badge, Tooltip } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import type { ShowLack, ShowStep, ShowType } from "@parabole/cms";

/** Les trois états d'une émission (cms/src/admin/shows.ts, SHOW_STEPS) : leur mot, leur couleur, et ce qu'ils veulent dire. */
export const STEPS: Record<ShowStep, { label: string; color: "amber" | "blue" | "green"; hint: string }> = {
  todo: { label: "À traiter", color: "amber", hint: "Il manque une info obligatoire, ou quelque chose attend l'équipe." },
  waiting: { label: "En attente", color: "blue", hint: "Tout est là : elle attend sa diffusion, puis SoundCloud la met en ligne." },
  online: { label: "En ligne", color: "green", hint: "Publiée sur le site." },
};

/** Ce qui laisse une émission à traiter, en mots courts. */
export const LACKS: Record<ShowLack, string> = {
  date: "date de diffusion",
  cover: "pochette",
  description: "description",
  tags: "étiquettes",
  mood: "mood",
  tracklist: "tracklist",
  sound: "son",
  review: "son à écouter",
  failed: "SoundCloud en échec",
  assemble: "playlist à assembler",
  slot: "créneau à trouver",
};

const MISSING_INFO: ShowLack[] = ["date", "cover", "description", "tags", "mood", "tracklist", "sound"];

/** « Il manque : pochette, tracklist. Son à écouter. » */
export function lackSentence(lacking: ShowLack[]): string {
  const missing = lacking.filter((lack) => MISSING_INFO.includes(lack)).map((lack) => LACKS[lack]);
  const team = lacking.filter((lack) => !MISSING_INFO.includes(lack)).map((lack) => LACKS[lack]);
  const said = [missing.length ? `Il manque : ${missing.join(", ")}.` : "", team.map((one) => `${one.charAt(0).toUpperCase()}${one.slice(1)}.`).join(" ")];
  return said.filter(Boolean).join(" ");
}

/** L'état d'une émission : une pastille, et au survol ce qui manque (à traiter) ou ce que l'état veut dire. */
export function StepBadge({ step, lacking = [], size = "1" }: { step: ShowStep; lacking?: ShowLack[]; size?: "1" | "2" }) {
  const { label, color, hint } = STEPS[step];
  const said = step === "todo" && lacking.length ? lackSentence(lacking) : hint;
  return (
    <Tooltip content={said}>
      <Badge color={color} variant="soft" radius="full" size={size} className="admin-status" aria-label={`${label}. ${said}`}>
        <span className="admin-status-dot" aria-hidden />
        {label}
      </Badge>
    </Tooltip>
  );
}

/**
 * Brouillon ou publié : une pastille, avec son point de couleur et son mot (la couleur ne dit jamais tout). `feminine` :
 * « Publiée », pour une émission.
 */
export function StatusBadge({ status, size = "1", feminine = false }: { status: "draft" | "published"; size?: "1" | "2"; feminine?: boolean }) {
  const published = status === "published";
  return (
    <Badge color={published ? "green" : "gray"} variant="soft" radius="full" size={size} className="admin-status">
      <span className="admin-status-dot" aria-hidden />
      {published ? (feminine ? "Publiée" : "Publié") : "Brouillon"}
    </Badge>
  );
}

const TYPE_ICONS = { dj_set: DiscIcon, playlist: ListBulletIcon, podcast: ChatBubbleIcon } satisfies Record<ShowType, unknown>;

/** L'icône d'un type de show : un disque pour un DJ set, une liste pour une playlist, une bulle pour un podcast. */
export function TypeIcon({ type }: { type: ShowType }) {
  const Icon = TYPE_ICONS[type];
  return <Icon aria-hidden />;
}

/** La vignette d'un show tant qu'il n'a pas de pochette affichable : son type, en couleur. */
export function TypeTile({ type, size = 36 }: { type: ShowType; size?: number }) {
  return (
    <span className="admin-type-tile" data-type={type} style={{ width: size, height: size }} title={LABELS.showType[type]}>
      <TypeIcon type={type} />
    </span>
  );
}

/** « ⌘ » sur Mac et iPad, « Ctrl » ailleurs. Le serveur ne sait pas : il écrit ⌘, le navigateur corrige. */
export function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod("Ctrl");
  }, []);
  return mod;
}
