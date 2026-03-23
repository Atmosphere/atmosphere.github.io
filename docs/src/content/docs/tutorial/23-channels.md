---
title: "Channels — Slack, Telegram, Discord, WhatsApp, Messenger"
description: "Connect your Atmosphere agent to external messaging platforms with zero per-channel code"
sidebar:
  order: 23
---

Atmosphere Channels bridges your `@Agent` (or `@AiEndpoint`) to external messaging platforms. Commands, AI responses, and confirmation flows work identically on every channel — you write the logic once.

## Supported Channels

| Channel | Protocol | Bot Setup | Env Variable |
|---------|----------|-----------|-------------|
| **Telegram** | Bot API webhooks | [@BotFather](https://t.me/BotFather) | `TELEGRAM_BOT_TOKEN` |
| **Slack** | Events API | [api.slack.com/apps](https://api.slack.com/apps) | `SLACK_BOT_TOKEN` |
| **Discord** | Gateway WebSocket | [discord.com/developers](https://discord.com/developers/applications) | `DISCORD_BOT_TOKEN` |
| **WhatsApp** | Cloud API webhooks | [Meta Business Suite](https://business.facebook.com/) | `WHATSAPP_ACCESS_TOKEN` |
| **Messenger** | Webhooks | [Meta for Developers](https://developers.facebook.com/) | `MESSENGER_PAGE_TOKEN` |

## Dependencies

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-agent</artifactId>
</dependency>
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-channels</artifactId>
</dependency>
```

Channels activate automatically when credentials are set as environment variables. No channel-specific code is needed.

## Telegram

### 1. Create a bot

Open Telegram, message [@BotFather](https://t.me/BotFather), and send:

```
/newbot
```

Follow the prompts — choose a name and username. BotFather replies with a token like:

```
123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
```

### 2. Set environment variables

```bash
export TELEGRAM_BOT_TOKEN=123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
export TELEGRAM_WEBHOOK_SECRET=any-random-string-you-choose
```

### 3. Expose your server publicly

Telegram webhooks require HTTPS. Use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free) or [ngrok](https://ngrok.com/):

```bash
# Cloudflare (recommended — no account required for quick tunnels)
cloudflared tunnel --url http://localhost:8080

# Or ngrok
ngrok http 8080
```

Copy the public URL (e.g. `https://your-tunnel.trycloudflare.com`).

### 4. Register the webhook

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<YOUR_TUNNEL>/webhook/telegram&secret_token=<YOUR_SECRET>"
```

You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5. Start the app and test

```bash
TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret> \
./mvnw spring-boot:run -pl samples/spring-boot-dentist-agent
```

Message your bot on Telegram — `/help`, `/firstaid`, or any question.

### Verification

Atmosphere verifies every Telegram webhook request using the `X-Telegram-Bot-Api-Secret-Token` header with constant-time comparison. Requests with missing or invalid secrets are rejected with 403.

---

## Slack

### 1. Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**.

### 2. Configure bot scopes

Under **OAuth & Permissions**, add these **Bot Token Scopes**:

- `chat:write` — send messages
- `channels:history` — read messages in public channels
- `groups:history` — read messages in private channels
- `im:history` — read direct messages

### 3. Install to workspace

Click **Install to Workspace** and authorize. Copy the **Bot User OAuth Token** (`xoxb-...`).

### 4. Enable Events API

Under **Event Subscriptions**:

1. Turn on **Enable Events**
2. Set the **Request URL** to `https://<YOUR_TUNNEL>/webhook/slack`
3. Atmosphere automatically responds to Slack's URL verification challenge
4. Under **Subscribe to bot events**, add: `message.channels`, `message.groups`, `message.im`
5. Click **Save Changes**

### 5. Get the signing secret

Under **Basic Information** → **App Credentials**, copy the **Signing Secret**.

### 6. Set environment variables and start

```bash
export SLACK_BOT_TOKEN=xoxb-your-bot-token
export SLACK_SIGNING_SECRET=your-signing-secret
```

### Verification

Atmosphere verifies Slack requests using HMAC-SHA256 with the `v0:timestamp:body` scheme. Requests older than 5 minutes are rejected to prevent replay attacks.

### Invite the bot

Add the bot to a channel: type `/invite @YourBotName` in the channel. Then message it.

---

## Discord

### 1. Create a Discord application

Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.

### 2. Create a bot

Under **Bot**, click **Add Bot**. Copy the **Token**.

### 3. Enable required intents

Under **Bot** → **Privileged Gateway Intents**, enable:

- **Message Content Intent** (required to read message text)
- **Server Members Intent** (optional)

### 4. Invite the bot to your server

Under **OAuth2** → **URL Generator**:

- Scopes: `bot`
- Bot permissions: `Send Messages`, `Read Message History`

Copy the generated URL and open it in your browser to invite the bot.

### 5. Set environment variable and start

```bash
export DISCORD_BOT_TOKEN=your-discord-bot-token
```

Discord uses a Gateway WebSocket connection (not HTTP webhooks), so no tunnel is needed. Atmosphere connects to Discord's gateway automatically, handles heartbeats, sequence tracking, and reconnection.

---

## WhatsApp

### 1. Set up a Meta Business account

Go to [business.facebook.com](https://business.facebook.com/) and create a business account if you don't have one.

### 2. Create a WhatsApp app

In [Meta for Developers](https://developers.facebook.com/), create a new app of type **Business** and add the **WhatsApp** product.

### 3. Get credentials

Under **WhatsApp** → **API Setup**:

- Copy the **Phone Number ID**
- Generate a **Permanent Access Token** (or use the temporary one for testing)
- Under **App Settings** → **Basic**, copy the **App Secret**

### 4. Configure webhook

Under **WhatsApp** → **Configuration**:

- Callback URL: `https://<YOUR_TUNNEL>/webhook/whatsapp`
- Verify token: any string (used only during initial verification)
- Subscribe to: `messages`

### 5. Set environment variables

```bash
export WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
export WHATSAPP_ACCESS_TOKEN=your-access-token
export WHATSAPP_APP_SECRET=your-app-secret
```

### Verification

Atmosphere verifies WhatsApp webhooks using HMAC-SHA256 via the `X-Hub-Signature-256` header (Meta platform standard).

---

## Messenger

### 1. Create a Facebook Page

You need a Facebook Page for your bot. Create one at [facebook.com/pages/create](https://www.facebook.com/pages/create).

### 2. Create a Meta app

In [Meta for Developers](https://developers.facebook.com/), create a new app and add the **Messenger** product.

### 3. Generate a Page Access Token

Under **Messenger** → **Access Tokens**, select your Page and generate a token.

### 4. Configure webhook

Under **Messenger** → **Webhooks**:

- Callback URL: `https://<YOUR_TUNNEL>/webhook/messenger`
- Verify token: any string
- Subscribe to: `messages`

### 5. Set environment variables

```bash
export MESSENGER_PAGE_TOKEN=your-page-access-token
export MESSENGER_APP_SECRET=your-app-secret
```

### Verification

Same HMAC-SHA256 scheme as WhatsApp (Meta platform standard).

---

## application.yaml

All channels are configured via environment variables. The Spring Boot configuration maps them:

```yaml
atmosphere:
  packages: com.example.myagent

atmosphere.channels:
  telegram:
    bot-token: ${TELEGRAM_BOT_TOKEN:}
    webhook-secret: ${TELEGRAM_WEBHOOK_SECRET:}
  slack:
    bot-token: ${SLACK_BOT_TOKEN:}
    signing-secret: ${SLACK_SIGNING_SECRET:}
  discord:
    bot-token: ${DISCORD_BOT_TOKEN:}
  whatsapp:
    phone-number-id: ${WHATSAPP_PHONE_NUMBER_ID:}
    access-token: ${WHATSAPP_ACCESS_TOKEN:}
    app-secret: ${WHATSAPP_APP_SECRET:}
  messenger:
    page-access-token: ${MESSENGER_PAGE_TOKEN:}
    app-secret: ${MESSENGER_APP_SECRET:}
```

Each channel activates only when its credentials are set. You can enable one, some, or all simultaneously.

## Message Filtering

Atmosphere provides a `ChannelFilter` chain for processing messages before and after they reach the agent:

- **MessageSplittingFilter** — automatically truncates messages that exceed the channel's max length (4096 for Telegram, 40000 for Slack, 2000 for Discord/Messenger)
- **AuditLoggingFilter** — logs all inbound/outbound messages at INFO level

Custom filters implement `ChannelFilter` and are auto-discovered via Spring Boot component scanning.

## Samples

| Sample | Channels | Description |
|--------|----------|-------------|
| [spring-boot-dentist-agent](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-dentist-agent) | Web + Slack + Telegram | Dr. Molar dental emergency agent with commands and AI tools |
| [spring-boot-channels-chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-channels-chat) | All 5 channels | Omnichannel AI chat with all platforms |
