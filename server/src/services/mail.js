import nodemailer from 'nodemailer';
import * as secrets from './secrets.js';

// SMTP_URL and MAIL_FROM come from the Super admin page, or the environment if nothing is saved there.
// Without SMTP_URL the email is only printed to the server console (useful for testing).
let current = { url: null, transport: null };
function transportFor(url) {
  if (!url) return null;
  if (current.url !== url) current = { url, transport: nodemailer.createTransport(url) };
  return current.transport;
}

export async function sendMail({ to, subject, text }) {
  await secrets.refresh();
  const transport = transportFor(secrets.get('SMTP_URL'));
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: secrets.get('MAIL_FROM') || 'no-reply@nexus.local', to, subject, text });
}
