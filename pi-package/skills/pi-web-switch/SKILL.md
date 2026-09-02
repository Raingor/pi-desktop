# pi-web-switch

A web-based dashboard for managing your pi coding agent's providers, models, token usage, sessions, and settings.

## Features

- **Dashboard**: Real-time token usage, cost tracking, cache hit rate, request logs
- **Models**: Browse, enable/disable, add/edit/delete models
- **Providers**: Manage built-in and custom providers, API keys
- **Sessions**: Browse past sessions grouped by project, delete old sessions
- **Memory**: View pi-hermes-memory content (MEMORY.md, USER.md, failures.md)
- **Settings**: Defaults, theme (Light/Dark/System), packages, import/export
- **Multi-language**: English, 简体中文, 繁體中文, 日本語

## Commands

### Start the dashboard

```
/pi-web-switch start
```

Opens the web UI at `http://localhost:5173`. The dashboard reads data directly from `~/.pi/agent/` — no setup required.

### Stop the dashboard

```
/pi-web-switch stop
```

### Check status

```
/pi-web-switch status
```

## Requirements

- pi coding agent installed and configured (`~/.pi/agent/` exists)
- Node.js 18+

## Usage

1. Run `/pi-web-switch start` in your pi session
2. Open `http://localhost:5173` in your browser
3. The dashboard automatically loads your pi configuration

## Data Source

All data is read from `~/.pi/agent/`:

| File | Description |
|------|-------------|
| `settings.json` | Provider, model, theme, packages config |
| `auth.json` | API keys per provider |
| `models.json` | Custom provider definitions |
| `sessions/*.jsonl` | Session history with token usage |
| `pi-hermes-memory/*.md` | Memory content |

Changes made in the UI are written back to these files in real time.
