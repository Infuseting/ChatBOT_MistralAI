# MistralChat — Open Assistant (Unofficial)

A polished, self-hostable chat application that uses Mistral AI models to power responses. It includes Google authentication, per-user threads, server-issued access tokens stored as secure HTTP-only cookies, and a minimal admin/persistence layer using Prisma + MySQL.

---

## Table of Contents

- [Name & Purpose](#name--purpose)
- [Introduction](#introduction)
- [Demo / User guide](#demo--user-guide)
- [Prerequisites](#prerequisites)
- [Installation and Setup](#installation-and-setup)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Authentication Flow](#authentication-flow)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [Contact](#contact)
- [License](#license)

---

## Name & Purpose

Project name: **MistralChat — Open Assistant (Unofficial)**

This repository is a demonstration chat application built on top of Mistral AI (community SDK). It's aimed at developers who want a self-hosted, extensible chat UI that supports:

- Google OAuth sign-in
- Server-issued access tokens (stored in DB)
- Threaded conversations saved per user
- Integration with Mistral AI models (via `@mistralai/mistralai`)
- Prisma for data persistence

---

## Introduction

MistralChat is a lightweight chat UI + backend stack that showcases how to wire up authentication, persistence, and model-backed chat responses. The app is suitable for prototyping, internal tools, and experimentation with LLMs.

Target audience: Everybody who already use LLMs

---

## Demo / User guide

Quick demo (server):
 
1. Visit [`https://chatbot.infuseting.fr`](https://chatbot.infuseting.fr/) and sign in with Google.
2. Get your [API key](https://admin.mistral.ai/organization/api-keys) from Mistral.
3. Create or open threads, send messages, and see model responses.


Tip: use the `Share` functionality to open a shared thread URL.

Picture of Home Page  
![Home page](readme/main.png)

Picture of Model Config where you can set your [API key](https://admin.mistral.ai/organization/api-keys), model in Fast List and default model for all the thread  
![Model Config Page](readme/model.png)

Fast Config to modify the context and the model of the actual thread  
![Fast Config Page](readme/config.png)



---

## Prerequisites

- Node.js (v18+ recommended)
- npm (or pnpm/yarn)
- A database supported by Prisma (MySQL is recommended)
- Google OAuth credentials (Client ID) configured for `http://localhost:3000` redirect
- Mistral [API key](https://admin.mistral.ai/organization/api-keys) 

---

## Installation and Setup

1. Clone the repo:

```bash
git clone https://github.com/Infuseting/ChatBOT_MistralAI.git
cd ChatBOT_MistralAI
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` in the repo root with at least:

```env
DATABASE_URL="mysql://<username>:<password>@<url>:<port>/chatbot"
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
NODE_ENV=development
```

4. Prisma setup (run the migrations):

```bash
npx prisma generate
npx prisma migrate dev
```

5. Start the dev server:

```bash
npm run dev
```

6. Open `http://localhost:3000` and sign in.

---

## Project Structure

Top-level layout:

```
src/
  app/
    api/            # Next.js API routes (auth, user, thread, validate)
    components/     # React components (Chatbot, Navbar, Modals...)
    login/          # Login page
    layout.tsx      # App root layout
  lib/
    prisma.ts       # Prisma client
  utils/            # Helpers (User, Thread, Messages...)
  middleware.ts     # Auth middleware validating tokens
```

---

## API Reference

High-level endpoints (see `src/app/api`):

- `POST /api/auth/google/token` — Exchange Google id_token, create server access token, sets HTTP-only cookie.
- `POST /api/auth/logout` — Revoke token (deletes from DB) and clears cookie.
- `GET /api/auth/validate` — Validate `access_token` against the DB (used by middleware).
- `GET /api/user` — Returns current user (reads cookie or Authorization header).
- `GET/POST /api/thread` — Thread listing and creation; Protected.

---

## Authentication Flow

- Client obtains `id_token` from Google sign-in.
- Client posts `id_token` to `/api/auth/google/token`.
- Server verifies the token with Google, upserts the user, creates a `accessToken` record, and sets `access_token` cookie (HTTP-only, secure).
- Middleware and API routes read the cookie or Authorization header and validate the token against DB.

Security notes:
- Access tokens are stored server-side and sent as HTTP-only cookies to reduce XSS risk.
- For high-scale deployments, consider signed JWTs so middleware can validate without DB calls.

---

## Roadmap (❌/✅)

|    Features    | Smartphone | Tablet | Computer |
|:--------------:|:----------:|:------:|:--------:|
|Remote Storage|✅|✅|✅|
|Thread|✅|✅|✅|
|Responsive|✅|✅|✅|
|Model and Context configurator|✅|✅|✅|
|Login with Google OAUTH| ✅|✅|✅|
|Edit & Regenerate Request|❌ | ❌ | ❌ |
|Login with Email| ❌ | ❌ | ❌ |
|Deep Thinks integration | ❌ | ❌ | ❌ |
|Model Features viewer | ❌ | ❌ | ❌ |
| File input | ❌ | ❌ | ❌ |
| Audio Call | ❌ | ❌ | ❌ |


---
## Documentation / Help Center

All the code is already documented and if you have any issues you can open issues directly on github

---

## Contributing

Ce projet a pour objectif de me permettre de demontrer mes competences a un employeur. Ainsi je n'autoriserais pas vraiment les contributions autrement que par les suggestions neanmoins si vous le souhaitez vous pouvez crée une fork du projet. Et je serais très content de voir ce que vous pouvez en faire.

Contributors:
- @Infuseting (owner)

---



## Acknowledgements

- Mistral AI and community SDKs
- My friend who give me idea

---

## Contact

If you want to collaborate or report issues, open a GitHub issue or contact the maintainer: `serretarthur@gmail.com`

---

## License

This project is provided under the MIT License 