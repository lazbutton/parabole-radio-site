-- Le journal des imports de la programmation Radio Cult (0012_imports.sql) : ses règles d'accès, sur le modèle du
-- journal de l'antenne (0010_antenne_acces.sql). La tâche de nuit écrit avec la connexion du serveur, en propriétaire
-- des tables ; un membre qui lance l'import depuis l'accueil l'écrit sous son rôle, en son propre nom.

-- 1. Lire : l'équipe seulement. Écrire : un membre, pour un import qu'il lance lui-même. ---------------------------
CREATE POLICY radiocult_import_select ON public.radiocult_import FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY radiocult_import_insert ON public.radiocult_import FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()) AND trigger = 'manual' AND member_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 2. Droits des rôles : rien pour le public ; ni modification ni suppression par l'API. -----------------------------
REVOKE ALL ON public.radiocult_import FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.radiocult_import TO authenticated;
--> statement-breakpoint

-- 3. Note pour le tableau de bord de Supabase. ----------------------------------------------------------------------
COMMENT ON TABLE public.radiocult_import IS 'Le journal des imports de la programmation Radio Cult (tâche de nuit ou bouton de l''admin) : créés, mis à jour, laissés, et ce qui est signalé.';
