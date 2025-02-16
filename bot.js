import { Client, GatewayIntentBits, Events } from 'discord.js';
import sharp from 'sharp';
import { writeFile } from 'fs/promises';
import { get } from 'https';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const MAX_RESOLUTION = 2048;
const imageList = [];

// Function to download image from URL
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Function to modify Discord image URL to enforce max resolution
function getResizedDiscordUrl(url) {
  if (url.includes('media.discordapp.net') || url.includes('cdn.discordapp.com')) {
    return `${url}&width=${MAX_RESOLUTION}&height=${MAX_RESOLUTION}`;
  }
  return url;
}

// Function to save image list to JSON
async function saveImageList() {
  try {
    // Sort imageList by timestamp (newest first)
    imageList.sort((a, b) => b.timestamp - a.timestamp);
    await writeFile('image-list.json', JSON.stringify(imageList, null, 2));
    console.log('Image list saved to image-list.json');
  } catch (error) {
    console.error('Error saving image list:', error);
  }
}

// Function to parse VRChat filename timestamp
function parseVRChatTimestamp(filename) {
  const match = filename.match(/VRChat_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (match) {
    // Convert the timestamp format from "YYYY-MM-DD_HH-MM-SS" to a Date object
    const [dateStr, timeStr] = match[1].split('_');
    const [year, month, day] = dateStr.split('-');
    const [hour, minute, second] = timeStr.split('-');
    
    // Create date using UTC to avoid timezone issues
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    ).getTime();
  }
  return null;
}

// Function to parse Discord URL timestamp
function parseDiscordUrlTimestamp(url) {
  const match = url.match(/ex=([0-9a-fA-F]+)/);
  if (match) {
    // Discord uses hex timestamp that represents seconds since Unix epoch
    const hexTimestamp = match[1];
    return parseInt(hexTimestamp, 16) * 1000; // Convert to milliseconds
  }
  return null;
}

// Function to format timestamp to readable format
function formatReadableTimestamp(timestamp) {
  const date = new Date(timestamp);
  // Use the exact format from the VRChat filename
  const formatted = date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC' // Use UTC to match VRChat timestamps
  }).replace(', ', '-');
  return formatted;
}

// Function to fetch channel history
async function fetchChannelHistory() {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;

    console.log('Fetching channel history...');
    let messages = await channel.messages.fetch({ limit: 100 });
    
    while (messages.size > 0) {
      for (const message of messages.values()) {
        for (const attachment of message.attachments.values()) {
          if (!attachment.contentType?.startsWith('image/')) continue;
          
          // Check if image is already in the list
          if (!imageList.some(img => img.originalUrl === attachment.url)) {
            try {
              console.log(`Processing historical image: ${attachment.url}`);
              const imageUrl = getResizedDiscordUrl(attachment.url);
              const imageBuffer = await downloadImage(imageUrl);
              
              // Change timestamp priority:
              // 1. VRChat filename timestamp (for actual photo time)
              // 2. Discord URL timestamp (fallback)
              // 3. Message timestamp (last resort)
              const fileTimestamp = parseVRChatTimestamp(attachment.name);
              const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
              
              const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
              
              imageList.push({
                originalUrl: attachment.url,
                filename: attachment.name,
                size: imageBuffer.length,
                timestamp: finalTimestamp,
                'timestamp-readable': formatReadableTimestamp(finalTimestamp),
                dimensions: {
                  width: (await sharp(imageBuffer).metadata()).width,
                  height: (await sharp(imageBuffer).metadata()).height
                }
              });
            } catch (error) {
              console.error(`Error processing historical image ${attachment.url}:`, error);
            }
          }
        }
      }
      
      // Get next batch of messages
      const lastMessage = messages.last();
      messages = await channel.messages.fetch({ 
        limit: 100,
        before: lastMessage.id 
      });
    }
    
    await saveImageList();
    console.log('Channel history processing complete!');
  } catch (error) {
    console.error('Error fetching channel history:', error);
  }
}

client.once(Events.ClientReady, async () => {
  console.log('Discord bot is ready!');
  await fetchChannelHistory(); // Fetch history when bot starts
});

client.on(Events.MessageCreate, async (message) => {
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
  
  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    
    try {
      console.log(`Processing image: ${attachment.url}`);
      const imageUrl = getResizedDiscordUrl(attachment.url);
      const imageBuffer = await downloadImage(imageUrl);
      
      // Change timestamp priority:
      // 1. VRChat filename timestamp (for actual photo time)
      // 2. Discord URL timestamp (fallback)
      // 3. Message timestamp (last resort)
      const fileTimestamp = parseVRChatTimestamp(attachment.name);
      const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
      
      const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
      
      imageList.push({
        originalUrl: attachment.url,
        filename: attachment.name,
        size: imageBuffer.length,
        timestamp: finalTimestamp,
        'timestamp-readable': formatReadableTimestamp(finalTimestamp),
        dimensions: {
          width: (await sharp(imageBuffer).metadata()).width,
          height: (await sharp(imageBuffer).metadata()).height
        }
      });
      
      await saveImageList();
      
    } catch (error) {
      console.error(`Error processing image ${attachment.url}:`, error);
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);

// Handle process termination
process.on('SIGINT', () => {
  console.log('Saving final image list and shutting down...');
  saveImageList().then(() => process.exit(0));
});

console.log('Starting Discord bot...');