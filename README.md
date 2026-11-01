# Parabole Radio — le site

La webradio communautaire de Paris 18 : le direct (lecteur ON AIR, programmation, historique, chat) et bientôt les
archives, les résidents et les événements. Un site [Astro 7](https://astro.build) en TypeScript, publié sur Vercel.

## Lancer l'aperçu

Il faut Node 22.12 ou plus.

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:4321. Le serveur de dev sert aussi l'API (`/api/direct`…) : le direct, la
programmation, l'historique et les liens Hopper marchent comme en ligne. Une modification s'affiche toute seule.

- `npm run build` : construit le site pour Vercel (dans `.vercel/output`).
- `npm run check` : vérifie les types.

## L'architecture : une coque qui ne s'arrête jamais

Le son ne doit jamais se couper quand on change de page. Le site est donc fait d'une **coque**, posée une fois, et
d'un **contenu**, le seul qui change :

- la coque (`src/layouts/Base.astro`) : la vidéo de fond et le globe, la barre du haut et son menu, le bandeau du
  lecteur, les panneaux PROGRAMMATION, HISTORIQUE et CHAT, et le mode staff ;
- le contenu : `<main id="page">`, rempli par chaque page de `src/pages/`.

Le `ClientRouter` d'Astro charge les pages sans recharger l'onglet. Une fonction de remplacement maison
(`src/scripts/router.ts`) ne remplace que le titre, les styles, `<html data-page>` et `<main id="page">` : le son, la
vidéo et le cadre du chat ne sont jamais déplacés ni recréés.

Pour une nouvelle page :

- elle utilise `Base` et met tout son contenu dans le gabarit (`<Base page="…">…</Base>`) ;
- son contenu défile dans sa zone, entre la barre du haut et le bandeau (`.feuille`, voir `src/styles/pages.css`) ;
- elle n'a pas de `<script>` à elle : un script de la coque se branche sur l'événement `astro:after-swap` (voir
  `router.ts`), car les scripts ne s'exécutent qu'une fois par onglet.

## Où est quoi

| Chemin | Rôle |
|---|---|
| `src/scripts/settings.ts` | **Les réglages** : mot de passe staff, lien et textes du bouton contributeurs, adresses de l'API, chat, Hopper, liste des clips |
| `src/scripts/` | Les modules de la coque : `audio` (flux, volume, Web Audio), `beat`, `scope` (oscilloscope), `globe`, `background` (playlist), `panels` (panneaux et fenêtres), `schedule`, `history` (et Hopper), `nowplaying`, `contributors`, `staff`, `router` |
| `src/components/` | Les morceaux de la coque (`Band`, `TopBar`, `Panels`, `Background`, `Staff`, `Icons`) et des pages (`Sheet`, `ComingSoon`) |
| `src/styles/` | Les styles, globaux : une bonne part du balisage est écrite par les scripts |
| `src/pages/` | Accueil, `about`, `show`, `residents`, `event`, 404, et l'API (`api/`) |
| `src/lib/station/` | **L'adaptateur de la station** : Radio Cult aujourd'hui |
| `src/lib/menu.ts` | Les rubriques du menu |
| `public/PARABOLE RADIO/` | Vidéos de fond, logo animé, polices, feuille Tailwind figée |

## La station et notre API

La page ne parle qu'à notre propre API, au format « Radiocompas » (`src/lib/station/types.ts`) :

| Route | Contenu | Cache |
|---|---|---|
| `GET /api/direct` | ce qui passe | 5 s |
| `GET /api/programme` | la programmation, de la veille à J+7 | 60 s |
| `GET /api/historique[?limit=N]` | les 20 derniers morceaux | 15 s |
| `GET /api/hopper?artist=…&title=…` | le lien hppr.fr d'un morceau | 30 jours (rien si Hopper est occupé) |

Les routes lisent la station par son adaptateur, avec un petit cache en mémoire, et le cache de Vercel
(`s-maxage`) fait le reste : un seul appel à la station pour tous les auditeurs. Le flux, lui, est lu directement par
le lecteur ; son adresse vient aussi de l'adaptateur.

**Passer de Radio Cult à BUTTON (Radiocompas)** : écrire `src/lib/station/radiocompas.ts` avec les mêmes exports
(`stream`, `timezone`, `nowPlaying`, `schedule`, `history`), puis le brancher dans `src/lib/station/index.ts`. Rien
d'autre ne change.

Radio Cult inscrit un morceau dans son historique environ 2 minutes après sa fin : la page ajoute en attendant les
morceaux qu'elle a vus passer.

**Hopper** : sans clé, Hopper accepte 10 recherches par minute depuis les adresses partagées de Vercel ; au-delà,
la route répond 503 et la page redemande 2 minutes plus tard. Pour donner à Parabole sa propre limite (60), ajouter
`parabole:<clé>` à `HOPPER_PARTNER_KEYS` dans le `.env` de Hopper, et la même `<clé>` en `HOPPER_KEY` dans les
variables d'environnement du projet Vercel.

## Les panneaux

PROGRAMMATION est toujours ouvert sur l'accueil, sur ordinateur ; ailleurs, et sur téléphone, il s'ouvre par sa
touche. HISTORIQUE et CHAT s'ouvrent au-dessus du bandeau. Sur ordinateur, on les déplace par leur barre de titre :
leur place est gardée dans le navigateur, d'une page et d'une visite à l'autre ; un double-clic sur la barre les
remet en place.

## Avant la mise en ligne

1. **Changer le mot de passe staff** : `STAFF_PASSWORD` dans `src/scripts/settings.ts`.
2. **L'aperçu de partage** : il manque une image de 1200 × 630, à mettre dans `public/` et dans `og:image`
   (`src/layouts/Base.astro`). L'adresse du site est `site` dans `astro.config.mjs`.
3. **Le formulaire contributeurs** : l'ouvrir en navigation privée. S'il demande une connexion, retirer dans Google
   Forms ce qui exige un compte (« Limiter à 1 réponse », collecte d'e-mails vérifiés, restriction à une
   organisation).
4. **Rien de privé dans `public/`** : tout ce qui y est est publié tel quel.

## Ajouter un clip de fond

1. Déposer le `.mp4` dans `public/PARABOLE RADIO/VIDEO/BACKGROUND/` (par exemple `background16.mp4`).
2. Ajouter son chemin à `bgPlaylist` dans `src/scripts/settings.ts`.
3. Faire son image d'attente, du même nom en `.jpg` :
   ```bash
   ffmpeg -i background16.mp4 -frames:v 1 -q:v 4 background16.jpg
   ```

Les clips passent au hasard, jamais deux fois le même de suite. Un clic sur le fond en lance un autre.

## Le mode staff

Double-clic sur le petit logo de la barre du haut, puis le mot de passe. Le staff peut changer la vidéo de fond,
ajouter une vidéo en surimpression, changer le lien du bouton contributeurs et le logo. Ces changements restent
**dans ce navigateur seulement** : utile pour un écran au studio. Le futur CMS (`/admin`) le remplacera.

## En ligne : Vercel, depuis GitHub

Le dépôt GitHub `lazbutton/parabole-radio-site` est relié au projet Vercel `parabole-radio-site`. Vercel lance
`npm run build`, et l'adaptateur `@astrojs/vercel` produit les pages statiques et la fonction de l'API.

- Un push sur `main` part **en production**, sur https://parabole-radio-site.vercel.app.
- Un push sur une autre branche donne un aperçu à sa propre adresse.

Pour brancher le domaine : Vercel › Settings › Domains › Add, puis ajouter chez Squarespace (Domains › DNS) les
enregistrements que Vercel indique. Le HTTPS s'active tout seul.

## Bon à savoir

- `public/PARABOLE RADIO/CSS/tailwind.css` a été générée une fois (Tailwind CSS 3.4.17) à partir des classes de
  l'ancienne page : une classe Tailwind qui n'y est pas ne fera rien. Écrire les nouveaux styles en CSS dans
  `src/styles/`, et ne pas modifier cette feuille à la main.
- Les dépendances sont à des versions exactes (`.npmrc`).
- Les clips d'origine, non compressés, sont gardés hors du dépôt, à côté du dossier du projet, dans
  `parabole-radio-site_sauvegarde-originaux_2026-10-30`.
