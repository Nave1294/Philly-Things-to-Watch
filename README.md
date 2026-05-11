# Philly Things to Watch

A personal timeline of things happening in Philadelphia worth keeping an eye on — transportation projects, development, parks, trials, politics, and whatever else you want to follow. Add projects from any device, log updates over time, see auto-fetched news headlines, and pin locations to a map of Philly.

The whole thing is a static site backed by GitHub Issues. No server, no database, no monthly bills.

## How it works

- **Each project is a GitHub Issue** in your repo (with structured data in the body and labels for category/status).
- **Each update is a comment** on that issue.
- **The site is plain HTML/CSS/JS** — runs in your browser, talks directly to the GitHub API.
- **Your GitHub Personal Access Token** lives only in your browser's `localStorage`. It never touches a server.
- **News headlines** are pulled from Google News RSS via [rss2json.com](https://rss2json.com).

## Setup (one-time)

### 1. Push the code

```bash
git push -u origin main
```

### 2. Enable GitHub Pages

- Go to your repo on GitHub → **Settings** → **Pages**
- Under **Source**, pick the branch (`main`) and `/ (root)`
- Save. After a minute your site will be live at `https://<your-username>.github.io/<repo-name>/`.

### 3. Create a Personal Access Token

- Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=Philly%20Things%20to%20Watch)
- Scope: `repo` (or `public_repo` if your repo is public)
- Copy the token (you only see it once).

### 4. Open the site

- Visit your GitHub Pages URL
- Click **⚙ Settings** (top right)
- Enter your repo as `owner/repo-name` and paste the token
- Save

You're done. Start adding projects.

## Using it from another device

Just open the same URL on the other device, click **⚙ Settings**, and paste your token again. That device now syncs with the same repo. Same token works on as many devices as you like.

## Features

- **Timeline view** sorted by recent activity; status conveyed by dot shape/fill (hollow, dashed, filled, half, check, X) rather than 8 different colors
- **Map view** with cream-toned tiles to match the editorial theme, plus terracotta pins for active projects (sage for completed, gray for cancelled)
- **Filters** by category and status
- **Search** across project names, descriptions, and locations
- **Sort** by recent updates, creation date, target completion, or status
- **Project detail view** with description, meta grid, manual update log, attached links, and auto-fetched news
- **Add updates** as you go — captured as issue comments so they're version-controlled
- **✦ Auto-fill (optional)** — when you set an Anthropic API key in Settings, the Add Project form gets an auto-fill button. Type a project name, click it, and Claude looks it up on the web and pre-fills category, status, description, dates, location, search terms, and links. Review and edit anything before saving.

## Adding a project

Click **+ Add Project**, fill in:

- **Name** — e.g. "Roosevelt Boulevard Subway"
- **Category** — Transportation, Development, etc.
- **Status** — Proposed / Planning / In Progress / etc.
- **Description** — what is this project?
- **Start date / Estimated completion** — optional
- **Location** — neighborhood or address (used for map pin)
- **News search terms** — comma-separated phrases for Google News (e.g. `"Roosevelt Boulevard Subway", "SEPTA Boulevard Line"`)
- **Links** — relevant articles or sources, one per line

## File layout

```
index.html        — page scaffolding
css/styles.css    — all styling
js/api.js         — GitHub API client (issues, comments, auth)
js/news.js        — Google News RSS fetcher
js/app.js         — UI, filters, timeline, map, modals
```

## Privacy & security

- Your token is stored in `localStorage` per browser. If you share a device, log out by clicking **Clear** in Settings.
- The site only talks to two external services: `api.github.com` (your GitHub repo) and `api.rss2json.com` (news headlines).
- Don't paste your token into a forked/untrusted copy of this site.

## Future ideas

- Notifications when a project hasn't been updated in N days
- Inline-edit updates instead of only adding new ones
- Email digest of recent activity
- A "next milestone" countdown widget
