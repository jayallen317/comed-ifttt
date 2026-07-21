# ComEd → IFTTT on GitHub Actions

Replaces the Pipedream workflow, which stopped running when the free-tier
credit allowance (100/month) was exhausted. GitHub Actions has no equivalent
cap for public repos, and a generous free allowance for private ones.

## Repo layout

```
your-repo/
├── check-price.js
├── state.json
└── .github/
    └── workflows/
        └── comed.yml      <- this is comed.yml, moved into that path
```

Note the workflow file **must** live at `.github/workflows/comed.yml`.
GitHub ignores it anywhere else.

## Setup

1. **Create the repo.** github.com → New repository. Private is fine.
   (If you make it public, Actions minutes are unlimited; private repos get
   2,000 free minutes/month and this job uses roughly 1 minute per run —
   see the note below.)

2. **Add the files** in the layout above.

3. **Add your IFTTT key as a secret.**
   Repo → Settings → Secrets and variables → Actions → New repository secret.
   - Name: `IFTTT_KEY`
   - Value: your IFTTT Webhooks key

   Add it as a secret, not in the code. The old Pipedream version had the key
   inline in the script; anyone with read access to this repo would see it.

4. **Allow Actions to push.** Settings → Actions → General → Workflow
   permissions → "Read and write permissions". The job needs this to commit
   `state.json` back after a state change.

5. **Test it.** Actions tab → "ComEd price check" → Run workflow. Check the
   log output, then confirm the event landed in your IFTTT activity feed.

## About the schedule

`*/10 * * * *` is every 10 minutes. Two things worth knowing:

**Private repos burn minutes.** Every 10 minutes is ~4,400 runs/month, and
GitHub bills a minimum of 1 minute per run — that overruns the 2,000-minute
free tier for private repos. Either make the repo public (unlimited minutes),
or widen the cron to `*/30 * * * *` (~1,450 runs, still over) — realistically,
**public repo is the answer** if you want 10-minute checks for free. The repo
contains no secrets, so public is safe here.

**GitHub cron is best-effort.** Scheduled runs get queued and can be delayed
several minutes during peak load, and GitHub disables schedules on repos with
no activity for 60 days. The state-change design makes delays harmless — a
late check still catches the current price. For the 60-day rule, any commit
resets the clock, and this workflow commits `state.json` on every state
change, so it keeps itself alive.

## Behavior change from the Pipedream version

The old script fired an IFTTT event on **every** run — ~144 events/day, each
one re-issuing the same command to the Ecobee. This version tracks the last
known state in `state.json` and fires only when the price **crosses** the
threshold. Expect a handful of events per day instead of 144.

Thresholds, from the original: **5¢ during 6am–10pm Chicago, 3¢ overnight.**
DST is handled automatically. To change them, edit the constants at the top
of `check-price.js`.

## Verified before handoff

Tested locally with the IFTTT call stubbed out:

- no prior state, low price → fires `comed_price_low`
- price stays low → no event
- price crosses to high → fires `comed_price_high`
- price stays high → no event
- price drops back → fires `comed_price_low`
- missing `IFTTT_KEY` → exits 1 with a clear message
- day/night boundaries at 6am and 10pm Chicago, in both CST and CDT

The live ComEd feed was also confirmed healthy and returning current data.
