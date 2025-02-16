# VerflauschigungFotoGalerie

_Woof woof!_ A Discord bot that manages and serves a gallery of VRChat screenshots with style! 🐾

## 🦴 Features

* Automatically processes images posted to a Discord channel
* Tracks VRChat screenshot timestamps and metadata
* Provides a REST API to access the image gallery
* Supports image moderation via reactions
* Optimizes image resolutions automatically
* Maintains persistent image history

## 🐕 Installation

1. Clone the repository
2. Create a `.env` file with your Discord credentials:
   ```env
   DISCORD_BOT_TOKEN=your_bot_token
   DISCORD_CHANNEL_ID=your_channel_id
   DISCORD_LOG_CHANNEL_ID=your_log_channel_id
   ```
3. Deploy using Docker:
   ```bash
   docker-compose up -d
   ```

## 🎾 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/health` | Health check endpoint |
| `/image-list.json` | Get the full image gallery |

The JSON response includes:
* Original and resized image URLs
* Message links and timestamps
* Image dimensions and file sizes
* VRChat metadata when available

### Sample Response

```json
[
  {
    "originalUrl": "https://cdn.discordapp.com/attachments/123456789/123456789/VRChat_2024-02-16_02-27-19.288_7680x4320.png",
    "resizedUrl": "https://cdn.discordapp.com/attachments/123456789/123456789/VRChat_2024-02-16_02-27-19.288_7680x4320.png&width=2048&height=2048",
    "filename": "VRChat_2024-02-16_02-27-19.288_7680x4320.png",
    "messageId": "123456789123456789",
    "messageUrl": "https://discord.com/channels/123456789/123456789/123456789",
    "size": 12345678,
    "timestamp": 1708045639000,
    "timestamp-readable": "16.02.2024-02:27:19",
    "dimensions": {
      "width": 7680,
      "height": 4320
    }
  }
]
```

## 🐾 Image Management

The bot supports several moderation features:
* ✅ Marks processed images automatically
* ❌ Remove images using cross reaction
* 🔍 Validates image existence periodically
* 📊 Maintains sorted chronological order

## 🦮 Configuration

| Setting | Description |
|---------|-------------|
| `MAX_RESOLUTION` | Maximum image dimension (default: 2048) |
| `PORT` | Web server port (default: 3000) |

## 🐕‍🦺 Notes

* Images are processed locally for size optimization
* All timestamps are stored in UTC
* API supports CORS for web applications
* Reactions are preserved for moderation history

---

_Happy snapping! Bark bark!_ 🐕 