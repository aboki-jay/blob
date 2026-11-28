# Milestone 2: Shared threads

**Draft for the maintainer to review. Nothing here is built.** Building starts after Milestone 1 has had its Chrome walkthrough and its pull request is merged; see [STATUS.md](STATUS.md).

Use `grill-me` and its companion `grilling` for the remaining milestone decisions. For each flow, walk through the expected outcome and what happens when access changes, an operation fails or someone retries it. Discuss the trade-offs with the maintainer before recording a decision or implementing it.

## Done when

A person can sign in, choose one of their comments, and share it. Someone they send the link to can sign in, read the conversation and reply, with or without the extension. The owner can stop sharing, and the other person loses access straight away. Comments that were not shared never leave the device.

## Decisions made (27 November 2026)

| Question | Decision |
| --- | --- |
| When does a comment leave the device? | Only when its owner presses Share on that comment. Signing in uploads nothing. |
| Who can see a shared comment? | Someone who has its link **and** is signed in. Without signing in, nothing is shown. |
| Who can reply? | The same people who can see it. |
| How do people sign in? | Google sign-in first, handled by Blob's own server. An emailed one-time code is added as the last step, for people without a Google account. |
| What does the server keep? | The least that sharing can work with. See "What the server keeps". |
| What does "Stop sharing" do? | Switches the link off and deletes the server's copy, replies included. The owner's device keeps its own copy. |
| Where does the server live? | Cloudflare: Workers for the server, D1 for the database. Free at this scale. |

Why not Clerk for sign-in: its extension kit needs the `cookies` permission and host permissions, which Blob's manifest rules forbid, and its documentation says Google sign-in does not work inside an extension popup without a separate web app. Plain Google sign-in adds one permission (`identity`) and no extra service holding people's accounts.

A consequence worth knowing: "has the link and is signed in" means *any* signed-in person the link reaches, including someone it was forwarded to. Limiting a comment to named people is invitations, which is Milestone 3.

## What the server keeps

Sharing cannot work with nothing stored: a comment someone else can read has to be somewhere they can reach. The aim is to keep only that, and nothing Blob could use to learn about a person.

| Kept | Why | Until |
| --- | --- | --- |
| The shared conversation: comments and replies, the page's address and title, the short description of the pinned element | It is the thing being shared | Until the owner stops sharing, deletes it or the link reaches its chosen expiry. |
| For each account: a random Blob id, and the name shown beside that person's comments | To tell people apart and label their comments | The account is deleted |
| A scrambled fingerprint of the sign-in identity (Google's account number, or the email address) | To recognise the same person next time. The number or address itself is not stored. | The account is deleted |
| A scrambled fingerprint of each sign-in session | To keep someone signed in | Sign-out, or it expires |

Not kept: passwords (there are none), email addresses in readable form, profile pictures, unshared comments, browsing, internet addresses beyond what the limits need for a short time, analytics of any kind.

Two honest limits. A fingerprint of an email address stops Blob holding a readable list of addresses, but someone who already knows an address could test whether it has an account. And for the emailed code, the email service has to be given the address to deliver to; what it logs is under its policy, not Blob's.

## 1. Accounts

- "Sign in with Google" in the drawer and the popup. Guest use stays exactly as it is, with no nagging.
- An account is Blob's own record with sign-in methods attached, so the emailed code can be added later without reworking accounts.
- The display name comes from Google at first sign-in and can be changed. No password ever reaches Blob.
- Signing out keeps everything saved on the device.
- Delete account removes the account, its shared comments and its replies from the server. Comments on the device are untouched.
- Until the emailed code exists, the sign-in screen says that an existing email address can be used to create a Google account.

### Sign-in code decisions (28 November 2026)

These apply to step 7, the emailed one-time code.

The [sign-in email template](email/README.md#sign-in-code) includes the subject, inbox preview, HTML and plain-text copy.

- **Email service: Resend's free tier.** Read on 28 November 2026: 3,000 emails a month, 100 a day, and 30 days of log retention. Nothing is paid for. The cost is that Resend is given each address a code is sent to and keeps its logs for that long; PRIVACY.md must say so. The alternative considered was Cloudflare's paid plan (5 dollars a month, 3,000 emails included, log retention not published). Recheck the limits when step 7 starts.
- **When a code cannot be sent.** If the daily limit is reached or the service is down, Blob says "We couldn't send your code. Try again later, or sign in with Google." It never says a code was sent when it was not.
- **Rules for a code.** A code lasts 10 minutes and stops working after 5 wrong tries. Asking for a new one replaces the old one. At most one request a minute per address.
- **What the email says.** The code, how long it lasts, and one friendly line inviting feedback at blob@davidokunlola.com. Nothing about any conversation, page or person, because the email passes through another company. (Maintainer's decision, 28 November 2026.) No "buy me a coffee" or other payment line: the maintainer raised one and decided against it for this email, because a sign-in email with a payment link reads like a scam and teaches people to click links in sign-in emails. If a donation page is ever made, it belongs in the About section and the README.
- The maintainer creates the Resend account and its sending key. The key is a Worker secret, typed in by the maintainer and never written into the repository.

## 2. Sharing a comment

- A Share control on a conversation the person owns. Before anything is sent, Blob says plainly what will be uploaded: the comments and replies, the page's address and title, and the short description of the element the pin is on.
- Sharing produces a link to copy. The conversation is marked "Shared" wherever it appears.
- Shared links use the permanent format `https://blob.davidokunlola.com/t/<random-code>`. The code is specific to the share. The URL contains no page title, website address or participant name.
- "Stop sharing" switches the link off and deletes the server's copy, replies included. Opening the link afterwards shows "no longer shared". Blob says this before it is done, because other people's replies go too.
- In the Share dialog, the owner chooses **Link expires** for this link. The default is **Until I stop sharing**. The other choices are **7 days**, **14 days** and **30 days**, counted from when sharing succeeds. (14 days was added by the maintainer on 28 November 2026, who also confirmed that this choice is the only thing that ends a share: there is no separate clean-up of links nobody opens.) Opening the link or replying does not reset the deadline.
- For a timed link, show the expiry date to the owner and recipients. Before the owner shares, explain that expiry works like **Stop sharing**. At the deadline, access ends and Blob deletes the server copy, including replies, even if nobody visits the link again. The owner keeps their local copy.
- After expiry or **Stop sharing**, sharing the same conversation again always creates a fresh link. The old link and any History entries saved from it permanently show **No longer shared**. To access the new share, recipients need its new link.
- Sharing again uploads only the owner's own comments and replies by default. The Share dialog offers a choice, off unless the owner turns it on, to also include replies that other people wrote under an earlier link, and says how many there are. (Maintainer's decision, 28 November 2026.) Turning it on shows those people's words and names to a new audience they did not reply to, and they are not asked; the dialog says this plainly before sharing.
- Once shared, the server holds the conversation. The device keeps a copy so it still shows offline, clearly marked if it could not be refreshed.
- Uploading, uploaded and failed states are shown honestly. A failed upload keeps the comment local and offers Try again, without creating duplicates.

## 3. Receiving a shared comment

- Every shared link opens the web conversation by default. After signing in, recipients can read the comments and reply in their browser. The page shows the original page's title and address and a description of the pinned element. It does not show the website itself and never a screenshot.
- People who already have Blob can choose **Open on the page** to see the pin on the original website. Blob uses the same anchoring and "Location unavailable" behaviour as local comments.
- Before the Chrome Web Store release, the unpacked extension ZIP is for testers. A public install prompt on the recipient page waits until Blob is available in the store.
- Blob never gives anyone access to the website a comment is on. If the recipient cannot open that website, they still have the conversation as text.
- Replies appear when the conversation is opened or refreshed. Live updates are Milestone 4.

### History decision (28 November 2026)

- The owner's shared conversations stay under their websites in History and carry a **Shared** label.
- A recipient chooses **Save to History** to add a conversation to **Saved shared threads**. Opening the link or replying leaves History unchanged.
- A saved entry follows the same access rules as the link. If the owner stops sharing or the link expires, the entry can no longer open the conversation.

## 4. Server rules

- Every request is checked on the server: who is signed in, whether the conversation is shared, whether the link is still on. The extension and web page are never trusted to decide.
- For a timed link, check the deadline on every read and reply, including replies submitted from a page opened before expiry.
- Only the owner can stop sharing or delete a conversation. People can delete their own replies.
- All input is validated again on the server and stored as plain text. Size limits on everything.
- Firm limits on sign-ins, shares and replies per person, counted in the database. Cloudflare's built-in limiter proved too loose to rely on (see the feedback relay notes in STATUS.md).
- Links are long random values that cannot be guessed, and are not the conversation's internal id.

## Chrome and privacy requirements

- One new permission: `identity`, for Google sign-in. Still no `host_permissions`, `content_scripts` or `web_accessible_resources`. The manifest check is updated on purpose, not loosened.
- The overlay still never calls the network. Requests go through the background, as now.
- The sign-in session is kept in the extension's own storage, never where a website can read it.
- The stored data gains a "shared" marker on conversations, so the schema version goes up with a migration.
- Nothing about unshared comments, browsing, or the page's content beyond the pin's description is sent.
- PRIVACY.md is rewritten to say what is stored on the server, for how long, and how to delete it. AGENTS.md's scope section is updated when building starts.

## Out of scope

Private rooms, invitations and named recipients; live updates and presence; email or push notifications (Blob holds no readable address to send them to); an Inbox; reactions; editing a comment after posting; billing; Chrome Web Store publishing.

## What the maintainer needs to set up

All are free and done once; step-by-step instructions will be written when they are needed.

1. A Google Cloud project with a "Sign in with Google" client.
2. A D1 database on the existing Cloudflare account.
3. For step 7 only: a Resend account with a sending address on the project's domain.

## Order of work

Small steps, each reviewable on its own:

1. Server and database with the access rules and their tests. No interface yet.
2. Sign in and sign out in the extension.
3. Share a comment, choose its expiry, copy the link and stop sharing.
4. The web page for recipients: sign in, read, reply.
5. "Open on the page" for recipients with the extension.
6. The owner's Shared label, Save to History for recipients, account deletion and privacy documentation.
7. Sign in with an emailed one-time code, for people without a Google account. A six-digit code typed into the popup or the web page; no password. See "Sign-in code decisions".

## Still to confirm

Nothing is open as of 28 November 2026. Every question raised so far has a decision recorded above.

## Verification

Use a controlled clock to check all four expiry choices. For timed links, check access just before and at the deadline, including a saved entry and a reply submitted from an already-open tab. Verify that visits leave the deadline unchanged and that expiry removes the server copy and replies while preserving the owner's local copy.

Share the same conversation again after each way of ending access. Verify that the new link opens and that the previous link and its saved History entry still show **No longer shared**.

Server rules get unit tests that try the forbidden cases: not signed in, link switched off, someone else's conversation, oversized input. Browser tests run against a local stand-in server with a test sign-in, never real Google accounts, and nothing in them is presented as the real service. Before the milestone is called done, the whole journey is run by hand in real Chrome with two real accounts.
