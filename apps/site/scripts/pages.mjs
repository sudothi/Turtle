// Pós-build para o GitHub Pages: uma pasta por página (/download/) e 404.html que volta para o início.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
mkdirSync(new URL("download/", dist), { recursive: true });
copyFileSync(new URL("index.html", dist), new URL("download/index.html", dist));
copyFileSync(new URL("index.html", dist), new URL("404.html", dist));
writeFileSync(new URL("CNAME", dist), `${process.env.SITE_DOMAIN ?? "ogturtle.xyz"}\n`);
writeFileSync(new URL(".nojekyll", dist), "");
