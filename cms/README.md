# CMS de Parabole Radio

Le CMS maison de Parabole Radio. L'équipe y saisit les **shows** (DJ sets, playlists, podcasts) et leur tracklist, les **artistes** (résidents et invités), les **événements** et les **pages** simples. Le site les lit.

Ce dossier en pose la base :

- le **modèle de données**, en Drizzle, et ses migrations ;
- la **base** Postgres de Supabase et ses **règles d'accès** (RLS) ;
- les **comptes de l'équipe** : Supabase Auth, lien magique, deux rôles ;
- les **fonctions de lecture** dont le site a besoin, typées ;
- un **jeu d'exemples** et des **tests** qui tournent sans compte Supabase.

Les écrans d'administration (`/admin`) viendront ensuite, dans le projet Astro. La section 9 dit ce qu'ils devront couvrir.

**Sommaire**

1. [La pile](#1-la-pile)
2. [Le modèle](#2-le-modèle)
3. [Qui peut quoi](#3-qui-peut-quoi)
4. [Mettre en place Supabase](#4-mettre-en-place-supabase)
5. [Variables d'environnement](#5-variables-denvironnement)
6. [Travailler en local](#6-travailler-en-local)
7. [Lire depuis le site](#7-lire-depuis-le-site)
8. [Tests et évolutions du modèle](#8-tests-et-évolutions-du-modèle)
9. [Ce que les écrans d'admin devront couvrir](#9-ce-que-les-écrans-dadmin-devront-couvrir)

---

## 1. La pile

| Brique | Version | Rôle |
|---|---|---|
| Supabase | Postgres 17 | La base, et les comptes de l'équipe (Auth) |
| Drizzle ORM | 0.45.4 | Le schéma en TypeScript et les requêtes |
| drizzle-kit | 0.31.11 | Les migrations tirées du schéma |
| postgres (postgres-js) | 3.4.9 | Le pilote vers Supabase |
| PGlite | 0.5.10 | Un vrai Postgres dans Node, sans serveur : développement local et tests |
| Vitest | 5.0.5 | Les tests |
| TypeScript | 6.0.3 | Les types |

Les versions sont exactes, sans `^`. Drizzle ORM, postgres, PGlite, Vitest et TypeScript sont aux versions du projet Hopper, déjà éprouvées ensemble ; drizzle-kit est celle qui accompagne Drizzle 0.45. Il faut Node 22.12 ou plus. Les scripts tournent en TypeScript, sans compilation (`--experimental-strip-types`).

```
cms/
├── src/
│   ├── schema.ts          le modèle : tables, types énumérés, relations
│   ├── db.ts              connect() : Supabase (DATABASE_URL) ou PGlite
│   ├── access.ts          lire et écrire sous un rôle : asPublic(), asMember()
│   ├── local-supabase.ts  ce que Supabase fournit d'office, recréé pour PGlite
│   ├── read/              les fonctions de lecture du site
│   ├── labels.ts          libellés français pour l'admin
│   ├── slug.ts            slugify(), isSlug()
│   └── index.ts           ce que le projet Astro importe
├── drizzle/               les migrations (SQL), appliquées dans l'ordre
├── seed/exemples.ts       le jeu d'exemples
├── scripts/               db:migrate et db:seed
└── test/                  les tests
```

---

## 2. Le modèle

```mermaid
erDiagram
    show ||--o{ track : "tracklist"
    show ||--o{ show_artist : ""
    artist ||--o{ show_artist : ""
    show ||--o{ show_tag : ""
    tag ||--o{ show_tag : ""
    event ||--o{ event_artist : ""
    artist ||--o{ event_artist : ""
    event ||--o{ event_photo : "galerie"
    media ||--o{ event_photo : ""
    media |o--o{ show : "pochette"
    media |o--o{ artist : "photo"
    media |o--o{ event : "visuel"
    auth_users ||--o| member : "compte"

    show {
        uuid id PK
        text slug UK
        text title
        enum type "dj_set, playlist, podcast"
        enum status "draft, published"
        timestamptz broadcast_at "diffusion"
        int duration_seconds
        text description "Markdown"
        uuid cover_id FK "image carrée"
        text soundcloud_url
        text soundcloud_track_id UK
        text radiocult_event_id UK
    }
    track {
        uuid id PK
        uuid show_id FK
        int position "1, 2, 3…"
        text artist
        text title
        int start_seconds "minutage"
        text hopper_url "https://hppr.fr/…"
    }
    artist {
        uuid id PK
        text slug UK
        text name
        enum role "resident, guest"
        text bio "Markdown"
        uuid photo_id FK
        jsonb links "libellé + adresse"
        enum status "draft, published"
        text radiocult_artist_id UK
    }
    show_artist {
        uuid show_id PK
        uuid artist_id PK
        int position
    }
    tag {
        uuid id PK
        enum kind "genre, mood, theme"
        text name
        text slug "unique par type"
    }
    show_tag {
        uuid show_id PK
        uuid tag_id PK
    }
    event {
        uuid id PK
        text slug UK
        text title
        enum category "art_ensemble, parabole, special, talk"
        enum status "draft, published"
        timestamptz starts_at
        timestamptz ends_at
        text venue "lieu"
        text address
        text description "Markdown"
        uuid visual_id FK
        text ticket_url "billetterie"
    }
    event_artist {
        uuid event_id PK
        uuid artist_id PK
        int position
    }
    event_photo {
        uuid event_id PK
        uuid media_id PK
        int position
        text caption "légende"
    }
    page {
        uuid id PK
        text slug UK
        text title
        text body "Markdown"
        enum status "draft, published"
    }
    media {
        uuid id PK
        text key UK "clé dans R2"
        text mime_type
        bigint size_bytes
        int width
        int height
        text alt "texte alternatif"
        text credit
        jsonb variants "versions réduites"
    }
    member {
        uuid user_id PK "compte Supabase Auth"
        text email UK
        text name
        enum role "admin, editor"
    }
    auth_users {
        uuid id PK
        text email
    }
```

### Les tables

| Table | Ce qu'elle garde | À savoir |
|---|---|---|
| `show` | Un épisode archivé ou à venir | Publier exige une date de diffusion. Le son est sur le compte SoundCloud de Parabole : le lecteur joue `soundcloud_track_id` (URN `soundcloud:tracks:<id>`), `soundcloud_url` mène à la piste (crédit exigé par SoundCloud). `radiocult_event_id` relie le show au créneau Radio Cult importé |
| `track` | La tracklist d'un show | Une ligne par morceau, `position` 1, 2, 3… sans doublon. Le minutage est en secondes depuis le début du show. Le lien Hopper commence forcément par `https://hppr.fr/` |
| `artist` | Un résident ou un invité | Le rôle est celui de l'artiste (filtres Resident / Guest). `links` : une liste `[{ "label": "Instagram", "url": "…" }]` |
| `show_artist` | Les artistes d'un show | Dans l'ordre d'affichage (« A b2b B ») |
| `tag` | Une étiquette de show | Typée : genre, mood ou thème. Un genre et un mood peuvent porter le même nom |
| `show_tag` | Les étiquettes d'un show | |
| `event` | Un événement | Catégorie Art ensemble, Parabole, Special ou Talk. Sans heure de fin, il reste « à venir » jusqu'à minuit, heure de Paris |
| `event_artist` | Les artistes d'un événement | Dans l'ordre d'affichage |
| `event_photo` | La galerie d'un événement | Dans l'ordre de défilement, avec une légende |
| `page` | Une page de texte | À propos (`a-propos`), mentions légales… |
| `media` | Un fichier envoyé sur Cloudflare R2 | Sa clé dans le seau, son type, ses dimensions, son texte alternatif, son crédit, ses versions réduites (`[{ "width": 800, "key": "…" }]`) |
| `member` | Un membre de l'équipe | Relié à un compte Supabase Auth, avec son rôle. Jamais d'auditeurs |

### Conventions

- **Identifiants** : des uuid. Les adresses du site utilisent le **slug** : minuscules sans accents, chiffres, tirets (`nuit-parabole-2026`). La base refuse tout autre format. `slugify()` en fabrique un.
- **Statut** : brouillon (`draft`) ou publié (`published`) sur tout ce que le site montre. Seul le publié est public.
- **Textes longs** (description, bio, page) : en Markdown, à afficher sans HTML brut.
- **Heures** : `timestamptz`, en UTC dans la base. Le site les affiche à l'heure de Paris.
- **`created_at`, `updated_at`** : tenus par Postgres. Un déclencheur met `updated_at` à jour à chaque modification, d'où qu'elle vienne.
- **Colonnes `search`** : le vecteur de la recherche plein texte. Postgres le calcule ; on ne l'écrit jamais.
- **Recherche** : en français, sans accents ni majuscules. La configuration `public.french_unaccent` ramène les mots à leur racine, et l'extension `unaccent` retire les accents.

### Les migrations

| Fichier | Écrit par | Contenu |
|---|---|---|
| `0000_prelude.sql` | à la main | L'extension `unaccent`, la configuration de recherche française, le schéma `private` |
| `0001_modele.sql` | drizzle-kit | Les types, les tables, les contraintes, les index. La RLS est activée partout |
| `0002_acces.sql` | à la main | Les règles d'accès, les droits des rôles, les déclencheurs |

---

## 3. Qui peut quoi

Postgres voit chaque visiteur sous un rôle de Supabase. La sécurité par ligne (RLS) applique les règles de `0002_acces.sql` à toutes leurs requêtes, par l'API de Supabase comme par le site.

| | Lire le publié | Lire les brouillons | Écrire les contenus | Gérer l'équipe |
|---|:-:|:-:|:-:|:-:|
| Le public (rôle `anon`) | ✓ | | | |
| Un compte sans fiche dans `member` | ✓ | | | |
| Un éditeur (`editor`) | ✓ | ✓ | ✓ | |
| Un admin (`admin`) | ✓ | ✓ | ✓ | ✓ |

« Écrire les contenus » couvre : créer, modifier, publier et supprimer les shows, les tracklists, les artistes, les événements, les étiquettes, les pages et les fichiers.

Le détail des règles :

- **Les contenus** (`show`, `artist`, `event`, `page`) : le public ne voit que le publié ; l'équipe voit tout.
- **Les liens** (tracklist, artistes et étiquettes d'un show, artistes et galerie d'un événement) suivent leur contenu. Ils sont visibles quand celui-ci l'est. L'artiste en brouillon d'un show publié reste caché.
- **Les fichiers** (`media`) : le public ne voit que ceux d'un contenu publié (pochette, photo, visuel, galerie). Les autres restent à l'équipe : ceux d'un brouillon, et ceux qui ne servent pas encore.
- **Les étiquettes** sont publiques.
- **L'équipe** (`member`) : le public n'y a aucun accès. Les membres se voient entre eux ; seul l'admin ajoute, modifie ou retire un membre. La base refuse de laisser l'équipe sans admin : un admin doit en nommer un autre avant de céder sa place. Cela vaut aussi pour la suppression de son compte dans Supabase Auth. Pour une vraie remise à zéro, l'éditeur SQL peut suspendre le déclencheur le temps de l'opération (`alter table member disable trigger keep_an_admin`, puis `enable`).
- **Droits des rôles** : Supabase donne d'office tous les droits aux rôles de son API. La migration les réduit : `anon` ne fait que lire, et personne ne vide une table par l'API (`TRUNCATE` échappe à la RLS).
- **Fonctions des règles** (`private.team_role()`, `private.is_admin()`…) : elles vivent dans le schéma `private`, que l'API de Supabase ne publie pas.

**Comment le site lit.** Le serveur se connecte en propriétaire des tables, que la RLS laisse passer. Chaque lecture prend donc, le temps de sa transaction, le rôle `anon` (`asPublic()`, dans `src/access.ts`). Les requêtes filtrent aussi le publié elles-mêmes : deux barrières plutôt qu'une. Les écrans d'admin écriront de même sous le rôle de la personne connectée (`asMember()`).

**Les comptes.** La connexion se fait par lien magique, et seulement pour l'équipe. Les inscriptions restent fermées dans Supabase : un compte n'existe que si un admin l'a invité. Un compte sans fiche dans `member` n'a pas plus de droits que le public. Les auditeurs n'ont jamais de compte : My Parabole garde ses favoris dans le navigateur.

---

## 4. Mettre en place Supabase

Rien n'est encore créé en ligne. Voici les étapes, à faire une fois. Les menus de Supabase peuvent bouger un peu ; les noms donnés ici sont ceux de fin 2026.

### 4.1 Créer le projet

1. Sur [supabase.com](https://supabase.com), créer une organisation pour Parabole, puis **New project** :
   - nom : `parabole-radio` ;
   - mot de passe de la base : long et aléatoire, gardé dans un gestionnaire de mots de passe ;
   - **région : West EU (Paris)**, `eu-west-3`. Elle est au plus près des auditeurs et de la région Vercel `cdg1`. À défaut, Central EU (Frankfurt).
2. Le plan gratuit suffit pour commencer, mais il met en pause un projet resté inactif une semaine. Une fois le site en ligne, le plan Pro écarte ce risque et ajoute des sauvegardes quotidiennes.

### 4.2 Récupérer les adresses de connexion

Bouton **Connect**, en haut du tableau de bord, onglet des chaînes de connexion :

- **Transaction pooler** (port `6543`) : pour le site sur Vercel. C'est le `DATABASE_URL` de Vercel.
- **Session pooler** (port `5432`) : pour lancer les migrations depuis un ordinateur.
- La connexion directe passe par IPv6 seulement : inutile ici.

Remplacer `[YOUR-PASSWORD]` par le mot de passe de la base.

### 4.3 Régler la connexion de l'équipe (Auth)

1. **Authentication → Sign In / Providers** :
   - **Email** activé, avec **Confirm email** ;
   - **Allow new users to sign up** : **désactivé**. Personne ne crée de compte seul : l'admin invite.
2. **Authentication → URL Configuration** :
   - **Site URL** : l'adresse du site (aujourd'hui `https://parabole-radio-site.vercel.app`) ;
   - **Redirect URLs** : `https://parabole-radio-site.vercel.app/admin/**`, `http://localhost:4321/admin/**`, plus celles des aperçus Vercel si l'admin doit y marcher (`https://parabole-radio-site-*-lazbuttons-projects.vercel.app/admin/**`).
3. **Authentication → Emails → SMTP Settings** : brancher un vrai service d'envoi (Brevo, Resend, Postmark…). Le service intégré n'écrit qu'aux membres de l'organisation Supabase, et quelques fois par heure seulement. Il ne suffit pas pour inviter l'équipe.
4. **Authentication → Emails → Templates** : traduire **Magic Link** (« Ton lien pour entrer dans l'admin de Parabole ») et **Invite user** (« Tu es invité·e dans l'équipe de Parabole Radio »).

Côté écrans d'admin, la connexion appellera `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`. Avec `shouldCreateUser: false`, une adresse inconnue ne reçoit rien et ne crée aucun compte.

### 4.4 Appliquer les migrations

Depuis un ordinateur, avec la chaîne **Session pooler** :

```bash
cd cms
npm install
```

```bash
DATABASE_URL="postgresql://postgres.<ref>:<mot-de-passe>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres" npm run db:migrate
```

On peut aussi mettre `DATABASE_URL` dans `cms/.env` (jamais versionné), puis lancer `npm run db:migrate`. Les migrations déjà passées sont sautées : on peut relancer sans risque.

Vérifier ensuite dans le tableau de bord :

- **Table Editor** : les 12 tables sont là, chacune avec la RLS activée ;
- **Advisors → Security Advisor** : aucune erreur.

Pour suivre les migrations, Drizzle tient le schéma `drizzle` (table `__drizzle_migrations`).

### 4.5 Nommer le premier admin

1. **Authentication → Users → Add user → Send invitation**, avec sa propre adresse. Cliquer le lien reçu.
2. **SQL Editor** :

```sql
insert into public.member (user_id, email, name, role)
select id, email, 'Prénom', 'admin' from auth.users where email = 'adresse@exemple.fr';
```

Les membres suivants seront invités depuis l'écran **Équipe** de l'admin (section 9).

### 4.6 Des exemples en ligne (facultatif)

Pour essayer le site sur la vraie base avec le jeu d'exemples :

```bash
npm run db:seed -- --distant
```

Tout y est marqué comme exemple. Pour tout retirer, et rien d'autre :

```bash
npm run db:seed -- --distant --supprimer
```

---

## 5. Variables d'environnement

Le modèle est dans `cms/.env.example`. Les variables `PUBLIC_*` peuvent aller dans le navigateur ; **les autres restent sur le serveur**.

| Variable | Où | Valeur |
|---|---|---|
| `DATABASE_URL` | Vercel (Production, Preview) | Chaîne **Transaction pooler** (port 6543), avec le mot de passe |
| `DATABASE_URL` | `cms/.env`, en local | Chaîne **Session pooler** (port 5432), pour `db:migrate`. Vide : base locale PGlite |
| `PUBLIC_SUPABASE_URL` | Vercel, `.env` | `https://<ref>.supabase.co` (Project Settings → Data API) |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel, `.env` | Clé publiable `sb_publishable_…` (Project Settings → API Keys ; l'ancienne clé `anon` fait le même travail) |
| `SUPABASE_SECRET_KEY` | Vercel seulement | Clé secrète `sb_secret_…` (l'ancienne `service_role`) : sert à inviter les membres, rien d'autre |
| `PUBLIC_MEDIA_URL` | Vercel, `.env` | Adresse publique du seau R2, par un domaine à soi : `https://media.<domaine>` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Vercel | Jeton R2 limité à ce seau, en lecture et écriture : pour les envois de fichiers |
| `CRON_SECRET` | Vercel | Une longue chaîne aléatoire : protège l'import quotidien Radio Cult |
| `PGLITE_DIR` | `.env`, facultatif | Autre dossier pour la base locale (par défaut `cms/.pglite`) |

Sur Vercel, sans `DATABASE_URL`, `connect()` s'arrête avec un message clair : il n'y a pas de disque durable pour PGlite.

---

## 6. Travailler en local

Pas besoin de compte Supabase :

```bash
cd cms
npm install
npm run db:migrate
npm run db:seed
```

- `db:migrate` crée la base locale dans `cms/.pglite`, que Git ignore. C'est un vrai Postgres, avec les rôles, le schéma `auth` et les droits de Supabase recréés (`src/local-supabase.ts`). Les règles d'accès s'y appliquent comme en ligne.
- `db:seed` écrit le jeu d'exemples : 9 shows (dont un brouillon), 16 morceaux, 8 artistes (dont un brouillon), 7 événements, 11 étiquettes, 2 pages, 15 fichiers. On peut le relancer : il remplace les exemples sans toucher au reste.
- `db:seed -- --supprimer` retire les exemples.

**Les exemples.** Tout y est inventé et marqué :

- les titres et les noms finissent par « (exemple) » ;
- les slugs commencent par `exemple-` ;
- les clés de fichiers commencent par `exemples/`. Ces fichiers n'existent pas sur R2 : le site doit supporter une image absente.

Les dates partent du jour du seed. Un événement à venir le reste donc.

**Une seule base locale à la fois.** PGlite ouvre `cms/.pglite` pour un seul processus. Arrêter le serveur de développement avant `db:seed`, ou l'inverse.

---

## 7. Lire depuis le site

Le projet Astro importera ce dossier comme un paquet de l'espace de travail npm : `"workspaces": ["cms"]` dans le `package.json` de la racine, puis `import … from "@parabole/cms"`. Vite compile directement les sources TypeScript.

```ts
// Projet Astro, src/lib/cms.ts
import { connect, createReader } from "@parabole/cms";

const { db } = await connect(); // DATABASE_URL sur Vercel, PGlite en local
export const cms = createReader(db, { mediaBaseUrl: import.meta.env.PUBLIC_MEDIA_URL });
```

```astro
---
// Projet Astro, une page
import { cms } from "../lib/cms";
const { items, total } = await cms.listShows({ type: "dj_set", genre: Astro.url.searchParams.get("genre") ?? undefined, period: "past" });
---
```

Toutes les lectures se font sous le rôle `anon`, en lecture seule. Elles ne voient donc que le publié. Une valeur lue dans une adresse et inconnue (type, catégorie, slug mal formé) donne une liste vide ou `null`, jamais une erreur.

| Fonction | Paramètres | Rend |
|---|---|---|
| `listShows(filtres)` | `type`, `genre`, `mood`, `theme` (slugs d'étiquettes), `artist` (slug), `period` (`"past"` : archives, `"upcoming"` : à venir), `limit` (24 par défaut, 100 au plus), `offset`, `now` | `{ items: ShowCard[], total, limit, offset }`, du plus récent au plus ancien (à venir : du plus proche au plus lointain) |
| `getShow(slug)` | | `ShowDetail` : la vignette, plus la description, la piste SoundCloud, le créneau Radio Cult et la tracklist dans l'ordre. Ou `null` |
| `listTags({ kind, type })` | type d'étiquette, type de show | Les étiquettes portées par au moins un show publié, avec leur nombre de shows : les menus de tri |
| `listArtists({ role })` | `"resident"` ou `"guest"` | `{ total, groups: [{ letter, artists }] }` : l'index A–Z, à la française (« Éloïse » sous E), « # » pour les chiffres, à la fin |
| `getArtist(slug)` | | `ArtistDetail` : photo, bio, liens, ses shows, ses événements, les étiquettes de ses shows. Ou `null` |
| `listEvents(filtres)` | `period` (`"upcoming"` ou `"past"`, obligatoire), `category`, `limit`, `offset`, `now` | `{ items: EventCard[], total, limit, offset }` |
| `getEvent(slug)` | | `EventDetail` : description, adresse, billetterie, artistes, galerie dans l'ordre. Ou `null` |
| `getPage(slug)` | | `{ slug, title, body, updatedAt }` (Markdown). Ou `null` |
| `search(texte, { limit })` | `limit` par type (10 par défaut) | `{ query, shows, artists, events }`, les plus pertinents d'abord |

Une vignette de show (`ShowCard`) porte de quoi remplir les grilles des croquis : titre, type, date, durée, pochette, artistes et étiquettes. Les images arrivent prêtes pour `<img>` :

```ts
type Image = { url: string; width: number | null; height: number | null; alt: string; credit: string | null; srcset: string | null };
```

**La recherche** (la loupe) :

- elle travaille en français : « musique électronique » trouve « musiques électroniques » ;
- elle ignore les accents et les majuscules : « eloise » trouve « Éloïse » ;
- elle trouve les débuts de mots, comme pendant la frappe : « jaz » trouve « Jazz » ;
- un show se trouve aussi par le nom de ses artistes (pas leur bio), par ses étiquettes et par sa tracklist ;
- un événement se trouve par son lieu et ses artistes ;
- un nom fait de mots vides (« Elle & Lui ») se trouve par une comparaison simple ;
- la ponctuation tapée ne casse rien.

---

## 8. Tests et évolutions du modèle

### Les tests

```bash
npm test
npm run typecheck
```

69 tests, sur une base PGlite en mémoire : aucun compte, aucun réseau, une dizaine de secondes. Ils couvrent :

- **les migrations** : elles passent sur une base vide, et leur relance ne change rien. Chaque table publique a sa RLS et ses règles. Le schéma Drizzle et la base sont d'accord. drizzle-kit n'a plus rien à générer : une migration oubliée fait échouer le test ;
- **le seed** : il passe, se rejoue sans doublon, se retire sans toucher au reste, et marque bien tout comme exemple ;
- **les lectures** : filtres, pagination, tracklist, index A–Z, événements à venir et passés, pages ;
- **la recherche** : français, accents, débuts de mots, brouillons jamais visibles, saisies piégées ;
- **les règles d'accès**, sous des rôles simulés comme ceux de Supabase : le public, un compte sans fiche, un éditeur, un admin, le dernier admin, et l'ancienne version de `auth.uid()`.

PGlite tourne sous Postgres 18, Supabase sous Postgres 17. Pour vérifier aussi le vrai moteur de Supabase, avec ses rôles et ses droits, Docker suffit :

```bash
docker run -d --name parabole-cms-supabase -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:54329:5432 supabase/postgres:17.11.0.016
```

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres npm test
```

```bash
docker rm -f parabole-cms-supabase
```

Chaque fichier de tests y crée sa propre base, puis l'efface. Le test propre au dossier PGlite est sauté.

### Faire évoluer le modèle

1. Modifier `src/schema.ts`.
2. `npm run db:generate -- --name=ce-qui-change` : drizzle-kit écrit la migration dans `drizzle/`. La relire.
3. Une table de plus ? Ajouter ses règles d'accès et ses droits dans une migration écrite à la main, sur le modèle de `0002_acces.sql` : `npm run db:custom -- --name=acces-…`. Sans règle, la table reste fermée à tous (le test des migrations le signale).
4. `npm test`, puis `npm run db:migrate` sur Supabase.

Trois règles :

- **ne jamais modifier une migration déjà appliquée** en ligne : en ajouter une ;
- **ne jamais utiliser `drizzle-kit push`** sur Supabase : il ne connaît pas les règles d'accès écrites à la main et proposerait de les supprimer ;
- **ne pas créer de table depuis le tableau de bord** : tout passe par les migrations.

---

## 9. Ce que les écrans d'admin devront couvrir

Sous `/admin`, dans le projet Astro, rendus côté serveur, en français, pensés pour le téléphone autant que pour l'ordinateur.

### 9.1 Connexion et session

- **`/admin/connexion`** : un champ e-mail, puis « Recevoir mon lien ». Le serveur appelle `signInWithOtp` avec `shouldCreateUser: false`. Le message est le même que l'adresse soit connue ou non.
- **`/admin/auth/callback`** : échange le code du lien contre une session, gardée en cookies (`@supabase/ssr`).
- **Garde de toutes les pages `/admin`** (middleware Astro) :
  - vérifier la session côté serveur (`supabase.auth.getUser()` ou `getClaims()`) ;
  - lire la fiche `member` ;
  - sans session : renvoyer vers la connexion ; sans fiche : « Ce compte ne fait pas partie de l'équipe ».
- **Toutes les écritures** passent par des actions serveur, avec `asMember(db, user.id, tx => …)`. La RLS s'applique alors. La clé secrète ne sert jamais aux contenus.
- **Déconnexion** depuis chaque page.

### 9.2 Les écrans

| Écran | Liste | Fiche (champs) |
|---|---|---|
| **Tableau de bord** | Brouillons récents, imports Radio Cult à relire, prochains événements, contenus sans texte alternatif | — |
| **Shows** | Filtres statut, type, étiquette, artiste ; recherche ; tri par date | Titre*, slug (tiré du titre, modifiable), type*, statut, date et heure de diffusion (heure de Paris), durée, description (Markdown avec aperçu), pochette carrée (envoi et recadrage 1:1), artistes (choix multiple ordonné ; un nouvel artiste naît en brouillon), étiquettes par type (création à la volée), piste SoundCloud (adresse, puis « Retrouver la piste » : l'API de SoundCloud, `/resolve`, côté serveur, remplit l'identifiant), créneau Radio Cult (lecture seule) |
| **Tracklist** (dans la fiche du show) | — | Tableau éditable : artiste, titre, minutage (`m:ss` ou `h:mm:ss`), lien Hopper ; réordonner par glisser ; coller une tracklist en texte (« 12:30 Artiste – Titre » par ligne) ; « Trouver les liens Hopper » : `POST https://hppr.fr/api/resolve` pour chaque morceau, avec la clé partenaire. Le lien n'est gardé que si Hopper répond 200 : un lien faux est pire qu'un lien absent. L'enregistrement remplace toute la tracklist dans une transaction |
| **Artistes** | Index A–Z, filtres résident / invité, statut | Nom*, slug, rôle*, bio (Markdown), photo carrée, liens (libellé + adresse, ordonnés), statut, identifiant Radio Cult (rempli par l'import) ; ses shows |
| **Événements** | À venir / passés, catégorie, statut | Titre*, slug, catégorie*, statut, début*, fin, lieu, adresse, description, visuel, billetterie, artistes ordonnés ; galerie : envoi de plusieurs photos, ordre par glisser, légende et texte alternatif pour chacune |
| **Étiquettes** | Par type, avec leur nombre de shows | Type*, nom*, slug ; fusionner deux étiquettes (les shows de l'une passent à l'autre) |
| **Pages** | Titre, statut, date de modification | Titre*, slug*, corps (Markdown avec aperçu), statut |
| **Médiathèque** | Grille des fichiers, ceux sans texte alternatif en tête | Texte alternatif, crédit, où le fichier sert ; supprimer seulement s'il ne sert plus (et sur R2 aussi) |
| **Équipe** (admin seulement) | Nom, adresse, rôle, dernière connexion | Inviter : adresse, nom, rôle. Le serveur appelle `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })` avec la clé secrète, puis écrit la fiche `member` sous le rôle de l'admin. Changer un rôle, retirer un membre (la base garde toujours un admin) |
| **Imports Radio Cult** | Journal des imports : créés, mis à jour, laissés | — |

Pour chaque contenu : **Enregistrer** (brouillon), **Publier**, **Dépublier**, **Aperçu** (la page du site, brouillon compris, pour l'équipe seulement), **Supprimer**, avec confirmation. Publier un show exige une date de diffusion : la base refuse sinon, et l'écran doit le dire avant.

À chaque enregistrement, il faudra **invalider le cache** des pages du site touchées : la page du contenu, les listes, la page des artistes liés.

### 9.3 Envoi des images vers R2

Une fonction Vercel n'accepte pas plus de 4,5 Mo par requête. Le fichier part donc directement du navigateur vers R2 :

1. **Demande d'envoi** : `POST /admin/api/media/upload` avec le nom, le type et la taille. Le serveur vérifie le membre, le type (`image/jpeg`, `png`, `webp`, `avif`) et la taille (25 Mo au plus). Il rend une adresse signée `PUT` valable 5 minutes, vers `originaux/2026/10/<uuid>.<ext>`.
2. **Envoi** : le navigateur pose le fichier sur R2 à cette adresse. Le seau autorise `PUT` depuis les adresses de l'admin (règle CORS).
3. **Traitement** : `POST /admin/api/media/finalize`. Le serveur relit l'original et le recadre en carré si c'est une pochette ou un portrait. Il le convertit en WebP aux largeurs 400, 800 et 1600 (`sharp`), ce qui retire au passage les métadonnées, dont la position GPS. Il dépose ces versions sous `images/2026/10/<uuid>-<largeur>.webp`. Enfin il écrit la ligne `media` : clé de la plus grande version, dimensions, `variants`, type `image/webp`.
4. **Texte alternatif** : demandé à l'envoi, obligatoire avant de publier un contenu qui utilise l'image (sauf image décorative, cochée comme telle).
5. **Suppression** : retirer aussi de R2 l'original et toutes les versions.

Côté Cloudflare :

- un seau `parabole-media` ;
- le public n'y lit que `images/`, par un domaine à soi (`media.<domaine>`, la valeur de `PUBLIC_MEDIA_URL`). L'adresse `r2.dev` est limitée et ne convient qu'aux essais ;
- les originaux restent privés ;
- un jeton d'API limité à ce seau, en lecture et écriture.

### 9.4 Import quotidien de la programmation Radio Cult

- **Une tâche planifiée Vercel**, une fois par jour : le plan Hobby le permet. Dans `vercel.json` :

  ```json
  { "crons": [{ "path": "/api/cron/radiocult", "schedule": "0 5 * * *" }] }
  ```

  La route vérifie l'en-tête `Authorization: Bearer <CRON_SECRET>`.
- **Lecture** de `https://api.radiocult.fm/api/station/parabole-radio-b02d5385/schedule?startDate=…&endDate=…` : la même source que la PROGRAMMATION du site, sur les 14 jours à venir.
- **Pour chaque créneau** (`start`, `end`, `title`, `media.type`) :
  - un créneau nouveau devient un **show en brouillon** ;
  - `radiocult_event_id` reçoit l'identifiant du créneau (champ à confirmer dans la réponse de l'API) ;
  - la date vient de `start`, la durée de `end - start` ;
  - le type se déduit de `media.type` : `mix` donne `dj_set`, `playlist` donne `playlist`, `live` donne `dj_set`, à corriger à la main au besoin ;
  - le slug est tiré du titre et de la date.
- **Les artistes** du créneau se relient par `artist.radiocult_artist_id`. Un artiste inconnu est créé en brouillon.
- **L'import ne touche jamais un show publié.** Sur un brouillon déjà importé, il ne met à jour que la date et la durée, si le créneau a bougé. Un créneau disparu de Radio Cult n'est pas supprimé : il est signalé au tableau de bord.
- **Rejouable** : `radiocult_event_id` est unique, un créneau ne donne jamais deux shows.
- **Une tâche du serveur**, sans personne connectée : elle écrit avec la connexion du serveur, en propriétaire des tables, et ne crée que des brouillons. Son résumé (créés, mis à jour, laissés) va dans les journaux de Vercel et à l'écran **Imports**.

### 9.5 Les rôles dans l'admin

| | Éditeur | Admin |
|---|:-:|:-:|
| Créer, modifier, publier, supprimer shows, artistes, événements, étiquettes, pages, fichiers | ✓ | ✓ |
| Voir l'équipe | ✓ | ✓ |
| Inviter, changer de rôle, retirer un membre | | ✓ |

Les écrans masquent ce qu'un rôle ne peut pas faire, mais c'est la base qui décide : un bouton oublié ne donne aucun droit. Si l'équipe veut un jour réserver la publication aux admins, il suffit d'une migration qui change les règles `*_update` des contenus.

### 9.6 Sécurité, pour mémoire

- Afficher le Markdown sans HTML brut.
- Ne jamais envoyer au navigateur `DATABASE_URL`, `SUPABASE_SECRET_KEY` ni les clés R2.
- Garder la vérification d'origine des formulaires d'Astro (`security.checkOrigin`).
- Une session se vérifie côté serveur à chaque requête. L'identifiant passé à `asMember()` vient toujours de `supabase.auth.getUser()`, jamais d'un champ de formulaire.
