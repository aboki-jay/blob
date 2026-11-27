# Milestone 2: Shared threads

**Draft for the maintainer to review. Nothing here is built.** Building starts after Milestone 1 has had its Chrome walkthrough and its pull request is merged; see [STATUS.md](STATUS.md).

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
| The shared conversation: comments and replies, the page's address and title, the short description of the pinned element | It is the thing being shared | The owner stops sharing or deletes it. Stopping sharing deletes the server's copy; the owner's device keeps its own. |
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

## 2. Sharing a comment

- A Share control on a conversation the person owns. Before anything is sent, Blob says plainly what will be uploaded: the comments and replies, the page's address and title, and the short description of the element the pin is on.
- Sharing produces a link to copy. The conversation is marked "Shared" wherever it appears.
- "Stop sharing" switches the link off and deletes the server's copy, replies included. Opening the link afterwards shows "no longer shared". Blob says this before it is done, because other people's replies go too.
- Once shared, the server holds the conversation. The device keeps a copy so it still shows offline, clearly marked if it could not be refreshed.
- Uploading, uploaded and failed states are shown honestly. A failed upload keeps the comment local and offers Try again, without creating duplicates.

## 3. Receiving a shared comment

- **Without the extension:** the link opens a Blob web page. After signing in it shows the page's title and address, what the pin is attached to, the comments, and a reply box. It does not show the website itself and never a screenshot.
- **With the extension:** the same web page offers "Open on the page". Blob then shows the conversation pinned to its element, using the same anchoring and "Location unavailable" behaviour as local comments.
- Blob never gives anyone access to the website a comment is on. If the recipient cannot open that website, they still have the conversation as text.
- Replies appear when the conversation is opened or refreshed. Live updates are Milestone 4.

## 4. Server rules

- Every request is checked on the server: who is signed in, whether the conversation is shared, whether the link is still on. The extension and web page are never trusted to decide.
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

Both are free and done once; step-by-step instructions will be written when they are needed.

1. A Google Cloud project with a "Sign in with Google" client.
2. A D1 database on the existing Cloudflare account.

## Order of work

Small steps, each reviewable on its own:

1. Server and database with the access rules and their tests. No interface yet.
2. Sign in and sign out in the extension.
3. Share a comment, copy the link, stop sharing.
4. The web page for recipients: sign in, read, reply.
5. "Open on the page" for recipients with the extension.
6. "Shared" in History, account deletion, privacy documentation.
7. Sign in with an emailed one-time code, for people without a Google account. A six-digit code typed into the popup or the web page; no password. Needs the email service decision below first.

## Still to confirm

- **History.** Proposal: shared conversations get a "Shared" label, and conversations received from others appear under a "Shared with me" heading. No Inbox in this milestone.
- **Getting the extension.** Blob is not in the Chrome Web Store, so recipients without it can only be pointed to the GitHub page. Acceptable for now?
- **Web address.** The recipient page needs an address on davidokunlola.com.
- **Email service for the code.** Cloudflare's free plan only sends to the account's own address. Sending codes to anyone needs its paid plan or another provider's free tier. No provider's limits or logging have been checked yet; that comes before step 7.
- **Idle conversations.** Whether a shared conversation nobody has opened for a long time should be removed from the server automatically.

## Verification

Server rules get unit tests that try the forbidden cases: not signed in, link switched off, someone else's conversation, oversized input. Browser tests run against a local stand-in server with a test sign-in, never real Google accounts, and nothing in them is presented as the real service. Before the milestone is called done, the whole journey is run by hand in real Chrome with two real accounts.
