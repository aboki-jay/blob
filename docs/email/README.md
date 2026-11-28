# Blob email templates

## Sign-in code

**Subject** — Your Blob sign-in code  
**Inbox preview** — Enter this code in Blob within 10 minutes.

[HTML body](sign-in-code.html) for the person signing in. For the planned Resend template, supply `CODE` as a six-digit string so a leading zero survives. The code appears once as selectable text. [Resend template variables](https://resend.com/blog/introducing-templates)

Plain-text body:

```text
Enter this code in Blob within 10 minutes.

{{{CODE}}}

Have feedback about Blob? Write to blob@davidokunlola.com.
```

## Feedback notification for the maintainer

**Subject** — Blob feedback: {{subjectRating}}

[Plain-text body](feedback-notification.txt) matching the current feedback relay. Use the selected rating for both rating fields. For a message alone, use `no rating` in the subject and `not given` in the body. For a rating alone, use `(no message)` in the body. An unavailable version appears as `unknown`. Preserve the sender's wording and line breaks.

## Feedback receipt for the sender

**Subject** — Thanks for your feedback on Blob  
**Inbox preview** — Your feedback reached the Blob team.

[HTML body](feedback-receipt.html) for a sender who wants an emailed confirmation. The current form confirms success inside Blob and collects no email address. Delivery of this template would need a separately agreed way for senders to request a receipt and supply a destination. Use the receipt only after the feedback submission succeeds.

Plain-text body:

```text
Your feedback reached the Blob team.

Something to add? Write to blob@davidokunlola.com.
```
