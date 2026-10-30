PARABOLE RADIO — how to put this site online (Netlify)
=======================================================

WHAT'S IN THIS FOLDER
- index.html .......................... the whole website (this is what Netlify serves)
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
- RC_PUBLISHABLE_KEY .... your Radio Cult publishable key (pk_...), needed for
                          "NOW PLAYING". Get it at app.radiocult.fm/settings/cms/api
- bgPlaylist ............ the list of background clips


BEFORE YOU DEPLOY — do these 4 things
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

4) KEEP NON-SITE FILES OUT
   Netlify Drop publishes EVERY file in the folder. Move out anything that is not
   part of the site (ETAT_DES_LIEUX.md, the .claude folder, this README) before
   dragging the folder.


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


DEPLOY ON NETLIFY (no account file needed, it's free)
-----------------------------------------------------
1) Go to  https://app.netlify.com/drop
2) Drag this whole "parabole-radio-site" FOLDER onto the page
   (after step 4 of "Before you deploy").
3) Wait a few seconds — it goes live at a temporary address like
   your-site-name.netlify.app . Test it there first.


CONNECT YOUR DOMAIN (registered at Squarespace, formerly Google Domains)
------------------------------------------------------------------------
1) In Netlify: Site settings > Domain management > Add a custom domain.
   Enter your domain. Netlify will show you the exact DNS records to add
   (an A record and/or a CNAME).
2) Log in at  squarespace.com  > Domains > your domain > DNS settings.
3) Add the records Netlify gave you. Save.
4) Wait for it to take effect (usually minutes, sometimes a few hours).
   Netlify turns on free HTTPS automatically once the domain is verified.


GOOD TO KNOW
------------
- Updating the site later = just re-drag the folder onto Netlify (or connect it
  to GitHub for auto-updates).
- Styles: PARABOLE RADIO/CSS/tailwind.css was generated once (Tailwind CSS v3.4.17)
  from the classes already in index.html, so a Tailwind class that isn't already in
  the page won't do anything. Write any new style as normal CSS in the <style> block
  of index.html, and don't edit tailwind.css by hand.
- The original, uncompressed clips are kept outside this folder, next to it, in
  parabole-radio-site_sauvegarde-originaux_2026-10-30.
