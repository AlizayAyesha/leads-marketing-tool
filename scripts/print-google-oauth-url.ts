import "./load-local-env";
import { google } from "googleapis";

const id = process.env.GOOGLE_CLIENT_ID?.trim();
const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirect = process.env.GOOGLE_REDIRECT_URI?.trim();
if (!id || !secret || !redirect) {
  console.log(JSON.stringify({ ok: false, error: "Missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI" }));
  process.exit(1);
}
const client = new google.auth.OAuth2(id, secret, redirect);
const url = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  state: "outreach",
});
console.log(JSON.stringify({ ok: true, redirect, authUrl: url }, null, 2));
