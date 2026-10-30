PARABOLE RADIO — how to put this site online (Vercel)
=====================================================

WHAT'S IN THIS FOLDER
- index.html .......................... the whole website (this is what Vercel serves)
- vercel.json ......................... the relay for Radio Cult's programme and history
  (see "The player")
- PARABOLE RADIO/VIDEO/BACKGROUND/ .... the 15 background clips (backgroundN.mp4), each
  with its first frame (backgroundN.jpg), shown while the clip loads
- PARABOLE RADIO/OVERLAY/logo.webp .... the animated logo (top-left), loaded for every
  visitor; logo.apng is the same logo for older browsers
- PARABOLE RADIO/FONTS/ ............... the Monument Grotesk font files
- PARABOLE RADIO/CSS/tailwind.css ..... the Tailwind classes used by the page, generated
  once (see "Good to know")


SETTINGS — all in one place
---------------------------
Open index.html in any text editor and search for "SETTINGS": the block at the top
of the <script> section holds everything you may want to change.
- STAFF_PASSWORD ........ the staff password (change it before launch)
- DEFAULT_SUBTITLE_URL .. where the yellow "contributors" button leads (your Google Form)
- phrases ............... the texts that take turns on that button
- STREAM_URL ............ the station's stream (Icecast)
- NOWPLAYING_URL ........ what's on air
- SCHEDULE_URL .......... the programme
- HISTORY_URL ........... the last tracks played
- STATION_TIMEZONE ...... the station's time zone, for the hours in the pop-ups
- bgPlaylist ............ the list of background clips


THE PLAYER
----------
The player, PROGRAMMATION and HISTORIQUE are the site's own: no embed. They read
the station's public data at the addresses above.

Today the station runs on Radio Cult (station parabole-radio-b02d5385): the
player plays its stream and shows what's on air. Radio Cult lets only its own
site read the programme and the history, so Vercel relays them under
/radiocult/ (see vercel.json). These two pop-ups therefore fill in on the site
online; on the computer, "python3 -m http.server" can't relay them and they
say "indisponible".

Later, Radiocompas (BUTTON): put its addresses in SETTINGS instead (now.json,
/public/programme.json, /public/historique.json). The page reads both formats,
nothing else to change; vercel.json can then go. Each address must answer from
another site (CORS): the nowplaying service and the public routes of
Radiocompas do.

An address left "" switches that part off without breaking the site: the player
shows "HORS ANTENNE" (and plays nothing), the pop-ups say the content is coming
soon.


BEFORE THE LAUNCH — 4 things to check
-------------------------------------
1) CHANGE THE STAFF PASSWORD
   STAFF_PASSWORD in the SETTINGS block.

2) FILL IN THE SHARE PREVIEW
   In index.html, search for  REPLACE_WITH_YOUR_DOMAIN  and put your real web
   address there. Then add a 1200x630 image named  share-image.jpg  in the
   PARABOLE RADIO folder, so the link preview looks right when shared.

3) CHECK THE CONTRIBUTORS FORM
   Open the Google Form link in a private window. If it asks you to sign in, open
   the form's settings in Google Forms and remove what requires an account
   ("Limit to 1 response", verified e-mail collection, restriction to an organisation).

4) KEEP PRIVATE FILES OUT OF GIT
   Vercel publishes EVERY file committed to the repository, this README included
   (at /README.txt). .gitignore already keeps ETAT_DES_LIEUX.md, the .claude folder
   and Vercel's local files out: never commit anything private.


ADD OR CHANGE A BACKGROUND CLIP
-------------------------------
1) Drop the .mp4 into  PARABOLE RADIO/VIDEO/BACKGROUND/  (for example background16.mp4).
2) Add its path to  bgPlaylist  in the SETTINGS block.
3) Make its waiting image: same name, .jpg. With ffmpeg:
      ffmpeg -i background16.mp4 -frames:v 1 -q:v 4 background16.jpg
Clips play in random order, never the same one twice in a row.


STAFF MODE
----------
Double-click the small logo in the top bar, then type the staff password.
Staff can change the background video, add a video overlay, change the contributors
link and change the logo. These changes stay IN THAT BROWSER ONLY: other visitors
never see them. Handy for a screen in the studio.


PREVIEW ON YOUR COMPUTER
------------------------
In a terminal, inside this folder:
      python3 -m http.server 8000
then open  http://localhost:8000 . If a change doesn't show up, reload the page.
PROGRAMMATION and HISTORIQUE stay empty there: they come through Vercel (see
"The player").


ONLINE: VERCEL, FROM GITHUB
---------------------------
The site is the GitHub repository  lazbutton/parabole-radio-site , linked to the
Vercel project  parabole-radio-site . Nothing to build: Vercel serves the files
as they are.
- Push to the  main  branch: the site goes live within seconds, at
  https://parabole-radio-site.vercel.app (and at your domain once connected).
- Push to any other branch: Vercel makes a preview at its own address, to try a
  change before it goes live. The project's "Deployments" tab in Vercel lists
  every deployment with its address.
- The /radiocult/ relay of vercel.json works online and on previews alike.


CONNECT YOUR DOMAIN (registered at Squarespace, formerly Google Domains)
------------------------------------------------------------------------
1) In Vercel: the project  parabole-radio-site  > Settings > Domains > Add.
   Enter your domain. Vercel will show you the exact DNS records to add
   (an A record and/or a CNAME).
2) Log in at  squarespace.com  > Domains > your domain > DNS settings.
3) Add the records Vercel gave you. Save.
4) Wait for it to take effect (usually minutes, sometimes a few hours).
   Vercel turns on free HTTPS automatically once the domain is verified.
5) Put the domain in the share preview (step 2 of "Before the launch").


GOOD TO KNOW
------------
- Updating the site = commit, then push to main (see "Online"). To try a change
  first, push it to another branch for a preview.
- Styles: PARABOLE RADIO/CSS/tailwind.css was generated once (Tailwind CSS v3.4.17)
  from the classes already in index.html, so a Tailwind class that isn't already in
  the page won't do anything. Write any new style as normal CSS in the <style> block
  of index.html, and don't edit tailwind.css by hand.
- The original, uncompressed clips are kept outside this folder, next to it, in
  parabole-radio-site_sauvegarde-originaux_2026-10-30.
