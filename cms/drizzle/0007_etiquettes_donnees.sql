-- Les étiquettes et les filtres du site (0006_etiquettes.sql) : leurs règles d'accès, puis le document « Tags et
-- filtres site web » de novembre 2026, et la reprise de ce qui existait (étiquettes typées, catégories d'événements).
--
-- Le document range les étiquettes en filtres (Thème, Genre, Géographie, Activité, Catégorie), les filtres en groupes
-- (Culture, Club, Caraïbes…), les groupes en étiquettes. Une étiquette n'existe qu'une fois, même rangée à plusieurs
-- places (Amapiano : Genre › Club et Géographie › Afrique / Moyen-Orient). Le mood (calme → énergique) n'est pas une
-- étiquette : c'est la colonne show.energy. La suite se fait dans l'admin (/admin/etiquettes).

-- 1. Règles d'accès, sur le modèle de 0002_acces.sql. ------------------------------------------------------------

-- Les filtres et leurs groupes sont publics, comme les étiquettes.
CREATE POLICY facet_select ON public.facet FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY tag_group_select ON public.tag_group FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY tag_member_select ON public.tag_member FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- Les étiquettes d'un artiste ou d'un événement suivent leur contenu : visibles quand il l'est.
CREATE POLICY artist_tag_select ON public.artist_tag FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.artist a WHERE a.id = artist_id));
--> statement-breakpoint
CREATE POLICY event_tag_select ON public.event_tag FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.event e WHERE e.id = event_id));
--> statement-breakpoint

-- Écrire : l'équipe, admin et éditeur, comme pour les autres contenus.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facet', 'tag_group', 'tag_member', 'artist_tag', 'event_tag'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_team_member()))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT private.is_team_member()))', t || '_delete', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Droits des rôles : le public ne fait que lire ; personne ne vide une table par l'API.
REVOKE ALL ON public.facet, public.tag_group, public.tag_member, public.artist_tag, public.event_tag FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.facet, public.tag_group, public.tag_member, public.artist_tag, public.event_tag TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facet, public.tag_group, public.tag_member, public.artist_tag, public.event_tag TO authenticated;
--> statement-breakpoint

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.facet FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint

-- 1 bis. Les étiquettes d'avant : une adresse par étiquette désormais. Celles qui portaient la même adresse sous deux
-- types (un genre et un mood « ambient ») n'en font plus qu'une, la plus ancienne, qui reprend les shows de l'autre.
-- Celles que le document ne connaît pas restent, sans place : « à classer » dans l'admin.
INSERT INTO public.show_tag (show_id, tag_id)
SELECT st.show_id, k.keep
FROM public.show_tag st
JOIN (SELECT id, first_value(id) OVER (PARTITION BY slug ORDER BY created_at, id) AS keep FROM public.tag) k ON k.id = st.tag_id
WHERE k.id <> k.keep
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM public.tag t
USING (SELECT id, first_value(id) OVER (PARTITION BY slug ORDER BY created_at, id) AS keep FROM public.tag) k
WHERE t.id = k.id AND k.id <> k.keep;
--> statement-breakpoint

-- 2. Les filtres, dans l'ordre du document.
INSERT INTO public.facet (slug, name, scope, show_types, position, description) VALUES
  ('theme', 'Thème', 'show', '{podcast}', 1,
    'Les sujets des podcasts, par grande famille.'),
  ('genre', 'Genre', 'show', '{dj_set,playlist}', 2,
    'Les genres des DJ sets et des playlists, par famille.'),
  ('geographie', 'Géographie', 'show', '{dj_set,playlist}', 3,
    'Les musiques des DJ sets et des playlists, par région du monde. Une étiquette peut être rangée ici et dans Genre à la fois.'),
  ('activite', 'Activité', 'artist', '{}', 4,
    'Ce que fait un résident ou un invité : le filtre de la page Résidents.'),
  ('categorie', 'Catégorie', 'event', '{}', 5,
    'Le genre d''un événement : montré sous chaque événement, et filtre des événements passés.');
--> statement-breakpoint

-- 3. Les étiquettes, chacune une seule fois, même rangée à plusieurs places. Une étiquette qui existe déjà à la même
-- adresse (« house », créée depuis la fiche d'un show) prend le nom du document et garde ses shows. La colonne « kind »
-- (genre, mood, thème) disparaît à la migration suivante : les nouvelles y prennent « genre », sans conséquence.
MERGE INTO public.tag t
USING (VALUES
  -- Thème › Culture
  ('Culture', 'culture'),
  ('Architecture', 'architecture'),
  ('Art', 'art'),
  ('Cinéma', 'cinema'),
  ('Design', 'design'),
  ('Food', 'food'),
  ('Littérature', 'litterature'),
  ('Mode', 'mode'),
  ('Photographie', 'photographie'),
  -- Thème › Société
  ('Société', 'societe'),
  ('Actualité', 'actualite'),
  ('Bien être', 'bien-etre'),
  ('Diasporas', 'diasporas'),
  ('Entreprenariat', 'entreprenariat'),
  ('Militantisme', 'militantisme'),
  ('Philosophie', 'philosophie'),
  ('Sport', 'sport'),
  -- Thème › Musique
  ('Musique', 'musique'),
  ('Actualité musicale', 'actualite-musicale'),
  ('Histoire de la musique', 'histoire-de-la-musique'),
  -- Genre › Classique
  ('Classique', 'classique'),
  -- Genre › Pop, variété
  ('Pop, variété', 'pop-variete'),
  -- Genre › Jazz
  ('Jazz', 'jazz'),
  -- Genre › Hip-hop, R'n'B
  ('Hip-hop, R''n''B', 'hip-hop-r-n-b'),
  ('Drill', 'drill'),
  ('RnB', 'rnb'),
  ('Rap', 'rap'),
  ('Trap', 'trap'),
  -- Genre › Soul
  ('Soul', 'soul'),
  ('Blues', 'blues'),
  ('Funk', 'funk'),
  ('Gospel', 'gospel'),
  ('Rhythm & blues', 'rhythm-blues'),
  -- Genre › Disco
  ('Disco', 'disco'),
  -- Genre › Rock
  ('Rock', 'rock'),
  ('Country', 'country'),
  ('Hard rock', 'hard-rock'),
  -- Genre › Metal, alternative rock
  ('Metal, alternative rock', 'metal-alternative-rock'),
  ('Indie rock', 'indie-rock'),
  ('Post punk', 'post-punk'),
  -- Genre › Ambient
  ('Ambient', 'ambient'),
  ('Experimental', 'experimental'),
  ('Spiritual', 'spiritual'),
  ('Noise', 'noise'),
  -- Genre › Électronique, downtempo
  ('Électronique, downtempo', 'electronique-downtempo'),
  ('Trip hop', 'trip-hop'),
  ('Video game music', 'video-game-music'),
  ('Soundtrack', 'soundtrack'),
  ('Library music', 'library-music'),
  -- Genre › Club
  ('Club', 'club'),
  ('Afro house', 'afro-house'),
  ('Afrobeats', 'afrobeats'),
  ('Amapiano', 'amapiano'),
  ('Baile funk', 'baile-funk'),
  ('Ballroom', 'ballroom'),
  ('Baltimore club', 'baltimore-club'),
  ('Batida', 'batida'),
  ('Coupé-décalé', 'coupe-decale'),
  ('Gqom', 'gqom'),
  ('Hyperpop', 'hyperpop'),
  ('Jersey club', 'jersey-club'),
  ('Kuduro', 'kuduro'),
  ('Kwaito', 'kwaito'),
  ('Mara', 'mara'),
  ('Ndombolo', 'ndombolo'),
  ('Nightcore', 'nightcore'),
  ('Raptor house', 'raptor-house'),
  ('Reggaeton', 'reggaeton'),
  ('Singeli', 'singeli'),
  ('Street hop', 'street-hop'),
  ('Vinahouse', 'vinahouse'),
  ('Wisisi', 'wisisi'),
  -- Genre › House / techno
  ('House / techno', 'house-techno'),
  ('Acid', 'acid'),
  ('Ambient techno', 'ambient-techno'),
  ('Bass music', 'bass-music'),
  ('Balearic house', 'balearic-house'),
  ('Breaks', 'breaks'),
  ('Broken beat', 'broken-beat'),
  ('Chicago house', 'chicago-house'),
  ('EDM', 'edm'),
  ('Deep house', 'deep-house'),
  ('Detroit house', 'detroit-house'),
  ('Detroit techno', 'detroit-techno'),
  ('Dub techno', 'dub-techno'),
  ('Electro', 'electro'),
  ('Euro house', 'euro-house'),
  ('Footwork', 'footwork'),
  ('French touch', 'french-touch'),
  ('Gabber', 'gabber'),
  ('Ghetto house', 'ghetto-house'),
  ('Ghettotech', 'ghettotech'),
  ('Happy hardcore', 'happy-hardcore'),
  ('Hardstyle', 'hardstyle'),
  ('Hip-house', 'hip-house'),
  ('House', 'house'),
  ('Leftfield house', 'leftfield-house'),
  ('Leftfield techno', 'leftfield-techno'),
  ('Makina', 'makina'),
  ('Minimal', 'minimal'),
  ('Tech house', 'tech-house'),
  ('Techno', 'techno'),
  ('Trance', 'trance'),
  ('Bassline', 'bassline'),
  ('Breakbeat hardcore', 'breakbeat-hardcore'),
  ('Breakcore', 'breakcore'),
  ('Donk', 'donk'),
  ('Drum & bass', 'drum-bass'),
  ('Dubstep', 'dubstep'),
  ('Garage', 'garage'),
  ('Grime', 'grime'),
  ('Jungle', 'jungle'),
  ('Speed garage', 'speed-garage'),
  ('UK funky', 'uk-funky'),
  -- Genre › Live performance, art ensemble
  ('Live performance, art ensemble', 'live-performance-art-ensemble'),
  -- Genre › Talk, poésie, soundtracks
  ('Talk, poésie, soundtracks', 'talk-poesie-soundtracks'),
  -- Géographie › Caraïbes
  ('Caraïbes', 'caraibes'),
  ('Baithak gana', 'baithak-gana'),
  ('Bashment', 'bashment'),
  ('Béguine', 'beguine'),
  ('Bouyon', 'bouyon'),
  ('Bubbling', 'bubbling'),
  ('Calypso', 'calypso'),
  ('Chutney', 'chutney'),
  ('Dancehall', 'dancehall'),
  ('Deck', 'deck'),
  ('Dembow', 'dembow'),
  ('Dennery segment', 'dennery-segment'),
  ('Digi dub', 'digi-dub'),
  ('Dub', 'dub'),
  ('Gwo ka', 'gwo-ka'),
  ('Kaseko', 'kaseko'),
  ('La plena', 'la-plena'),
  ('Lovers rock', 'lovers-rock'),
  ('Mento', 'mento'),
  ('Raboday', 'raboday'),
  ('Reggae', 'reggae'),
  ('Rocksteady', 'rocksteady'),
  ('Shatta', 'shatta'),
  ('Ska', 'ska'),
  ('Soca', 'soca'),
  ('Steel drum', 'steel-drum'),
  ('Twoubadou', 'twoubadou'),
  ('Zouk', 'zouk'),
  -- Géographie › Amérique latine / Brésil
  ('Amérique latine / Brésil', 'amerique-latine-bresil'),
  ('Arrocha', 'arrocha'),
  ('Bachata', 'bachata'),
  ('Batucada', 'batucada'),
  ('Boléro', 'bolero'),
  ('Bossa nova', 'bossa-nova'),
  ('Brasillica', 'brasillica'),
  ('Brega', 'brega'),
  ('Carimbó', 'carimbo'),
  ('Champeta', 'champeta'),
  ('Chicha', 'chicha'),
  ('Corrido', 'corrido'),
  ('Cumbia', 'cumbia'),
  ('Flamenco', 'flamenco'),
  ('Forró', 'forro'),
  ('Freestyle', 'freestyle'),
  ('Gaita', 'gaita'),
  ('Guaracha', 'guaracha'),
  ('Guaraní', 'guarani'),
  ('Guarapo', 'guarapo'),
  ('Huayños', 'huaynos'),
  ('Jazz latin', 'jazz-latin'),
  ('Joropo', 'joropo'),
  ('Mariachi', 'mariachi'),
  ('Merengue', 'merengue'),
  ('Meringue', 'meringue'),
  ('Música popular brasileira', 'musica-popular-brasileira'),
  ('Musique indigène d''Amérique du Sud', 'musique-indigene-d-amerique-du-sud'),
  ('Norteño', 'norteno'),
  ('Nueva canción', 'nueva-cancion'),
  ('Nueva trova', 'nueva-trova'),
  ('Nuevo cancionero', 'nuevo-cancionero'),
  ('Pasillo', 'pasillo'),
  ('Paso doble', 'paso-doble'),
  ('Quechua', 'quechua'),
  ('Rancheras', 'rancheras'),
  ('Rockola', 'rockola'),
  ('Salsa', 'salsa'),
  ('Samba', 'samba'),
  ('Soul latine', 'soul-latine'),
  ('Tango', 'tango'),
  ('Tonada', 'tonada'),
  ('Vallenato', 'vallenato'),
  ('Zapateado', 'zapateado'),
  -- Géographie › Afrique / Moyen-Orient
  ('Afrique / Moyen-Orient', 'afrique-moyen-orient'),
  ('Afro disco', 'afro-disco'),
  ('Afrobeat', 'afrobeat'),
  ('Arbantone', 'arbantone'),
  ('Balani', 'balani'),
  ('Benga', 'benga'),
  ('Bikutsi', 'bikutsi'),
  ('Blues saharien', 'blues-saharien'),
  ('Chaâbi', 'chaabi'),
  ('Chaoui', 'chaoui'),
  ('Coladeira', 'coladeira'),
  ('Dabke', 'dabke'),
  ('Danse du ventre arabe', 'danse-du-ventre-arabe'),
  ('Dhaanto', 'dhaanto'),
  ('Disco turque', 'disco-turque'),
  ('Electro acholi', 'electro-acholi'),
  ('Éthio-jazz', 'ethio-jazz'),
  ('Éthiopiques', 'ethiopiques'),
  ('Folk érythréen', 'folk-erythreen'),
  ('Folk malgache', 'folk-malgache'),
  ('Folk soudanais', 'folk-soudanais'),
  ('Fuji', 'fuji'),
  ('Funaná', 'funana'),
  ('Ga', 'ga'),
  ('Gengetone', 'gengetone'),
  ('Gnawa', 'gnawa'),
  ('Griot', 'griot'),
  ('Gumbe', 'gumbe'),
  ('Gyil', 'gyil'),
  ('Halay', 'halay'),
  ('Hawzi', 'hawzi'),
  ('Highlife', 'highlife'),
  ('Jazz sud-africain', 'jazz-sud-africain'),
  ('Juju', 'juju'),
  ('Kabyle', 'kabyle'),
  ('Kalenjin', 'kalenjin'),
  ('Khaleeji', 'khaleeji'),
  ('Kilalaky', 'kilalaky'),
  ('Kizomba', 'kizomba'),
  ('Kora', 'kora'),
  ('Lekompo', 'lekompo'),
  ('Lewa', 'lewa'),
  ('Mahraganat', 'mahraganat'),
  ('Makossa', 'makossa'),
  ('Maloya', 'maloya'),
  ('Mandinka', 'mandinka'),
  ('Mapouka', 'mapouka'),
  ('Maqam irakien', 'maqam-irakien'),
  ('Maringa', 'maringa'),
  ('Mbalax', 'mbalax'),
  ('Mbaqanga', 'mbaqanga'),
  ('Mezoued', 'mezoued'),
  ('Mizmar', 'mizmar'),
  ('Morna', 'morna'),
  ('Musique amazighe', 'musique-amazighe'),
  ('Musique arabe traditionnelle', 'musique-arabe-traditionnelle'),
  ('Musique éthiopienne traditionnelle', 'musique-ethiopienne-traditionnelle'),
  ('Musique mandingue', 'musique-mandingue'),
  ('Musique mauritanienne traditionnelle', 'musique-mauritanienne-traditionnelle'),
  ('Musique mizrahie', 'musique-mizrahie'),
  ('Musique persane traditionnelle', 'musique-persane-traditionnelle'),
  ('Pop arabe', 'pop-arabe'),
  ('Pop érythréenne', 'pop-erythreenne'),
  ('Pop éthiopienne', 'pop-ethiopienne'),
  ('Pop soudanaise', 'pop-soudanaise'),
  ('Qaraami', 'qaraami'),
  ('Rababa', 'rababa'),
  ('Raï', 'rai'),
  ('Rock anatolien', 'rock-anatolien'),
  ('Rumba', 'rumba'),
  ('Sai', 'sai'),
  ('Salegy', 'salegy'),
  ('Séga', 'sega'),
  ('Semba', 'semba'),
  ('Shangaan electro', 'shangaan-electro'),
  ('Simpa', 'simpa'),
  ('Soukous', 'soukous'),
  ('Taarab', 'taarab'),
  ('Wassalou', 'wassalou'),
  ('Wassoulou', 'wassoulou'),
  ('Zamrock', 'zamrock'),
  ('Ziglibithy', 'ziglibithy'),
  ('Zouglou', 'zouglou'),
  ('Zukra', 'zukra'),
  -- Géographie › Asie
  ('Asie', 'asie'),
  ('Baloutche', 'baloutche'),
  ('Bhangra', 'bhangra'),
  ('Bollywood', 'bollywood'),
  ('Budots', 'budots'),
  ('C-pop', 'c-pop'),
  ('Cải lương', 'cai-luong'),
  ('Cantopop', 'cantopop'),
  ('Choliya', 'choliya'),
  ('City pop', 'city-pop'),
  ('Dân ca', 'dan-ca'),
  ('Dangdut', 'dangdut'),
  ('Folk baila', 'folk-baila'),
  ('Folk birman', 'folk-birman'),
  ('Folk du Rajasthan', 'folk-du-rajasthan'),
  ('Folk kirghize', 'folk-kirghize'),
  ('Folk philippin', 'folk-philippin'),
  ('Folk tadjik', 'folk-tadjik'),
  ('Gamelan', 'gamelan'),
  ('Ghazal', 'ghazal'),
  ('I-pop', 'i-pop'),
  ('J-pop', 'j-pop'),
  ('J-rock', 'j-rock'),
  ('Jaipong', 'jaipong'),
  ('K-pop', 'k-pop'),
  ('Keroncong', 'keroncong'),
  ('Kundiman', 'kundiman'),
  ('Lollywood', 'lollywood'),
  ('Luk krung', 'luk-krung'),
  ('Luk thung', 'luk-thung'),
  ('Mandopop', 'mandopop'),
  ('Molam', 'molam'),
  ('Musique afghane traditionnelle', 'musique-afghane-traditionnelle'),
  ('Musique bouddhiste traditionnelle', 'musique-bouddhiste-traditionnelle'),
  ('Musique chinoise traditionnelle', 'musique-chinoise-traditionnelle'),
  ('Musique classique indienne', 'musique-classique-indienne'),
  ('Musique classique pakistanaise', 'musique-classique-pakistanaise'),
  ('Musique classique thaïlandaise', 'musique-classique-thailandaise'),
  ('Musique coréenne traditionnelle', 'musique-coreenne-traditionnelle'),
  ('Musique de film tamoul', 'musique-de-film-tamoul'),
  ('Musique japonaise traditionnelle', 'musique-japonaise-traditionnelle'),
  ('Musique laotienne traditionnelle', 'musique-laotienne-traditionnelle'),
  ('Musique vietnamienne traditionnelle', 'musique-vietnamienne-traditionnelle'),
  ('Newa', 'newa'),
  ('Nhạc vàng', 'nhac-vang'),
  ('Pop bengalie', 'pop-bengalie'),
  ('Pop hokkien', 'pop-hokkien'),
  ('Pop khmère', 'pop-khmere'),
  ('Pop ouïghoure', 'pop-ouighoure'),
  ('Pop pachtoune', 'pop-pachtoune'),
  ('Pop pakistanaise', 'pop-pakistanaise'),
  ('Pop persane', 'pop-persane'),
  ('Pop sunda', 'pop-sunda'),
  ('Pop turque', 'pop-turque'),
  ('Proto visual kei', 'proto-visual-kei'),
  ('Roadshow music', 'roadshow-music'),
  ('Saung', 'saung'),
  ('Shashmaqam', 'shashmaqam'),
  ('Shidaiqu', 'shidaiqu'),
  ('Toi', 'toi'),
  ('V-pop', 'v-pop'),
  -- Géographie › Europe
  ('Europe', 'europe'),
  ('Fado portugais', 'fado-portugais'),
  ('Folk celtique', 'folk-celtique'),
  ('Folk nordique', 'folk-nordique'),
  ('Musique bulgare traditionnelle', 'musique-bulgare-traditionnelle'),
  ('Musique grecque traditionnelle', 'musique-grecque-traditionnelle'),
  ('Musique irlandaise traditionnelle', 'musique-irlandaise-traditionnelle'),
  ('Musique italienne traditionnelle', 'musique-italienne-traditionnelle'),
  ('Pop arménienne', 'pop-armenienne'),
  ('Pop des Balkans', 'pop-des-balkans'),
  -- Activité › Podcast
  ('Podcast', 'podcast'),
  -- Activité › Playlist
  ('Playlist', 'playlist'),
  -- Activité › DJ
  ('DJ', 'dj'),
  -- Catégorie › Live session_Art ensemble
  ('Live session_Art ensemble', 'live-session-art-ensemble'),
  -- Catégorie › Fête
  ('Fête', 'fete'),
  -- Catégorie › Rencontre/Talk
  ('Rencontre/Talk', 'rencontre-talk'),
  -- Catégorie › DJ set_On air
  ('DJ set_On air', 'dj-set-on-air'),
  -- Catégorie › Événement spécial
  ('Événement spécial', 'evenement-special')
) AS d (name, slug) ON t.slug = d.slug
WHEN MATCHED THEN UPDATE SET name = d.name
WHEN NOT MATCHED THEN INSERT (kind, name, slug) VALUES ('genre', d.name, d.slug);
--> statement-breakpoint

-- 4. Les groupes de chaque filtre, dans l'ordre du document.
INSERT INTO public.tag_group (facet_id, tag_id, position)
SELECT f.id, t.id, g.position
FROM (VALUES
  ('theme', 'culture', 1), ('theme', 'societe', 2), ('theme', 'musique', 3),
  ('genre', 'classique', 1), ('genre', 'pop-variete', 2), ('genre', 'jazz', 3), ('genre', 'hip-hop-r-n-b', 4),
  ('genre', 'soul', 5), ('genre', 'disco', 6), ('genre', 'rock', 7), ('genre', 'metal-alternative-rock', 8),
  ('genre', 'ambient', 9), ('genre', 'electronique-downtempo', 10), ('genre', 'club', 11),
  ('genre', 'house-techno', 12), ('genre', 'live-performance-art-ensemble', 13),
  ('genre', 'talk-poesie-soundtracks', 14),
  ('geographie', 'caraibes', 1), ('geographie', 'amerique-latine-bresil', 2),
  ('geographie', 'afrique-moyen-orient', 3), ('geographie', 'asie', 4), ('geographie', 'europe', 5),
  ('activite', 'podcast', 1), ('activite', 'playlist', 2), ('activite', 'dj', 3),
  ('categorie', 'live-session-art-ensemble', 1), ('categorie', 'fete', 2), ('categorie', 'rencontre-talk', 3),
  ('categorie', 'dj-set-on-air', 4), ('categorie', 'evenement-special', 5)
) AS g (facet, tag, position)
JOIN public.facet f ON f.slug = g.facet
JOIN public.tag t ON t.slug = g.tag;
--> statement-breakpoint

-- 5. Les étiquettes de chaque groupe. Celle qui porte le nom de son groupe (SOUL dans SOUL, CLUB dans CLUB) n'y est pas :
-- le groupe se choisit lui-même.
INSERT INTO public.tag_member (facet_id, group_id, tag_id)
SELECT f.id, g.id, t.id
FROM (VALUES
  ('theme', 'culture', ARRAY[
    'architecture', 'art', 'cinema', 'design', 'food', 'litterature', 'mode', 'photographie'
  ]),
  ('theme', 'societe', ARRAY[
    'actualite', 'bien-etre', 'diasporas', 'entreprenariat', 'militantisme', 'philosophie', 'sport'
  ]),
  ('theme', 'musique', ARRAY[
    'actualite-musicale', 'histoire-de-la-musique'
  ]),
  ('genre', 'hip-hop-r-n-b', ARRAY[
    'drill', 'rnb', 'rap', 'trap'
  ]),
  ('genre', 'soul', ARRAY[
    'blues', 'funk', 'gospel', 'rhythm-blues'
  ]),
  ('genre', 'rock', ARRAY[
    'country', 'hard-rock'
  ]),
  ('genre', 'metal-alternative-rock', ARRAY[
    'indie-rock', 'post-punk'
  ]),
  ('genre', 'ambient', ARRAY[
    'experimental', 'spiritual', 'noise'
  ]),
  ('genre', 'electronique-downtempo', ARRAY[
    'trip-hop', 'video-game-music', 'soundtrack', 'library-music'
  ]),
  ('genre', 'club', ARRAY[
    'afro-house', 'afrobeats', 'amapiano', 'baile-funk', 'ballroom', 'baltimore-club', 'batida', 'coupe-decale',
    'gqom', 'hyperpop', 'jersey-club', 'kuduro', 'kwaito', 'mara', 'ndombolo', 'nightcore', 'raptor-house',
    'reggaeton', 'singeli', 'street-hop', 'vinahouse', 'wisisi'
  ]),
  ('genre', 'house-techno', ARRAY[
    'acid', 'ambient-techno', 'bass-music', 'balearic-house', 'breaks', 'broken-beat', 'chicago-house', 'edm',
    'deep-house', 'detroit-house', 'detroit-techno', 'dub-techno', 'electro', 'euro-house', 'footwork', 'french-touch',
    'gabber', 'ghetto-house', 'ghettotech', 'happy-hardcore', 'hardstyle', 'hip-house', 'house', 'leftfield-house',
    'leftfield-techno', 'makina', 'minimal', 'tech-house', 'techno', 'trance', 'bassline', 'breakbeat-hardcore',
    'breakcore', 'donk', 'drum-bass', 'dubstep', 'garage', 'grime', 'jungle', 'speed-garage', 'uk-funky'
  ]),
  ('geographie', 'caraibes', ARRAY[
    'baithak-gana', 'bashment', 'beguine', 'bouyon', 'bubbling', 'calypso', 'chutney', 'dancehall', 'deck', 'dembow',
    'dennery-segment', 'digi-dub', 'dub', 'gwo-ka', 'kaseko', 'la-plena', 'lovers-rock', 'mento', 'raboday', 'reggae',
    'rocksteady', 'shatta', 'ska', 'soca', 'steel-drum', 'twoubadou', 'zouk'
  ]),
  ('geographie', 'amerique-latine-bresil', ARRAY[
    'arrocha', 'bachata', 'baile-funk', 'batucada', 'bolero', 'bossa-nova', 'brasillica', 'brega', 'carimbo',
    'champeta', 'chicha', 'corrido', 'cumbia', 'flamenco', 'forro', 'freestyle', 'gaita', 'guaracha', 'guarani',
    'guarapo', 'huaynos', 'jazz-latin', 'joropo', 'kaseko', 'mariachi', 'merengue', 'meringue',
    'musica-popular-brasileira', 'musique-indigene-d-amerique-du-sud', 'norteno', 'nueva-cancion', 'nueva-trova',
    'nuevo-cancionero', 'pasillo', 'paso-doble', 'quechua', 'rancheras', 'rockola', 'salsa', 'samba', 'soul-latine',
    'tango', 'tonada', 'vallenato', 'zapateado'
  ]),
  ('geographie', 'afrique-moyen-orient', ARRAY[
    'afro-disco', 'afrobeat', 'amapiano', 'arbantone', 'balani', 'benga', 'bikutsi', 'blues-saharien', 'chaabi',
    'chaoui', 'coladeira', 'coupe-decale', 'dabke', 'danse-du-ventre-arabe', 'dhaanto', 'disco-turque',
    'electro-acholi', 'ethio-jazz', 'ethiopiques', 'folk-erythreen', 'folk-malgache', 'folk-soudanais', 'fuji',
    'funana', 'ga', 'gengetone', 'gnawa', 'gqom', 'griot', 'gumbe', 'gyil', 'halay', 'hawzi', 'highlife',
    'jazz-sud-africain', 'juju', 'kabyle', 'kalenjin', 'khaleeji', 'kilalaky', 'kizomba', 'kora', 'lekompo', 'lewa',
    'mahraganat', 'makossa', 'maloya', 'mandinka', 'mapouka', 'maqam-irakien', 'maringa', 'mbalax', 'mbaqanga',
    'mezoued', 'mizmar', 'morna', 'musique-amazighe', 'musique-arabe-traditionnelle',
    'musique-ethiopienne-traditionnelle', 'musique-mandingue', 'musique-mauritanienne-traditionnelle',
    'musique-mizrahie', 'musique-persane-traditionnelle', 'pop-arabe', 'pop-erythreenne', 'pop-ethiopienne',
    'pop-soudanaise', 'qaraami', 'rababa', 'rai', 'rock-anatolien', 'rumba', 'sai', 'salegy', 'sega', 'semba',
    'shangaan-electro', 'simpa', 'singeli', 'soukous', 'taarab', 'wassalou', 'wassoulou', 'zamrock', 'ziglibithy',
    'zouglou', 'zukra'
  ]),
  ('geographie', 'asie', ARRAY[
    'baloutche', 'bhangra', 'bollywood', 'budots', 'c-pop', 'cai-luong', 'cantopop', 'choliya', 'city-pop', 'dan-ca',
    'dangdut', 'folk-baila', 'folk-birman', 'folk-du-rajasthan', 'folk-kirghize', 'folk-philippin', 'folk-tadjik',
    'gamelan', 'ghazal', 'i-pop', 'j-pop', 'j-rock', 'jaipong', 'k-pop', 'keroncong', 'kundiman', 'lollywood',
    'luk-krung', 'luk-thung', 'mandopop', 'molam', 'musique-afghane-traditionnelle',
    'musique-bouddhiste-traditionnelle', 'musique-chinoise-traditionnelle', 'musique-classique-indienne',
    'musique-classique-pakistanaise', 'musique-classique-thailandaise', 'musique-coreenne-traditionnelle',
    'musique-de-film-tamoul', 'musique-japonaise-traditionnelle', 'musique-laotienne-traditionnelle',
    'musique-vietnamienne-traditionnelle', 'newa', 'nhac-vang', 'pop-bengalie', 'pop-hokkien', 'pop-khmere',
    'pop-ouighoure', 'pop-pachtoune', 'pop-pakistanaise', 'pop-persane', 'pop-sunda', 'pop-turque', 'proto-visual-kei',
    'roadshow-music', 'saung', 'shashmaqam', 'shidaiqu', 'toi', 'v-pop'
  ]),
  ('geographie', 'europe', ARRAY[
    'fado-portugais', 'folk-celtique', 'folk-nordique', 'musique-bulgare-traditionnelle',
    'musique-grecque-traditionnelle', 'musique-irlandaise-traditionnelle', 'musique-italienne-traditionnelle',
    'pop-armenienne', 'pop-des-balkans'
  ])
) AS m (facet, grp, tags)
CROSS JOIN LATERAL unnest(m.tags) AS one (slug)
JOIN public.facet f ON f.slug = m.facet
JOIN public.tag g ON g.slug = m.grp
JOIN public.tag t ON t.slug = one.slug;
--> statement-breakpoint

-- 6. Les événements : leur catégorie devient une étiquette du filtre Catégorie. La colonne « category » disparaît à la
-- migration suivante. « Parabole » (les soirées de la radio) devient Fête.
INSERT INTO public.event_tag (event_id, tag_id)
SELECT e.id, t.id
FROM public.event e
JOIN public.tag t ON t.slug = CASE e.category::text
  WHEN 'art_ensemble' THEN 'live-session-art-ensemble'
  WHEN 'parabole' THEN 'fete'
  WHEN 'special' THEN 'evenement-special'
  WHEN 'talk' THEN 'rencontre-talk'
END
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 7. Notes pour le tableau de bord de Supabase. ----------------------------------------------------------------------
COMMENT ON TABLE public.tag IS 'Une étiquette (genre, région, thème, activité, catégorie d''événement), rangée dans les filtres du site. Une adresse par étiquette.';
--> statement-breakpoint
COMMENT ON TABLE public.facet IS 'Un filtre du site : Thème, Genre, Géographie (shows), Activité (artistes), Catégorie (événements). Ses groupes sont dans tag_group.';
--> statement-breakpoint
COMMENT ON TABLE public.tag_group IS 'Un groupe d''un filtre : une étiquette au premier niveau (Club, Caraïbes, Culture), dans l''ordre de position.';
--> statement-breakpoint
COMMENT ON TABLE public.tag_member IS 'Une étiquette rangée dans un groupe (Amapiano dans Club). Une étiquette peut avoir plusieurs places.';
--> statement-breakpoint
COMMENT ON TABLE public.artist_tag IS 'Les étiquettes d''un artiste : son activité (podcast, playlist, DJ).';
--> statement-breakpoint
COMMENT ON TABLE public.event_tag IS 'Les étiquettes d''un événement : sa catégorie (Fête, Rencontre/Talk…).';
--> statement-breakpoint
COMMENT ON TABLE public.event IS 'Un événement, à venir ou passé. Sa catégorie est une étiquette (event_tag).';
--> statement-breakpoint
COMMENT ON COLUMN public.show.energy IS 'Le mood d''un DJ set ou d''une playlist : de 1 (calme) à 5 (énergique).';
