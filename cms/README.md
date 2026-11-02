# CMS de Parabole Radio

Le CMS maison de Parabole Radio. L'équipe y saisit les **shows** (DJ sets, playlists, podcasts) et leur tracklist, les **artistes** (résidents et invités), les **événements**, les **pages** simples, et les **étiquettes** qui les rangent dans les filtres du site. Le site les lit.

Ce dossier en pose la base :

- le **modèle de données**, en Drizzle, et ses migrations ;
- la **base** Postgres de Supabase et ses **règles d'accès** (RLS) ;
- les **comptes de l'équipe** : Supabase Auth, adresse et mot de passe pour commencer, deux rôles ;
- les **fonctions de lecture** dont le site a besoin, typées ;
- un **jeu d'exemples** et des **tests** qui tournent sans compte Supabase ;
- les **lectures et écritures de l'admin** (`src/admin/`) : la saisie vérifiée champ par champ, puis écrite sous le rôle de la personne connectée.

Les écrans d'administration (`/admin`) sont dans le projet Astro. La section 9 dit ce qu'ils doivent couvrir, et ce qui est déjà fait.

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
│   ├── admin/             les lectures et écritures de l'admin, et la vérification des saisies
│   ├── labels.ts          libellés français pour l'admin
│   ├── slug.ts            slugify(), isSlug()
│   ├── paris.ts           l'heure de Paris (champs date et heure de l'admin)
│   ├── tracklist.ts       minutages et tracklist collée en texte (aussi dans le navigateur)
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
    artist ||--o{ artist_tag : ""
    tag ||--o{ artist_tag : ""
    event ||--o{ event_tag : ""
    tag ||--o{ event_tag : ""
    facet ||--o{ tag_group : "groupes"
    tag ||--o{ tag_group : ""
    tag_group ||--o{ tag_member : "étiquettes"
    tag ||--o{ tag_member : ""
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
        smallint energy "mood, 1 calme à 5 énergique"
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
        text name
        text slug UK
    }
    show_tag {
        uuid show_id PK
        uuid tag_id PK
    }
    artist_tag {
        uuid artist_id PK
        uuid tag_id PK
    }
    event_tag {
        uuid event_id PK
        uuid tag_id PK
    }
    facet {
        uuid id PK
        text slug UK
        text name
        enum scope "show, artist, event"
        enum show_types "types de shows, vide : tous"
        text description
        int position "1, 2, 3…"
    }
    tag_group {
        uuid facet_id PK
        uuid tag_id PK "le groupe"
        int position "1, 2, 3…"
    }
    tag_member {
        uuid facet_id PK
        uuid group_id PK
        uuid tag_id PK
    }
    event {
        uuid id PK
        text slug UK
        text title
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
        text key UK "clé dans le seau media"
        text mime_type
        bigint size_bytes
        int width
        int height
        text alt "texte alternatif"
        text credit
        jsonb variants "versions réduites"
    }
    background_clip {
        uuid id PK
        text title
        text video_url UK "public/ ou Vercel Blob"
        text poster_url "image d'attente"
        int position "1, 2, 3…"
        enum status "draft, published"
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
| `show` | Un épisode archivé ou à venir | Publier exige une date de diffusion. `energy` : le mood d'un DJ set ou d'une playlist, de 1 (calme) à 5 (énergique), le curseur des filtres du site. Le son est sur le compte SoundCloud de Parabole : le lecteur joue `soundcloud_track_id` (URN `soundcloud:tracks:<id>`), `soundcloud_url` mène à la piste (crédit exigé par SoundCloud). `radiocult_event_id` relie le show au créneau Radio Cult importé |
| `track` | La tracklist d'un show | Une ligne par morceau, `position` 1, 2, 3… sans doublon. Le minutage est en secondes depuis le début du show. Le lien Hopper commence forcément par `https://hppr.fr/` |
| `artist` | Un résident ou un invité | Le rôle est celui de l'artiste (filtres Resident / Guest). `links` : une liste `[{ "label": "Instagram", "url": "…" }]` |
| `show_artist` | Les artistes d'un show | Dans l'ordre d'affichage (« A b2b B ») |
| `tag` | Une étiquette | Un genre (Amapiano), une région (Caraïbes), un thème (Cinéma), une activité (DJ), une catégorie d'événement (Fête). Une adresse par étiquette, quelle que soit sa place. Sans place dans un filtre, elle est « à classer » |
| `facet` | Un filtre du site | Thème (podcasts), Genre et Géographie (DJ sets et playlists), Activité (artistes), Catégorie (événements). `scope` : ce qu'il range ; `show_types` : pour les shows, les types concernés (vide : tous) ; `position` : l'ordre de l'admin et du site |
| `tag_group` | Un groupe d'un filtre | Une étiquette au premier niveau d'un filtre (Club dans Genre), dans l'ordre de `position`. Elle se choisit elle-même sur une fiche et vaut, sur le site, pour tout son groupe |
| `tag_member` | Une étiquette dans un groupe | Amapiano dans Club. Une étiquette peut avoir plusieurs places (Amapiano est aussi dans Afrique / Moyen-Orient) ; jamais dans son propre groupe. Retirer un groupe de son filtre en retire ses étiquettes |
| `show_tag` | Les étiquettes d'un show | |
| `artist_tag` | Les étiquettes d'un artiste | Ce qu'il fait : podcast, playlist, DJ |
| `event_tag` | Les étiquettes d'un événement | Sa catégorie : Live session_Art ensemble, Fête, Rencontre/Talk, DJ set_On air, Événement spécial |
| `event` | Un événement | Sa catégorie est une étiquette (`event_tag`). Sans heure de fin, il reste « à venir » jusqu'à minuit, heure de Paris |
| `event_artist` | Les artistes d'un événement | Dans l'ordre d'affichage |
| `event_photo` | La galerie d'un événement | Dans l'ordre de défilement, avec une légende |
| `page` | Une page de texte | À propos (`a-propos`), mentions légales… |
| `background_clip` | Une vidéo du fond du site | Publiée : dans la rotation ; brouillon : mise de côté. `position` donne l'ordre de la liste, et le numéro de chaîne. Le fichier est dans le site (`public/`, les 15 clips d'origine, inscrits par la migration) ou sur Vercel Blob (envoyé depuis l'admin, section 9.7) |
| `media` | Un fichier envoyé sur Supabase Storage | Sa clé dans le seau (la plus grande version), son type, ses dimensions, son texte alternatif (vide : une image décorative), son crédit, ses versions réduites (`[{ "width": 800, "key": "…" }]`) |
| `member` | Un membre de l'équipe | Relié à un compte Supabase Auth, avec son rôle. Jamais d'auditeurs |
| `chat_author` | Un pseudo de l'antenne libre (le chat, section 9.9) | Tenu par une session anonyme du site : un jeton dans un cookie, dont la base ne garde que l'empreinte (`token_hash`). `pseudo_key`, la forme comparée, est unique. Les exclusions (`muted_until`) et le bannissement |
| `chat_message` | Un message de l'antenne | Passé à l'antenne (`visible`), en attente de la régie (`held`), refusé (`refused`) ou brouillé (`removed`). `on_air_at` : son passage, l'envoi plus le différé. Ceux de la régie portent `member_id` |
| `chat_report` | Un signalement | Un par auditeur et par message, vu ou non par la régie |
| `chat_term` | La liste de mots de la régie | Refuser, mettre en attente ou masquer ; en mot entier, ou partout (`anywhere`) |
| `chat_action` | Le journal de l'antenne | Chaque décision : des règles, des signalements, ou de la régie (le membre) |
| `chat_settings` | Les réglages de l'antenne | Une seule ligne : ouverte, mode lent, différé, mode prudent, messages au bandeau, liens, seuil de signalements, dernier vidage |

Hors de l'API, dans le schéma `private` : `chat_trace`, l'adresse IP de chaque message, gardée un an (section 9.9).

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
| `0003_stockage.sql` | à la main | La description de la table `media` : Supabase Storage plutôt que Cloudflare R2 |
| `0004_fond.sql` | drizzle-kit | La table `background_clip` des vidéos de fond |
| `0005_fond_acces.sql` | à la main | Ses règles d'accès, ses droits, son déclencheur, et les 15 clips d'origine |
| `0006_etiquettes.sql` | drizzle-kit | Les filtres (`facet`), les groupes et leurs étiquettes (`tag_group`, `tag_member`), les étiquettes des artistes et des événements, le mood des shows (`show.energy`) |
| `0007_etiquettes_donnees.sql` | à la main | Leurs règles d'accès, puis le document « Tags et filtres site web » : 5 filtres, 30 groupes, 351 étiquettes. Et la reprise de l'existant : une étiquette par adresse (un genre et un mood « ambient » n'en font plus qu'une), les catégories d'événements en étiquettes |
| `0008_etiquettes_fin.sql` | drizzle-kit | Retire ce qui ne sert plus : le type d'une étiquette (`tag.kind`), la catégorie d'un événement (`event.category`) |
| `0009_antenne.sql` | drizzle-kit | Les tables de l'antenne libre, le chat |
| `0010_antenne_acces.sql` | à la main | Leurs règles d'accès (l'équipe seulement), la trace des adresses IP, la diffusion par la base sur le canal Realtime, la règle de réception sur `realtime.messages`, la purge |
| `0011_seaux.sql` | à la main | Les seaux du Storage pour les images (section 9.3) : `originaux`, privé, et `media`, public, avec leurs limites. Aucune règle sur `storage.objects`. Rien à faire sur une base sans Storage |

---

## 3. Qui peut quoi

Postgres voit chaque visiteur sous un rôle de Supabase. La sécurité par ligne (RLS) applique les règles de `0002_acces.sql` à toutes leurs requêtes, par l'API de Supabase comme par le site.

| | Lire le publié | Lire les brouillons | Écrire les contenus | Gérer l'équipe |
|---|:-:|:-:|:-:|:-:|
| Le public (rôle `anon`) | ✓ | | | |
| Un compte sans fiche dans `member` | ✓ | | | |
| Un éditeur (`editor`) | ✓ | ✓ | ✓ | |
| Un admin (`admin`) | ✓ | ✓ | ✓ | ✓ |

« Écrire les contenus » couvre : créer, modifier, publier et supprimer les shows, les tracklists, les artistes, les événements, les étiquettes, les pages, les fichiers et les vidéos de fond.

Le détail des règles :

- **Les contenus** (`show`, `artist`, `event`, `page`) : le public ne voit que le publié ; l'équipe voit tout.
- **Les liens** (tracklist, artistes et étiquettes d'un show, artistes et galerie d'un événement) suivent leur contenu. Ils sont visibles quand celui-ci l'est. L'artiste en brouillon d'un show publié reste caché.
- **Les fichiers** (`media`) : le public ne voit que ceux d'un contenu publié (pochette, photo, visuel, galerie). Les autres restent à l'équipe : ceux d'un brouillon, et ceux qui ne servent pas encore.
- **Les images elles-mêmes**, dans Supabase Storage : aucune règle sur `storage.objects`. Seul le serveur y écrit, avec la clé secrète ; ni le navigateur ni la clé publiable ne peuvent y écrire ni y lister quoi que ce soit. Le public lit le seau `media` par son adresse publique (section 9.3).
- **Les étiquettes**, les filtres et leurs groupes sont publics. Les étiquettes d'un artiste ou d'un événement suivent leur contenu.
- **Les vidéos de fond** (`background_clip`) : le public ne voit que celles de la rotation (publiées) ; l'équipe voit et modifie tout.
- **L'équipe** (`member`) : le public n'y a aucun accès. Les membres se voient entre eux ; seul l'admin ajoute, modifie ou retire un membre. La base refuse de laisser l'équipe sans admin : un admin doit en nommer un autre avant de céder sa place. Cela vaut aussi pour la suppression de son compte dans Supabase Auth. Pour une vraie remise à zéro, l'éditeur SQL peut suspendre le déclencheur le temps de l'opération (`alter table member disable trigger keep_an_admin`, puis `enable`).
- **L'antenne libre** (`chat_*`) : le public n'y a aucun droit, pas même en lecture. Le serveur y écrit en propriétaire, après la modération (`src/chat/`), et la base diffuse elle-même ce qui passe à l'antenne. L'équipe, la régie, lit tout et modère sous son rôle ; elle n'écrit au journal et n'écrit à l'antenne qu'en son propre nom.
- **Droits des rôles** : Supabase donne d'office tous les droits aux rôles de son API. La migration les réduit : `anon` ne fait que lire, et personne ne vide une table par l'API (`TRUNCATE` échappe à la RLS).
- **Fonctions des règles** (`private.team_role()`, `private.is_admin()`…) : elles vivent dans le schéma `private`, que l'API de Supabase ne publie pas.

**Comment le site lit.** Le serveur se connecte en propriétaire des tables, que la RLS laisse passer. Chaque lecture prend donc, le temps de sa transaction, le rôle `anon` (`asPublic()`, dans `src/access.ts`). Les requêtes filtrent aussi le publié elles-mêmes : deux barrières plutôt qu'une. Les écrans d'admin écriront de même sous le rôle de la personne connectée (`asMember()`).

**Les comptes.** La connexion est réservée à l'équipe : pour l'instant par adresse et mot de passe, plus tard par lien magique (section 4.3). Les inscriptions restent fermées dans Supabase : un compte n'existe que si un admin l'a créé. Un compte sans fiche dans `member` n'a pas plus de droits que le public. Les auditeurs n'ont jamais de compte : My Parabole garde ses favoris dans le navigateur.

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

**Pour l'instant : adresse et mot de passe, sans aucun e-mail.** Envoyer des e-mails demande un domaine vérifié chez un service d'envoi (Resend…), que Parabole n'a pas encore. En attendant, l'admin crée les comptes avec un mot de passe, et rien ne part par e-mail.

1. **Authentication → Sign In / Providers** :
   - **Email** activé, avec **Confirm email** ;
   - **Allow new users to sign up** : **désactivé**. Personne ne crée de compte seul : l'admin le fait.
2. **Authentication → URL Configuration** :
   - **Site URL** : l'adresse du site (aujourd'hui `https://parabole-radio-site.vercel.app`) ;
   - **Redirect URLs** : `https://parabole-radio-site.vercel.app/admin/**`, `http://localhost:4321/admin/**`, plus celles des aperçus Vercel si l'admin doit y marcher (`https://parabole-radio-site-*-lazbuttons-projects.vercel.app/admin/**`). Inutiles pour le mot de passe, elles serviront au lien magique.
3. **Authentication → Attack Protection** : un mot de passe d'au moins 12 caractères.

Côté écrans d'admin, la connexion appellera `supabase.auth.signInWithPassword({ email, password })`. Un mot de passe oublié ne se réinitialise pas par e-mail : un admin en pose un nouveau (tableau de bord, ou écran Équipe).

**Plus tard : le lien magique**, quand un domaine sera vérifié dans Resend. Rien ne change dans la base :

1. Resend : ajouter le domaine (région Europe), poser ses enregistrements DNS, créer une clé d'API limitée à l'envoi.
2. **Authentication → Emails → SMTP Settings** : hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe la clé d'API, expéditeur `admin@<domaine>`, nom « Parabole Radio ». Le service intégré de Supabase ne suffit pas : il n'écrit qu'aux membres de l'organisation Supabase, et quelques fois par heure seulement.
3. **Authentication → Emails → Templates** : traduire **Magic Link** (« Ton lien pour entrer dans l'admin de Parabole ») et **Invite user** (« Tu es invité·e dans l'équipe de Parabole Radio »).
4. L'écran de connexion appelle alors `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`. Avec `shouldCreateUser: false`, une adresse inconnue ne reçoit rien et ne crée aucun compte.

### 4.4 Appliquer les migrations

Depuis un ordinateur, avec la chaîne **Session pooler**. Le CMS est un paquet de l'espace de travail npm du site : `npm install`, à la racine du projet, l'installe aussi. Les commandes `db:*` se lancent depuis `cms/` :

```bash
npm install
cd cms
```

```bash
DATABASE_URL="postgresql://postgres.<ref>:<mot-de-passe>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres" npm run db:migrate
```

On peut aussi mettre `DATABASE_URL` dans `cms/.env` (jamais versionné), puis lancer `npm run db:migrate`. Les migrations déjà passées sont sautées : on peut relancer sans risque.

Vérifier ensuite dans le tableau de bord :

- **Table Editor** : les tables sont là, chacune avec la RLS activée ;
- **Storage** : les seaux `originaux` (privé) et `media` (public), créés par `0011_seaux.sql` (section 9.3) ;
- **Advisors → Security Advisor** : aucune erreur.

Pour suivre les migrations, Drizzle tient le schéma `drizzle` (table `__drizzle_migrations`).

### 4.5 Nommer le premier admin

1. **Authentication → Users → Add user → Create new user** : son adresse, un mot de passe, et **Auto Confirm User** coché. Aucun e-mail ne part.
2. **SQL Editor** :

```sql
insert into public.member (user_id, email, name, role)
select id, email, 'Prénom', 'admin' from auth.users where email = 'adresse@exemple.fr';
```

Les membres suivants se créent de la même façon (rôle `editor` ou `admin`), puis depuis l'écran **Équipe** de l'admin (section 9). Le mot de passe se transmet par un canal sûr (Signal, de vive voix), jamais par un message en clair laissé dans une boîte mail.

### 4.6 Des exemples en ligne (facultatif)

Pour essayer le site sur la vraie base avec le jeu d'exemples :

```bash
npm run db:seed -- --distant
```

Tout y est marqué comme exemple. Pour tout retirer, et rien d'autre :

```bash
npm run db:seed -- --distant --supprimer
```

Une image envoyée depuis l'admin et posée sur un exemple (la photo d'un artiste, la pochette d'un show) arrête la commande, qui ne retire alors rien : elle n'efface que des lignes de la base, et les fichiers de l'image resteraient dans le Storage. Elle nomme chaque fiche concernée. Retirer ces images depuis l'admin, ou supprimer leurs fiches depuis l'admin, qui efface aussi les fichiers ; puis relancer la commande. Le jeu neuf (`npm run db:seed -- --distant`) s'arrête de même, puisqu'il commence par retirer l'ancien. Une fiche d'exemple devenue vraie garde sa place si son adresse sur le site ne commence plus par `exemple-`.

---

## 5. Variables d'environnement

Le modèle est dans `cms/.env.example`. Les variables `PUBLIC_*` peuvent aller dans le navigateur ; **les autres restent sur le serveur**. En local, le site lit le `.env` de la racine ; les scripts du CMS (`db:migrate`, `db:seed`), celui de `cms/`. L'admin se sert de la clé secrète pour les envois d'images (section 9.3) ; elle servira aussi à l'écran Équipe.

| Variable | Où | Valeur |
|---|---|---|
| `DATABASE_URL` | Vercel (Production, Preview) | Chaîne **Transaction pooler** (port 6543), avec le mot de passe |
| `DATABASE_URL` | `cms/.env`, en local | Chaîne **Session pooler** (port 5432), pour `db:migrate`. Vide : base locale PGlite |
| `PUBLIC_SUPABASE_URL` | Vercel, `.env` | `https://<ref>.supabase.co` (Project Settings → Data API) |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel, `.env` | Clé publiable `sb_publishable_…` (Project Settings → API Keys ; l'ancienne clé `anon` fait le même travail) |
| `SUPABASE_SECRET_KEY` | Vercel (Production, Preview), comme secret ; `.env` pour essayer l'envoi en local | Clé secrète `sb_secret_…` (Project Settings → API Keys ; l'ancienne `service_role` marche aussi) : sert à écrire dans le Storage, et servira à créer les comptes de l'équipe, rien d'autre. Sans elle, l'admin n'envoie aucune image et le dit dans les fiches |
| `PUBLIC_MEDIA_URL` | Vercel, `.env` | Adresse publique du seau `media` : `https://<ref>.supabase.co/storage/v1/object/public/media`. Les envois passent par `SUPABASE_SECRET_KEY` |
| `BLOB_READ_WRITE_TOKEN` | Vercel (posé en reliant le magasin Blob au projet) ; `.env` pour essayer l'envoi en local | Le jeton du magasin Vercel Blob `parabole-fond`, celui des vidéos de fond (section 9.7). Serveur seulement : il signe les envois du navigateur et efface les fichiers devenus inutiles. Sans lui, l'admin gère la liste des vidéos mais n'en envoie aucune |
| `CRON_SECRET` | Vercel | Une longue chaîne aléatoire : protège l'import quotidien Radio Cult |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Vercel, `.env` | Le widget Turnstile (Cloudflare) de l'antenne libre : la vérification anti-robots au premier message d'un pseudo (section 9.9). En Production seulement : le widget ne connaît que les adresses de la production, `localhost` et `127.0.0.1`. Facultatifs : sans eux (les aperçus, le développement), l'antenne marche sans cette vérification |
| `PGLITE_DIR` | `.env`, facultatif | Autre dossier pour la base locale (par défaut `cms/.pglite`) |

Sur Vercel, sans `DATABASE_URL`, `connect()` s'arrête avec un message clair : il n'y a pas de disque durable pour PGlite.

---

## 6. Travailler en local

Pas besoin de compte Supabase pour les données. À la racine du projet, puis dans `cms/` :

```bash
npm install
cd cms
npm run db:migrate
npm run db:seed
```

- `db:migrate` crée la base locale dans `cms/.pglite`, que Git ignore. C'est un vrai Postgres, avec les rôles, le schéma `auth` et les droits de Supabase recréés (`src/local-supabase.ts`). Les règles d'accès s'y appliquent comme en ligne.
- `db:seed` écrit le jeu d'exemples : 9 shows (dont un brouillon), 16 morceaux, 8 artistes (dont un brouillon), 7 événements, 11 étiquettes, 2 pages, 15 fichiers. On peut le relancer : il remplace les exemples sans toucher au reste.
- `db:seed -- --supprimer` retire les exemples, sauf si une image envoyée depuis l'admin est posée sur l'un d'eux (section 4.6).

**Les exemples.** Tout y est inventé et marqué :

- les titres et les noms finissent par « (exemple) » ;
- les slugs commencent par `exemple-` ;
- les clés de fichiers commencent par `exemples/`. Ces fichiers n'existent pas dans le Storage : le site doit supporter une image absente.

Les dates partent du jour du seed. Un événement à venir le reste donc.

**Une seule base locale à la fois.** PGlite ouvre `cms/.pglite` pour un seul processus. Arrêter le serveur de développement avant `db:seed`, ou l'inverse.

### L'admin en local

La connexion passe par Supabase Auth, que PGlite ne fournit pas. Avec la seule base PGlite, l'admin s'ouvre, mais un compte connecté n'y trouve pas sa fiche d'équipe (« Ce compte ne fait pas partie de l'équipe »). Deux façons de travailler :

- **Sur le projet en ligne.** Dans le `.env` de la racine : `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DATABASE_URL` (Session pooler). On travaille alors sur la vraie base : ce qu'on y crée existe pour de bon.
- **Sur un Supabase local**, sans rien toucher en ligne. Il faut Docker et la CLI Supabase. Dans un dossier hors du dépôt, `supabase init`, puis dans `supabase/config.toml`, comme en ligne : `[auth] enable_signup = false` et `minimum_password_length = 12`. Laisser `[auth.email] enable_signup = true` : à `false`, il coupe toute connexion par e-mail, pas seulement les inscriptions. Ensuite :

  ```bash
  supabase start -x realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor,mailpit
  ```

  La commande affiche l'adresse (`http://127.0.0.1:54321`), la clé publiable et la base (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Avec cette base en `DATABASE_URL` : `npm run db:migrate`, puis `npm run db:seed -- --distant`. Les comptes se créent par l'API d'administration d'Auth, avec la clé secrète locale, et leur fiche `member` en SQL (section 4.5). Pour y brancher le site, mettre ces trois valeurs dans `.env.development.local`, à la racine : `npm run dev` les préfère au `.env`.

  **Pour essayer l'envoi des images**, garder le Storage : retirer `storage-api` de la liste `-x` (`imgproxy` peut rester dehors), le démarrer avant `db:migrate`, qui crée les seaux, et ajouter la clé secrète locale (`SUPABASE_SECRET_KEY`) aux trois valeurs. Les images vont alors dans le Storage local.

---

## 7. Lire depuis le site

Le projet Astro importe ce dossier comme un paquet de l'espace de travail npm : `"workspaces": ["cms"]` dans le `package.json` de la racine, puis `import … from "@parabole/cms"`. Vite compile directement les sources TypeScript. Un module à part, `@parabole/cms/tracklist`, sert aussi dans le navigateur : il ne tire ni la base ni Node.

La base s'ouvre une fois par instance du serveur, à la première requête qui en a besoin (`src/lib/cms.ts` du site, `database()`) : rien ne s'y connecte pendant la construction.

```astro
---
// Projet Astro, une page rendue à la demande
import { createReader } from "@parabole/cms";
import { database } from "../lib/cms";

export const prerender = false;
const cms = createReader(await database(), { mediaBaseUrl: import.meta.env.PUBLIC_MEDIA_URL });
const genre = Astro.url.searchParams.get("genre");
const { items, total } = await cms.listShows({ type: "dj_set", tags: genre ? [genre] : [], period: "past" });
const menus = await cms.listFacets({ scope: "show", type: "dj_set" }); // Genre, Géographie : les menus des filtres
---
```

Les écrans d'admin, eux, ne créent rien : la garde (`src/middleware.ts`) laisse dans `Astro.locals.admin` les fonctions de `createAdmin()`, liées à l'identifiant de la session vérifiée.

Toutes les lectures se font sous le rôle `anon`, en lecture seule. Elles ne voient donc que le publié. Une valeur lue dans une adresse et inconnue (type, catégorie, slug mal formé) donne une liste vide ou `null`, jamais une erreur.

| Fonction | Paramètres | Rend |
|---|---|---|
| `listShows(filtres)` | `type`, `tags` (adresses d'étiquettes, toutes exigées ; une étiquette de groupe vaut pour tout son groupe : `"club"` trouve aussi les shows Amapiano), `energy` (`{ min, max }`, de 1 à 5), `artist` (slug), `period` (`"past"` : archives, `"upcoming"` : à venir), `limit` (24 par défaut, 100 au plus), `offset`, `now` | `{ items: ShowCard[], total, limit, offset }`, du plus récent au plus ancien (à venir : du plus proche au plus lointain) |
| `getShow(slug)` | | `ShowDetail` : la vignette, plus la description, la piste SoundCloud, le créneau Radio Cult et la tracklist dans l'ordre. Ou `null` |
| `listFacets({ scope, type, all })` | ce que montre la page (`"show"`, `"artist"`, `"event"`), le type de show, `all` : garder les étiquettes sans contenu | Les menus des filtres de la page : `[{ slug, name, groups: [{ slug, name, count, tags: [{ slug, name, count }] }] }]`, filtres et groupes dans l'ordre de l'admin, étiquettes dans l'ordre alphabétique, avec leur nombre de contenus publiés (un groupe compte ceux de toutes ses étiquettes, chacun une fois) |
| `listArtists({ role, tag })` | `"resident"` ou `"guest"`, adresse d'étiquette (`"dj"`) | `{ total, groups: [{ letter, artists }] }` : l'index A–Z, à la française (« Éloïse » sous E), « # » pour les chiffres, à la fin. Chaque portrait porte ses étiquettes |
| `getArtist(slug)` | | `ArtistDetail` : photo, bio, liens, ses étiquettes, ses shows, ses événements, les étiquettes de ses shows (`showTags`). Ou `null` |
| `listEvents(filtres)` | `period` (`"upcoming"` ou `"past"`, obligatoire), `tag` (adresse d'étiquette : `"fete"`), `limit`, `offset`, `now` | `{ items: EventCard[], total, limit, offset }` ; chaque événement porte ses étiquettes, à montrer dessous |
| `getEvent(slug)` | | `EventDetail` : description, adresse, billetterie, artistes, galerie dans l'ordre. Ou `null` |
| `getPage(slug)` | | `{ slug, title, body, updatedAt }` (Markdown). Ou `null` |
| `search(texte, { limit })` | `limit` par type (10 par défaut) | `{ query, shows, artists, events }`, les plus pertinents d'abord |
| `listBackgroundClips()` | | Les vidéos de fond de la rotation, dans l'ordre de la liste : `[{ src, title, poster }]` |

Une vignette de show (`ShowCard`) porte de quoi remplir les grilles des croquis : titre, type, date, durée, mood, pochette, artistes et étiquettes. Les images arrivent prêtes pour `<img>` :

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

195 tests, sur une base PGlite en mémoire : aucun compte, aucun réseau, une quinzaine de secondes. `npm test` marche aussi depuis la racine du projet. Ils couvrent :

- **les migrations** : elles passent sur une base vide, et leur relance ne change rien. Chaque table publique a sa RLS et ses règles. Le schéma Drizzle et la base sont d'accord. drizzle-kit n'a plus rien à générer : une migration oubliée fait échouer le test ;
- **le seed** : il passe, se rejoue sans doublon, se retire sans toucher au reste, et marque bien tout comme exemple ;
- **les lectures** : filtres, pagination, tracklist, index A–Z, événements à venir et passés, pages ;
- **la recherche** : français, accents, débuts de mots, brouillons jamais visibles, saisies piégées ;
- **les règles d'accès**, sous des rôles simulés comme ceux de Supabase : le public, un compte sans fiche, un éditeur, un admin, le dernier admin, et l'ancienne version de `auth.uid()`.
- **les vidéos de fond** : les clips d'origine inscrits par la migration, la liste que lit le site, les règles d'accès, puis l'ajout, le titre, la mise de côté, l'ordre, le remplacement du fichier et la suppression ;
- **les étiquettes et les filtres** : ce que la migration inscrit (filtres, groupes dans l'ordre du document, étiquettes à deux places, noms en minuscules), la reprise d'une base d'avant (rejouée sur une copie arrêtée à `0006`), la saisie des noms (liste collée en capitales), les menus du site et des listes de l'admin, puis l'ajout, le renommage, les places, l'ordre, la fusion et la suppression des étiquettes et des filtres, et leurs règles d'accès ;
- **l'admin** : la saisie vérifiée champ par champ, la tracklist collée, les minutages, l'heure de Paris aux changements d'heure ; puis, sous le rôle d'un éditeur, la création d'un show avec un artiste et une étiquette nés à la volée, la publication, la tracklist remplacée, l'enregistrement concurrent, la suppression ; et le refus d'un compte hors de l'équipe.
- **les images** : les seaux que crée la migration (dans l'imitation du Storage de `local-supabase.ts`), le texte alternatif demandé à l'envoi, puis sous le rôle d'un éditeur l'inscription d'une image envoyée, sa place sur une fiche (photo d'un artiste, pochette d'un show) et le jeton de version rendu à l'écran, ce que le site en lit (`srcset` des versions réduites), le retrait des images qui ne servent plus (jamais les exemples), le refus d'un compte hors de l'équipe, et le retrait des exemples arrêté tant qu'une image envoyée est posée sur l'un d'eux ;
- **l'antenne libre** : les contrôles du texte (mots déguisés, faux positifs, liens déguisés, coordonnées, forme, pseudos) ; l'envoi et sa modération (pseudo pris ou réservé, changements de pseudo, liste de mots, mode lent, débit par personne et par adresse, doublons, différé, mode prudent, Turnstile, sanctions automatiques) ; les signalements ; les actions de la régie ; ce que la base diffuse (un faux `realtime.send()` le note) ; les règles d'accès ; la trace des adresses IP et la purge.

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

**Où on en est.** Première tranche faite (novembre 2026) : tout le 9.1 (connexion, garde, déconnexion, mot de passe), les écrans **Shows** (liste, fiche, tracklist collée et réordonnée) et **Artistes** (index A–Z, fiche), avec Enregistrer, Publier, Dépublier et Supprimer. Ces écrans forment une application React (Radix Themes) : on passe de l'un à l'autre sans recharger la page, la recherche et les filtres s'appliquent en direct, une fiche modifiée retient la navigation ; la connexion garde le style du site. Les écritures passent par `createAdmin()` (`src/admin/`), sous le rôle de la personne connectée ; un enregistrement fait par quelqu'un d'autre entre-temps est signalé avant d'être remplacé.

Puis l'interface a été refondue : barre latérale, recherche de partout (⌘K, `/admin/recherche`), mode sombre, filtres en pastilles, fiches au titre en grand avec leurs actions dans une barre, tracklist en feuille de calcul (Entrée, Alt+↑ ↓), et un petit éditeur Tiptap pour les descriptions et les bios, qui enregistre du Markdown (l'aperçu à part a disparu). Le tableau de bord montre les prochaines diffusions et ce qui manque : les shows déjà diffusés sans tracklist ou sans son, les artistes sans photo ou sans bio (`overview()`, et le filtre `missing` des listes, pour que le nombre annoncé soit celui de la liste où l'on arrive).

Puis l'écran **Étiquettes** (`/admin/etiquettes`, rubrique « Contenus », section 9.8) : les filtres du site et leurs étiquettes, tirés du document « Tags et filtres site web » ; la fiche d'un show propose ces étiquettes avec leur place et le mood (de calme à énergique), celle d'un artiste son activité (podcast, playlist, DJ).

Ensuite, l'écran **Vidéos de fond** (`/admin/videos`, rubrique « Site ») : les clips du fond du site dans l'ordre de leur liste, avec leur image, leur titre (modifiable sur place) et leur numéro de chaîne ; mettre de côté ou remettre dans la rotation, monter et descendre, voir, remplacer, supprimer, et ajouter une vidéo, qui part directement du navigateur vers Vercel Blob (9.7).

Puis l'**envoi des images** (9.3) : la photo d'un artiste et la pochette d'un show, glissées ou choisies dans leur fiche, cadrées en carré, avec leur texte alternatif et leur crédit ; elles partent directement du navigateur vers Supabase Storage, et le site les montre en versions WebP réduites.

Pas encore : le reste du tableau de bord (imports Radio Cult à relire, prochains événements, textes alternatifs), les événements (leurs étiquettes de catégorie sont prêtes dans la base ; leur visuel et leur galerie attendent leur écran, l'envoi est prêt), les pages, la médiathèque, l'équipe, les imports Radio Cult, « Retrouver la piste » SoundCloud, « Trouver les liens Hopper », l'aperçu sur le site et l'invalidation du cache.

### 9.1 Connexion et session

- **`/admin/connexion`** : adresse et mot de passe, puis « Entrer ». Le serveur appelle `signInWithPassword` ; la session est gardée en cookies (`@supabase/ssr`). En cas d'échec, un seul message, que l'adresse soit connue ou non. Plus tard, avec le lien magique : un champ e-mail, « Recevoir mon lien » (`signInWithOtp`, `shouldCreateUser: false`), et `/admin/auth/callback` qui échange le code du lien contre une session.
- **Changer son mot de passe** depuis l'admin (`supabase.auth.updateUser({ password })`), 12 caractères au moins. Le mot de passe actuel est vérifié d'abord : une session restée ouverte sur un ordinateur partagé ne suffit pas.
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
| **Shows** | Filtres statut, type, étiquette, artiste ; recherche ; tri par date | Titre*, slug (tiré du titre, modifiable), type*, statut, date et heure de diffusion (heure de Paris), durée, description (Markdown, écrite dans un petit éditeur visuel), pochette carrée (envoi et recadrage 1:1), artistes (choix multiple ordonné ; un nouvel artiste naît en brouillon), étiquettes filtre par filtre, à la souris (section 9.8 ; une étiquette hors des filtres se tape dans « Autres »), mood de 1 à 5, piste SoundCloud (adresse, puis « Retrouver la piste » : l'API de SoundCloud, `/resolve`, côté serveur, remplit l'identifiant), créneau Radio Cult (lecture seule) |
| **Tracklist** (dans la fiche du show) | — | Tableau éditable : artiste, titre, minutage (`m:ss` ou `h:mm:ss`), lien Hopper ; réordonner par glisser ; coller une tracklist en texte (« 12:30 Artiste – Titre » par ligne) ; « Trouver les liens Hopper » : `POST https://hppr.fr/api/resolve` pour chaque morceau, avec la clé partenaire. Le lien n'est gardé que si Hopper répond 200 : un lien faux est pire qu'un lien absent. L'enregistrement remplace toute la tracklist dans une transaction |
| **Artistes** | Index A–Z, filtres résident / invité, statut | Nom*, slug, rôle*, bio (Markdown), photo carrée, liens (libellé + adresse, ordonnés), statut, identifiant Radio Cult (rempli par l'import) ; ses shows |
| **Événements** | À venir / passés, catégorie, statut | Titre*, slug, catégorie*, statut, début*, fin, lieu, adresse, description, visuel, billetterie, artistes ordonnés ; galerie : envoi de plusieurs photos, ordre par glisser, légende et texte alternatif pour chacune |
| **Étiquettes** ✓ | Un onglet par filtre (Thème, Genre, Géographie, Activité, Catégorie…) et « À classer » ; les groupes dans l'ordre, leurs étiquettes en pastilles avec leur nombre de contenus ; la recherche dans tous les filtres | Nom, adresse ; ses places (en ajouter, en retirer) ; fusionner avec une autre ; supprimer. Ajouter une étiquette ou une liste collée à un groupe ; ajouter, ordonner, retirer les groupes ; créer, modifier, ordonner, supprimer un filtre (section 9.8) |
| **Pages** | Titre, statut, date de modification | Titre*, slug*, corps (Markdown avec aperçu), statut |
| **Médiathèque** | Grille des fichiers, ceux sans texte alternatif en tête | Texte alternatif, crédit, où le fichier sert ; supprimer seulement s'il ne sert plus (et dans le Storage aussi) |
| **Équipe** (admin seulement) | Nom, adresse, rôle, dernière connexion | Ajouter : adresse, nom, rôle. Le serveur crée le compte avec la clé secrète (`supabase.auth.admin.createUser({ email, password, email_confirm: true })`, mot de passe tiré au hasard et montré une seule fois à l'admin), puis écrit la fiche `member` sous le rôle de l'admin. Plus tard, avec les e-mails : `inviteUserByEmail` à la place. Poser un nouveau mot de passe, changer un rôle, retirer un membre (la base garde toujours un admin) |
| **Imports Radio Cult** | Journal des imports : créés, mis à jour, laissés | — |
| **Vidéos de fond** ✓ | Cartes dans l'ordre de la liste : image, numéro de chaîne, titre, durée, cadre, poids ; celles mises de côté en gris | Titre (sur place), dans la rotation ou de côté, monter et descendre ; ajouter et remplacer (envoi direct vers Vercel Blob, 9.7), supprimer avec confirmation |

Pour chaque contenu : **Enregistrer** (brouillon), **Publier**, **Dépublier**, **Aperçu** (la page du site, brouillon compris, pour l'équipe seulement), **Supprimer**, avec confirmation. Publier un show exige une date de diffusion : la base refuse sinon, et l'écran doit le dire avant.

À chaque enregistrement, il faudra **invalider le cache** des pages du site touchées : la page du contenu, les listes, la page des artistes liés.

### 9.3 Envoi des images vers Supabase Storage

Fait (novembre 2026) pour la photo d'un artiste et la pochette d'un show ; le visuel et la galerie d'un événement s'y brancheront avec leur écran.

Les images vont dans le Storage du projet Supabase : pas d'autre compte. Deux seaux, créés avec leurs limites par la migration `0011_seaux.sql` (`npm run db:migrate`) :

- `originaux`, **privé** (25 Mo au plus ; `image/jpeg`, `png`, `webp`, `avif`) : les fichiers tels qu'envoyés, avec leurs métadonnées (dont la position GPS), sous `2026/11/<uuid>.<ext>` ;
- `media`, **public** (5 Mo au plus ; `image/webp`) : les versions que le site affiche, sous `images/2026/11/<uuid>-<largeur>.webp`.

Seul le serveur y écrit, avec la clé secrète (`SUPABASE_SECRET_KEY`). Il n'y a donc aucune règle RLS à poser sur `storage.objects` : sans règle, ni le navigateur ni la clé publiable ne peuvent y écrire ni y lister. Le public lit le seau `media` par son adresse publique, la valeur de `PUBLIC_MEDIA_URL` (à défaut, celle tirée de `PUBLIC_SUPABASE_URL`).

**Dans la fiche** (`src/components/admin/ImageField.tsx`), on glisse un fichier sur la zone « Photo » ou « Pochette », ou on le choisit. Une fenêtre montre l'aperçu cadré comme sur le site : en carré, on fait glisser l'image (ou on la déplace aux flèches du clavier) pour choisir ce qui reste. Le texte alternatif est déjà proposé (« Portrait de … », « Pochette de « … » »), à préciser ; le crédit est facultatif. « Envoyer » montre la progression, puis l'image prend sa place tout de suite, sans enregistrer la fiche. Une image en place se remplace (bouton, ou fichier glissé dessus), change de texte ou se retire. Une fiche pas encore créée attend son premier enregistrement.

Une fonction Vercel n'accepte pas plus de 4,5 Mo par requête. Le fichier part donc directement du navigateur vers le Storage (`src/pages/admin/api/media/[action].ts`, `src/lib/admin/storage.ts`) :

1. **Demande d'envoi** : `POST /admin/api/media/upload` avec le type et le poids. La garde vérifie le membre ; le serveur, le type (`image/jpeg`, `png`, `webp`, `avif`) et le poids (25 Mo au plus). Il rend une adresse d'envoi signée vers `originaux/2026/11/<uuid>.<ext>` (`createSignedUploadUrl`, valable 2 heures, pour ce seul fichier, sans écraser).
2. **Envoi** : le navigateur y pose le fichier, comme le ferait `uploadToSignedUrl` du client Supabase (le même `PUT` en formulaire), mais par `XMLHttpRequest`, qui donne la progression. Ni client Supabase dans le navigateur, ni règle CORS à régler.
3. **Traitement** : `POST /admin/api/media/finalize`, avec le cadrage, le texte alternatif et le crédit. Le serveur relit l'original, le tourne selon son orientation EXIF, le recadre en carré (photo, pochette) là où l'écran l'a montré, et le convertit en WebP aux largeurs 400, 800 et 1600 (`sharp`, qualité 80), ce qui retire au passage les métadonnées. Jamais d'agrandissement : une image de 1 000 px de large donne 400, 800 et 1 000 ; sous 200 px de côté, elle est refusée (l'écran le dit avant l'envoi). Il dépose ces versions dans le seau `media`, avec `cacheControl: "31536000"` : un nom de fichier ne sert qu'une fois, le CDN peut le garder un an. Enfin il écrit la ligne `media`, sous le rôle du membre : clé de la plus grande version, poids, dimensions, `variants` (les plus petites, pour le `srcset` que construit `toImage`), type `image/webp`. Un original illisible est effacé.
4. **Mise en place** : la fiche envoie l'image à sa propre adresse (`intent=photo` ou `cover`), qui prend sa place (`placeMedia`). La fiche change de version : l'écran reçoit la nouvelle, et enregistre ensuite le reste de la saisie sans fausse alerte.
5. **Texte alternatif** : demandé à l'envoi, et obligatoire, sauf pour une image décorative, cochée comme telle (son texte alternatif reste vide). Une image en place a donc toujours le sien, ou se dit décorative : publier n'a rien de plus à vérifier.
6. **Suppression** : une image qui ne sert plus (remplacée, retirée, ou dont la fiche est supprimée) disparaît, avec son original et toutes ses versions (`releaseMedia`, puis le Storage). Seulement celles envoyées depuis l'admin (`images/…`) : jamais une image qui sert encore ailleurs, ni les exemples (`exemples/…`). Le retrait des exemples (`db:seed -- --supprimer`) n'efface que des lignes : il s'arrête tant qu'une image envoyée est posée sur l'un d'eux (section 4.6).

Le module natif `sharp` (une dépendance du site) n'est chargé que pour ce traitement : les autres écrans de l'admin ne le paient pas. La fonction Vercel embarque son binaire pour Linux et la bibliothèque `libvips` qu'il charge ; s'il manquait, l'écran le dirait au lieu d'une erreur.

**Les limites de la formule gratuite** (pricing de Supabase, novembre 2026) : 1 Go de fichiers, 5 Go de trafic sortant par mois (plus 5 Go servis depuis le cache du CDN), 50 Mo par fichier. Le redimensionnement à la volée de Supabase est réservé aux formules payantes : on ne s'en sert pas, `sharp` prépare les tailles à l'envoi. Une version de 800 px pèse une centaine de Ko : le trafic suffit pour les images. Pas pour les vidéos de fond, qui pèsent plusieurs Mo chacune : elles vont sur Vercel Blob (9.7), et les clips d'origine restent dans `public/`. L'usage se suit dans Project Settings → Usage.

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
| Ajouter, changer de rôle, retirer un membre | | ✓ |

Les écrans masquent ce qu'un rôle ne peut pas faire, mais c'est la base qui décide : un bouton oublié ne donne aucun droit. Si l'équipe veut un jour réserver la publication aux admins, il suffit d'une migration qui change les règles `*_update` des contenus.

### 9.6 Sécurité, pour mémoire

- Afficher le Markdown sans HTML brut.
- Ne jamais envoyer au navigateur `DATABASE_URL` ni `SUPABASE_SECRET_KEY`.
- Garder la vérification d'origine des formulaires d'Astro (`security.checkOrigin`).
- Une session se vérifie côté serveur à chaque requête. L'identifiant passé à `asMember()` vient toujours de `supabase.auth.getUser()`, jamais d'un champ de formulaire.

### 9.7 Les vidéos de fond

Les clips qui passent au hasard derrière toutes les pages du site. Leur liste est la table `background_clip` : l'ordre (`position`, qui donne aussi le numéro de chaîne), le titre (que le site peut afficher à l'arrivée du clip, avec son numéro), la rotation (publié) ou la mise de côté (brouillon), et les adresses de la vidéo et de son image d'attente. L'écran est `/admin/videos`.

**Où sont les fichiers.**

- Les 15 clips d'origine restent dans `public/PARABOLE RADIO/VIDEO/BACKGROUND/`, livrés avec le site : Vercel les sert comme le reste (100 Go de trafic par mois en Hobby). La migration `0005_fond_acces.sql` les inscrit dans la liste. Supprimer l'un d'eux dans l'admin le retire de la liste ; son fichier reste dans le dépôt, à retirer par un commit pour alléger le site.
- Les vidéos envoyées depuis l'admin vont dans le magasin **Vercel Blob** `parabole-fond` (public, région `cdg1`, Paris), relié au projet le 1er novembre 2026 : Vercel a posé `BLOB_READ_WRITE_TOKEN` en Production, Preview et Development. Pas Supabase Storage : son trafic gratuit (5 Go par mois) est partagé avec la base et les images, et le dépasser peut restreindre tout le projet, connexion à l'admin comprise.

**L'envoi** (`src/components/admin/ClipsScreen.tsx`, `src/pages/admin/videos.astro`, `src/lib/admin/blob.ts`). Une fonction Vercel n'accepte pas plus de 4,5 Mo par requête : la vidéo part directement du navigateur vers le magasin.

1. Le navigateur lit la vidéo : sa durée, son cadre, et sa première image en JPEG (640 px de large au plus), qui devient l'image d'attente. Une vidéo qu'il ne sait pas lire est refusée : les visiteurs ne la liraient pas non plus.
2. Pour chaque fichier, l'écran demande un jeton (`intent=ticket`). Le serveur vérifie le type (MP4 ou WebM ; JPEG ou WebP pour l'image) et la taille (40 Mo au plus), tire le nom (`fond/<uuid>.mp4`) et signe un jeton valable une demi-heure pour ce seul fichier.
3. Le navigateur dépose le fichier avec `put()` de `@vercel/blob/client`, en plusieurs parties au-delà de 8 Mo, avec une barre de progression. L'envoi continue si l'on change d'écran ; fermer l'onglet demande confirmation.
4. `intent=add` (ou `replace`) : le serveur vérifie que le fichier est bien dans le magasin (`head`), garde sa taille réelle et l'inscrit à la fin de la liste, dans la rotation. Un refus efface les fichiers envoyés, un remplacement efface l'ancien, une suppression aussi. Le serveur n'efface que des fichiers de ce magasin, rangés sous `fond/`, et jamais ceux d'un clip encore dans la liste.
5. Un nom ne sert qu'une fois : navigateurs et réseau de Vercel gardent chaque fichier un an.

**Le site** lit la liste par `GET /api/fond`, celles de la rotation dans l'ordre. Vercel la garde 30 secondes, les navigateurs la redemandent à chaque visite : un changement de l'admin arrive en une minute environ. Si elle ne répond pas dans les 1,5 s du chargement, le fond démarre sur la liste de secours de `src/scripts/settings.ts` (les clips d'origine) et prend celle de l'admin dès qu'elle arrive. Un clip illisible, retiré entre-temps par exemple, cède sa place au suivant.

**Les limites de la formule Hobby** (tarifs de Vercel, septembre 2026) : 1 Go de fichiers, 10 Go de trafic Blob par mois, 10 000 opérations simples (lectures hors cache) et 2 000 avancées (envois, listes). Elles valent pour tout le compte Vercel : le magasin `lennygotchi-media`, d'un autre projet, les partage. Chaque lecture d'une vidéo compte dans le trafic, cache ou pas : une vidéo de 4 Mo vue 2 500 fois fait 10 Go. Au-delà, Vercel Blob s'arrête jusqu'à 30 jours : seules les vidéos envoyées ne se chargent plus, le fond passe aux suivantes, le site et l'admin continuent. D'où les conseils de l'écran (640 px de large, moins de 10 Mo), et la formule Pro si le site grandit. L'usage se suit dans Vercel, Storage, `parabole-fond`.

**En local**, l'envoi a besoin du jeton : `vercel env pull` l'écrit dans `.env.local`, avec d'autres réglages, à ne jamais versionner. Les envois faits en local vont dans le vrai magasin : supprimer ensuite la vidéo d'essai depuis l'admin, ce qui efface ses fichiers.

### 9.8 Les étiquettes et les filtres

Le document « Tags et filtres site web » (novembre 2026) dit comment le site range ses contenus. La migration `0007_etiquettes_donnees.sql` l'a inscrit dans la base ; la suite se fait dans l'admin, à `/admin/etiquettes`.

**Le modèle.** Une **étiquette** (`tag`) n'existe qu'une fois. Un **filtre** (`facet`) la range, pour un genre de contenu : les shows (d'un ou plusieurs types), les artistes ou les événements. Dans un filtre, des **groupes** (`tag_group`) : ce sont des étiquettes au premier niveau (Club, Caraïbes, Culture), qui se choisissent elles-mêmes sur une fiche (« Jazz », sans plus de précision) et valent, sur le site, pour toutes leurs étiquettes. Dans un groupe, des **étiquettes** (`tag_member`), dans l'ordre alphabétique. Une étiquette peut avoir plusieurs places : Amapiano est dans Genre › Club et dans Géographie › Afrique / Moyen-Orient ; un show Amapiano se trouve par les deux. Deux niveaux, pas plus : un groupe ne contient pas de groupes.

**Ce que la migration a inscrit**, d'après le document :

| Filtre | Range | Groupes | Étiquettes dans les groupes |
|---|---|---|---|
| Thème | les podcasts | Culture, Société, Musique | 17 |
| Genre | les DJ sets et les playlists | 14, de Classique à Talk, poésie, soundtracks | 82 |
| Géographie | les DJ sets et les playlists | Caraïbes, Amérique latine / Brésil, Afrique / Moyen-Orient, Asie, Europe | 228 |
| Activité | les artistes | Podcast, Playlist, DJ | — |
| Catégorie | les événements | Live session_Art ensemble, Fête, Rencontre/Talk, DJ set_On air, Événement spécial | — |

La lecture du document, pour s'y retrouver :

- dans les listes de genres, un passage en gras est un groupe, et les noms qui suivent sont ses étiquettes (« **HIP-HOP, R'N'B,** DRILL, RNB, RAP, TRAP » : le groupe « Hip-hop, R'n'B » et quatre étiquettes) ;
- une étiquette qui porte le nom de son groupe (SOUL dans SOUL, CLUB dans CLUB) n'est pas recopiée dedans : le groupe se choisit lui-même ;
- les noms passent des capitales du document aux minuscules, sigles et noms propres gardés (« UK funky », « K-pop », « Folk du Rajasthan ») ;
- le mood (« calme — énergique ») n'est pas une étiquette : c'est `show.energy`, de 1 à 5 ;
- les résidents et les invités restent le rôle d'un artiste ; leur sous-filtre (podcast, playlist, DJ) est le filtre Activité ;
- la partie « POUBELLE » et « À propos » n'ont rien donné.

Les étiquettes saisies avant la migration restent, avec leurs shows : celle qui porte une adresse du document y prend sa place et son nom ; les autres passent « à classer ». Les catégories d'événements deviennent des étiquettes : Art ensemble → Live session_Art ensemble, Parabole → Fête, Special → Événement spécial, Talk → Rencontre/Talk.

**Quand le document évolue**, tout se fait dans l'écran Étiquettes, sans migration :

- **ajouter** : dans le groupe, le champ « Ajouter… » prend un nom, ou une liste copiée du document (« AFRO HOUSE, AFROBEATS, AMAPIANO » ; une liste sur plusieurs lignes aussi) : les noms en capitales passent en minuscules, une étiquette déjà connue (même adresse, ou même nom sans accents ni majuscules) gagne une place au lieu d'être recréée ;
- **ranger ailleurs, retirer** : la fiche d'une étiquette (un clic sur sa pastille) liste ses places ; « Ranger aussi dans… » en ajoute une. Retirer une étiquette de toutes ses places la laisse sur ses contenus, « à classer » ;
- **renommer** : le nom et l'adresse. L'adresse sert aux liens des filtres du site : la changer casse ceux déjà partagés ;
- **fusionner** deux doublons (« Wassalou » et « Wassoulou ») : les contenus et les places de l'une passent à l'autre ;
- **supprimer** une étiquette, ou d'un coup celles à classer qui ne servent à rien ;
- **les groupes** : en ajouter (« Nouveau groupe… », au bas du filtre), les monter, les descendre, les retirer du filtre ;
- **les filtres** : en créer (« Nouveau filtre » : son nom, ce qu'il range, pour quels types de shows), les modifier, les ordonner, les supprimer. Ce qu'un filtre range ne change plus après sa création.

**Dans les fiches**, les étiquettes se choisissent à la souris, sans rien savoir par cœur : un bloc par filtre (`src/components/admin/FacetPicker.tsx`), ceux du type du show seulement (Genre et Géographie pour un DJ set ou une playlist, Thème pour un podcast).

- Un filtre sans sous-groupes (Activité) montre ses étiquettes en pastilles ; un petit filtre (Thème) montre chaque groupe sur sa ligne, suivi de ses étiquettes.
- Un grand filtre (Genre, Géographie) montre ses groupes ; un clic sur un groupe ouvre ses étiquettes en dessous, avec « Tout « Club » » pour choisir le groupe lui-même. Ce qui est choisi reste visible en haut, à retirer d'un clic, et une recherche trouve une étiquette dans le filtre (Entrée la coche).
- Une pastille choisie se colore ; un groupe montre combien de ses étiquettes sont choisies. Une étiquette à deux places (Amapiano) se coche dans les deux filtres à la fois.
- Une étiquette rangée seulement dans un filtre d'un autre type (un genre sur un podcast) est signalée, à retirer d'un clic. « Autres » prend une étiquette qui n'est dans aucun filtre : un nom inconnu crée une étiquette à classer.
- Le mood se règle de 1 à 5 pour un DJ set ou une playlist (un podcast n'en garde pas). La fiche d'un artiste montre ses filtres de la même façon (Activité : Podcast, Playlist, DJ). Les listes des shows et des artistes ont un filtre « Étiquette » (« Activité » pour les artistes) rangé comme les filtres du site ; choisir un groupe garde aussi les contenus de ses étiquettes. Le tableau de bord compte les étiquettes à classer.

**Sur le site**, les pages liront `listFacets()` pour leurs menus (section 7) et `listShows({ tags, energy })`, `listArtists({ tag })`, `listEvents({ tag })` pour leurs listes. Les pages Show, Résidents et Événements ne sont pas encore construites.

### 9.9 L'antenne libre (le chat)

Le chat du site, décrit en entier dans `CHAT_EN_DIRECT.md` : les messages défilent dans le bandeau, on écrit dans le bandeau, la conversation se lit sur la page 888, et la régie modère depuis l'écran **Antenne libre** (`/admin/antenne`, rubrique « Site »).

- **Le CMS** : `src/chat/forme.ts` (les contrôles du texte, sans base ni Node : aussi dans le navigateur, `@parabole/cms/antenne`), `src/chat/index.ts` (`createAntenne()` : l'état, l'historique, l'envoi et sa modération, les signalements, avec la connexion du serveur) et `src/admin/chat.ts` (l'écran de la régie, sous son rôle).
- **La diffusion** : la base envoie elle-même chaque changement sur le canal privé `chat:antenne` de Supabase Realtime (`realtime.send()`, dans les déclencheurs de `0010_antenne_acces.sql`). Les navigateurs l'écoutent avec la seule clé publiable : la règle `chat_antenne_ecoute` sur `realtime.messages` leur permet de recevoir, aucune ne leur permet d'envoyer. Rien à régler dans Supabase pour cela ; éteindre « Allow public access » (Realtime → Settings) ajoute une barrière, si rien d'autre n'utilise de canal public.
- **Les auditeurs** n'ont pas de compte : une session anonyme du site, un jeton dans un cookie (`parabole_antenne`, réservé aux routes `/api/chat`), dont la base ne garde que l'empreinte.
- **La purge** : `private.purge_chat()` retire les messages au bout de 30 jours, et le journal, la trace des adresses IP et les pseudos inactifs au bout d'un an. Si pg_cron est allumé au moment de la migration, elle passe chaque nuit ; sinon, l'allumer (Database → Extensions), puis dans l'éditeur SQL : `select cron.schedule('antenne-purge', '17 4 * * *', 'select private.purge_chat()');`.
- **Pour l'essayer en local**, il faut un Supabase avec Realtime : la recette de « L'admin en local », sans exclure `realtime` au `supabase start`. Sans `PUBLIC_SUPABASE_URL`, le site redemande l'historique toutes les 8 secondes au lieu d'écouter le canal.
