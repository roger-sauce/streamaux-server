# CLAUDE.md

House rules for this repository. Read before touching anything.

## Language

English is the default for everything the machine keeps.

- Code comments: English, plain ASCII. A comment says WHY, not what.
- Error strings that can travel into a UI: English.
- UI texts: English.
- Documents: English.
- Commit messages: English, plain ASCII, one line, what changed and what for.
  No prefixes such as "feat:".

Two exceptions, both deliberate:

- The conversation with the maintainer is German.
- The two KONTEXT documents stay German. They are a handover written for one
  reader, not code, and they are kept out of the repository (see below).

Older German comments under apps/adapters/radiostations/ are converted when a
file is opened for another reason, never in a pass of their own.

Say the ANSWER, not the mechanism. A line of UI earns its place by carrying
something the reader cannot already see: "Support Concert Guide" is the status
that matters, and how a station gets there is the adapters business.

## What must not be committed

This repository is private today and may not stay that way. Everything that
would describe the home network to a stranger is therefore kept outside it,
and .gitignore says so with a reason beside each entry: the internal
documents, the network diagrams, the measurement and debug directories, the
TLS keys, and .env.

Two things about that are easy to get wrong.

A .gitignore does NOT act backwards. A file committed before its entry was
added stays tracked and keeps being committed. Worth checking with
`git ls-files` rather than assuming, and `git rm --cached` is the fix.

And `git rm --cached` only affects what happens next. Anything already pushed
remains in the history, so for a repository that is to be made public the
honest route is a fresh, empty one that only the intended code is copied into.

## Working method (binding)

- Never create or change a file without the maintainer's explicit consent.
  This includes supposedly trivial helper files. Analyse, explain, propose the
  concrete commands. He runs them.
- No comment lines inside bash blocks, and no "!" inside double quotes. His
  zsh trips over both.
- One command per block. Several in one block merge into a single line when
  they are pasted.
- Assume the assistant cannot delete files in this checkout, only write them.
  In a git clone, `git rm -f` is the right way and it is the maintainer who
  runs it.
- Stay out of git in his working copies. A stale .git/index.lock left behind
  by a stray command costs him more than the command saved.
- One station at a time, each checked on its own, on his machine first. Deploy
  the batch later.
- Network tests run at his end. Several broadcasters answer differently, or
  not at all, from a data centre, so a green result from anywhere else proves
  nothing about the station.
- Pure rule logic is checked offline by overriding global.fetch, not by
  eyeballing the patterns.
- Everything that can be checked before the push is checked before the push.
  Commit and push come afterwards -- otherwise we commit something the test
  then fails on.

      cd apps && npm test

  Node's own runner, no dependency. The checks live in `apps/checks/` and each
  one names the incident that made it necessary. A rule with a new case gets a
  new check in the same commit; a check that cannot fail is worse than none, so
  break the rule once and see it go red before trusting it.
- dispatch.js is always fetched fresh, never from an earlier copy. It is the
  most fragile file here: it is the one place every adapter is wired in, and a
  stale copy silently unwires the ones added since. After every change to it,
  the load test comes before anything else.

## Where things are

- apps/autoplay-pi/       the server, dispatch.js, Roon
- apps/adapters/          one file per house, plus the shared scorer
- ios/StreamAux/          the iOS app
