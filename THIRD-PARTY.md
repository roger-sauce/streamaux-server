# Third-party software

What this project is built on, and under which licence each part is available.
Compiled on 02.11.2026 from `apps/package-lock.json`, the two Dockerfiles and
`apps/roon-trigger/package.json`; the versions are the ones pinned at that
date, not the newest in existence.

Not one of these is copyleft. That is why this project can be released under
the PolyForm Noncommercial licence without asking anyone: permissive licences
allow a work built on them to be distributed under different, even narrower,
terms, as long as their own notices travel along. Those notices are below, and
each package carries its full text in its own folder once `npm install` has
run.

## Runtime dependencies, Node

Installed into the `autoplay-pi` image from `apps/package.json`:

| Package | Version | Licence |
|---|---|---|
| playwright | 1.61.1 | Apache-2.0 |
| playwright-core | 1.61.1 | Apache-2.0 |
| node-html-parser | 9.0.0 | MIT |
| css-select | 5.2.2 | BSD-2-Clause |
| css-what | 6.2.2 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| domelementtype | 2.3.0 | BSD-2-Clause |
| dom-serializer | 2.0.0 | MIT |
| entities | 4.5.0, 8.0.0 | BSD-2-Clause |
| nth-check | 2.1.1 | BSD-2-Clause |
| boolbase | 1.0.0 | ISC |
| fsevents | 2.3.2 | MIT |

`fsevents` is macOS-only and is present for development on a Mac; it is not
used on the Raspberry Pi.

## Runtime dependencies, Roon extension

Installed into the `roon-trigger` image from `apps/roon-trigger/package.json`,
all four from Roon Labs and all four Apache-2.0:

| Package | Source | Licence |
|---|---|---|
| node-roon-api | github:roonlabs/node-roon-api | Apache-2.0 |
| node-roon-api-browse | github:roonlabs/node-roon-api-browse | Apache-2.0 |
| node-roon-api-transport | github:roonlabs/node-roon-api-transport | Apache-2.0 |
| node-roon-api-status | github:roonlabs/node-roon-api-status | Apache-2.0 |

They are fetched from GitHub rather than from npm because that is where Roon
Labs publishes them.

## Build and development only

Not shipped in any image; needed to check the code:

| Package | Version | Licence |
|---|---|---|
| typescript | 7.0.2 | Apache-2.0 |
| eslint | 10.7.0 | MIT |
| @types/node | 20.19.43 | MIT |

The ESLint plugin tree adds a further sixty-odd packages, MIT, Apache-2.0,
BSD-2-Clause, ISC and BlueOak-1.0.0 between them. `npm ls --all` lists them;
`npx license-checker` prints their licences.

## Container images

| Image | Contains | Licence |
|---|---|---|
| node:24-trixie-slim | Node.js on Debian 13 | Node.js: MIT. Debian: a few hundred packages, mostly GPL-2+, LGPL and permissive |
| node:20-alpine | Node.js on Alpine 3.23 | Node.js: MIT. Alpine: mostly MIT and GPL-2 |
| caddy:2-alpine | Caddy web server | Apache-2.0 |

## Programs called as programs

Two parts do the heavy lifting and are **separate executables**, started as
child processes. They are not linked into this code, so their copyleft terms
govern those programs and not this project. This is the distinction that
matters for anyone reading the licence of the whole:

| Program | Where from | Licence |
|---|---|---|
| ffmpeg | Debian package in the autoplay-pi image | GPL-2+ as Debian builds it, parts LGPL |
| Chromium | installed by `playwright install` | BSD-3-Clause, with a long list of its own third parties |
| alsa-utils | Debian package | GPL-2+ |

Anyone redistributing the **image** rather than this source distributes ffmpeg
and Chromium along with it and inherits their obligations. Nobody distributing
only this repository does.

## Services, not software

The adapters talk to broadcasters' own interfaces -- the BBC, ARD, Radio
France, NRK, RAI, RTVE, DR, Sveriges Radio, SRF, VRT, Polskie Radio, RTÉ, ORF,
Concertzender and others. Those are not dependencies and carry no licence to
this project; each broadcaster's terms of use apply to whoever queries them,
and some of them say in plain words that recordings are for personal listening
only. That is between the person running this and the station, and it is worth
reading before pointing a resolver at a public service broadcaster.

## Names and logos

Station names and marks belong to the broadcasters. They appear in the app to
point at those stations and for no other purpose; **no licence is claimed and
no affiliation, sponsorship or endorsement is implied**.

The marks were assembled from publicly available sources and no permission was
sought, because the app is private and noncommercial. To be precise about what
that is and is not: material offered for free use on Wikipedia and elsewhere is
often non-free content under that site's own rules, which do not pass to anyone
else. So this is a statement of where the files came from, not of a right to
them.

**Any of them can be removed on request, and removing one changes nothing
else.** The app looks the mark up in its asset catalogue and falls back to the
station's name wherever none is there -- see `hasImage()` in
`SourcesSection.swift` -- so a row without a mark is a row with a name on it,
not a gap. One file, no layout to repair. Write to 36forlive@gmail.com.

The logos are not in this repository. They live in the app, which is handed out
on request.

## Roon

Roon and the Roon API belong to Roon Labs LLC. This project is not affiliated
with, endorsed by, or supported by Roon Labs.
