import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { allowedHost, isSpotifyLink, musicService, normalizeName, parseSpotifyPage, pickDeezer, spotifyTrackId, type Fetcher } from "./music.js";

const ID = "4cOdK2wGLETKBW3PvgPWqT";
const PAGE = `<html><head>
  <meta property="og:title" content="Never Gonna Give You Up"/>
  <meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987"/>
  <meta property="og:image" content="https://i.scdn.co/image/capa"/>
  <meta name="music:duration" content="213"/>
  <meta name="music:musician_description" content="Rick Astley"/>
</head></html>`;
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2000)]);

/** Spotify e Deezer de mentira; conta quantas vezes cada endereço foi pedido. */
async function fake(overrides: Record<string, () => Response> = {}) {
  const jpg = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const calls: string[] = [];
  const routes: Record<string, () => Response> = {
    [`https://open.spotify.com/track/${ID}`]: () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    "https://i.scdn.co/image/capa": () => new Response(jpg, { headers: { "content-type": "image/jpeg" } }),
    "https://api.deezer.com/track/781592622": () => Response.json({ preview: "https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3?hdnea=exp=1" }),
    "https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3?hdnea=exp=1": () => new Response(MP3, { headers: { "content-type": "audio/mpeg" } }),
    "https://spotify.link/abcDEF123": () => new Response(null, { status: 302, headers: { location: `https://open.spotify.com/track/${ID}?si=x` } }),
    ...overrides,
  };
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url.startsWith("https://api.deezer.com/search")) {
      return Response.json({ data: [
        { id: 1, title: "Never Gonna Give You Up (Cover)", duration: 200, preview: "x", artist: { name: "Outra Banda" } },
        { id: 781592622, title: "Never Gonna Give You Up", duration: 213, preview: "https://cdnt-preview.dzcdn.net/x.mp3", artist: { name: "Rick Astley" } },
      ] });
    }
    const r = routes[url];
    return r ? r() : new Response("não", { status: 404 });
  };
  return { fetcher, calls };
}

describe("cartão de música", () => {
  it("reconhece links de faixa do Spotify", () => {
    expect(spotifyTrackId(`https://open.spotify.com/track/${ID}`)).toBe(ID);
    expect(spotifyTrackId(`https://open.spotify.com/intl-pt/track/${ID}?si=abc`)).toBe(ID);
    expect(spotifyTrackId(`https://open.spotify.com/embed/track/${ID}`)).toBe(ID);
    for (const u of [`https://open.spotify.com/album/${ID}`, `https://evil.com/track/${ID}`, `https://open.spotify.com.evil.com/track/${ID}`, "https://open.spotify.com/track/curto"])
      expect(spotifyTrackId(u), u).toBeNull();
    expect(isSpotifyLink("https://spotify.link/abcDEF123")).toBe(true);
    expect(isSpotifyLink("https://example.com")).toBe(false);
  });

  it("só alcança hosts do Spotify e do Deezer", () => {
    for (const h of ["open.spotify.com", "i.scdn.co", "image-cdn-ak.spotifycdn.com", "api.deezer.com", "cdnt-preview.dzcdn.net"]) expect(allowedHost(h), h).toBe(true);
    for (const h of ["evil.com", "scdn.co.evil.com", "deezer.com.evil.com", "169.254.169.254", "localhost"]) expect(allowedHost(h), h).toBe(false);
  });

  it("lê título, artista, álbum, duração e capa da página", () => {
    expect(parseSpotifyPage(PAGE)).toEqual({ title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", durationMs: 213_000, image: "https://i.scdn.co/image/capa" });
    expect(parseSpotifyPage("<p>nada</p>")).toBeNull();
  });

  it("compara nomes sem acento, feat e versão", () => {
    expect(normalizeName("Ação (feat. Fulano) - Remastered 2011")).toBe("acao");
    expect(normalizeName("Simon & Garfunkel")).toBe("simon e garfunkel");
  });

  it("escolhe a faixa certa do Deezer e recusa parecidas", () => {
    const want = { title: "Song", artist: "Banda", album: null, durationMs: 180_000, image: null };
    expect(pickDeezer([{ id: 1, title: "Song", preview: "p", duration: 300, artist: { name: "Outra" } }], want)).toBeNull();
    expect(pickDeezer([{ id: 2, title: "Song", preview: "p", duration: 181, artist: { name: "Outra" } }], want)?.id).toBe(2);
    expect(pickDeezer([{ id: 3, title: "Song", duration: 180, artist: { name: "Banda" } }], want)).toBeNull(); // sem prévia
    expect(pickDeezer([{ id: 4, title: "Song (Ao Vivo)", preview: "p", duration: 240, artist: { name: "Banda feat. X" } }], want)?.id).toBe(4);
  });

  it("resolve o link, serve capa e prévia, e guarda em cache", async () => {
    const { fetcher, calls } = await fake();
    const m = musicService(fetcher);
    const t = await m.resolve(`https://open.spotify.com/intl-pt/track/${ID}?si=1`);
    expect(t).toEqual({ id: ID, url: `https://open.spotify.com/track/${ID}`, title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", durationMs: 213_000, hasCover: true, previewSource: "deezer" });
    expect(await m.resolve("https://spotify.link/abcDEF123")).toEqual(t);
    expect(calls.filter((c) => c.includes("open.spotify.com/track")).length).toBe(1);

    const cover = await m.cover(ID);
    expect(cover && (await sharp(cover).metadata())).toMatchObject({ format: "webp", width: 320, height: 320 });
    expect((await m.preview(ID))?.equals(MP3)).toBe(true);
    await m.preview(ID);
    expect(calls.filter((c) => c.includes("dzcdn.net")).length).toBe(1);
  });

  it("faixa ainda não resolvida não tem capa nem prévia; arquivo que não é MP3 é recusado", async () => {
    const { fetcher } = await fake({ "https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3?hdnea=exp=1": () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
    const m = musicService(fetcher);
    expect(await m.cover(ID)).toBeNull();
    expect(await m.preview(ID)).toBeNull();
    await m.resolve(`https://open.spotify.com/track/${ID}`);
    expect(await m.preview(ID)).toBeNull();
  });

  it("sem a faixa no Deezer, o cartão sai sem prévia; página fora do ar dá null", async () => {
    const empty: Fetcher = async (url) =>
      url.startsWith("https://api.deezer.com/search") ? Response.json({ data: [] }) : (await fake()).fetcher(url);
    expect((await musicService(empty).resolve(`https://open.spotify.com/track/${ID}`))?.previewSource).toBeNull();
    const down: Fetcher = async () => new Response("erro", { status: 503 });
    expect(await musicService(down).resolve(`https://open.spotify.com/track/${ID}`)).toBeNull();
    expect(await musicService(down).resolve("https://example.com/qualquer")).toBeNull();
  });

  it("redirecionamento para fora dos hosts permitidos é ignorado", async () => {
    const evil: Fetcher = async () => {
      const r = new Response(PAGE, { headers: { "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: "https://evil.com/x" });
      return r;
    };
    expect(await musicService(evil).resolve(`https://open.spotify.com/track/${ID}`)).toBeNull();
  });
});
