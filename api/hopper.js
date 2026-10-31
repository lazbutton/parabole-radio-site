// Hopper (hppr.fr) for the HISTORIQUE pop-up: finds a track of the history on the streaming
// platforms and gives its hppr.fr page, which opens it on each listener's own platform. The same
// contract as OutLive (Hopper's README, « OutLive (Radio Campus) »):
//   POST https://hppr.fr/api/resolve { track: { artist, title } }
//   → 200 { id, url } when a platform has the track word for word, 422 when none has.
// GET /api/hopper?artist=…&title=… answers { url } or { url: null }. Both answers are kept 30 days
// by Vercel's cache, so each track is asked once whoever listens (and asked again after 30 days, as
// OutLive does). "busy" or an error is not kept: the track is asked again later.
// HOPPER_KEY (a Vercel setting, optional) is a partner key of Hopper's HOPPER_PARTNER_KEYS: with it,
// Parabole has its own limit (60 a minute) instead of the one of Vercel's shared addresses (10).
const HOPPER = 'https://hppr.fr/api/resolve';
const KEEP = 'public, max-age=3600, s-maxage=2592000';

export default async function handler(req, res){
  const artist = String(req.query.artist || '').trim().slice(0, 300);
  const title = String(req.query.title || '').trim().slice(0, 300);
  if(!artist || !title) return res.status(400).json({ error: 'invalid' });
  const headers = { 'Content-Type': 'application/json' };
  if(process.env.HOPPER_KEY) headers['X-Hopper-Key'] = process.env.HOPPER_KEY;
  try {
    const answer = await fetch(HOPPER, {
      method: 'POST', headers, body: JSON.stringify({ track: { artist, title } }), signal: AbortSignal.timeout(25000),
    });
    if(answer.status === 200){
      const { url } = await answer.json();
      res.setHeader('Cache-Control', KEEP);
      return res.status(200).json({ url: typeof url === 'string' && url.startsWith('https://hppr.fr/') ? url : null });
    }
    if(answer.status === 422){
      res.setHeader('Cache-Control', KEEP);
      return res.status(200).json({ url: null });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: answer.status === 429 ? 'busy' : 'unavailable' });
  } catch(error){
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'unavailable' });
  }
}
