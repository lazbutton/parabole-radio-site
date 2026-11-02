// ---------- L'ANTENNE LIBRE, BRANCHÉE ----------
// La source de l'antenne (antenne-source.ts) : notre API pour l'historique et pour écrire (src/pages/api/chat/), et le
// canal privé « chat:antenne » de Supabase Realtime pour ce qui passe, écouté avec la seule clé publiable : lire ne
// demande aucune session. Écrire passe par notre serveur, qui tient la session anonyme de l'auditeur (un cookie) et
// décide. La connexion ne reste ouverte que l'onglet visible : une minute après qu'il est caché, elle se ferme ; elle
// se rouvre à son retour, avec l'historique. Sans réglages Supabase (en local), l'antenne redemande l'historique toutes
// les 8 secondes.
import { verifierFormePseudo } from "@parabole/cms/antenne";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL, PUBLIC_TURNSTILE_SITE_KEY } from "astro:env/client";
import { COULEURS, type Couleur, type Ecoute, type Etat, type Message, type Reponse, type Source } from "./antenne-source";

/** Un message tel que l'envoient le serveur et la base (MessageAntenne du CMS). */
type Recu = { id: string; pseudo: string; couleur: string; texte: string; regie: boolean; heure: string; antenne: string };
type EtatRecu = { ouvert: boolean; lent: number; differe: number; bandeau: boolean; vide?: string | null };

const versMessage = (m: Recu): Message => ({
  id: m.id,
  pseudo: m.pseudo,
  couleur: (m.couleur in COULEURS ? m.couleur : "white") as Couleur,
  texte: m.texte,
  regie: m.regie,
  heure: Date.parse(m.heure),
  antenne: Date.parse(m.antenne),
});

async function demander<T>(adresse: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(adresse, {
    method: corps ? "POST" : "GET",
    headers: corps ? { "Content-Type": "application/json" } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!reponse.ok) throw new Error(`${adresse} → HTTP ${reponse.status}`);
  return reponse.json() as Promise<T>;
}

/** Turnstile, chargé au premier besoin, dans une case en haut de la page 888 ; le plus souvent sans rien demander. */
let turnstile: Promise<{ render(el: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void } | null> | null = null;
function chargerTurnstile() {
  turnstile ??= new Promise((fin) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => fin((window as unknown as { turnstile?: never }).turnstile ?? null);
    script.onerror = () => fin(null);
    document.head.append(script);
  });
  return turnstile;
}
async function preuveHumaine(): Promise<string | null> {
  const api = PUBLIC_TURNSTILE_SITE_KEY ? await chargerTurnstile() : null;
  const page = document.getElementById("antennePage");
  if (!api || !page) return null;
  const caseTurnstile = document.createElement("div");
  caseTurnstile.className = "antenne-turnstile";
  page.querySelector(".antenne-tete")?.after(caseTurnstile);
  return new Promise((fin) => {
    let id = "";
    const finir = (jeton: string | null) => {
      if (id) api.remove(id);
      caseTurnstile.remove();
      fin(jeton);
    };
    id = api.render(caseTurnstile, {
      sitekey: PUBLIC_TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      theme: "dark",
      language: "fr",
      callback: (jeton: string) => finir(jeton),
      "error-callback": () => finir(null),
      "timeout-callback": () => finir(null),
    });
  });
}

export function creerSource(): Source {
  let ecoute: Ecoute | null = null;
  let etat: Etat = { ouvert: true, differe: 0, lent: 0, bandeau: true, signal: true };
  let dernierVidage: string | null | undefined;
  let client: SupabaseClient | null = null;
  let canal: RealtimeChannel | null = null;
  let fermeture: ReturnType<typeof setTimeout> | undefined;
  let releve: ReturnType<typeof setInterval> | undefined;
  /** Ce qu'on a montré : de quoi retirer ce que la régie a brouillé pendant une coupure. */
  const montres = new Map<string, number>();
  /** Ses messages en attente de la régie : on demande à /api/chat/moi ce qu'ils deviennent. */
  const enAttente = new Set<string>();
  let suivi: ReturnType<typeof setInterval> | undefined;

  const signal = (present: boolean) => {
    if (etat.signal === present) return;
    etat = { ...etat, signal: present };
    ecoute?.etat(etat);
  };
  const recevoir = (m: Recu) => {
    const message = versMessage(m);
    montres.set(message.id, message.antenne);
    ecoute?.message(message);
  };
  function etatRecu(recu: EtatRecu) {
    if (dernierVidage !== undefined && recu.vide !== undefined && recu.vide !== dernierVidage) {
      montres.clear();
      ecoute?.vidage();
    }
    if (recu.vide !== undefined) dernierVidage = recu.vide;
    etat = { ouvert: recu.ouvert, lent: recu.lent, differe: recu.differe, bandeau: recu.bandeau, signal: etat.signal };
    ecoute?.etat(etat);
  }

  /** L'état et l'historique : à l'ouverture, au retour du signal, au retour sur l'onglet. */
  async function charger() {
    try {
      const { etat: recu, messages } = await demander<{ etat: EtatRecu; messages: Recu[] }>("/api/chat");
      etatRecu(recu);
      const presents = new Set(messages.map((m) => m.id));
      // ce que la régie a brouillé pendant qu'on n'écoutait pas : dans la fenêtre de l'historique, et absent
      const debut = messages.length ? Date.parse(messages[0]!.antenne) : Infinity;
      for (const [id, antenne] of montres) {
        if (antenne < debut || antenne > Date.now() || presents.has(id)) continue;
        montres.delete(id);
        ecoute?.retrait(id);
      }
      messages.forEach(recevoir);
      if (!canal) signal(true);
    } catch {
      signal(false);
    }
  }

  async function ecouter() {
    if (canal) return;
    if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      // en local sans Supabase : l'historique, toutes les 8 secondes
      releve ??= setInterval(() => !document.hidden && charger(), 8000);
      return;
    }
    if (!client) {
      const { createClient } = await import("@supabase/supabase-js");
      client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    canal = client
      .channel("chat:antenne", { config: { private: true } })
      .on("broadcast", { event: "message" }, ({ payload }) => recevoir(payload as Recu))
      .on("broadcast", { event: "retrait" }, ({ payload }) => {
        montres.delete((payload as { id: string }).id);
        ecoute?.retrait((payload as { id: string }).id);
      })
      .on("broadcast", { event: "vidage" }, ({ payload }) => {
        dernierVidage = (payload as { heure: string | null }).heure;
        montres.clear();
        ecoute?.vidage();
      })
      .on("broadcast", { event: "etat" }, ({ payload }) => etatRecu(payload as EtatRecu))
      .subscribe((statut) => {
        if (statut === "SUBSCRIBED") {
          signal(true);
          charger(); // ce qui est passé pendant la connexion
        } else if (statut === "CHANNEL_ERROR" || statut === "TIMED_OUT") signal(false); // supabase-js réessaie seul
      });
  }
  function couper() {
    if (canal && client) client.removeChannel(canal);
    canal = null;
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(fermeture);
    if (document.hidden) fermeture = setTimeout(couper, 60_000);
    else if (!canal) {
      charger();
      ecouter();
    }
  });

  /** Ses messages en attente : toutes les 10 secondes, ce que la régie en a fait. */
  function suivre() {
    if (suivi || !enAttente.size) return;
    suivi = setInterval(async () => {
      try {
        const { moi } = await demander<{ moi: { messages: { id: string; statut: string; raison: string | null }[] } | null }>("/api/chat/moi");
        for (const m of moi?.messages ?? []) {
          if (!enAttente.has(m.id) || m.statut === "attente") continue;
          enAttente.delete(m.id);
          if (m.statut === "refuse") ecoute?.rejet(m.id, m.raison || "la régie ne l'a pas passé.");
          else if (m.statut === "brouille") ecoute?.retrait(m.id);
          // passé à l'antenne : il arrive par le canal
        }
      } catch {}
      if (!enAttente.size) {
        clearInterval(suivi);
        suivi = undefined;
      }
    }, 10_000);
  }

  return {
    demarrer(e) {
      ecoute = e;
      charger();
      ecouter();
    },

    async envoyer(envoi): Promise<Reponse> {
      type Rendu = { issue: "antenne" | "attente"; message: Recu } | { issue: "refuse"; raison: string; code?: string };
      try {
        let rendu = await demander<Rendu>("/api/chat/messages", envoi);
        if (rendu.issue === "refuse" && rendu.code === "humain") {
          const preuve = await preuveHumaine();
          if (preuve) rendu = await demander<Rendu>("/api/chat/messages", { ...envoi, turnstile: preuve });
        }
        if (rendu.issue === "refuse") return { issue: "refuse", raison: rendu.raison, ...(rendu.code === "pseudo" ? { code: "pseudo" as const } : {}) };
        const message = versMessage(rendu.message);
        montres.set(message.id, message.antenne);
        if (rendu.issue === "attente") {
          enAttente.add(message.id);
          suivre();
        }
        return { issue: rendu.issue, message };
      } catch {
        return { issue: "refuse", raison: "le message n'est pas parti, réessaie dans un instant." };
      }
    },

    async signaler(id) {
      try {
        const rendu = await demander<{ ok: boolean; raison?: string }>("/api/chat/signalements", { message: id, motif: "signalé depuis la page 888" });
        return rendu.ok ? null : (rendu.raison ?? "le signalement n'est pas parti.");
      } catch {
        return "le signalement n'est pas parti, réessaie dans un instant.";
      }
    },

    verifierPseudo: (pseudo) => verifierFormePseudo(pseudo),
  };
}
