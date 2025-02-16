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

// Function to process image
async function processImage(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  // Check if image needs resizing
  if (metadata.width > MAX_RESOLUTION || metadata.height > MAX_RESOLUTION) {
    const resizeOptions = metadata.width > metadata.height
      ? { width: MAX_RESOLUTION }
      : { height: MAX_RESOLUTION };
    
    return await image.resize(resizeOptions).toBuffer();
  }
  
  return buffer;
}

// Function to save image list to JSON
async function saveImageList() {
  try {
    await writeFile('image-list.json', JSON.stringify(imageList, null, 2));
    console.log('Image list saved to image-list.json');
  } catch (error) {
    console.error('Error saving image list:', error);
  }
}

client.once(Events.ClientReady, () => {
  console.log('Discord bot is ready!');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
  
  // Process attachments
  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    
    try {
      console.log(`Processing image: ${attachment.url}`);
      
      // Download image
      const imageBuffer = await downloadImage(attachment.url);
      
      // Process and resize if needed
      const processedBuffer = await processImage(imageBuffer);
      
      // Add to image list
      imageList.push({
        originalUrl: attachment.url,
        filename: attachment.name,
        size: processedBuffer.length,
        timestamp: message.createdTimestamp,
        dimensions: {
          width: (await sharp(processedBuffer).metadata()).width,
          height: (await sharp(processedBuffer).metadata()).height
        }
      });
      
      // Save updated list to JSON
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