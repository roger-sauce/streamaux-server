# streamaux-server

Takes the address of a radio broadcast and finds the audio behind it, so that
Roon can play it.

Paste the page of a concert -- a BBC Radio 3 episode, an NTS show, a
Concertzender recording, a Mixcloud set -- and this answers with a stream URL
and a tracklist. Thirty stations and thirty-three archives and platforms have an
adapter each; what they have in common is that none of them offers a plain
audio link on the page a listener actually sees.

**This repository is the server half.** The iOS and macOS app that shares a URL
into it is not here -- see [The app](#the-app) at the end.

It runs on a Raspberry Pi in the same house as a Roon core. It is a private
project, published because a few people in the Roon community asked how it
works, and it is offered with **no warranty of any kind** -- see
[LICENSE](LICENSE).

## What it does

```
  a page address                        the StreamAux app, or curl
         |
         v
  dispatch.js  -- picks the adapter that recognises the address
         |
         v
  one of 63 adapters  -- reads the page or the station's own API,
         |                sometimes with Playwright where a player
         |                only exists after JavaScript has run
         v
  { title, streamUrl, tracklist }
         |
         v
  ffmpeg  -->  ALSA loopback  -->  Roon
```

The last step is the part people usually do not expect. Roon has no "play this
URL" call, so the audio is pushed into an ALSA loopback device that Roon reads
as a live radio station, and a small Roon extension (`roon-trigger`) starts
that station in the zone you chose.

## What you need before any of this works

Honest list, because the chain is longer than the code:

- **A Roon core** on the same network, and a Roon subscription.
- **Roon Extension Manager** with **Entrypoint Gateway** and **Audio
  Entrypoint** installed and enabled. These are TheAppgineer's extensions and
  are what present the loopback to Roon as a station. Without them there is
  nothing for ffmpeg to play into.
- **A Linux host with Docker**, arm64 or amd64. Developed on a Raspberry Pi 5
  with Raspberry Pi OS (Debian 13).
- **The ALSA loopback module**, `snd-aloop`. This is the fiddly part; it has
  a section of its own below.
- **A TLS certificate** if you want HTTPS on the local network. The setup here
  uses [mkcert](https://github.com/FiloSottile/mkcert); a self-signed pair
  works as well.

## Deploying

Two independent compose stacks. Both are built on the machine they run on --
there are no published images, and an arm64 image built on a Mac is not the
same thing as one built on the Pi.

### 1. The resolver

```
git clone https://github.com/roger-sauce/streamaux-server.git
cd streamaux-server/apps/autoplay-pi
```

The server refuses to start without a shared secret. Put one in `.env` next to
the compose file -- the file is deliberately not in git:

```
printf 'AUTOPLAY_KEY=%s\n' "$(openssl rand -hex 32)" > .env
```

Certificates, if you want the HTTPS port:

```
mkdir -p caddy/certs && mkcert -cert-file caddy/certs/autoplay.pem -key-file caddy/certs/autoplay-key.pem your-host.local
```

Then build and start it. The first build takes a while: it installs Chromium
through Playwright.

```
docker compose up -d --build
```

Two ports: **8072** plain HTTP, and **7443** HTTPS through Caddy. Health check:

```
curl -s localhost:8072/health
```

Resolve something by hand, which is the quickest way to see whether the chain
works at all:

```
docker compose exec -T autoplay-pi node try-adapter.js "https://www.nts.live/shows/..."
```

It prints which adapter caught the address, what it answered, and then checks
the stream with a range request -- an archive recording has a length, a
livestream does not, and that single number is what tells the two apart.

### 2. The Roon extension

```
cd ../roon-trigger
mkdir -p roon-config && sudo chown -R 1000:1000 roon-config
docker compose up -d --build
```

Set `ROON_STATION_NAME` in that compose file to the exact title of your
"My Live Radio" entry -- the default is the one on the author's machine and
will not match yours.

Then in Roon: **☰ → Settings → Extensions → Enable** next to "Roon Trigger".
Roon's pairing protocol needs that click once; it cannot be automated.

```
curl -s localhost:4000/api/zones
```

Once that lists your zones, the extension is paired.

### 3. The ALSA loopback

The step that takes the longest, and the one that breaks again later without
saying so. `snd-aloop` is a kernel module that makes a virtual sound card:
whatever is written into one side can be read out of the other. ffmpeg writes,
the Audio Entrypoint extension reads, and Roon sees a radio station.

Load it once and check that it is really there:

```
sudo modprobe snd-aloop
```

```
lsmod | grep snd_aloop
```

Make it survive a reboot:

```
echo "snd-aloop" | sudo tee -a /etc/modules
```

Find out which card it became, and which device number is which side. The
loopback shows up in both lists, and the numbers from these two commands are
the ones that go into the configuration:

```
aplay -l
```

```
arecord -l
```

Prove it carries sound before Roon is anywhere near it. A thousand hertz into
the playback side:

```
speaker-test -D hw:0,1 -c 2 -t sine -f 1000 -r 44100
```

Then, in Roon: open the **Audio Entrypoint** extension's settings and choose
that sound card, and add its station URL under **My Live Radio → Add Station →
Add Station URL**. **The order matters:** start the test tone first and add
the station afterwards, otherwise Roon's validation of the URL fails because
nothing is coming out of it yet.

Finally put the device into `apps/autoplay-pi/docker-compose.yml` as
`ALSA_DEVICE`, in the form `hw:<card>,<device>`.

**The trap, and it will happen to you.** The card index moves. After a kernel
or OS update the loopback here went from card 3 to card 0. Nothing announces
it and nothing fails loudly -- the symptom is silence. So after every Pi OS
update: `aplay -l`, and then correct the number in **two** places, the
`ALSA_DEVICE` in the compose file and the sound card in the Audio Entrypoint
extension's own dropdown. The second one is the one everybody forgets.

**And the container needs the audio group by number.** `group_add: "29"` in
the compose file is the numeric GID of `audio` on this Debian-based Pi OS. The
group name does not work there; look yours up with `getent group audio`.

## There is no web interface, on purpose

`public/` holds a browser UI that is no longer served, and it is not coming
back. Two reasons, the first of which settles it:

**A browser cannot send a header when it loads a page.** The server takes a
shared secret in an HTTP header on every call, and there is no way for the
address bar to carry one. A web UI would therefore have needed a second,
weaker way in -- a cookie, a session, a login -- which is a second way to get
the security of this wrong, for a machine that sits in a private network and
hands audio to Roon.

**And nobody missed it.** The old page was never good on a phone, which is
where it would have been used: the interaction is "I am reading about a
concert, send it over", and that is a share sheet, not a web form. The native
app does that in one gesture and the browser never could.

## What else is in here

`systemd/`, `resolve-week.js`, `build-archive.js`, `audit-resolved.js` and
`retention.js` are **not part of StreamAux** and you can ignore all of them.

They are a nightly run that takes the broadcasts of a finished week, asks
every adapter whether a recording can still be reached, and records the answer
-- which is how one learns how long each station keeps things. That record
feeds a companion app, a radio concert guide, which is not in this repository.
The run needs a schedule feed in that guide's shape; without one it has
nothing to walk.

StreamAux works without any of it. They are here because they share the same
adapters, and keeping one copy of sixty-three adapters is the whole reason
this is one repository rather than two.

## Configuration, all of it

| Where | Name | Meaning |
|---|---|---|
| `apps/autoplay-pi/.env` | `AUTOPLAY_KEY` | shared secret with the app. No default; without it the container exits |
| compose | `ALSA_DEVICE` | playback side of the loopback, e.g. `hw:0,1` |
| compose | `ROON_TRIGGER_URL` | where the extension listens, from inside the container |
| compose | `ROON_STATION_NAME` | exact title of the "My Live Radio" entry |
| environment | `PROBE_CONTACT` | the address the availability probe names as its operator |
| environment | `VRT_USER`, `VRT_PASSWORD` | only for VRT MAX, which releases recordings to signed-in users |
| environment | `PR_API_KEY` | only for Polskie Radio's article API |

## A word about the stations

Every adapter asks a broadcaster's own public interface, identifies itself
honestly in its User-Agent, and does not pretend to be a browser to get past a
bot defence. Several broadcasters say in their terms that recordings are for
personal listening; some are region-locked and the resolver records that
rather than working around it. What you do with a stream address is between
you and the station. See [THIRD-PARTY.md](THIRD-PARTY.md).

## The app

<!-- SCREENSHOTS GO HERE. Put the files in media/ and reference them as
     ![what it shows](media/name.png) -- media/ is tracked, unlike docs/,
     so publish-public.sh carries them over. Three or four are plenty: the
     share sheet taking a concert page, the zone picker, the tracklist, and
     one of Roon playing the result. -->

The Swift app -- share sheet, Roon zone picker, tracklist, handoff -- is not in
this repository and is not on the App Store. It is one person's app for one
household, and publishing a build would mean supporting it.

**If you want it, write to me:** 36forlive@gmail.com. Tell me roughly what you
run (Roon core, what kind of Pi, iPhone or Mac) and I will send the project or
a build.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). In short: use it for anything that is
not commercial, change it, pass it on, and expect no warranty and no liability
from me whatsoever. Commercial use needs a separate agreement -- ask.

Roon and the Roon API belong to Roon Labs LLC. This project is not affiliated
with Roon Labs.
