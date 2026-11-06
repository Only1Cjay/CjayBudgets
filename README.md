# CjayBudgets

**BUDGETSxSAVINGS — a personal finance tracker for budgeting and saving, built for one person's real money.**

CjayBudgets is a simple, offline-first web app for tracking income, expenses, and savings in naira (₦). It was built by a PharmD student at the University of Benin to manage a student budget — allowance in, food, transport, and data out, with a savings pot on the side. There is no account to create and no server: your data lives in your own browser, with optional sync to your own Google Drive.

## Features

- **Budget tab** — log income and expense entries with a date, category (free text, e.g. Food, Transport, Data), description, and amount. Mark entries as recurring where they repeat.
- **Monthly view** — flip between months, or jump to a month with the period picker. Summary cards show income, expenses, and net for the period; tapping a card shows the detail behind it.
- **Monthly budget tracker** — set an optional monthly budget total and split it into envelopes per category, then watch spending against each envelope.
- **Weekly snapshot** — a quick view of spending so far this week.
- **Savings tab** — a deposits-and-withdrawals ledger with a running total saved.
- **Savings goal** — set an optional goal (label + target amount) and track progress towards it.
- **Search and filter** — find entries and ledger items quickly.
- **Edit and delete** — open any entry or ledger item to change or remove it.
- **Print** — print a monthly budget view or a savings statement (via the browser's print dialog).
- **Local backup & restore** — export all data as a JSON file (`cjay-budgets-backup-YYYY-MM-DD.json`) and restore from a backup file later.
- **Google Drive sync (optional)** — sign in with Google to back up and sync your data to a folder in your own Drive. Google API calls are never cached; everything else works offline.
- **View-only mode** — open the app with `?view=1` for a read-only look (editing is hidden; sample data is shown if there is none yet).
- **Dark & light themes** — one-tap toggle, remembered on the device.
- **Offline PWA** — installable on your phone's home screen; a service worker caches the app so it works without internet, and notifies you when an update is available.

## How to use

1. Open the app in a browser (or install it to your home screen from the browser menu).
2. Tap **+** to log your first income or expense.
3. Switch between the **Budget** and **Savings** tabs at the top.
4. Use the menu (☰) for Search, Budget Plan, Savings Goal, and Settings.
5. In Settings you can connect Google Drive sync and export a local backup.

No installation, build step, or account is needed — it runs entirely as static files.

## Tech stack

- Plain HTML, CSS, and JavaScript — no framework, no build step
- Data stored in the browser's `localStorage` (key: `cjay_budgets_v1`)
- Google Drive API (via `gapi` + Google Identity Services) for optional sync
- Font Awesome 6.5.0 and Google Fonts (Sora, Inter) via CDN
- Service worker (`sw.js`, currently v1.1.4) + web app manifest for offline use and installability

## Project structure

```
CjayBudgets/
├── index.html    # App shell: top bar, Budget/Savings tabs, modals, FAB
├── app.js        # All app logic: entries, budgets, envelopes, savings,
│                 #   search/filter, Drive sync, backup/restore, printing
├── styles.css    # All styling, including dark/light themes
├── sw.js         # Service worker (offline cache, update notifications)
├── manifest.json # PWA manifest (name, icons, standalone display)
├── icon.svg      # App icon
└── README.md     # This file
```

## Status

Actively used by its author; the most recent commit at the time of writing was 1 October 2026. Data is stored locally in the browser, so clearing browser data without a backup or Drive sync will lose it — export a backup from Settings every so often.
