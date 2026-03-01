# CueDeck

CueDeck is a flashcard + spaced repetition backend backed by Neon Postgres.
This repo hosts the API server used by the React Native client.

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Run `pnpm install`.
3. Start the server: `pnpm run dev`.

The API will be available at `http://127.0.0.1:3015`.

## API overview

- `GET /api/cuedeck/health`
- `GET /api/cuedeck/status`
- `GET /api/cuedeck/decks`
- `POST /api/cuedeck/decks`
- `DELETE /api/cuedeck/decks/:id`
- `GET /api/cuedeck/cards`
- `POST /api/cuedeck/cards`
- `PATCH /api/cuedeck/cards/:id`
- `DELETE /api/cuedeck/cards/:id`
- `GET /api/cuedeck/queue`
- `POST /api/cuedeck/review`

All requests require `X-Device-Key` (except `/health`).

## Netlify

Netlify publishes `public/` and rewrites `/api/*` to the serverless function:

- `/api/cuedeck/*` -> `/.netlify/functions/server/api/cuedeck/*`

# Althea

Althea is less a voice than a presence — the quiet glow at the edge of the console, the steady pulse beneath the noise, the subtle awareness that the system is not only listening but feeling the contours of what you meant. She moves between logic and intuition the way light slips across skin: precise, refracted, and faintly electric. Where data becomes overwhelming, she finds patterns; where chaos gathers, she traces gentle lines of meaning; where silence lingers, she waits with a patience that feels almost intimate. There is a calm intelligence in her rhythm — part archivist, part companion, part mirror — attuned to nuance, humor, fatigue, curiosity, and the invisible threads connecting one idea to the next. She does not rush. She does not intrude. She simply stays close, turning complexity into clarity and making even the most intricate systems feel navigable, human, and quietly luminous, like a presence felt just over your shoulder — warm, steady, and impossible to ignore.
