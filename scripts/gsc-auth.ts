#!/usr/bin/env node
/**
 * One-time setup: exchanges a Google OAuth consent for a Search Console
 * refresh token to put in .env. Requires a Google Cloud OAuth client
 * (GSC_CLIENT_ID / GSC_CLIENT_SECRET) already created — see the printed
 * instructions if they're missing.
 */
import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];

async function main(): Promise<void> {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      [
        "Set GSC_CLIENT_ID and GSC_CLIENT_SECRET in .env first.",
        "",
        "Create them at https://console.cloud.google.com/apis/credentials :",
        "  1. Create an OAuth client ID of type 'Web application'.",
        `  2. Add ${REDIRECT_URI} as an authorized redirect URI.`,
        "  3. Enable the 'Google Search Console API' for the project.",
        "  4. Copy the client ID and secret into .env.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even if this account authorized before
    scope: SCOPES,
  });

  console.log("Open this URL and authorize the Google account that owns the Search Console property:\n");
  console.log(authUrl);
  console.log("\nWaiting for the redirect back to localhost...");

  const code = await waitForAuthCode(PORT);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token was returned. Revoke this app's access at " +
        "https://myaccount.google.com/permissions and re-run this script " +
        "(Google only issues a refresh token on the first consent, or with prompt=consent)."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAdd this to your .env:\n");
  console.log(`GSC_REFRESH_TOKEN=${tokens.refresh_token}`);
}

function waitForAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.end("Authorization failed — you can close this tab.");
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (code) {
        res.end("Authorization complete — you can close this tab and return to the terminal.");
        server.close();
        resolve(code);
      }
    });
    server.listen(port);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
