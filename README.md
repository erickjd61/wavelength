# Wavelength

Live classroom icebreakers, based on Noah O'Donnell's Wavelength design. Students join from their own phones, the facilitator runs the session from a laptop or phone, and the projector shows the room what to do. Everything stays in sync in real time.

## The three screens

| Who | Address | What it does |
|---|---|---|
| Students | `/` or `/CODE`, e.g. `/BIO101` (the QR code) | Join with the class code, get a color group, follow each activity, answer the teacher's questions, save who they met |
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

## Privacy model

- When a student joins, their phone gets a secret key. Every student request must carry it, so knowing a classmate's id (which is in the roster) is not enough to read or change their data.
- Connections are requests: A asks, B accepts or declines. Contact details are shared only after acceptance, and only the fields each student chose to share (off by default). Declines are never revealed to the sender.
- Facilitator data requires the class PIN. The projector view contains names and groups only.
- Classes are erased after 60 days without use; **Wrap-up → Delete class data** erases one immediately.

## Email rules

`shared/validate.js` is used by both the phone and the server. Each class has an `emailPolicy` (`required: true`, `domains: []`). Adding a domain, e.g. `['purdue.edu']`, limits sign-up to that domain and its subdomains.

## Testing

- `npm test` runs the server tests against an in-memory database (`scripts/mock-redis.js`).
- `npm run dev` runs the whole site locally on http://localhost:5173 with in-memory data.
- Preview deployments (any branch other than `main`) store data under a separate `wlp:` prefix, so they never touch live classes.
