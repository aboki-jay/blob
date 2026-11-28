# Blob feedback relay

A small Cloudflare Worker. Blob's feedback form posts a rating and some text to it, and it emails them to the maintainer. It is the only server-side piece of Blob. Commenting never uses it, and Blob works without it: with no relay configured, the form's Submit button stays off and offers an email link instead.

It stores nothing and logs no message content.

## What it accepts

`POST` with a JSON body:

```json
{ "rating": "Good", "text": "Pins are easy to place", "version": "0.1.0" }
```

- `rating` is one of `Frustrated`, `Neutral`, `Okay`, `Good`, or left out.
- `text` is up to 2,000 characters, or left out. One of the two is required.
- Anything else in the body is ignored. The recipient, sender and subject cannot be set by the caller.

The limit is set to 5 messages a minute from one sender. Cloudflare's limiter counts approximately, so in practice it blunts a burst rather than enforcing the number exactly.

## Deploying it (maintainer)

You need the Cloudflare account that holds the sending domain. It works on the Workers Free plan, because feedback is only ever sent to your own verified address.

1. **Switch on Email Sending for the domain.** In the Cloudflare dashboard go to **Compute > Email Service > Email Sending**, select **Onboard Domain**, choose the domain, then **Done**.
2. **Check your inbox is a verified destination.** Under **Compute > Email Service > Email Routing > Destination Addresses** it should be listed as verified.
3. **Deploy**, from this folder:

   ```bash
   cd worker/feedback
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put FEEDBACK_TO
   ```

   `wrangler login` opens the browser to sign in. `wrangler deploy` puts the Worker at `https://blob-feedback.davidokunlola.com/` and creates the DNS record for it. `wrangler secret put` asks for a value: type the inbox from step 2. It is kept as a secret so the address is not in this repository. The same secret can be added in the dashboard instead: **Workers & Pages > blob-feedback > Settings > Variables and Secrets > Add**, type **Secret**, name `FEEDBACK_TO`.

4. **Try it:**

   ```bash
   curl -X POST https://blob-feedback.davidokunlola.com/ -H "content-type: application/json" -H "user-agent: blob-test" -d "{\"rating\":\"Good\",\"text\":\"Test from the terminal\"}"
   ```

   It should answer `{"ok":true}` and an email should arrive.

5. **Tell Blob where it is.** The address is `FEEDBACK_ENDPOINT` in [`lib/feedback.ts`](../../lib/feedback.ts). Rebuild after changing it.

### About the address

The Worker is served from the project's own domain, set in `routes` in `wrangler.jsonc`. Cloudflare's default `workers.dev` address is switched off, because it contains the account's name and Blob's code is public.

There are two `routes` entries for the same name. The first creates the address. The second is there because the domain's own website has a catch-all route that would otherwise answer for every subdomain; a route that names this one exactly takes priority. If the relay ever starts answering with the website instead of JSON, that second entry is the thing to check.

To run it on a different domain, change both `routes` entries and `FEEDBACK_ENDPOINT`.

## If something goes wrong

| Answer | Meaning |
| --- | --- |
| `503 not-configured` | `FEEDBACK_TO` has not been set. Run the `secret put` step. |
| `502 send-failed` | Cloudflare refused to send. Usually the domain is not onboarded for Email Sending, or the inbox is not a verified destination. `npx wrangler tail` shows the error code. |
| `429 too-many-requests` | More than 5 messages in a minute from one sender. Wait a minute. |
| `405` with an empty body, or a web page | The website's catch-all route answered instead of the Worker. See "About the address". |
| Deploy fails on `ratelimits` | Remove the `ratelimits` block from `wrangler.jsonc` and deploy again. The Worker runs without it, just with no per-sender limit. |

To change the sending address, edit `FEEDBACK_FROM` in `wrangler.jsonc`. It must be on a domain onboarded for Email Sending.

## Tests

`npm test` at the repository root covers the Worker's logic (`tests/unit/feedback-worker.test.ts`) with a stand-in for Cloudflare's email service. Nothing in the test suite sends real email.
