# Wavelength

Live classroom icebreakers, based on Noah O'Donnell's Wavelength design. Students join from their own phones, the facilitator runs the session from a laptop or phone, and the projector shows the room what to do. Everything stays in sync in real time.

## The three screens

| Who | Address | What it does |
|---|---|---|
| Students | `/` or `/?c=CODE` (the QR code) | Join with the class code, get a color group, follow each activity, answer the teacher's questions, save who they met |
| Facilitator | `/teach` | Create a class (code + PIN), run the agenda and timer, push prompts, regroup, see answers and progress, export the roster |
| Projector | `/screen?c=CODE` | Join screen with QR, activity instructions with timer, groups by name, or blank. Controlled from `/teach` |

The facilitator can use the same code and PIN on a laptop and a phone at the same time.

## How it works

- Static front end (Preact + htm, no build step) and one serverless function: `api/rpc.js`.
- Class state lives in **Upstash Redis**. Phones check for changes every 3 seconds (the facilitator every 2), and a check costs one database command when nothing changed.
- No student accounts: a student's phone remembers their profile and their spot in each class. Facilitator actions require the class PIN.

## Setup on Vercel

1. Import this repository as a new Vercel project. No framework, no build command.
2. In the project's **Storage** tab, add **Upstash for Redis** (free plan) from the Marketplace and connect it to this project. That sets the database environment variables automatically. The code accepts either `KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`.
3. Redeploy so the new variables take effect.
4. Open `/teach`, create a class, and open the projector screen.

## Usage and cost (approximate)

A full 75-minute class with about 30 phones uses roughly 100,000 database commands; a 20-minute session uses roughly 30,000. Upstash's free plan includes 500,000 commands a month, so expect about four full-length classes (or many short ones) per month for free. Check the Upstash and Vercel usage pages after the first real class.

## Privacy

- Students see each other's names and groups only.
- Email and LinkedIn are optional, and go only to people a student connects with — and to the roster export — if the student chooses to share them.
- Answers to the teacher's questions are visible only to the facilitator; anonymous answers show without a name.
- Two truths stay on the student's phone.
- **Wrap-up → Delete class data** permanently erases a class from the database.

## Local development

`api/rpc.js` exports `handle(req)`; any small Node server that serves the static files and routes `/api/rpc` to it works for testing, with an Upstash-compatible REST endpoint (or a local stand-in) in the environment variables above.
