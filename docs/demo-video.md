# Make a demo video with Claude

A 60 to 90 second video is your backup if the live demo fails, and it lets judges see your work again later. Claude can make it for you: it drives your app like a real person, records the screen, and cuts a motion-designed video around what judges score.

## What you need

- **Claude Code** (in the terminal, the desktop app or claude.ai/code), opened in your project folder.
- Node.js 20 or newer. Claude installs the rest (Playwright to record, Remotion to edit).
- Your app running, or a URL for it.
- About 10 minutes. Start by 3:30 so it's done before the 4:00 freeze.

## The prompt

Copy this, fill in the four blanks, and paste it into Claude Code.

```text
Make a 60–90 second demo video of our prototype for the judges.

Team: [name] · App: [URL, or how to start it] · Track [1/2/3] · For: [one person: who, where, language, phone] · Test data only.

1. Record: drive the real app with Playwright at phone size (390×844). Do the one core task as that person, start to finish. Record the screen. No faked screens; if a step is mocked, say so on screen.
2. Edit: turn the recording into a motion-designed MP4 with Remotion (1080×1920, 30 fps, under 90 s). Beats:
   - Who (5 s): team, track, the person it's for.
   - Why (10 s): their problem in one line. → redemptive potential
   - Do it (40–60 s): the live flow, zoom to each tap, one short caption per step. → usable by the end user
   - Proof (10 s): the result landing for real (saved, dashboard moves). → technical viability
   - Real vs mocked (5 s): one honest line, plus what Baptize would need next.
   Large captions, high contrast, smooth zooms. No voiceover needed.
3. Check it: watch your own render (sample frames), fix anything unreadable, then give me the file path and length.
```

The beats follow the judging: **redemptive potential** (who and why), **usable by the end user** (the flow), **technical viability** (proof it works). See [judging](judging.md).

Tested on Oct 23 against a sample Track 1 prototype: one run of Claude Code made a 74-second, 1080×1920 video in about 8 minutes, caught and fixed its own cropped zooms, and said plainly what was real and what was mocked.

## Then

1. Watch it once yourself.
2. Upload it: YouTube (unlisted), Google Drive or Loom, shared as "anyone with the link".
3. Paste the link in the **Demo video** field on the [submission form](submission.md).

## No code, or no time?

Record your phone screen while you use the prototype (iPhone: Control Center, Screen Recording; Android: Quick Settings, Screen record). Say out loud who it's for, do the task, show the result. Upload it the same way.
