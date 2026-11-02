// ---------- L'ANTENNE LIBRE : le chat du site (CHAT_EN_DIRECT.md) ----------
// Les messages des auditeurs défilent dans le bandeau, entre les phrases de Parabole ; on écrit dans le bandeau même, son
// pseudo puis son message ; toute la conversation se lit sur la page 888, une page de télétexte à côté de l'image. Ce
// module ne fait que l'antenne à l'écran : les messages viennent de sa source (antenne-source.ts), le canal temps réel
// de Supabase et notre API (antenne-supabase.ts).
import { cle, COULEURS, lienPermis, type Couleur, type Etat, type Message, type Source } from "./antenne-source";
import { creerSource } from "./antenne-supabase";
import { popups, togglePopup } from "./panels";
import { CHAT, STATION_TIMEZONE } from "./settings";

/** Ce que ce navigateur retient : le pseudo et sa couleur, les messages au bandeau ou non, les pseudos masqués. */
type Preferences = { pseudo: string; couleur: Couleur; bandeau: boolean; masques: string[]; regles: boolean };
const RANGEMENT = "parabole_antenne";

function lirePreferences(): Preferences {
  const couleurs = Object.keys(COULEURS) as Couleur[];
  const defaut: Preferences = { pseudo: "", couleur: couleurs[Math.floor(Math.random() * couleurs.length)], bandeau: true, masques: [], regles: false };
  try {
    const lu = JSON.parse(localStorage.getItem(RANGEMENT) || "{}") || {};
    return {
      ...defaut,
      ...lu,
      couleur: lu.couleur in COULEURS ? lu.couleur : defaut.couleur,
      masques: Array.isArray(lu.masques) ? lu.masques : [],
    };
  } catch (e) {
    return defaut;
  }
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
/** Un élément et son texte, sans jamais passer par du HTML. */
function bout<K extends keyof HTMLElementTagNameMap>(balise: K, classe = "", texte = "") {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte) el.textContent = texte;
  return el;
}

const REGLES = [
  "Ici on parle musique et on se respecte. Pas d'insultes envers les gens ; rien de raciste, sexiste, homophobe, transphobe ou validiste, rien sur la religion ou l'apparence de quelqu'un.",
  "Pas de harcèlement ni de menaces, envers personne : auditeurs, résidents, invités, équipe.",
  "Pas de coordonnées : ni les tiennes ni celles des autres (téléphone, adresse, e-mail, comptes privés).",
  "Pas de pub ni de spam. Les liens se limitent aux plateformes de musique.",
  "Ce que tu envoies passe à l'antenne : ton pseudo et ton message défilent dans le bandeau, sur toutes les pages, pour tous les visiteurs.",
  "Une modération automatique filtre les messages ; la régie peut brouiller un message, couper ton antenne ou te bannir, sans préavis.",
  "Un message te gêne ? « Signaler ».",
];
const NOMS_COULEURS: Record<Couleur, string> = { red: "Rouge", green: "Vert", yellow: "Jaune", blue: "Bleu", magenta: "Magenta", cyan: "Cyan", white: "Blanc" };

function brancher(source: Source) {
  const trouves = {
    bandeau: document.querySelector<HTMLElement>(".bandeau"),
    fenetre: document.querySelector<HTMLElement>(".bandeau-defile"),
    piste: document.querySelector<HTMLElement>(".bandeau-piste"),
    caseBouton: element<HTMLButtonElement>("antenneCase"),
    form: element<HTMLFormElement>("antenneEcriture"),
    champPseudo: element<HTMLInputElement>("antennePseudo"),
    champMessage: element<HTMLInputElement>("antenneMessage"),
    ok: element<HTMLButtonElement>("antenneOk"),
    etiquette: element<HTMLButtonElement>("antenneEtiquette"),
    envoi: element<HTMLButtonElement>("antenneEnvoi"),
    compteur: element("antenneCompteur"),
    flash: element("antenneFlash"),
    page: element("antennePage"),
    fil: element<HTMLOListElement>("antenneFil"),
    avisZone: element("antenneAvis"),
    vue: element("antenneVue"),
    etatTexte: element("antenneEtat"),
    horloge: element("antenneHorloge"),
  };
  if (Object.values(trouves).some((el) => !el)) return; // l'antenne n'est pas dans cette page
  const { bandeau, fenetre, piste, caseBouton, form, champPseudo, champMessage, ok, etiquette, envoi, compteur, flash, page, fil, avisZone, vue, etatTexte, horloge } =
    trouves as { [K in keyof typeof trouves]: NonNullable<(typeof trouves)[K]> };
  const touches = [...page.querySelectorAll<HTMLButtonElement>(".antenne-touche")];
  const caseLong = caseBouton.querySelector(".case-long");
  const caseCourt = caseBouton.querySelector(".case-court");

  const prefs = lirePreferences();
  const garder = () => {
    try {
      localStorage.setItem(RANGEMENT, JSON.stringify(prefs));
    } catch (e) {}
  };
  const calme = !!window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const etroit = matchMedia("(max-width: 820px)");
  const heureCourte = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit" });
  const heureLongue = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  let etat: Etat = { ouvert: true, differe: 0, lent: 0, bandeau: true, signal: true };
  let ouverte = false; // l'antenne ouverte : l'écriture dans le bandeau et la page 888
  let pseudoConfirme = !!prefs.pseudo; // sur téléphone : le pseudo est passé, on écrit le message
  let dernierEnvoi = 0;
  const messages = new Map<string, Message>(); // ce qui est passé, ou passera, dans l'ordre d'arrivée
  const brouilles = new Set<string>();
  const miens = new Set<string>();
  const minuteries = new Map<string, ReturnType<typeof setTimeout>>(); // le différé : ce qui n'est pas encore passé
  const dejaAuBandeau = new Set<string>();

  const masque = (m: Message) => !m.regie && prefs.masques.includes(cle(m.pseudo));
  // la régie peut retirer les messages du bandeau (ils restent sur la page 888), et chacun le peut pour son navigateur
  const auBandeau = () => prefs.bandeau && etat.bandeau && etat.signal;
  const moiCite = (texte: string) =>
    !!prefs.pseudo && texte.split(/(@[\p{L}\p{N}_.-]+)/u).some((morceau) => morceau.startsWith("@") && cle(morceau.slice(1)) === cle(prefs.pseudo));

  // ---------- LES MORCEAUX D'UN MESSAGE, au bandeau comme sur la page 888 ----------
  function quiParle(m: Message) {
    if (m.regie) return bout("b", "antenne-regie", "Parabole");
    const b = bout("b", "antenne-pseudo", m.pseudo);
    b.style.setProperty("--c", COULEURS[m.couleur]);
    return b;
  }
  /** Le texte : les mentions ressortent (la sienne en jaune) ; sur la page 888, un lien permis devient cliquable. */
  function texteDe(texte: string, liens: boolean) {
    const span = bout("span", "antenne-texte");
    for (const morceau of texte.split(/(https?:\/\/\S+|@[\p{L}\p{N}_.-]+)/u)) {
      if (!morceau) continue;
      if (morceau.startsWith("@")) {
        span.append(bout(prefs.pseudo && cle(morceau.slice(1)) === cle(prefs.pseudo) ? "mark" : "span", "antenne-mention", morceau));
      } else if (liens && /^https?:\/\//.test(morceau) && lienPermis(morceau)) {
        const a = bout("a", "", morceau);
        a.href = morceau;
        a.target = "_blank";
        a.rel = "nofollow ugc noopener noreferrer";
        span.append(a);
      } else span.append(morceau);
    }
    return span;
  }

  // ---------- LE BANDEAU : les messages entre les phrases de Parabole ----------
  const phrases = [...piste.querySelectorAll(".bandeau-texte:first-child > span")].map((s) => s.textContent || "").filter(Boolean);
  if (!phrases.length) phrases.push("PARABOLE RADIO");
  bandeau.classList.add("bandeau--antenne");
  piste.replaceChildren();
  const file: Message[] = []; // les nouveaux, qui passent d'abord (la régie en tête)
  let depuisPhrase = 0,
    iPhrase = 0,
    iRotation = 0,
    x = 0,
    avant = 0,
    arret = false;

  const carre = () => {
    const i = bout("i", "bandeau-carre");
    i.setAttribute("aria-hidden", "true");
    return i;
  };
  function itemPhrase(phrase: string) {
    const el = bout("span", "bandeau-texte bandeau-item");
    el.append(phrase, carre());
    return el;
  }
  function itemMessage(m: Message) {
    const el = bout("span", "bandeau-texte bandeau-item bandeau-msg");
    el.dataset.id = m.id;
    el.append(quiParle(m), bout("span", "bandeau-fleche", "▸"), texteDe(m.texte, false), carre());
    if (brouilles.has(m.id)) el.classList.add("brouille");
    return el;
  }
  /** Les messages de la demi-heure, qui tournent quand rien de neuf n'arrive. */
  function rotation() {
    if (!auBandeau()) return [];
    const maintenant = Date.now();
    return [...messages.values()].filter((m) => m.antenne <= maintenant && maintenant - m.heure < 30 * 60_000 && !brouilles.has(m.id) && !masque(m)).slice(-8);
  }
  /** Ce qui entre ensuite dans le bandeau : un nouveau message, ou l'un des récents, et une phrase tous les trois. */
  function suivant() {
    const recents = rotation();
    if (depuisPhrase >= 3 || (!file.length && !recents.length)) {
      depuisPhrase = 0;
      return itemPhrase(phrases[iPhrase++ % phrases.length]);
    }
    depuisPhrase++;
    return itemMessage(file.shift() ?? recents[iRotation++ % recents.length]);
  }
  /** La piste avance d'environ 40 pixels par seconde, comme l'animation d'origine, un peu plus quand des messages attendent. */
  function defiler(t: number) {
    requestAnimationFrame(defiler);
    const dt = Math.min(0.1, (t - (avant || t)) / 1000);
    avant = t;
    if (ouverte || document.hidden || !fenetre.clientWidth) return; // le bandeau caché : rien à mesurer
    if (!arret) x -= (40 + 15 * Math.min(file.length, 2)) * dt;
    let premier = piste.firstElementChild as HTMLElement | null;
    while (premier && x + premier.offsetWidth < 0) {
      x += premier.offsetWidth;
      premier.remove();
      premier = piste.firstElementChild as HTMLElement | null;
    }
    for (let n = 0; n < 12 && x + piste.scrollWidth < fenetre.clientWidth + 160; n++) piste.append(suivant());
    piste.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  }
  /** Sans animations : un élément à la fois, relayé toutes les 6 secondes. */
  function relayer() {
    if (!ouverte && !document.hidden) piste.replaceChildren(suivant());
    setTimeout(relayer, 6000);
  }
  function entrerAuBandeau(m: Message) {
    if (dejaAuBandeau.has(m.id) || !auBandeau() || masque(m) || brouilles.has(m.id)) return;
    dejaAuBandeau.add(m.id);
    if (m.regie) file.unshift(m);
    else file.push(m);
    while (file.length > 5) {
      const i = file.findIndex((n) => !n.regie); // les plus anciens laissent leur place ; ils restent sur la page 888
      file.splice(i < 0 ? file.length - 1 : i, 1);
    }
  }
  function brouillerAuBandeau(id: string) {
    for (const el of piste.querySelectorAll(`.bandeau-msg[data-id="${CSS.escape(id)}"]`)) el.classList.add("brouille");
  }
  function viderBandeau() {
    for (const el of piste.querySelectorAll(".bandeau-msg")) el.remove();
    file.length = 0;
  }
  fenetre.addEventListener("mouseenter", () => (arret = true));
  fenetre.addEventListener("mouseleave", () => (arret = false));
  piste.addEventListener("click", (e) => {
    if ((e.target as Element).closest(".bandeau-msg:not(.brouille)")) ouvrir();
  });

  // ---------- LA PAGE 888 : toute la conversation, la plus récente en haut ----------
  function statut(li: Element, texte: string) {
    const s = li.querySelector(".fil-statut");
    if (s) s.textContent = texte;
  }
  function ligne(m: Message) {
    const li = bout("li", "fil-msg");
    li.dataset.id = m.id;
    const quand = bout("time", "", heureCourte.format(m.heure));
    quand.dateTime = new Date(m.heure).toISOString();
    const corps = bout("div", "fil-corps");
    corps.append(quiParle(m), texteDe(m.texte, true), bout("span", "fil-statut"));
    li.append(quand, corps);
    if (!m.regie && !miens.has(m.id)) li.append(actions(m));
    if (moiCite(m.texte) && !miens.has(m.id)) li.classList.add("mention");
    if (masque(m)) li.hidden = true;
    // sur téléphone, un appui montre les actions
    li.addEventListener("click", (e) => {
      if (!(e.target as Element).closest("a, button")) li.classList.toggle("actions");
    });
    return li;
  }
  function actions(m: Message) {
    const boite = bout("div", "fil-actions");
    const touche = (texte: string, faire: (b: HTMLButtonElement) => void) => {
      const b = bout("button", "", texte);
      b.type = "button";
      b.addEventListener("click", () => faire(b));
      boite.append(b);
    };
    touche("Signaler", async (b) => {
      b.disabled = true;
      const refus = await source.signaler(m.id);
      if (refus) {
        b.disabled = false;
        return avis(`Signalement : ${refus}`);
      }
      b.textContent = "Signalé";
      avis("Signalé : la régie va regarder.");
    });
    touche("Répondre", () => repondre(m));
    touche("Masquer", () => masquer(m.pseudo));
    return boite;
  }
  function afficher(li: HTMLElement) {
    fil.prepend(li);
    while (fil.children.length > 50) fil.lastElementChild?.remove();
  }
  const ligneDe = (id: string) => fil.querySelector<HTMLElement>(`.fil-msg[data-id="${CSS.escape(id)}"]`);

  /** Un avis de la régie, en haut de la page, quelques secondes. */
  function avis(texte: string, duree = 7000, action?: { libelle: string; faire: () => void }) {
    const p = bout("p", "", texte);
    if (action) {
      const b = bout("button", "", action.libelle);
      b.type = "button";
      b.addEventListener("click", () => {
        action.faire();
        p.remove();
      });
      p.append(b);
    }
    avisZone.prepend(p);
    while (avisZone.children.length > 2) avisZone.lastElementChild?.remove();
    setTimeout(() => p.remove(), duree);
  }

  // ---------- CE QUE LA SOURCE ANNONCE ----------
  /** Un message passe à l'antenne : la page 888 l'affiche (ou met à jour celui qu'on avait envoyé), le bandeau le prend. */
  function passer(m: Message, nouveau: boolean) {
    const deja = ligneDe(m.id);
    if (deja) {
      deja.classList.remove("envoi", "attente", "differe");
      statut(deja, "");
    } else afficher(ligne(m));
    if (nouveau) entrerAuBandeau(m);
  }
  function recevoir(m: Message) {
    if (brouilles.has(m.id)) return;
    messages.set(m.id, m);
    const reste = m.antenne - Date.now();
    if (reste <= 0) return passer(m, m.antenne > Date.now() - 10_000);
    // en différé : personne ne le voit avant son heure, sauf son auteur
    clearTimeout(minuteries.get(m.id));
    minuteries.set(
      m.id,
      setTimeout(() => {
        minuteries.delete(m.id);
        passer(m, true);
      }, reste),
    );
  }
  function retirer(id: string) {
    brouilles.add(id);
    clearTimeout(minuteries.get(id));
    minuteries.delete(id);
    const i = file.findIndex((m) => m.id === id);
    if (i >= 0) file.splice(i, 1);
    brouillerAuBandeau(id);
    const li = ligneDe(id);
    if (!li) return; // en différé chez les autres : il ne passera jamais
    li.classList.remove("envoi", "attente", "differe", "actions", "mention");
    li.classList.add("brouille");
    li.querySelector(".fil-actions")?.remove();
    const texte = li.querySelector(".antenne-texte");
    if (texte) texte.textContent = "▒▒▒ Brouillé par la régie ▒▒▒";
    statut(li, "");
  }
  function vider() {
    for (const t of minuteries.values()) clearTimeout(t);
    minuteries.clear();
    for (const id of messages.keys()) brouilles.add(id);
    messages.clear();
    for (const el of piste.querySelectorAll(".bandeau-msg")) el.classList.add("brouille");
    file.length = 0;
    neigeSur(page, 900);
    setTimeout(() => {
      fil.replaceChildren();
      avis("La régie a remis l'antenne à zéro.");
    }, 650);
  }
  function changerEtat(nouvel: Etat) {
    if (!nouvel.signal && etat.signal) viderBandeau(); // sans signal, le bandeau garde ses phrases
    etat = nouvel;
    majEtat();
  }

  // ---------- L'ÉTAT, LES VUES DE LA PAGE ----------
  let vueChoisie: "regles" | "pseudo" | null = null;
  let arreterNeige: (() => void) | null = null;
  function majEtat() {
    etatTexte.textContent = !etat.signal
      ? "Pas de signal"
      : !etat.ouvert
        ? "Fermée"
        : (etat.differe ? "En différé" : "En direct") + (etat.lent ? ` · lent ${etat.lent} s` : "");
    page.dataset.etat = !etat.signal ? "signal" : !etat.ouvert ? "ferme" : etat.differe ? "differe" : "direct";
    if (caseLong) caseLong.textContent = ouverte ? "Fermer" : etat.ouvert ? "Antenne libre" : "Antenne fermée";
    if (caseCourt) caseCourt.textContent = ouverte ? "Fermer" : etat.ouvert ? "Antenne" : "Fermée";
    caseBouton.setAttribute("aria-label", ouverte ? "Fermer l'antenne libre" : "Ouvrir l'antenne libre, le chat");
    majVue();
    majEnvoi();
  }
  function majVue(refaire = false) {
    const quoi = !etat.signal ? "signal" : !etat.ouvert ? "carton" : (vueChoisie ?? "");
    for (const b of touches) if (b.dataset.touche === "regles" || b.dataset.touche === "pseudo") b.setAttribute("aria-pressed", String(b.dataset.touche === vueChoisie));
    if (!refaire && vue.dataset.quoi === quoi) return;
    arreterNeige?.();
    arreterNeige = null;
    vue.dataset.quoi = quoi;
    vue.replaceChildren();
    vue.hidden = !quoi;
    page.classList.toggle("vue-ouverte", !!quoi);
    if (quoi === "signal") {
      vue.append(bout("p", "antenne-signal", "Recherche du signal…"));
      arreterNeige = neigeSur(vue);
    } else if (quoi === "carton") {
      const carton = bout("div", "antenne-carton");
      carton.append(bout("strong", "", "Interruption momentanée"), bout("span", "", "de l'antenne libre"), bout("small", "", "La régie revient vite. Le son, lui, continue."));
      vue.append(carton);
    } else if (quoi === "regles") {
      const liste = bout("ol", "antenne-regles");
      for (const regle of REGLES) liste.append(bout("li", "", regle));
      vue.append(bout("h3", "", "Les règles de l'antenne"), liste, retour());
    } else if (quoi === "pseudo") vue.append(...vuePseudo());
  }
  function retour() {
    const b = bout("button", "vue-touche", "Retour aux messages");
    b.type = "button";
    b.addEventListener("click", () => {
      vueChoisie = null;
      majVue();
    });
    return b;
  }
  function vuePseudo() {
    const moi = bout("p", "antenne-moi", prefs.pseudo || "Pas encore de pseudo");
    moi.style.setProperty("--c", COULEURS[prefs.couleur]);
    const nuancier = bout("div", "antenne-nuancier");
    for (const couleur of Object.keys(COULEURS) as Couleur[]) {
      const b = bout("button");
      b.type = "button";
      b.style.setProperty("--c", COULEURS[couleur]);
      b.setAttribute("aria-label", NOMS_COULEURS[couleur]);
      b.setAttribute("aria-pressed", String(couleur === prefs.couleur));
      b.addEventListener("click", () => {
        prefs.couleur = couleur;
        garder();
        majPseudo();
        majVue(true);
      });
      nuancier.append(b);
    }
    const changer = bout("button", "vue-touche", "Changer de pseudo");
    changer.type = "button";
    changer.addEventListener("click", () => {
      vueChoisie = null;
      majVue();
      pseudoConfirme = false;
      ouvrir();
      champPseudo.focus();
      champPseudo.select();
    });
    return [bout("h3", "", "Ton pseudo"), moi, bout("p", "antenne-aide", "Sa couleur :"), nuancier, changer, retour()];
  }
  for (const b of touches)
    b.addEventListener("click", () => {
      const touche = b.dataset.touche;
      if (touche === "fermer") return fermer();
      if (touche === "bandeau") {
        prefs.bandeau = !prefs.bandeau;
        garder();
        if (!prefs.bandeau) viderBandeau();
        majToucheBandeau();
        avis(prefs.bandeau ? "Les messages repassent dans ton bandeau." : "Plus de messages dans ton bandeau : il garde ses phrases.");
        return;
      }
      vueChoisie = vueChoisie === touche ? null : (touche as "regles" | "pseudo");
      majVue();
    });
  function majToucheBandeau() {
    const b = touches.find((t) => t.dataset.touche === "bandeau");
    if (!b) return;
    b.textContent = `Bandeau : ${prefs.bandeau ? "oui" : "non"}`;
    b.setAttribute("aria-pressed", String(prefs.bandeau));
  }

  /** La neige d'un téléviseur, sur une partie de la page, le temps d'une coupure. */
  function neigeSur(sur: HTMLElement, duree?: number) {
    const canevas = bout("canvas", "antenne-neige");
    canevas.width = 120;
    canevas.height = 90;
    const ctx = canevas.getContext("2d");
    const image = ctx?.createImageData(canevas.width, canevas.height);
    const points = image && new Uint32Array(image.data.buffer);
    let raf = 0,
      dernier = 0;
    const dessiner = (t: number) => {
      if (!calme) raf = requestAnimationFrame(dessiner);
      if (!ctx || !image || !points || t - dernier < 40) return;
      dernier = t;
      for (let i = 0; i < points.length; i++) {
        const v = (Math.random() * 210) | 0;
        points[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
      ctx.putImageData(image, 0, 0);
    };
    sur.append(canevas);
    raf = requestAnimationFrame(dessiner);
    const arreter = () => {
      cancelAnimationFrame(raf);
      canevas.remove();
    };
    if (duree) setTimeout(arreter, duree);
    return arreter;
  }

  // ---------- ÉCRIRE DANS LE BANDEAU : le pseudo, puis le message ----------
  let horlogeId: ReturnType<typeof setInterval> | undefined;
  function ouvrir() {
    if (!ouverte) {
      ouverte = true;
      bandeau.classList.add("ecrit");
      form.hidden = false;
      caseBouton.setAttribute("aria-expanded", "true");
      if (!champPseudo.value) champPseudo.value = prefs.pseudo;
      if (!prefs.regles) avis("En passant à l'antenne, tu acceptes les règles (touche rouge).", 9000);
      clearInterval(horlogeId);
      horlogeId = setInterval(tic, 1000);
    }
    if (!page.classList.contains("open")) togglePopup("antenne");
    majPseudo();
    majEtat();
    tic();
    (form.dataset.etape === "pseudo" || !champPseudo.value ? champPseudo : champMessage).focus();
  }
  function fermer() {
    if (!ouverte) return;
    ouverte = false;
    bandeau.classList.remove("ecrit");
    form.hidden = true;
    form.classList.remove("flash");
    caseBouton.setAttribute("aria-expanded", "false");
    page.classList.remove("open");
    vueChoisie = null;
    clearInterval(horlogeId);
    majEtat();
  }
  // HISTORIQUE, ou PROGRAMMATION sur téléphone, ferme la page 888 (panels.ts) : l'écriture se range avec elle
  new MutationObserver(() => {
    if (ouverte && !page.classList.contains("open")) fermer();
  }).observe(page, { attributes: true, attributeFilter: ["class"] });
  caseBouton.addEventListener("click", () => (ouverte ? fermer() : ouvrir()));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !ouverte) return;
    fermer();
    caseBouton.focus();
  });

  function majPseudo() {
    form.dataset.etape = etroit.matches && !pseudoConfirme ? "pseudo" : "message";
    champPseudo.style.setProperty("--c", COULEURS[prefs.couleur]);
    etiquette.textContent = prefs.pseudo || champPseudo.value || "Pseudo";
    etiquette.style.setProperty("--c", COULEURS[prefs.couleur]);
  }
  etroit.addEventListener("change", majPseudo);
  function majCompteur() {
    const n = [...champMessage.value].length;
    compteur.textContent = n >= 140 ? String(160 - n) : "";
  }
  function majEnvoi() {
    const reste = Math.ceil((dernierEnvoi + etat.lent * 1000 - Date.now()) / 1000);
    const coupe = !etat.ouvert || !etat.signal;
    envoi.disabled = coupe || reste > 0 || !champPseudo.value.trim() || !champMessage.value.trim();
    envoi.textContent = reste > 0 && !coupe ? `${reste} s` : "Envoi";
    champMessage.placeholder = !etat.signal ? "recherche du signal…" : !etat.ouvert ? "l'antenne est fermée" : "ton message à l'antenne";
    ok.disabled = !champPseudo.value.trim();
  }
  /** Chaque seconde, l'antenne ouverte : l'horloge, le mode lent, le compte à rebours du différé. */
  function tic() {
    horloge.textContent = heureLongue.format(Date.now());
    for (const li of fil.querySelectorAll<HTMLElement>(".fil-msg.differe"))
      statut(li, `en différé · ${Math.max(0, Math.ceil((Number(li.dataset.antenne) - Date.now()) / 1000))} s`);
    majEnvoi();
  }

  /** Le pseudo d'abord : vérifié tout de suite, puis gardé dans ce navigateur. */
  function validerPseudo() {
    const pseudo = champPseudo.value.trim();
    const refus = pseudo ? source.verifierPseudo(pseudo) : "choisis d'abord un pseudo.";
    if (refus) {
      avis(`Pseudo : ${refus}`);
      pseudoConfirme = false;
      majPseudo();
      champPseudo.focus();
      return false;
    }
    pseudoConfirme = true;
    if (pseudo !== prefs.pseudo) {
      prefs.pseudo = pseudo;
      garder();
    }
    majPseudo();
    return true;
  }
  champPseudo.addEventListener("input", majEnvoi);
  champPseudo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (validerPseudo()) champMessage.focus();
  });
  ok.addEventListener("click", () => {
    if (validerPseudo()) champMessage.focus();
  });
  etiquette.addEventListener("click", () => {
    pseudoConfirme = false;
    majPseudo();
    champPseudo.focus();
    champPseudo.select();
  });
  champMessage.addEventListener("input", () => {
    majCompteur();
    majEnvoi();
  });

  /** Après l'envoi, deux secondes : le message passe dans le bandeau même. Le champ, invisible, garde la main. */
  let flashId: ReturnType<typeof setTimeout> | undefined;
  function flasher(m: Message, quoi: string) {
    flash.replaceChildren(bout("span", "flash-quoi", quoi), quiParle(m), bout("span", "bandeau-fleche", "▸"), texteDe(m.texte, false));
    form.classList.add("flash");
    clearTimeout(flashId);
    flashId = setTimeout(() => form.classList.remove("flash"), 2400);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texte = champMessage.value.trim();
    if (!texte || envoi.disabled || !validerPseudo()) return;
    const brouillon = ligne({ id: "envoi-" + Date.now(), pseudo: prefs.pseudo, couleur: prefs.couleur, texte, heure: Date.now(), antenne: Date.now() });
    brouillon.classList.add("envoi");
    brouillon.querySelector(".fil-actions")?.remove();
    statut(brouillon, "envoi…");
    afficher(brouillon);
    champMessage.value = "";
    majCompteur();
    envoi.disabled = true;
    const reponse = await source.envoyer({ pseudo: prefs.pseudo, couleur: prefs.couleur, texte });
    brouillon.remove();
    if (reponse.issue === "refuse") {
      champMessage.value = texte;
      majCompteur();
      majEnvoi();
      if (reponse.code === "pseudo") {
        // le pseudo ne passe pas : on le corrige, le message attend dans son champ
        avis(`Pseudo : ${reponse.raison}`, 9000);
        pseudoConfirme = false;
        majPseudo();
        champPseudo.focus();
        champPseudo.select();
        return;
      }
      avis(`La régie n'a pas passé ton message : ${reponse.raison}`, 9000);
      champMessage.focus();
      return;
    }
    prefs.regles = true;
    garder();
    dernierEnvoi = Date.now();
    const m = reponse.message;
    miens.add(m.id);
    if (reponse.issue === "attente") {
      const li = ligne(m);
      li.classList.add("attente");
      statut(li, "en attente de la régie");
      afficher(li);
      flasher(m, "En attente de la régie");
    } else if (m.antenne > Date.now()) {
      const li = ligne(m);
      li.classList.add("differe");
      li.dataset.antenne = String(m.antenne);
      afficher(li);
      recevoir(m);
      flasher(m, `En différé · ${Math.round((m.antenne - Date.now()) / 1000)} s`);
    } else {
      recevoir(m);
      flasher(m, "À l'antenne");
    }
    tic();
  });

  // ---------- RÉPONDRE, MASQUER ----------
  function repondre(m: Message) {
    if (!ouverte) ouvrir();
    const debut = `@${m.pseudo} `;
    if (!champMessage.value.startsWith(debut)) champMessage.value = debut + champMessage.value;
    majCompteur();
    majEnvoi();
    if (form.dataset.etape === "pseudo") return champPseudo.focus();
    champMessage.focus();
    champMessage.setSelectionRange(champMessage.value.length, champMessage.value.length);
  }
  function masquer(pseudo: string) {
    const k = cle(pseudo);
    if (!prefs.masques.includes(k)) prefs.masques.push(k);
    garder();
    appliquerMasques();
    avis(`Les messages de ${pseudo} sont masqués dans ce navigateur.`, 9000, {
      libelle: "Annuler",
      faire: () => {
        prefs.masques = prefs.masques.filter((x) => x !== k);
        garder();
        appliquerMasques();
      },
    });
  }
  function appliquerMasques() {
    for (const li of fil.querySelectorAll<HTMLElement>(".fil-msg")) {
      const m = messages.get(li.dataset.id || "");
      li.hidden = !!m && masque(m);
    }
    for (let i = file.length - 1; i >= 0; i--) if (masque(file[i])) file.splice(i, 1);
    for (const el of piste.querySelectorAll<HTMLElement>(".bandeau-msg")) {
      const m = messages.get(el.dataset.id || "");
      if (m && masque(m)) el.remove();
    }
  }

  // ---------- EN ROUTE ----------
  champPseudo.value = prefs.pseudo;
  majToucheBandeau();
  majPseudo();
  majEtat();
  source.demarrer({
    message: recevoir,
    retrait: retirer,
    vidage: vider,
    etat: changerEtat,
    rejet(id, raison) {
      ligneDe(id)?.remove();
      avis(`La régie n'a pas passé ton message : ${raison}`, 9000);
    },
  });
  if (calme) relayer();
  else requestAnimationFrame(defiler);
}

if (CHAT === "antenne" && popups.antenne) brancher(creerSource());
