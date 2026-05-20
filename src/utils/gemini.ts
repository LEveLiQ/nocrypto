import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";

// Initialize the Gemini client. It automatically picks up GEMINI_API_KEY from environment variables
let ai: GoogleGenAI | null = null;

export function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    logger.warn("GEMINI_API_KEY is not configured in .env! Scam scanning will be unavailable.", "GEMINI");
    return;
  }

  try {
    ai = new GoogleGenAI({ apiKey });
    logger.success(`Gemini SDK successfully initialized with model: ${process.env.GEMINI_MODEL || "gemini-3.5-flash"}.`, "GEMINI");
  } catch (error) {
    logger.error("Failed to initialize Gemini SDK:", error, "GEMINI");
  }
}

export interface ScamScanResult {
  isScam: boolean;
  confidence: number; // 0 to 1
  reason: string;
}

/**
 * Downloads a media attachment from a URL and converts it to base64.
 */
async function downloadAttachmentAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/png";

    return {
      data: buffer.toString("base64"),
      mimeType,
    };
  } catch (error) {
    logger.error(`Failed to download attachment from ${url}:`, error, "GEMINI");
    return null;
  }
}

/**
 * Scans a message (text content and/or optional multiple image attachments) for scams/phishing patterns.
 */
export async function scanMessageForScam(
  textContent: string,
  imageUrls?: string[],
  confidenceThreshold: number = 0.70
): Promise<ScamScanResult> {
  if (!ai) {
    logger.warn("Gemini client is not initialized, skipping scam scan.", "GEMINI");
    return { isScam: false, confidence: 0, reason: "Gemini client not initialized" };
  }

  try {
    const imageCount = imageUrls ? imageUrls.length : 0;
    logger.info(`Starting scan... ${imageCount > 0 ? `[Has ${imageCount} Image(s)] ` : ""}${textContent ? `[Text length: ${textContent.length}]` : ""}`, "GEMINI");

    const prompt = `
You are NoCrypto, a specialized cybersecurity bot designed to analyze Discord messages and images to protect users from malicious content.
Analyze the provided content (text and/or image) for scam, phishing, or unauthorized promotional patterns.

Common scam/phishing/promotion patterns to look for:
1. Fake Discord Nitro giveaways ("Get 1 month of Nitro free", fake claims, QR codes asking users to scan to login/claim).
2. Phishing links disguised as official sites via typosquatting, character-swapping, or domain mimicking (e.g. steam-communnity.ru, dlscord-nitro.com, steamcommunnlty.com, fake crypto airdrops).
3. Unsolicited financial coaching, quick-rich recruitment, or off-platform redirection scams promising fast/guaranteed riches, mentoring, or high-yield investments under profit-share conditions (e.g., "teach 10 people to earn $50k within a week", "make $500 doing simple tasks", "invest and get 10x returns"). They often command targets to contact a phone number, WhatsApp, or Telegram handle off-platform to circumvent Discord monitoring/filters.
4. Accounts asking users to run scripts/code, download/test files (.exe, .scr, .zip), or test their "new indie game".
5. QR code login scams (scanning a QR code to "verify" or "win a prize", which actually steals their session token).
6. Unsolicited self-promotion or server invitations in images/text (e.g., screenshots containing Discord invite links/codes, promotional banners for other servers/channels, or QR codes inviting users to other platforms).
7. Screenshots of text chats, direct messages, or alerts containing any of the above patterns. Carefully transcribe and evaluate the text inside these images!

Crucial False Positive Protection Guidelines (Follow strictly):
- Do NOT flag standard, benign Discord bot invite/authorization links (e.g., 'discord.com/oauth2/authorize') as scams or phishing unless the surrounding message is explicitly manipulative (e.g., coercing users to authorize a bot to win a prize or verify their account to avoid being banned). General bot invites are safe and normal.
- Do NOT flag official Discord gift links (e.g., starting with 'discord.gift/') as scams or phishing unless they are typosquatted (like 'dlscord.gift' or 'discord.glft') or accompanied by highly manipulative/coercive text. Real 'discord.gift' links are safe and normal, even if the code itself is expired or invalid.
- Do NOT flag common safe links (like official discord.com, github.com, youtube.com, google.com, twitch.tv) unless they contain actual scam copy (like fake Nitro giveaways).
- Do NOT flag benign, legitimate sharing of contact details (WhatsApp, Telegram handles, email, portfolios) for normal personal connections, server support, gaming, or standard freelance commissions (e.g., "Hit me up on Telegram @name if you need commission work" or "Add me on Discord/WhatsApp to play together"). ONLY flag them if they are combined with unrealistic get-rich-quick claims, profit-sharing schemes, or manipulative solicitations.

Evaluate the content. If you are reasonably sure (confidence >= ${confidenceThreshold}) that it is a scam, phishing, or unauthorized promotion, flag it.

You must respond in strict JSON format matching this exact schema:
{
  "isScam": boolean,
  "confidence": number, // A float between 0.0 and 1.0 representing how confident you are
  "reason": string // A brief, 1-2 sentence explanation of why this was flagged (e.g., "Contains a fake Nitro link disguised as dlscord.com") or why it's safe.
}
`;

    const contents: any[] = [];

    // 1. If images are provided, download all of them concurrently in parallel to minimize latency!
    if (imageUrls && imageUrls.length > 0) {
      const downloadPromises = imageUrls.map((url) => downloadAttachmentAsBase64(url));
      const downloadedMedia = await Promise.all(downloadPromises);

      for (const mediaData of downloadedMedia) {
        if (mediaData) {
          contents.push({
            inlineData: {
              mimeType: mediaData.mimeType,
              data: mediaData.data,
            },
          });
        }
      }
    }

    // 2. Add text content (includes prompt + actual message text)
    const fullTextPrompt = `${prompt}\n\nDiscord Message Text to analyze:\n"""\n${textContent || "[No text content]"}\n"""`;
    contents.push({ text: fullTextPrompt });

    // 3. Query Gemini 3.5 Flash with robust auto-retry logic (up to 3 times)
    let response = null;
    let retries = 3;
    let delay = 1000; // start with 1 second delay

    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
          contents,
          config: {
            responseMimeType: "application/json",
          },
        });
        break; // Success! Break out of the retry loop
      } catch (error: any) {
        retries--;
        const isTemporaryError =
          error?.status === 500 ||
          error?.status === 502 ||
          error?.status === 503 ||
          error?.status === 504 ||
          error?.status === 429;

        if (isTemporaryError && retries > 0) {
          logger.warn(`Gemini API returned ${error.status} (${error.status === 429 ? "Rate Limit" : "Temporary Server Error"}). Retrying in ${delay}ms... (${retries} attempts left)`, "GEMINI");
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // double the delay for exponential backoff
        } else {
          // If it's a persistent error or we ran out of retries, rethrow
          throw error;
        }
      }
    }

    if (!response || !response.text) {
      throw new Error("Received empty response from Gemini API.");
    }

    const responseText = response.text;
    const result: ScamScanResult = JSON.parse(responseText.trim());

    if (result.isScam) {
      logger.warn(`ALERT: Flagged scam (Confidence: ${(result.confidence * 100).toFixed(0)}%). Reason: ${result.reason}`, "GEMINI");
    } else {
      logger.info(`Message scanned and marked SAFE (Confidence: ${(100 - result.confidence * 100).toFixed(0)}% safe).`, "GEMINI");
    }

    return result;
  } catch (error) {
    logger.error("Error running scam scan through Gemini:", error, "GEMINI");
    return {
      isScam: false,
      confidence: 0,
      reason: `Scan failed due to an error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
