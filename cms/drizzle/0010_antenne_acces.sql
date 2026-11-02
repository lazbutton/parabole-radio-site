-- L'antenne libre, le chat du site (0009_antenne.sql, CHAT_EN_DIRECT.md) : ses règles d'accès, ses droits, la trace des
-- adresses IP, la diffusion en temps réel par la base, et la purge.
--
-- Le public n'a aucun droit sur ces tables, pas même en lecture : la clé publiable ne permet pas de les lire par l'API
-- de Supabase. Le serveur du site y écrit en propriétaire, après la modération (src/chat/), et la base diffuse elle-même
-- ce qui passe à l'antenne. L'équipe, la régie, les lit et les modère sous son rôle (src/admin/chat.ts).

-- 1. La régie : l'équipe lit tout et modère. -----------------------------------------------------------------------
CREATE POLICY chat_author_select ON public.chat_author FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_author_update ON public.chat_author FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_message_select ON public.chat_message FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_message_update ON public.chat_message FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
-- Écrire en tant que Parabole : sous son propre nom de membre, jamais sous celui d'un auditeur.
CREATE POLICY chat_message_insert ON public.chat_message FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()) AND member_id = (SELECT auth.uid()) AND author_id IS NULL);
--> statement-breakpoint
CREATE POLICY chat_report_select ON public.chat_report FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_report_update ON public.chat_report FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_term_select ON public.chat_term FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_term_insert ON public.chat_term FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_term_update ON public.chat_term FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_term_delete ON public.chat_term FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_action_select ON public.chat_action FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
-- Le journal : chaque membre n'y écrit qu'en son nom.
CREATE POLICY chat_action_insert ON public.chat_action FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()) AND actor = 'team' AND member_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY chat_settings_select ON public.chat_settings FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY chat_settings_update ON public.chat_settings FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Droits des rôles : rien pour le public ; l'équipe, ce que ses règles lui laissent. -----------------------------
REVOKE ALL ON public.chat_author, public.chat_message, public.chat_report, public.chat_term, public.chat_action,
  public.chat_settings FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.chat_author, public.chat_report, public.chat_settings TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.chat_message TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_term TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.chat_action TO authenticated;
--> statement-breakpoint

-- 3. Date de modification, réglages de départ, notes pour le tableau de bord de Supabase. ---------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_author', 'chat_message', 'chat_term', 'chat_settings'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()', t);
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO public.chat_settings DEFAULT VALUES;
--> statement-breakpoint
COMMENT ON TABLE public.chat_author IS 'L''antenne libre : un pseudo, tenu par une session anonyme du site (cookie). Ni compte ni e-mail.';
--> statement-breakpoint
COMMENT ON TABLE public.chat_message IS 'L''antenne libre : un message, passé à l''antenne, en attente, refusé ou brouillé par la régie.';
--> statement-breakpoint
COMMENT ON TABLE public.chat_settings IS 'L''antenne libre : ses réglages (ouverte, mode lent, différé, bandeau…), sur une seule ligne.';
--> statement-breakpoint

-- 4. La trace : l'adresse IP de chaque message, gardée un an (LCEN), hors de l'API de Supabase. ----------------------
CREATE TABLE private.chat_trace (
  message_id uuid PRIMARY KEY,
  author_id uuid,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX chat_trace_ip ON private.chat_trace (ip, created_at);
--> statement-breakpoint
REVOKE ALL ON private.chat_trace FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- 5. La diffusion : la base envoie elle-même ce qui change sur le canal privé « chat:antenne » (Supabase Realtime,
-- « Broadcast from Database »), avec ce qu'il faut à l'écran et rien de plus. Sans Realtime (les tests sur l'image
-- supabase/postgres), rien ne part ; sur PGlite, un faux realtime.send() note ce qu'il aurait envoyé.
CREATE FUNCTION private.chat_diffuser(evenement text, contenu jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
  BEGIN
    IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
      RETURN;
    END IF;
    PERFORM realtime.send(contenu, evenement, 'chat:antenne', true);
  END $$;
--> statement-breakpoint
-- Un message passe à l'antenne (son heure de passage dit quand l'afficher), ou en est retiré.
CREATE FUNCTION private.chat_message_diffuser() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
  BEGIN
    IF NEW.status = 'visible' AND (TG_OP = 'INSERT' OR OLD.status <> 'visible') THEN
      PERFORM private.chat_diffuser('message', jsonb_build_object(
        'id', NEW.id, 'pseudo', NEW.pseudo, 'couleur', NEW.color, 'texte', NEW.body, 'regie', NEW.member_id IS NOT NULL,
        'heure', NEW.created_at, 'antenne', NEW.on_air_at));
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'visible' AND NEW.status <> 'visible' THEN
      PERFORM private.chat_diffuser('retrait', jsonb_build_object('id', NEW.id));
    END IF;
    RETURN NULL;
  END $$;
--> statement-breakpoint
CREATE TRIGGER chat_message_diffuser AFTER INSERT OR UPDATE OF status ON public.chat_message
  FOR EACH ROW EXECUTE FUNCTION private.chat_message_diffuser();
--> statement-breakpoint
-- Les réglages : l'état de l'antenne, et le vidage.
CREATE FUNCTION private.chat_settings_diffuser() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
  BEGIN
    IF NEW.cleared_at IS DISTINCT FROM OLD.cleared_at THEN
      PERFORM private.chat_diffuser('vidage', jsonb_build_object('heure', NEW.cleared_at));
    END IF;
    PERFORM private.chat_diffuser('etat', jsonb_build_object(
      'ouvert', NEW.open, 'lent', NEW.slow_seconds, 'differe', NEW.delay_seconds, 'bandeau', NEW.ticker));
    RETURN NULL;
  END $$;
--> statement-breakpoint
CREATE TRIGGER chat_settings_diffuser AFTER UPDATE ON public.chat_settings
  FOR EACH ROW EXECUTE FUNCTION private.chat_settings_diffuser();
--> statement-breakpoint
-- Recevoir le canal : tout le monde, avec la seule clé publiable. Aucune règle INSERT : aucun navigateur ne diffuse
-- sur ce sujet, seule la base. Supabase tient déjà la sécurité par ligne de realtime.messages : pas d'ALTER TABLE ici.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL AND to_regprocedure('realtime.topic()') IS NOT NULL THEN
    EXECUTE $policy$CREATE POLICY chat_antenne_ecoute ON realtime.messages FOR SELECT TO anon, authenticated
      USING ((SELECT realtime.topic()) = 'chat:antenne' AND realtime.messages.extension = 'broadcast')$policy$;
  END IF;
END $$;
--> statement-breakpoint

-- 6. La purge (CHAT_EN_DIRECT.md, section 10) : les messages au bout de 30 jours (leurs signalements avec eux) ; le
-- journal, la trace des adresses IP et les pseudos inactifs au bout d'un an. Chaque nuit par pg_cron, s'il est là.
CREATE FUNCTION private.purge_chat(maintenant timestamptz DEFAULT now()) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
  BEGIN
    DELETE FROM public.chat_message WHERE created_at < maintenant - interval '30 days';
    DELETE FROM public.chat_action WHERE created_at < maintenant - interval '1 year';
    DELETE FROM private.chat_trace WHERE created_at < maintenant - interval '1 year';
    DELETE FROM public.chat_author WHERE last_seen_at < maintenant - interval '1 year';
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.purge_chat(timestamptz) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('antenne-purge', '17 4 * * *', 'select private.purge_chat()');
  END IF;
END $$;
