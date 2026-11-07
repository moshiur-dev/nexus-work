import nodemailer from 'nodemailer';

// If SMTP_URL is set (e.g. smtp://user:pass@host:587), emails are sent for real.
// Otherwise the email body is printed to the server console so you can test the flow locally.
let transport = null;
if (process.env.SMTP_URL) {
  transport = nodemailer.createTransport(process.env.SMTP_URL);
}

export async function sendMail({ to, subject, text }) {
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || 'no-reply@nexus.local', to, subject, text });
}
