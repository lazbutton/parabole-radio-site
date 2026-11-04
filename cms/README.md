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
│   ├── radiocult/         l'import de la programmation Radio Cult et la traduction des réponses de son API
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
    member |o--o{ radiocult_import : "lancé par"

    show {
        uuid id PK
        text slug UK
        text title
        enum type "dj_set, playlist, podcast"
        enum status "draft, published"
        timestamptz broadcast_at "diffusion"
        int duration_seconds
        smallint energy "mood, 1 calme à 4 énergique"
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
    about_page {
        boolean id PK "une seule ligne"
        text description "Markdown"
        jsonb socials "libellé + adresse"
        jsonb team "rôle + nom + lien"
        jsonb credits "rôle + nom + lien"
        text contact_email
        text apply_text "Markdown"
        text apply_url "le formulaire"
        text apply_label "le bouton"
        text film_url "Vercel Blob"
        text film_poster_url "image fixe"
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
    radiocult_import {
        uuid id PK
        enum trigger "cron, manual"
        uuid member_id FK "vide : la tâche de nuit"
        timestamptz range_start
        timestamptz range_end
        int created
        int updated
        int unchanged
        text error "vide : réussi"
        jsonb report "ce qui reste à relire"
    }
```

### Les tables

| Table | Ce qu'elle garde | À savoir |
|---|---|---|
| `show` | Un épisode archivé ou à venir | Publier exige une date de diffusion. `energy` : le mood d'un DJ set ou d'une playlist, de 1 (calme) à 4 (énergique), le curseur des filtres du site (la contrainte accepte encore 5, l'ancienne échelle : lu 4 partout, `clampEnergy`). Le son est sur le compte SoundCloud de Parabole : le lecteur joue `soundcloud_track_id` (URN `soundcloud:tracks:<id>`), `soundcloud_url` mène à la piste (crédit exigé par SoundCloud). `radiocult_event_id` relie le show au créneau Radio Cult importé (l'identifiant d'un créneau seul ; « série@jour » pour une occurrence d'un créneau répété, section 9.4) |
| `track` | La tracklist d'un show | Une ligne par morceau, `position` 1, 2, 3… sans doublon. Le minutage est en secondes depuis le début du show. Le lien Hopper commence forcément par `https://hppr.fr/` |
| `artist` | Un résident ou un invité | Le rôle est celui de l'artiste (filtres Resident / Guest). `links` : une liste `[{ "label": "Instagram", "url": "…" }]`. `broadcast_group` : son groupe de diffusion, 1 ou 2 (section 9.12) |
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
| `page` | Une page de texte | Les mentions légales (`mentions-legales`, posée par la migration, écrite dans l'écran À propos)… |
| `about_page` | La page À propos (section 9.10) | Une seule ligne, posée par la migration, toujours en ligne : la description, les réseaux sociaux, l'équipe et les crédits (`[{ "role", "name", "url" }]`, le lien facultatif), l'adresse de contact, CANDIDATER (le texte, l'adresse du formulaire, le mot du bouton), et le film qu'on y lance (la vidéo, son image fixe, son titre, ce que le navigateur en a lu) |
| `background_clip` | Une vidéo du fond du site | Publiée : dans la rotation ; brouillon : mise de côté. `position` donne l'ordre de la liste, et le numéro de chaîne. Le fichier est dans le site (`public/`, les 15 clips d'origine, inscrits par la migration) ou sur Vercel Blob (envoyé depuis l'admin, section 9.7) |
| `media` | Un fichier envoyé sur Supabase Storage | Sa clé dans le seau (la plus grande version), son type, ses dimensions, son texte alternatif (vide : une image décorative), son crédit, ses versions réduites (`[{ "width": 800, "key": "…" }]`) |
| `upload_link` | Le lien d'envoi d'un artiste (section 9.12) | Un par artiste : son jeton (43 caractères, l'adresse `/envoyer/<jeton>`), qui l'a créé, sa dernière ouverture, la dernière mise à jour de sa fiche par le résident |
| `submission` | L'envoi d'un show par un résident | Un par show : qui, le lien de sa playlist, son mot pour l'équipe, le lundi du bloc visé (`block_start`) et la semaine (1, 2 ou vide) |
| `audio_file` | Un fichier son, dans le seau R2 | Le son d'un show (`main`, un seul à la fois) ou un morceau d'une playlist (`part`, avec sa place, son artiste, son titre, sa durée). Sa clé (`audio/AAAA/MM/<uuid>.<ext>`), son nom d'envoi, son poids, et où il en est : `uploading` (en route, sans show), `received`, `approved`, puis `sending`, `sent` ou `failed` pour SoundCloud |
| `broadcast_cycle` | Le calendrier des groupes | Une seule ligne : un lundi où le groupe 1 commence un bloc, la durée d'un bloc (14 jours), la deadline (15 jours avant) |
| `member` | Un membre de l'équipe | Relié à un compte Supabase Auth, avec son rôle. Jamais d'auditeurs |
| `radiocult_import` | Le journal de l'import de la programmation Radio Cult (section 9.4) | Une ligne par passage, de la tâche de nuit (`cron`) ou du bouton de l'accueil (`manual`, avec le membre) : la période lue, les shows créés, mis à jour et laissés, l'erreur s'il a échoué, et le détail (`report`) que relit l'accueil |
| `chat_author` | Un pseudo de l'antenne libre (le chat, section 9.9) | Tenu par une session anonyme du site : un jeton dans un cookie, dont la base ne garde que l'empreinte (`token_hash`). `pseudo_key`, la forme comparée, est unique. Les exclusions (`muted_until`) et le bannissement |
| `chat_message` | Un message de l'antenne | Passé à l'antenne (`visible`), en attente de la régie (`held`), refusé (`refused`) ou brouillé (`removed`). `on_air_at` : son passage, l'envoi plus le différé. Ceux de la régie portent `member_id` |
| `chat_report` | Un signalement | Un par auditeur et par message, vu ou non par la régie |
| `chat_term` | La liste de mots de la régie | Refuser, mettre en attente ou masquer ; en mot entier, ou partout (`anywhere`) |
| `chat_action` | Le journal de l'antenne | Chaque décision : des règles, des signalements, ou de la régie (le membre) |
| `chat_settings` | Les réglages de l'antenne | Une seule ligne : ouverte, mode lent, différé, mode prudent, messages au bandeau, liens, seuil de signalements, dernier vidage |

Hors de l'API, dans le schéma `private` : `chat_trace`, l'adresse IP de chaque message, gardée un an (section 9.9) ; `soundcloud_account`, le compte SoundCloud relié et ses jetons, sur une seule ligne (section 9.14).

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
| `0012_imports.sql` | drizzle-kit | Le journal de l'import Radio Cult (`radiocult_import`) et son type `import_trigger` |
| `0013_imports_acces.sql` | à la main | Ses règles d'accès : l'équipe le lit ; un membre n'y écrit que l'import qu'il lance lui-même ; personne ne le modifie ni ne le vide par l'API |
| `0014_a_propos.sql` | drizzle-kit | La page À propos (`about_page`), sur une ligne |
| `0015_a_propos_acces.sql` | à la main | Ses règles d'accès (tout le monde la lit, l'équipe la modifie, personne n'y ajoute ni n'en retire de ligne), sa ligne, reprise de la page provisoire du site, et les mentions légales (`page` « mentions-legales ») : ce qui est connu, et ce qui reste à compléter |
| `0016_envois.sql` | drizzle-kit | Les envois des résidents (section 9.12) : `upload_link`, `submission`, `audio_file`, `broadcast_cycle`, leurs types, et le groupe de diffusion des artistes |
| `0017_envois_acces.sql` | à la main | Leurs règles d'accès (l'équipe seulement ; le calendrier, un admin le modifie), un seul son actif par show, leurs déclencheurs, et le calendrier de l'agenda de l'équipe (groupe 1 à partir du 14 décembre 2026) |
| `0018_soundcloud.sql` | à la main | Le compte SoundCloud de Parabole et ses jetons (section 9.14) : `private.soundcloud_account`, une seule ligne, hors de l'API, aucun droit pour ses rôles |

---

## 3. Qui peut quoi

Postgres voit chaque visiteur sous un rôle de Supabase. La sécurité par ligne (RLS) applique les règles de `0002_acces.sql` à toutes leurs requêtes, par l'API de Supabase comme par le site.

| | Lire le publié | Lire les brouillons | Écrire les contenus | Gérer l'équipe |
|---|:-:|:-:|:-:|:-:|
| Le public (rôle `anon`) | ✓ | | | |
| Un compte sans fiche dans `member` | ✓ | | | |
| Un éditeur (`editor`) | ✓ | ✓ | ✓ | |
| Un admin (`admin`) | ✓ | ✓ | ✓ | ✓ |

« Écrire les contenus » couvre : créer, modifier, publier et supprimer les shows, les tracklists, les artistes, les événements, les étiquettes, les pages, les fichiers et les vidéos de fond ; modifier la page À propos.

Le détail des règles :

- **Les contenus** (`show`, `artist`, `event`, `page`) : le public ne voit que le publié ; l'équipe voit tout.
- **Les liens** (tracklist, artistes et étiquettes d'un show, artistes et galerie d'un événement) suivent leur contenu. Ils sont visibles quand celui-ci l'est. L'artiste en brouillon d'un show publié reste caché.
- **Les fichiers** (`media`) : le public ne voit que ceux d'un contenu publié (pochette, photo, visuel, galerie). Les autres restent à l'équipe : ceux d'un brouillon, et ceux qui ne servent pas encore.
- **Les images elles-mêmes**, dans Supabase Storage : aucune règle sur `storage.objects`. Seul le serveur y écrit, avec la clé secrète ; ni le navigateur ni la clé publiable ne peuvent y écrire ni y lister quoi que ce soit. Le public lit le seau `media` par son adresse publique (section 9.3).
- **Les étiquettes**, les filtres et leurs groupes sont publics. Les étiquettes d'un artiste ou d'un événement suivent leur contenu.
- **Les vidéos de fond** (`background_clip`) : le public ne voit que celles de la rotation (publiées) ; l'équipe voit et modifie tout.
- **La page À propos** (`about_page`) : tout le monde la lit, elle est toujours en ligne ; l'équipe la modifie. Personne n'y ajoute ni n'en retire de ligne : il n'y en a qu'une, et la base en refuse une seconde.
- **L'équipe** (`member`) : le public n'y a aucun accès. Les membres se voient entre eux ; seul l'admin ajoute, modifie ou retire un membre. La base refuse de laisser l'équipe sans admin : un admin doit en nommer un autre avant de céder sa place. Cela vaut aussi pour la suppression de son compte dans Supabase Auth. Pour une vraie remise à zéro, l'éditeur SQL peut suspendre le déclencheur le temps de l'opération (`alter table member disable trigger keep_an_admin`, puis `enable`).
- **Le journal de l'import Radio Cult** (`radiocult_import`) : l'équipe le lit ; le public n'y a aucun droit. La tâche de nuit y écrit avec la connexion du serveur ; un membre n'y écrit que l'import qu'il lance depuis l'accueil, en son nom (`trigger = 'manual'`, `member_id` = son compte). Personne ne le modifie.
- **Les envois des résidents** (`upload_link`, `submission`, `audio_file`, `broadcast_cycle`) : le public n'y a aucun droit. L'équipe lit et écrit tout, sauf le calendrier, qu'un admin seul modifie. La page d'envoi d'un résident n'a pas de compte : le serveur y écrit en propriétaire des tables, une fois le jeton du lien vérifié, et seulement pour l'artiste de ce lien (section 9.12). Les fichiers son, dans le seau R2 privé, ne se lisent que par des adresses signées par le serveur.
- **Le compte SoundCloud** (`private.soundcloud_account`) : hors de l'API, aucun rôle n'y a droit. Seul le serveur le lit et l'écrit, avec sa connexion : ses jetons publient les émissions. Un admin le relie ou le délie depuis l'accueil ; l'équipe n'en voit que le nom (section 9.14).
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
| `CRON_SECRET` | Vercel (Production) | Une longue chaîne aléatoire (16 caractères au moins, sans espace) : Vercel l'envoie à ses tâches planifiées, l'import Radio Cult de la nuit (section 9.4) et la publication du matin sur SoundCloud (9.14), qui s'en sert aussi pour se relancer. Sans elle, ces routes refusent tout ; « Importer maintenant » et « Publier maintenant » marchent quand même |
| `PUBLIC_RADIOCULT_KEY` | Vercel, `.env.local` | La clé publishable de Radio Cult (`pk_…`), en lecture seule. L'import lit avec elle les artistes de la station ; sans elle, les shows arrivent sans leurs artistes, et la fiche d'un artiste ne propose pas la liste de Radio Cult. Jamais la clé secrète |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Vercel, `.env` | Le widget Turnstile (Cloudflare) de l'antenne libre : la vérification anti-robots au premier message d'un pseudo (section 9.9). En Production seulement : le widget ne connaît que les adresses de la production, `localhost` et `127.0.0.1`. Facultatifs : sans eux (les aperçus, le développement), l'antenne marche sans cette vérification |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Vercel (Production, Preview), `.env` | L'identifiant du compte Cloudflare et le nom du seau R2 des émissions envoyées par les résidents (`parabole-sets`, section 9.12) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Vercel (Production, Preview), comme secrets ; `.env` pour essayer en local | Le jeton d'API R2 « Object Read & Write », limité à ce seau. Serveur seulement : il signe les dépôts et les lectures, vérifie les fichiers arrivés et efface ceux qui ne servent plus. Sans les quatre, la page d'envoi le dit et ne prend aucun fichier |
| `YOUTUBE_API_KEY` | Vercel, `.env`, facultatif | Une clé de l'API YouTube Data v3 (Google Cloud, gratuite), limitée à cette API : l'outil d'assemblage lit avec elle la liste d'une playlist YouTube (section 9.13). Sans elle, on colle la liste ; Deezer se lit sans clé |
| `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET` | Vercel (Production), le second comme secret ; `.env` pour essayer en local | L'appli SoundCloud de Parabole (soundcloud.com/you/apps, section 9.14). Serveur seulement : elle relie le compte de la radio, publie les émissions et lit les playlists SoundCloud de l'outil d'assemblage. Sans elles, rien ne part sur SoundCloud, et l'admin le dit |
| `R2_ENDPOINT` | `.env`, facultatif | Un autre point d'accès S3 que R2 (un MinIO local pour les essais) ; vide : `https://<compte>.r2.cloudflarestorage.com` |
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
| `listShows(filtres)` | `type`, `tags` (adresses d'étiquettes, toutes exigées ; une étiquette de groupe vaut pour tout son groupe : `"club"` trouve aussi les shows Amapiano), `energy` (`{ min, max }`, de 1 à 4), `artist` (slug), `period` (`"past"` : archives, `"upcoming"` : à venir), `limit` (24 par défaut, 100 au plus), `offset`, `now` | `{ items: ShowCard[], total, limit, offset }`, du plus récent au plus ancien (à venir : du plus proche au plus lointain) |
| `listShowMonths(filtres)` | les filtres de `listShows`, sans `limit` ni `offset` | `[{ month: "2026-05", count }]` : les mois de la liste (l'heure de Paris décide du mois), dans son ordre. Le rail des mois de la page Émissions, et la page de la liste où commence chaque mois |
| `getShow(slug)` | | `ShowDetail` : la vignette, plus la description, la piste SoundCloud, le créneau Radio Cult et la tracklist dans l'ordre ; ses artistes portent leurs liens (`links`). Ou `null` |
| `listFacets({ scope, type, all })` | ce que montre la page (`"show"`, `"artist"`, `"event"`), le type de show, `all` : garder les étiquettes sans contenu | Les menus des filtres de la page : `[{ slug, name, groups: [{ slug, name, count, tags: [{ slug, name, count }] }] }]`, filtres et groupes dans l'ordre de l'admin, étiquettes dans l'ordre alphabétique, avec leur nombre de contenus publiés (un groupe compte ceux de toutes ses étiquettes, chacun une fois) |
| `listArtists({ role, tag })` | `"resident"` ou `"guest"`, adresse d'étiquette (`"dj"`) | `{ total, groups: [{ letter, artists }] }` : l'index A–Z, à la française (« Éloïse » sous E), « # » pour les chiffres, à la fin. Chaque portrait porte ses étiquettes |
| `getArtist(slug)` | | `ArtistDetail` : photo, bio, liens, ses étiquettes, ses shows, ses événements, les étiquettes de ses shows (`showTags`). Ou `null` |
| `listEvents(filtres)` | `period` (`"upcoming"` ou `"past"`, obligatoire), `tag` (adresse d'étiquette : `"fete"`), `limit`, `offset`, `now` | `{ items: EventCard[], total, limit, offset }` ; chaque événement porte ses étiquettes, à montrer dessous |
| `getEvent(slug)` | | `EventDetail` : description, adresse, billetterie, artistes, galerie dans l'ordre. Ou `null` |
| `getPage(slug)` | | `{ slug, title, body, updatedAt }` (Markdown). Ou `null`. Sert aux mentions légales (`"mentions-legales"`) |
| `getAbout()` | | La page À propos : `{ description, socials, team, credits, contactEmail, apply: { text, url, label }, film, updatedAt }`, la description et le texte de CANDIDATER en Markdown, `film` : `{ src, type, poster, title, width, height, durationSeconds }` ou `null`. `null` si sa ligne manque (migration pas appliquée) |
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

303 tests, sur une base PGlite en mémoire : aucun compte, aucun réseau, une quinzaine de secondes. `npm test` marche aussi depuis la racine du projet. Ils couvrent :

- **les migrations** : elles passent sur une base vide, et leur relance ne change rien. Chaque table publique a sa RLS et ses règles. Le schéma Drizzle et la base sont d'accord. drizzle-kit n'a plus rien à générer : une migration oubliée fait échouer le test ;
- **le seed** : il passe, se rejoue sans doublon, se retire sans toucher au reste, et marque bien tout comme exemple ;
- **les lectures** : filtres, pagination, tracklist, index A–Z, événements à venir et passés, pages ;
- **la recherche** : français, accents, débuts de mots, brouillons jamais visibles, saisies piégées ;
- **les règles d'accès**, sous des rôles simulés comme ceux de Supabase : le public, un compte sans fiche, un éditeur, un admin, le dernier admin, et l'ancienne version de `auth.uid()`.
- **les vidéos de fond** : les clips d'origine inscrits par la migration, la liste que lit le site, les règles d'accès, puis l'ajout, le titre, la mise de côté, l'ordre, le remplacement du fichier et la suppression ;
- **les étiquettes et les filtres** : ce que la migration inscrit (filtres, groupes dans l'ordre du document, étiquettes à deux places, noms en minuscules), la reprise d'une base d'avant (rejouée sur une copie arrêtée à `0006`), la saisie des noms (liste collée en capitales), les menus du site et des listes de l'admin, puis l'ajout, le renommage, les places, l'ordre, la fusion et la suppression des étiquettes et des filtres, et leurs règles d'accès ;
- **l'admin** : la saisie vérifiée champ par champ, la tracklist collée, les minutages, l'heure de Paris aux changements d'heure ; puis, sous le rôle d'un éditeur, la création d'un show avec un artiste et une étiquette nés à la volée, la publication, la tracklist remplacée, l'enregistrement concurrent, la suppression ; et le refus d'un compte hors de l'équipe.
- **les événements dans l'admin** : la saisie vérifiée (titre et début obligatoires, fin après le début, adresse d'inscription complétée, catégorie exigée pour publier, légende d'une photo) ; puis, sous le rôle d'un éditeur, la liste dans l'ordre (à venir du plus proche, puis passés du plus récent) avec ses filtres et sa recherche, la création avec un artiste né à la volée, la publication refusée sans catégorie, l'adresse prise, l'enregistrement concurrent, le visuel, la galerie (ajout sans doublon, ordre, légende, retrait, images rendues puis effacées), la suppression qui rend ses images, et le refus d'un compte hors de l'équipe ;
- **les images** : les seaux que crée la migration (dans l'imitation du Storage de `local-supabase.ts`), le texte alternatif demandé à l'envoi, puis sous le rôle d'un éditeur l'inscription d'une image envoyée, sa place sur une fiche (photo d'un artiste, pochette d'un show) et le jeton de version rendu à l'écran, ce que le site en lit (`srcset` des versions réduites), le retrait des images qui ne servent plus (jamais les exemples), le refus d'un compte hors de l'équipe, et le retrait des exemples arrêté tant qu'une image envoyée est posée sur l'un d'eux ;
- **l'import Radio Cult** : la traduction des réponses (clé d'un créneau seul ou répété, jour de Paris, artistes, descriptions TipTap en Markdown sans HTML ni liens douteux, réseaux en liens, type du show) ; puis l'import : brouillons créés avec leurs artistes (retrouvés par leur nom, reliés, ou créés), rejoué sans doublon, brouillon qui suit son créneau et reçoit ce qui lui manque, show publié jamais réécrit mais signalé, créneau disparu signalé, occurrence d'une série passée à un autre jour, échec noté, lancement par un membre (et refus d'un compte hors de l'équipe), ce que relit l'accueil, et le lien d'une fiche à un artiste de Radio Cult ;
- **la page À propos** : sa ligne et les mentions légales posées par la migration, et une seule ligne ; la saisie vérifiée (lignes vides oubliées, réseau nommé d'après son adresse, lien vers une page du site, adresse e-mail devenue lien `mailto:`, chaque erreur à sa place) ; les règles d'accès (le public lit, n'écrit rien ; un compte hors de l'équipe non plus) ; l'enregistrement des textes et des mentions légales (recréées si elles manquent), l'enregistrement concurrent ; le film mis, son image fixe changée, remplacé et enlevé, avec les fichiers devenus inutiles ; les contraintes du film dans la base ;
- **les envois des résidents** : le calendrier des groupes (blocs, deadlines, le bloc « en retard » entre une deadline et le début de son bloc, changements d'heure) ; les fichiers refusés (format, poids) ; la page d'un lien (blocs, émissions, créneaux, étiquettes à cocher) ; les dépôts par type (un MP3 pour un set ou un podcast, des morceaux ou un lien pour une playlist), les étiquettes inconnues refusées, le remplacement d'un son, le conflit de version ; la fiche d'artiste du résident (bio, photo) ; les règles d'accès ; le rattachement aux créneaux (seul quand il n'y a qu'une paire possible, à la main sinon, refusé sur un créneau qui a déjà son émission) ; les comptes du tableau de bord et les listes qu'ils ouvrent ; la prochaine deadline et ses retardataires ; le ménage de nuit ;
- **l'assemblage des playlists** : la frise (départs, fondus raccourcis pour un morceau court), les gains à puissance constante, les silences (seuil, limite, morceau tout silencieux), la setlist minutée, le rapprochement des fichiers avec la liste (accents, « feat. », mentions de version, numéros, étiquettes, départage par la durée, manquants et fichiers en trop), la lecture de réponses types de Deezer, YouTube et SoundCloud (une longue playlist par pages) ; puis l'inscription du son assemblé (sa place, l'ancien son remplacé, la setlist en tracklist, la nouvelle version de la fiche, pas pendant un envoi vers SoundCloud) ;
- **la publication sur SoundCloud**, sans SoundCloud (un faux réseau, un faux seau) : le corps multipart à l'octet près, le PKCE (le vecteur de la RFC 7636), le compte relié et ses jetons renouvelés une seule fois chacun, les émissions du matin (validées, datées, diffusées, sans piste), l'envoi (les champs de la piste, la pochette, le jeton, la piste inscrite, la page publiée, les morceaux effacés), jamais deux envois de la même émission (sauf un envoi interrompu), l'échec noté sans nouvel essai, l'essai en privé qui laisse la page en brouillon ;
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

Puis l'**import de la programmation Radio Cult** (9.4) : chaque nuit, et à la demande depuis l'accueil, les créneaux des 14 jours à venir deviennent des shows en brouillon, reliés à leurs artistes ; l'accueil montre le dernier passage et ce qu'il reste à relire ; la fiche d'un artiste se relie à son artiste de Radio Cult dans une liste.

Puis l'écran **À propos** (`/admin/a-propos`, rubrique « Site », 9.10) : la page du site rangée comme elle s'affiche (description, réseaux sociaux, équipe, crédits, contact, candidater), les mentions légales, page à part, et le film qu'on lance depuis la page.

Puis l'écran **Événements** (`/admin/evenements`, rubrique « Contenus », 9.11) : la liste (à venir d'abord, puis les passés par mois) et la fiche, avec sa catégorie choisie à la souris, son visuel, et sa galerie, où l'on envoie plusieurs photos d'un coup, chacune avec sa légende et son texte alternatif, rangées par glisser.

Pas encore : le reste du tableau de bord (prochains événements, textes alternatifs), les pages, la médiathèque, l'équipe, « Retrouver la piste » SoundCloud, « Trouver les liens Hopper », l'aperçu sur le site et l'invalidation du cache.

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
| **Tableau de bord** | Brouillons récents, imports Radio Cult à relire ✓, prochains événements, contenus sans texte alternatif | — |
| **Shows** | Filtres statut, type, étiquette, artiste ; recherche ; tri par date | Titre*, slug (tiré du titre, modifiable), type*, statut, date et heure de diffusion (heure de Paris), durée, description (Markdown, écrite dans un petit éditeur visuel), pochette carrée (envoi et recadrage 1:1), artistes (choix multiple ordonné ; un nouvel artiste naît en brouillon), étiquettes filtre par filtre, à la souris (section 9.8 ; une étiquette hors des filtres se tape dans « Autres »), mood de 1 à 5, piste SoundCloud (adresse, puis « Retrouver la piste » : l'API de SoundCloud, `/resolve`, côté serveur, remplit l'identifiant), créneau Radio Cult (lecture seule) |
| **Tracklist** (dans la fiche du show) | — | Tableau éditable : artiste, titre, minutage (`m:ss` ou `h:mm:ss`), lien Hopper ; réordonner par glisser ; coller une tracklist en texte (« 12:30 Artiste – Titre » par ligne) ; « Trouver les liens Hopper » : `POST https://hppr.fr/api/resolve` pour chaque morceau, avec la clé partenaire. Le lien n'est gardé que si Hopper répond 200 : un lien faux est pire qu'un lien absent. L'enregistrement remplace toute la tracklist dans une transaction |
| **Artistes** | Index A–Z, filtres résident / invité, statut | Nom*, slug, rôle*, bio (Markdown), photo carrée, liens (libellé + adresse, ordonnés), statut, artiste Radio Cult (choisi dans la liste de la station, ou relié par l'import) ; ses shows |
| **Événements** ✓ | À venir (du plus proche) puis passés (par mois) ; filtres période, catégorie, statut ; recherche (titre, lieu, artistes) | Titre*, slug, catégorie (il en faut une pour publier), statut, début*, fin, lieu, adresse, description, visuel (son cadre gardé), inscription (billetterie), artistes ordonnés ; galerie : envoi de plusieurs photos d'un coup, ordre par glisser, légende et texte alternatif pour chacune (9.11) |
| **Étiquettes** ✓ | Un onglet par filtre (Thème, Genre, Géographie, Activité, Catégorie…) et « À classer » ; les groupes dans l'ordre, leurs étiquettes en pastilles avec leur nombre de contenus ; la recherche dans tous les filtres | Nom, adresse ; ses places (en ajouter, en retirer) ; fusionner avec une autre ; supprimer. Ajouter une étiquette ou une liste collée à un groupe ; ajouter, ordonner, retirer les groupes ; créer, modifier, ordonner, supprimer un filtre (section 9.8) |
| **Pages** | Titre, statut, date de modification | Titre*, slug*, corps (Markdown avec aperçu), statut. Les mentions légales, elles, s'écrivent déjà dans l'écran À propos |
| **À propos** ✓ | — | Description, réseaux sociaux, équipe, crédits, contact, candidater (texte, bouton, formulaire), mentions légales : enregistrés ensemble, toujours en ligne. Le film : envoi direct vers Vercel Blob, image fixe choisie dans le film ou envoyée, remplacer, retirer (9.10) |
| **Médiathèque** | Grille des fichiers, ceux sans texte alternatif en tête | Texte alternatif, crédit, où le fichier sert ; supprimer seulement s'il ne sert plus (et dans le Storage aussi) |
| **Équipe** (admin seulement) | Nom, adresse, rôle, dernière connexion | Ajouter : adresse, nom, rôle. Le serveur crée le compte avec la clé secrète (`supabase.auth.admin.createUser({ email, password, email_confirm: true })`, mot de passe tiré au hasard et montré une seule fois à l'admin), puis écrit la fiche `member` sous le rôle de l'admin. Plus tard, avec les e-mails : `inviteUserByEmail` à la place. Poser un nouveau mot de passe, changer un rôle, retirer un membre (la base garde toujours un admin) |
| **Envois des résidents** ✓ | Dans l'accueil : la prochaine deadline de chaque groupe (qui a envoyé, qui relancer), et « À compléter » : sons à écouter, publications SoundCloud en échec, playlists à assembler, envois sans créneau | Dans la fiche d'un artiste : son groupe et son lien d'envoi. Dans celle d'un show : l'envoi, le son (écouter, valider, télécharger, effacer), les morceaux d'une playlist, et le rattachement à un créneau (9.12) |
| **Imports Radio Cult** ✓ | Dans l'accueil : le dernier passage (créés, mis à jour, laissés), ce qu'il reste à relire, « Importer maintenant ». Le journal entier est dans `radiocult_import` | — |
| **Vidéos de fond** ✓ | Cartes dans l'ordre de la liste : image, numéro de chaîne, titre, durée, cadre, poids ; celles mises de côté en gris | Titre (sur place), dans la rotation ou de côté, monter et descendre ; ajouter et remplacer (envoi direct vers Vercel Blob, 9.7), supprimer avec confirmation |

Pour chaque contenu : **Enregistrer** (brouillon), **Publier**, **Dépublier**, **Aperçu** (la page du site, brouillon compris, pour l'équipe seulement), **Supprimer**, avec confirmation. Publier un show exige une date de diffusion : la base refuse sinon, et l'écran doit le dire avant.

À chaque enregistrement, il faudra **invalider le cache** des pages du site touchées : la page du contenu, les listes, la page des artistes liés.

### 9.3 Envoi des images vers Supabase Storage

Fait (novembre 2026) pour la photo d'un artiste, la pochette d'un show, le visuel d'un événement et sa galerie (9.11). Le visuel et les photos gardent leur cadre (`shape: "free"`) : une affiche en hauteur reste entière.

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

Fait (novembre 2026). Radio Cult décide de ce qui passe à l'antenne, et quand ; l'admin, de la façon de le présenter. L'import fait le lien : chaque créneau de la grille de Radio Cult devient un show en brouillon, que l'équipe complète (pochette, description, étiquettes, puis la tracklist et le son après la diffusion) et publie. Un créneau n'est jamais saisi deux fois.

**Quand.**

- **Chaque nuit**, par une tâche planifiée de Vercel, une fois par jour comme le permet le plan Hobby (`vercel.json`) :

  ```json
  { "crons": [{ "path": "/api/cron/radiocult", "schedule": "0 5 * * *" }] }
  ```

  Vers 6 h ou 7 h à Paris : Vercel la lance dans l'heure, sur la production seulement. La route (`src/pages/api/cron/radiocult.ts`) vérifie l'en-tête `Authorization: Bearer <CRON_SECRET>` que Vercel envoie ; sans le réglage `CRON_SECRET`, elle refuse tout.
- **À la demande**, avec « Importer maintenant » dans le bloc « Programmation Radio Cult » de l'accueil : après avoir calé la grille chez Radio Cult, les brouillons arrivent tout de suite. L'import s'écrit alors au nom de la personne connectée, sous son rôle.

**Ce qu'il lit** (`src/lib/admin/imports.ts`) : `GET /schedule?startDate=…&endDate=…`, de maintenant à dans 14 jours, la même source que la PROGRAMMATION du site ; et `GET /artists`, avec la clé publishable (`PUBLIC_RADIOCULT_KEY`), pour les artistes des créneaux. Les réponses sont traduites par `src/radiocult/traduction.ts` (CMS) ; l'écriture est dans `src/radiocult/index.ts`, sans appel réseau.

**La clé d'un créneau** (`show.radiocult_event_id`). Un créneau seul garde son identifiant chez Radio Cult, même déplacé. Une occurrence d'un créneau répété n'a pas d'identifiant à elle : Radio Cult le fabrique à la lecture (`<série>-r_index-<début>`) et il change dès que la série bouge. La clé est donc la série et le jour, à Paris : `<série>@2026-11-03`. Une série avancée d'une heure garde ses shows ; une occurrence passée à un autre jour (trois jours au plus) reprend le show de sa série au lieu d'en créer un second.

**Pour chaque créneau :**

- **nouveau** : un show en brouillon. Titre et description (TipTap, traduit en Markdown) du créneau ; date de son début, durée de sa longueur ; adresse tirée du titre et du jour (`podcast-2026-11-03`) ; type tiré du créneau : un set enregistré (`mix`) ou un direct (`live`) font un DJ set, `playlist` une playlist, un titre qui dit « podcast » un podcast ;
- **ses artistes**, dans l'ordre de Radio Cult : retrouvés par `artist.radiocult_artist_id`, sinon par leur nom (sans accents ni majuscules) ou leur adresse, et la fiche trouvée est alors reliée ; sinon créés en brouillon, invités, avec leur bio et leurs liens (réseaux de Radio Cult). Un artiste sans nom chez Radio Cult est laissé de côté ; deux fiches Radio Cult du même nom (« Secri », « SECRI ») font une seule fiche ;
- **un brouillon déjà importé** suit son créneau : sa date et sa durée changent avec lui, et il reçoit les artistes et la description du créneau tant qu'il n'en a pas. Rien d'autre : le titre, la description et les artistes choisis par l'équipe restent les siens ;
- **un show publié n'est jamais réécrit** (seul son lien au créneau peut changer, quand une occurrence change de jour). S'il ne correspond plus à son créneau, l'accueil le signale : à corriger sur la fiche, ou chez Radio Cult ;
- **un créneau disparu** de Radio Cult n'est pas supprimé : son show est signalé à l'accueil.

**Rejouable** : un créneau ne donne jamais deux shows (`radiocult_event_id` est unique), et deux imports ne se croisent pas (verrou de transaction).

**Le journal** (`radiocult_import`, section 2) garde chaque passage, réussi ou non. Son résumé va aussi dans les journaux de Vercel (« Radio Cult, import (tâche de nuit) : 2 shows créés, 1 inchangé. »). L'accueil montre le dernier passage, puis ce que le dernier passage réussi demande encore, relu sur les fiches d'aujourd'hui : à corriger à la main (show publié décalé, créneau disparu), nouveaux brouillons, brouillons mis à jour, artistes créés. Une fiche corrigée, publiée ou supprimée en sort aussitôt.

**Relier un artiste** : la fiche d'un artiste propose la liste des artistes de la station (« Artiste Radio Cult ») ; un artiste déjà relié à une autre fiche y est grisé. Sans la clé publishable, ou si Radio Cult ne répond pas, le lien reste tel quel.

**Sans écriture chez Radio Cult.** La station n'a pas l'option Connect : l'API n'y écrit rien. Les créneaux, leurs artistes et les enregistrements se saisissent dans Radio Cult, le reste dans l'admin.

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

Le document « Tags et filtres site web » dit comment le site range ses contenus. La migration `0007_etiquettes_donnees.sql` en a inscrit la version du 2 novembre 2026 ; les versions suivantes s'importent depuis l'admin, à `/admin/etiquettes` (« Importer le document », plus bas), où se fait aussi tout le reste.

**Le modèle.** Une **étiquette** (`tag`) n'existe qu'une fois. Un **filtre** (`facet`) la range, pour un genre de contenu : les shows (d'un ou plusieurs types), les artistes ou les événements. Dans un filtre, des **groupes** (`tag_group`) : ce sont des étiquettes au premier niveau (Club, Caraïbes, Culture), qui se choisissent elles-mêmes sur une fiche (« Jazz », sans plus de précision) et valent, sur le site, pour toutes leurs étiquettes. Dans un groupe, des **étiquettes** (`tag_member`), dans l'ordre alphabétique. Une étiquette peut avoir plusieurs places : Amapiano est dans Genre › Club et dans Géographie › Afrique / Moyen-Orient ; un show Amapiano se trouve par les deux. Deux niveaux, pas plus : un groupe ne contient pas de groupes.

**Ce que la migration a inscrit**, d'après le document :

| Filtre | Range | Groupes | Étiquettes dans les groupes |
|---|---|---|---|
| Thème | les podcasts | Culture, Société, Musique | 17 |
| Genre | les DJ sets et les playlists | 14, de Classique à Talk, poésie, soundtracks | 82 |
| Géographie | les DJ sets et les playlists | Caraïbes, Amérique latine / Brésil, Afrique / Moyen-Orient, Asie, Europe | 228 |
| Activité | les artistes | Podcast, Playlist, DJ | — |
| Catégorie | les événements | Live session_Art ensemble, Fête, Rencontre/Talk, DJ set_On air, Événement spécial | — |

La version du 3 novembre refait Genre en 13 groupes, de Classique à Live & parole (Soul & funk, Rap & RnB, Techno, Breaks & bass music…), et range de nouvelles étiquettes dans Afrique / Moyen-Orient et dans Asie.

La lecture du document, pour s'y retrouver :

- les rubriques : ÉMISSIONS › PODCAST donne Thème (sous chaque titre, une étiquette par ligne) ; ÉMISSIONS › PLAYLIST + DJ SETS donne Genre et Géographie (« → GENRE », « → GÉOGRAPHIE »), et un autre titre à cet endroit, un nouveau filtre des DJ sets et des playlists ; RÉSIDENTS donne Activité, et ÉVÉNEMENTS, Catégorie ;
- dans les listes de genres, un passage en gras est un groupe, et les noms qui suivent sont ses étiquettes (« **HIP-HOP, R'N'B,** DRILL, RNB, RAP, TRAP » : le groupe « Hip-hop, R'n'B » et quatre étiquettes) ;
- une étiquette qui porte le nom de son groupe (SOUL dans SOUL, CLUB dans CLUB) n'est pas recopiée dedans : le groupe se choisit lui-même ;
- les noms passent des capitales du document aux minuscules, sigles et noms propres gardés (« Rap UK », « K-pop », « Folk du Rajasthan », « Techno de Détroit »), et l'accent oublié sur une capitale revient (« ELECTRONIQUE » donne « Électronique ») ;
- le mood (« calme — énergique ») n'est pas une étiquette : c'est `show.energy`, de 1 à 4 (5 avant le 4 novembre 2026) ;
- les résidents et les invités restent le rôle d'un artiste ; leur sous-filtre (podcast, playlist, DJ) est le filtre Activité ;
- la lecture s'arrête à « À propos » ou à « POUBELLE ».

Les étiquettes saisies avant la migration restent, avec leurs shows : celle qui porte une adresse du document y prend sa place et son nom ; les autres passent « à classer ». Les catégories d'événements deviennent des étiquettes : Art ensemble → Live session_Art ensemble, Parabole → Fête, Special → Événement spécial, Talk → Rencontre/Talk.

**Quand le document évolue**, tout se fait dans l'écran Étiquettes, sans migration.

**Importer le document**, le plus simple : dans Google Docs, Fichier › Télécharger › Markdown, puis « Importer le document » en haut de l'écran (`src/admin/document.ts`). L'admin montre d'abord tout ce qui changera, filtre par filtre : les groupes ajoutés ou retirés, leur ordre, les étiquettes qui entrent dans chaque groupe ou en sortent ; puis les étiquettes créées, renommées, supprimées. Rien ne change avant « Appliquer » : l'aperçu joue l'import dans une transaction, puis l'annule. Le document fait foi pour les filtres qu'il décrit, et seulement pour eux :

- une étiquette se retrouve par son adresse : elle garde ses contenus et prend le nom du document (« Pop, variété » devient « Pop & variété ») ; une casse retouchée dans l'admin reste ;
- une étiquette que le document ne nomme plus quitte ces filtres. Si elle ne sert à rien, elle est supprimée. Si elle est posée sur des contenus, elle reste, à classer, ou prend un des nouveaux noms du document en gardant ses contenus : « Detroit techno » devient « Techno de Détroit », le nom le plus proche étant proposé d'office. Rangée aussi dans un autre filtre, elle y reste ;
- un filtre que le document ne décrit pas n'est pas touché.

Ce que l'import n'a pas su lire (une rubrique inconnue, des étiquettes avant tout groupe) est signalé dans l'aperçu, sans l'arrêter. Réimporter le même document ne change rien.

**À la main**, pour une retouche :

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
- Le mood se règle de 1 à 4 pour un DJ set ou une playlist (un podcast n'en garde pas). La fiche d'un artiste montre ses filtres de la même façon (Activité : Podcast, Playlist, DJ). Les listes des shows et des artistes ont un filtre « Étiquette » (« Activité » pour les artistes) rangé comme les filtres du site ; choisir un groupe garde aussi les contenus de ses étiquettes. Le tableau de bord compte les étiquettes à classer.

**Sur le site**, les pages liront `listFacets()` pour leurs menus (section 7) et `listShows({ tags, energy })`, `listArtists({ tag })`, `listEvents({ tag })` pour leurs listes. Les pages Résidents et Événements sont construites ; la page Show ne l'est pas encore.

### 9.9 L'antenne libre (le chat)

Le chat du site, décrit en entier dans `CHAT_EN_DIRECT.md` : les messages défilent dans le bandeau, on écrit dans le bandeau, la conversation se lit sur la page 888, et la régie modère depuis l'écran **Antenne libre** (`/admin/antenne`, rubrique « Site »).

- **Le CMS** : `src/chat/forme.ts` (les contrôles du texte, sans base ni Node : aussi dans le navigateur, `@parabole/cms/antenne`), `src/chat/index.ts` (`createAntenne()` : l'état, l'historique, l'envoi et sa modération, les signalements, avec la connexion du serveur) et `src/admin/chat.ts` (l'écran de la régie, sous son rôle).
- **La diffusion** : la base envoie elle-même chaque changement sur le canal privé `chat:antenne` de Supabase Realtime (`realtime.send()`, dans les déclencheurs de `0010_antenne_acces.sql`). Les navigateurs l'écoutent avec la seule clé publiable : la règle `chat_antenne_ecoute` sur `realtime.messages` leur permet de recevoir, aucune ne leur permet d'envoyer. Rien à régler dans Supabase pour cela ; éteindre « Allow public access » (Realtime → Settings) ajoute une barrière, si rien d'autre n'utilise de canal public.
- **Les auditeurs** n'ont pas de compte : une session anonyme du site, un jeton dans un cookie (`parabole_antenne`, réservé aux routes `/api/chat`), dont la base ne garde que l'empreinte.
- **La purge** : `private.purge_chat()` retire les messages au bout de 30 jours, et le journal, la trace des adresses IP et les pseudos inactifs au bout d'un an. Si pg_cron est allumé au moment de la migration, elle passe chaque nuit ; sinon, l'allumer (Database → Extensions), puis dans l'éditeur SQL : `select cron.schedule('antenne-purge', '17 4 * * *', 'select private.purge_chat()');`.
- **Pour l'essayer en local**, il faut un Supabase avec Realtime : la recette de « L'admin en local », sans exclure `realtime` au `supabase start`. Sans `PUBLIC_SUPABASE_URL`, le site redemande l'historique toutes les 8 secondes au lieu d'écouter le canal.

### 9.10 La page À propos

La page du site (`/a-propos`), d'après le croquis du 3 novembre 2026, et son écran dans l'admin (`/admin/a-propos`, rubrique « Site »). Toute la page tient dans la table `about_page`, sur une ligne : rien n'y est en brouillon, chaque enregistrement passe sur le site en une minute environ (le cache de Vercel). Un bloc vide n'est pas montré.

**Sur le site** (`src/pages/a-propos.astro`, `src/styles/a-propos.css`, `src/scripts/a-propos.ts`) :

- en fond, l'image fixe du film (le mode photo de `background.ts`, comme la photo d'un artiste), et au centre un grand ▶, seul, sans cadre ni texte (le titre du film n'est dit qu'aux lecteurs d'écran) ; sans film, la vidéo de fond habituelle ;
- DESCRIPTION et les réseaux sociaux à droite ; L'ÉQUIPE et les CRÉDITS à gauche, en générique de fin (le rôle, des points, le nom), qui passent sous le bas du premier écran ; CONTACT et CANDIDATER (la touche jaune, qui mène au formulaire) plus bas ; tout en bas, le lien des mentions légales. Le contenu garde une marge en haut et sur les côtés, et 1 120 px de large au plus, au centre. Sur téléphone, l'un sous l'autre, ▶ posé sur l'image ;
- ▶ lance le film, avec le son, après un éclair de neige : il passe sous l'en-tête, derrière les pages. La radio lui prête le son (`preterLeSon()`, `audio.ts`) et le reprend quand il finit, qu'on le ferme ou qu'on quitte la page ; ÉCOUTER, RADIO / VIDÉO ou le casque reprennent la main et le mettent en pause. Le volume de l'en-tête règle aussi le film. La régie reste discrète : un fil d'avancée au bas de l'écran, et la durée, ❚❚ et × en petit dans le coin ; un clic sur l'image elle-même met en pause ou relance ;
- le film en marche, si la souris ne bouge plus pendant 2 s, les pages et le pointeur s'effacent ; l'en-tête et la régie restent. Ils reviennent au moindre mouvement, au doigt, à la molette ou au clavier ; un doigt posé sur la page effacée ne fait que la réveiller. En pause, rien ne s'efface. Par-dessus le film, les pages ne floutent plus l'image (un flou recalculé à chaque image ralentit le défilement).

**Les mentions légales** sont une page à part (`/mentions-legales`, la table `page`), avec un lien discret en bas de À propos. La migration en pose une première version : l'hébergeur (Vercel Inc., adresse vérifiée le 3 novembre 2026) et, à compléter, l'éditeur et la direction de la publication. Elles s'écrivent dans l'écran À propos et s'enregistrent avec la page.

**Le film** suit le chemin des vidéos de fond (9.7), dans le même magasin Vercel Blob, sous `a-propos/` :

1. On choisit la vidéo (MP4 ou WebM, 100 Mo au plus). Le navigateur la lit, puis on choisit l'image fixe en la faisant défiler (elle part à un dixième de sa durée, 10 s au plus) ; elle devient un JPEG de 1920 px de large au plus.
2. La vidéo et l'image partent directement du navigateur vers le magasin, sous des jetons que le serveur signe pour chaque fichier (`intent=ticket`). L'envoi continue si l'on change d'écran.
3. `intent=film` : le serveur vérifie que les fichiers sont dans le magasin, puis les met sur la page. L'image fixe se change à part (un autre moment du film, ou une image de l'ordinateur : `intent=poster`), le film se retire (`intent=remove-film`). Les fichiers devenus inutiles sont effacés du magasin, et seulement sous `a-propos/`.

Le film ne se charge qu'au clic sur ▶ (`preload="none"`), mais chaque lecture le télécharge sur le trafic de Vercel Blob, compté au mois et partagé avec les vidéos de fond (10 Go en Hobby, 9.7) : un film de 50 Mo vu en entier 200 fois fait 10 Go. D'où le conseil de l'écran : 720p, moins de 50 Mo. Si la page attire du monde, le film ira mieux sur Cloudflare R2 (sortie gratuite), prévu pour les sets.

### 9.11 Les événements

La rubrique du site (`/evenements` et `/evenements/<adresse>`), d'après le croquis du 3 novembre 2026, et son écran dans l'admin (`/admin/evenements`, rubrique « Contenus »). Les tables étaient prêtes depuis le début (section 2), les lectures `listEvents()` et `getEvent()` aussi.

**Sur le site** (`src/pages/evenements/`, `src/styles/evenements.css`, `src/scripts/evenement.ts`, `src/lib/evenements.ts`) :

- **La liste** pose ses affiches sur la vidéo, dans la grille des résidents : ÉVÉNEMENTS À VENIR, du plus proche au plus lointain, puis ÉVÉNEMENTS PASSÉS, du plus récent au plus ancien, par pages de 40 (`?page=2`). Une affiche, c'est un carré (le visuel, sinon la mire), puis le nom, la date et la catégorie. À venir, l'image est en couleurs, avec une pastille quand il approche (« En ce moment », qui clignote, « Aujourd'hui », « Demain ») ; passé, elle est en bichromie, comme les portraits des résidents, et retrouve ses couleurs au survol après un éclair de neige.
- **La page d'un événement** est de la famille de celle d'un artiste : son visuel prend l'antenne (le mode photo de `background.ts` ; une affiche plus haute que l'écran défile avec la page) ; en bas du premier écran, le nom en lettres creuses, la catégorie et la date ; à droite, l'encart Description, qui commence à hauteur du nom et passe sous le bas de l'écran : le texte, le lieu et son lien vers la carte (Google Maps), les artistes (vers leur page), puis INSCRIPTION, la touche jaune S'INSCRIRE et le site où elle mène, tant que l'événement n'est pas passé. Plus bas, ses photos en rangée ; une photo s'ouvre en grand, et l'on passe à la suivante avec ◂ ▸ ou les flèches du clavier, dans un éclair de neige.
- La date s'écrit à l'heure de Paris : « sam. 15 nov. · 19:00 » à venir, « 15 nov. 2025 » passé, « Du 3 au 13 octobre 2026 » sur 24 heures ou plus. Sans heure de fin, un événement reste à venir jusqu'à minuit, comme dans le CMS.
- Les rangées ÉVÉNEMENTS des pages d'artistes et la loupe (P101) mènent à la page de l'événement. Vers elle, la neige tombe dès le départ, comme vers un artiste.
- Rendue à la demande, gardée une minute par le cache de Vercel. Un événement inconnu ou en brouillon répond « Pas de signal » (404) ; une base injoignable, le carton « Interruption momentanée ».

**Dans l'admin** (`src/components/admin/EventsList.tsx`, `EventEditor.tsx`, `GalleryField.tsx` ; `cms/src/admin/events.ts`) :

- **La liste** : à venir d'abord, puis les passés par mois ; filtres période, catégorie et statut ; recherche par titre, lieu ou artiste ; d'un coup d'œil, le visuel et le nombre de photos. Les événements sont aussi dans la recherche de partout (⌘K).
- **La fiche** suit celle d'un show : la catégorie se choisit à la souris dans le filtre Catégorie (il en faut une pour publier ; « Autres » prend une étiquette qui n'y est pas, à classer), le début (obligatoire) et la fin, le lieu, l'adresse, les artistes dans l'ordre, le lien d'inscription, la description. Publiée, sa page s'ouvre depuis la barre de la fiche.
- **Le visuel** s'envoie comme la pochette d'un show, mais garde son cadre : une affiche en hauteur reste entière.
- **La galerie** change sur place, sans enregistrer la fiche. « Ajouter des photos » en prend plusieurs d'un coup (ou on les glisse) : une fenêtre les montre, chacune avec sa légende et son texte alternatif (« Photo de « … » », à préciser), et un crédit pour toutes ; elles partent l'une après l'autre (`sendImage`, le même envoi que les autres images), puis vont au bout de la galerie (`intent=photos-add`). Une photo se range par sa poignée ou son menu (`photos-order`), change de légende (`photo-caption`) ou de texte, ou se retire (`photo-remove`) : son fichier est effacé du Storage s'il ne sert plus. Supprimer l'événement efface aussi son visuel et ses photos.

Pas encore : le filtre par catégorie sur la page du site, le zapping d'un événement à l'autre, les prochains événements sur l'accueil de l'admin.

### 9.12 Les envois des résidents

Presque toutes les émissions de Parabole sont préenregistrées : les DJ sets et les podcasts en un fichier, les playlists curatées en morceaux à enchaîner. Les résidents les envoient depuis une page à eux, sans compte : `/envoyer/<jeton>`, dont l'équipe crée le lien dans la fiche de l'artiste. Les fichiers vont dans un seau **Cloudflare R2** privé (`parabole-sets`) : une fonction Vercel ne prend pas plus de 4,5 Mo par requête, Vercel Blob tient 1 Go sur l'offre Hobby (les vidéos de fond comprises), et le Storage gratuit de Supabase aussi ; R2 en garde 10 Go gratuitement, puis 0,015 $ par Go et par mois, sans frais de sortie. L'équipe écoute et valide chaque son dans l'admin, le télécharge et le charge à la main dans Radio Cult (sans l'option Connect, le site ne peut rien y écrire). La suite : l'assemblage des playlists (9.13), puis la publication sur SoundCloud, toute seule, le lendemain matin de la diffusion (9.14).

**Le rythme.** Les résidents sont en deux groupes, qui alternent à l'antenne par blocs de deux semaines, du lundi au dimanche. La deadline d'un bloc tombe le dimanche, 15 jours avant son premier jour, à minuit (heure de Paris). Un résident passe une fois par bloc, parfois deux (deux épisodes, envoyés ensemble). Le calendrier (`broadcast_cycle`) se règle une fois, par un admin, depuis l'accueil (« Calendrier ») : un lundi où le groupe 1 commence un bloc, la durée d'un bloc, la deadline ; les blocs et les deadlines s'en déduisent (`src/envois/calendrier.ts`, à l'heure de Paris, changements d'heure compris). Le groupe d'un résident se choisit dans sa fiche ; un invité n'en a pas.

**La page d'envoi** (`src/pages/envoyer/[jeton].astro`, `src/components/envoi/`, `src/pages/api/envoi/` ; `cms/src/envois/`). Sobre, aux couleurs de l'admin, dont elle reprend les briques (étiquettes par filtre, tracklist, éditeur de texte, envoi des images) :

- en haut, le prochain bloc du résident et sa deadline : « Bloc du lundi 28 déc. au dimanche 10 janv. À envoyer au plus tard le dimanche 13 déc. (dans 9 jours). » Entre la deadline et le début du bloc, ce bloc reste proposé, « en retard », à côté du suivant ;
- ses émissions : celles qu'il a envoyées, et les créneaux de la grille où il est déjà (les brouillons importés de Radio Cult, de 90 jours avant à 45 jours après), à remplir. Il corrige une émission, ou remplace son fichier, tant qu'elle n'est pas partie sur SoundCloud ;
- le formulaire : le bloc et, s'il la connaît, la semaine ; le type (DJ set, podcast ou playlist), le titre, la description, le mood (pas pour un podcast), les étiquettes des filtres de ce type (sans en créer), la pochette carrée, puis le son : un MP3 pour un set ou un podcast (750 Mo au plus, la limite de Radio Cult ; un débit sous 320 kbit/s est signalé, pas refusé), les morceaux d'une playlist (MP3, M4A, WAV, AIFF ou FLAC, 200 Mo chacun, 60 au plus, 2 Go en tout ; artiste et titre tirés du nom du fichier, rangés par glisser) et/ou le lien de la playlist ; la tracklist ; un mot pour l'équipe ;
- sa fiche d'artiste : sa bio et sa photo, enregistrées tout de suite (et en ligne si sa fiche est publiée). L'équipe voit la date de ces changements dans le bloc « Lien d'envoi » de la fiche.

L'émission devient un show **en brouillon**, sans date tant qu'elle attend son créneau, avec l'artiste du lien parmi ses artistes. La page n'est ni indexée, ni gardée en cache, et son adresse n'est transmise à aucun autre site (`Referrer-Policy: no-referrer`). Un lien inconnu ou désactivé répond 404, sans dire s'il a existé.

**Les fichiers.** Un fichier ne passe jamais par Vercel : le navigateur l'annonce (`/api/envoi/fichier` : son nom, son poids, son rôle), le serveur inscrit sa ligne (`uploading`) et signe un dépôt (PUT) pour cette seule clé et ce seul type, valable 6 heures ; le navigateur le dépose dans R2 avec sa barre de progression, deux morceaux à la fois, et retient l'onglet tant que ça part. À l'envoi du formulaire (`/api/envoi/deposer`), le serveur vérifie dans le seau que chaque fichier est arrivé en entier (HEAD, son poids réel), puis enregistre le show, l'envoi et les fichiers dans une seule transaction (`deposer`). Un son remplacé, un morceau retiré, sont effacés du seau ; un fichier jamais arrivé est oublié par la tâche de nuit au bout d'un jour. Le seau a besoin d'une règle CORS (ci-dessous) : le navigateur y dépose directement.

**Dans l'admin** (`src/components/admin/EnvoiPanels.tsx`, `Dashboard.tsx` ; `cms/src/admin/envois.ts`, `cms/src/envois/rattacher.ts`) :

- **La fiche d'un artiste** : son groupe, et le bloc « Lien d'envoi » : créer le lien, le copier pour le lui envoyer, l'ouvrir, le remplacer par un nouveau (l'ancien cesse de marcher) ou le désactiver ; quand il l'a ouvert pour la dernière fois.
- **La fiche d'un show** : le bloc « Envoi » (de qui, quand, pour quel bloc et quelle semaine, « en retard » après la deadline, le lien de la playlist, son mot) ; en tête du bloc « Son », le son reçu : le lecteur, **Valider** (de « À écouter » à « Validé »), **Télécharger** (le MP3 à charger dans Radio Cult), Effacer ; pour une playlist, les « Morceaux reçus », à télécharger un à un. L'écoute et le téléchargement passent par `/admin/api/son/<id>`, qui renvoie vers une adresse de lecture signée, valable une heure. Supprimer un show efface aussi ses fichiers du seau.
- **L'accueil** : le panneau « Envois des résidents », pour la deadline qui vient de passer (les retardataires, tant que le bloc n'a pas commencé) puis la prochaine : « 9 envois sur 14 résidents », et la liste de ceux qui n'ont rien envoyé, avec leur lien à copier pour les relancer ; dans « À compléter » : les sons à écouter, les publications SoundCloud en échec, les playlists à assembler et les envois sans créneau, chacun vers la liste des shows filtrée (`?missing=review`, `failed`, `assemble`, `slot`).
- **Le rattachement à un créneau.** Une émission envoyée avant que la grille soit faite attend dans un show provisoire. Quand son créneau est importé de Radio Cult, elle s'y rattache : le titre, la description, les étiquettes, le mood, la tracklist, la pochette, les artistes et les fichiers passent sur le show du créneau, qui garde sa date, sa durée et son créneau ; le show provisoire disparaît. Le site le fait seul, chaque nuit après l'import (dans la même tâche, `/api/cron/radiocult`) et après « Importer maintenant », quand il n'y a qu'une paire possible : un seul créneau de la même personne dans le bloc (et dans la semaine, si elle l'a dite), que nul autre envoi ne réclame. Sinon l'envoi reste dans « Envois sans créneau », et sa fiche propose les créneaux possibles (« Rattacher »).

**Mettre en place R2** (une fois) :

1. Dans Cloudflare, activer R2 et créer le seau `parabole-sets`, privé (aucun accès public, aucun domaine).
2. Dans ses réglages, la règle CORS :

   ```json
   [{ "AllowedOrigins": ["https://parabole-radio-site.vercel.app", "http://localhost:4321"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```

3. Créer un jeton d'API R2 « Object Read & Write », limité à ce seau ; noter son identifiant et son secret.
4. Poser dans Vercel (Production et Preview) `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY` (section 5).

Pas encore : les relances par e-mail avant la deadline, les semaines sans antenne dans le calendrier, les envois qu'on peut reprendre après une coupure.

### 9.13 L'assemblage des playlists

Une playlist curatée arrive en morceaux (les fichiers du curateur, dans le seau) et/ou en lien de playlist. L'équipe en fait un seul MP3, avec un fondu enchaîné entre les morceaux, et la setlist minutée en sort toute seule. Tout se passe **dans le navigateur** de la personne de l'équipe : décoder et encoder une heure de son coûterait trop de calcul aux fonctions de Vercel (4 heures par mois sur l'offre Hobby).

**Dans la fiche d'une émission « playlist »**, le bloc « Assembler la playlist » (`src/components/admin/Assembler.tsx`) :

- **les morceaux** : ceux du curateur, et ceux que l'équipe glisse depuis son ordinateur, téléchargés de son côté (un WeTransfer, ou les morceaux d'une playlist en ligne). L'outil ne télécharge rien lui-même, d'aucune plateforme ;
- **la liste**, si le curateur a donné un lien : « Lire la liste du lien » la lit sur Deezer (son API publique, sans clé) ou sur YouTube et YouTube Music (avec `YOUTUBE_API_KEY`) : titres, artistes, durées, dans l'ordre. Ailleurs, « Coller une liste » (une ligne par morceau, « Artiste – Titre »). Spotify ne se lit plus : depuis février 2026, une appli Spotify en mode développement ne lit que les playlists de son propriétaire. SoundCloud se lit avec le compte relié de la publication (9.14), liens courts `on.soundcloud.com` compris ;
- **le rapprochement** (`rapprocher`, `src/assemblage.ts`) range chaque fichier à sa place dans la liste, d'après ses étiquettes ou son nom (« 01 - Artiste - Titre.mp3 ») : il ne tient compte ni des accents, ni de « feat. », ni des mentions de version (« (Original Mix) », « - Radio Edit »), ni des numéros ; à score voisin, la durée la plus proche l'emporte. Une place sans fichier est signalée (« manquant ») et se remplit dans un menu, comme un fichier resté sans place. La setlist prend l'artiste et le titre de la liste. Sans liste, les morceaux se rangent par glisser et la setlist prend ce qui est écrit sur chaque ligne ;
- **les réglages** : le fondu enchaîné, de 0 à 10 s (3 s par défaut, raccourci pour un morceau trop court : jamais plus de la moitié d'un morceau), « Retirer les silences » au début et à la fin des morceaux (sous −60 dB, 5 s au plus de chaque côté), et « Remplacer la tracklist par la setlist minutée » (avec une confirmation si la fiche en avait une).

**« Assembler »** (`src/components/admin/assemble.ts`) : chaque morceau est lu (ceux du seau par `/admin/api/son/<id>`), décodé et ramené à 44,1 kHz stéréo (un AIFF, que Chrome et Firefox ne décodent pas, est lu à la main), débarrassé de ses silences, puis enchaîné au précédent en fondu à puissance constante (`fadeInGain`, `fadeOutGain`). Le son part par morceaux de 4 s vers l'encodeur MP3 d'un Web Worker (`assembler.worker.ts`) : LAME compilé en WebAssembly (`wasm-media-encoders` 0.7.0), en **320 kbit/s** constants. Seuls le morceau en cours et la fin du précédent restent en mémoire. Le MP3 est ensuite déposé dans le seau (une adresse signée, `assembly-ticket`), puis inscrit (`assembly-register`, après vérification dans le seau) : il devient le son de l'émission, « À écouter » puis à valider comme un son envoyé, à la place de l'ancien ; sa setlist minutée (le départ de chaque morceau : la somme des durées précédentes, moins les fondus) remplace la tracklist, et la fiche change de version. Une barre suit les étapes ; l'onglet doit rester ouvert ; « Annuler » arrête tout.

Le calcul (la frise, les fondus, les silences, la setlist, le rapprochement, la lecture des réponses de Deezer, YouTube et SoundCloud) est dans `cms/src/assemblage.ts`, sans dépendance, servi au navigateur par `@parabole/cms/assemblage`, et testé à part (`assemblage.test.ts`). Les morceaux sources restent dans le seau, jusqu'à ce que la playlist soit publiée sur SoundCloud (9.14) : ils sont alors effacés, le MP3 assemblé reste. Navigateurs : Chrome, Firefox ou Edge, sur ordinateur.

Pas encore : écouter un enchaînement avant d'assembler, harmoniser le volume des morceaux.

### 9.14 La publication sur SoundCloud

Le lendemain matin de sa diffusion, une émission validée part toute seule sur le compte SoundCloud de Parabole, puis sa page est publiée sur le site : dans les émissions, et chez ses artistes. C'est le schéma de l'équipe du 4 novembre 2026 : l'équipe écoute et valide le son, le charge dans Radio Cult pour la diffusion, et le site fait le reste. Le code : `cms/src/soundcloud/` (le compte, l'envoi), `src/lib/soundcloud.ts` (le seau, la pochette), `src/pages/admin/soundcloud/`, `src/pages/api/cron/soundcloud.ts`.

**Le compte.** Un admin le relie une fois, depuis l'accueil (panneau « SoundCloud », « Relier SoundCloud »), connecté chez SoundCloud au compte de Parabole : OAuth 2.1 avec PKCE (`/admin/soundcloud/relier`, puis le retour sur `/admin/soundcloud/retour`). Le verifier et l'état attendent dans un cookie (httpOnly, 10 minutes, sur `/admin/soundcloud` seulement). Le compte et ses jetons vont dans `private.soundcloud_account`, une seule ligne, hors de l'API. Le jeton d'accès vit une heure : le serveur le renouvelle deux minutes avant la fin, sous `FOR UPDATE`, car un jeton de renouvellement ne sert qu'une fois. « Délier » oublie le compte : plus rien ne part. Un compte retiré chez SoundCloud se relie de la même façon.

**Chaque matin**, la tâche planifiée `/api/cron/soundcloud` (`30 6 * * *` dans `vercel.json`, l'heure d'après l'import Radio Cult ; Vercel Hobby la lance dans l'heure) prend les émissions dont le son est **validé**, qui ont une date de diffusion (un créneau de la grille), dont la diffusion est finie (son début plus sa durée, deux heures si elle manque) et qui n'ont pas encore de piste SoundCloud (`aPublier`). Elles partent l'une après l'autre, de la plus ancienne à la plus récente, tant qu'il reste du temps à la fonction (200 s sur ses 300, `maxDuration`). S'il en reste, la tâche se relance elle-même (`?tour=2`, avec `CRON_SECRET`, 20 tours au plus) sans attendre la suite : chaque appel a ses 300 s. C'est surtout de l'attente réseau.

**L'envoi** (`envoyer`). Le son passe « Envoi vers SoundCloud » (`prendre` : jamais deux envois de la même émission), puis le MP3 va du seau à SoundCloud en flux, sans passer en mémoire (`POST https://api.soundcloud.com/tracks`, en multipart, de longueur exacte), avec :

- le titre et les artistes (« A & B ») ;
- la description en texte simple, suivie de la setlist minutée et du lien de sa page (`/emissions/<slug>`) ;
- les étiquettes (la première sert de genre), la date de diffusion, et le téléchargement fermé ;
- la pochette, convertie en JPEG de 2000 px au plus : SoundCloud ne prend ni le WebP ni l'AVIF du site.

Puis, dans une seule transaction : la piste est inscrite sur l'émission (`soundcloud_track_id`, `soundcloud_url`, et la durée si elle manquait), le son passe « Sur SoundCloud », la page de l'émission est publiée (en public seulement), et les morceaux d'une playlist assemblée sont effacés du seau. Le MP3 y reste.

**Un échec** (SoundCloud refuse, la connexion coupe, le seau ne répond pas) passe le son « Envoi en échec », avec sa raison dans la fiche. Il n'est pas réessayé seul : il s'affiche à l'accueil (« Publications SoundCloud en échec »). Un envoi resté en route plus de 15 minutes s'est interrompu (une fonction Vercel s'arrête au bout de 5) : « Publier maintenant » le reprend, et la tâche de nuit le passe en échec. Si SoundCloud a pris le son mais que la fiche n'a pas pu être mise à jour, l'échec donne l'adresse et l'identifiant de la piste, à reporter à la main plutôt que de l'envoyer une seconde fois.

**« Publier maintenant »**, dans le bloc « Son » de la fiche, fait la même chose tout de suite, pour un son validé, en échec ou interrompu : en public, ou en privé pour un essai (la page ne change pas). La fiche doit être enregistrée, puisque SoundCloud reçoit ce qui l'est. L'envoi part sans être attendu (`waitUntil`) ; la fiche se relit toutes les 5 secondes, puis prend la piste quand SoundCloud a répondu. On peut la quitter. Une émission sans date ne part jamais seule ; « Publier maintenant » l'envoie quand même, et sa page reste en brouillon.

**Les playlists SoundCloud** se lisent aussi avec ce compte, dans l'outil d'assemblage (9.13) : `GET /resolve` (les liens courts `on.soundcloud.com` compris), puis la playlist, par pages si elle est longue.

**Mettre en place SoundCloud** (une fois) :

1. Connecté au compte SoundCloud de Parabole, créer une appli dans « Your Apps » (`https://soundcloud.com/you/apps`), avec deux adresses de retour : `https://parabole-radio-site.vercel.app/admin/soundcloud/retour` et `http://localhost:4321/admin/soundcloud/retour`.
2. Poser `SOUNDCLOUD_CLIENT_ID` et `SOUNDCLOUD_CLIENT_SECRET` dans Vercel (Production ; le second comme secret, section 5).
3. Après la mise en ligne, à l'accueil de l'admin : « Relier SoundCloud ».
4. Pour publier chaque semaine : l'abonnement **Artist Pro**. Un compte gratuit plafonne la durée totale de son en ligne, et la pochette envoyée par l'API est réservée aux comptes Pro.
5. Premier essai : « Publier maintenant », en privé, sur une émission de test.

Pas encore : le lecteur maison du site (9.15), Mixcloud, mieux adapté aux playlists de morceaux entiers (SoundCloud repère les morceaux du commerce, et peut bloquer une telle playlist bien plus qu'un DJ set mixé).

### 9.15 Les émissions et la ligne ARCHIVE

La rubrique du site (`/emissions` et `/emissions/<adresse>`), d'après les croquis du 4 novembre 2026. Rien à changer dans la base : les shows, leurs étiquettes, leur mood et leur tracklist y étaient (section 2), et l'écran Shows de l'admin les remplit. S'y ajoutent une lecture, `listShowMonths()`, et les liens des artistes dans `getShow()`.

**La liste** (`src/pages/emissions/index.astro`, `src/scripts/emissions.ts`, `src/styles/emissions.css`, `src/lib/emissions.ts`) pose les archives sur la vidéo, dans la grille des résidents, de la plus récente à la plus ancienne :

- en haut, collés au défilement, les onglets TOUT · PODCAST · PLAYLIST · DJ SET, avec leur nombre, puis TRIER PAR : les filtres de l'admin qui valent pour ce type (Thème pour les podcasts, Genre et Géographie pour les DJ sets et les playlists, les trois pour TOUT), puis MOOD, sauf pour les podcasts ;
- une touche de TRIER PAR ouvre son panneau à droite, une page de télétexte (P210, P220…) : les groupes du filtre alignés à droite, et sous le groupe choisi ses étiquettes ; il se pose par-dessus la droite de la grille, comme sur le croquis, sans la pousser. Le mood se choisit de 1 (calme) à 5 (énergique). Tout filtre **sur place, sans recharger** : un clic allume la pastille et la grille suit aussitôt ; le panneau ne bouge pas ; chaque pastille dit combien d'émissions elle donnerait avec les autres filtres, et celles qui ne donneraient rien s'éteignent. Un groupe choisi déplie ses étiquettes ; une étiquette choisie, cliquée de nouveau, ramène à son groupe. Les filtres en service s'affichent sous TRIER PAR, avec le nombre d'émissions, en pastilles qu'on retire d'un clic, et TOUT EFFACER. Un onglet garde les filtres qui valent encore pour son type ;
- à gauche, le rail des mois (« 05.26 ») ; le premier show de chaque mois porte ce mois dans son coin. Le rail allume le mois qu'on parcourt et mène à la page où commence chaque mois ;
- une carte : la pochette en bichromie (une archive, comme un événement passé), qui retrouve ses couleurs au survol, puis la date (« 12.05.26 »), le titre, les résidents, le type et deux étiquettes ;
- toutes les archives (diffusées) sont dans la page, lues par lots de 100 : `src/scripts/emissions.ts` refait le calcul du serveur (`src/lib/emissions.ts`) dans le navigateur. Tout est dans l'adresse (`?type=dj-set&genre=soul&mood=4&trier=genre`), qui suit sans s'empiler dans l'historique : sans script, la page se rend déjà filtrée et ses pastilles sont des liens. Échap ferme le panneau. Rien ne change de place quand on filtre : la rangée du haut garde sa hauteur (la ligne du nombre d'émissions est toujours là), les touches de TRIER PAR d'un autre type et les mois du rail sans émission s'éteignent sans disparaître, et la place de la barre de défilement est gardée (`scrollbar-gutter`, `src/styles/pages.css`), comme sur toutes les rubriques, qui ne défilent plus en largeur. Au-delà de quelques centaines d'archives, il faudra repasser à des pages, ou à une lecture en JSON.

**La page d'une émission** (`src/pages/emissions/[slug].astro`) est de la famille de celle d'un événement : la pochette prend l'antenne ; en bas du premier écran, la date et la durée, le titre en lettres creuses, les résidents (vers leur page), le type (vers sa liste), les étiquettes, le mood et ▶ ÉCOUTER ; à droite, la TRACKLIST (NOM, TITRE, le lien Hopper), dont chaque minutage lance l'archive à cet endroit, et où le morceau qui passe s'allume. Sous le premier écran : la description, les réseaux des résidents, la piste sur SoundCloud, puis AUTRES ÉMISSIONS en rangée (celles du premier résident d'abord, puis les plus récentes du même type). Sans tracklist (un podcast n'en a pas forcément), la description monte dans l'encart de droite (`src/components/emissions/Description.astro`). Les rangées ÉMISSIONS des pages d'artistes et la loupe (P101) y mènent.

**La ligne ARCHIVE** (`src/components/TopBar.astro`, `src/scripts/archive.ts`, `src/styles/archive.css`) est la troisième ligne de l'en-tête, jaune, sous la ligne ON AIR. Elle apparaît quand une émission est en main : celle de la page qu'on regarde (prête à jouer), ou celle qu'on écoute, qui continue d'une page à l'autre. On y trouve son nom (vers sa page), ▶, l'avancée (l'onde de la piste, qu'on fait glisser), le volume (celui du site, partagé avec la ligne ON AIR), −30 / +30, SoundCloud ↗ et ×. Une émission jamais lancée part avec sa page ; × ferme la ligne. L'en-tête grandit d'autant (`--archive-h`) : les pages commencent dessous, et JUSTE AVANT comme la loupe (P101) se déplient sous elle.

- **Le son** vient du lecteur intégré de SoundCloud, piloté par son API JavaScript (`https://w.soundcloud.com/player/api.js`), sans clé : il suffit de l'identifiant de la piste, celui de la fiche du show. Le lecteur ne se charge qu'au premier ▶ (rien ne part chez SoundCloud avant), dans un cadre minuscule et invisible de l'en-tête, jamais déplacé ; une autre émission s'y charge à la place. Le lecteur entièrement maison prévu (le flux de l'API dans notre propre `<audio>`, avec hls.js) attend l'application SoundCloud de la radio (l'abonnement Artist Pro, partie C de l'envoi des sets) : il remplacera `lecteurPour()` sans changer la ligne.
- **Un navigateur qui exige un toucher dans le lecteur lui-même** (l'iPhone) : sans son au bout de 5 s, le lecteur de SoundCloud se montre sous la ligne, en page de télétexte, le temps de ce premier toucher ; la ligne reprend ensuite la main. Pas encore essayé sur un vrai iPhone.
- **Les conditions de SoundCloud** (API Terms of Use, relues le 4 novembre 2026) : créditer l'auteur (le titre et les résidents de la ligne), citer SoundCloud comme source, et un lien visible vers la page de la piste (SoundCloud ↗ dans la ligne, « La piste sur SoundCloud » sur la page). Toutes les archives sont sur le compte de Parabole.
- **Le direct et l'archive ne jouent jamais ensemble** : l'archive emprunte le son (`preterLeSon()`, `audio.ts`, qui compte maintenant ses emprunteurs : le film d'À propos et l'archive) et le rend quand on ferme la ligne ou que l'émission finit ; le direct reprend alors s'il jouait. ▶ ON AIR, RADIO / VIDÉO ou le casque reprennent la main : l'archive se met en pause. Le film d'À propos et l'archive se mettent en pause l'un l'autre.
- Une piste introuvable (un identifiant faux) : « Introuvable sur SoundCloud » dans la ligne, et « Indisponible » sur la page. Un show sans piste montre « Bientôt en écoute ».

Rendues à la demande, gardées une minute par le cache de Vercel. Une émission inconnue ou en brouillon répond « Pas de signal » (404) ; une base injoignable, le carton « Interruption momentanée ».

Pas encore : le zapping d'une émission à l'autre, reprendre une émission là où on l'avait laissée, le lecteur maison (avec l'application SoundCloud).

### 9.16 Les retours du 4 novembre 2026 sur l'admin

Notes de l'équipe sur l'admin en ligne, appliquées sans changer la base (aucune migration) :

- **Barre latérale** rangée comme le schéma : Contenus (Émissions, Résidents, Événements, À propos), Filtres (Émissions, Résidents, Événements, À classer), Site (Vidéos de fond, Antenne libre). Les adresses ne changent pas (`/admin/shows`, `/admin/artistes`) ; « shows » devient « émissions » dans tous les textes.
- **Filtres** (`/admin/etiquettes`) : une rubrique par contenu (`src/components/admin/rubriques.ts`, `?rubrique=residents` ouvre son premier filtre). Pour les émissions, « Podcast » (Thème) puis « Playlist + DJ sets » (Genre, Géographie et l'onglet Mood, qui explique l'échelle).
- **Accueil** : plus de boutons « Nouvel artiste » et « Nouveau show » (on crée depuis la rubrique, ou ⌘K) ; « Brouillons à reprendre » rejoint « À compléter », qui compte aussi les émissions diffusées sans pochette, sans description ou sans étiquette ; la note périmée sur les pages du site est partie.
- **Émissions** : les pastilles Statut et À compléter côte à côte ; À compléter propose aussi « sans pochette », « sans description », « sans étiquette » (`lacksCover`, `lacksDescription`, `lacksTags`) ; la colonne « Contenu » devient « À compléter » et dit ce qui manque. Un podcast sans tracklist ne manque de rien (`lacksTracklist`).
- **Fiche d'une émission** : le mood passe à 4 crans (`ENERGY.max`), sur le site aussi ; un 5 déjà enregistré se lit 4 et s'enregistre 4 à la prochaine sauvegarde.
- **Fiche d'un résident** : « Ses émissions » dans la colonne principale ; « Lien de la page » et « Fiche Radio Cult » expliquent ce qu'ils font.
- **Événements** : deux parties titrées, « À venir » et « Passés » (par mois), et un menu « … » au bout de chaque ligne : Modifier, Supprimer (confirmé).
- **Antenne libre** : messages au bandeau, mode lent, différé et liens ne se règlent plus ici ; ils gardent leur valeur en base. Restent : ouverte ou fermée, mode prudent, signalements.
