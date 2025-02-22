import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } from 'discord.js';
import sharp from 'sharp';
import { writeFile, readFile } from 'fs/promises';
import { get } from 'https';
import 'dotenv/config';
import fotogalerieCommand from './commands/fotogalerie.js';
import express from 'express';
import stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const MAX_RESOLUTION = 2048;
const imageList = [];
const commands = [fotogalerieCommand.data];

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

let logChannel = null;
let photoChannelId = process.env.DISCORD_CHANNEL_ID;
let logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;

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
    imageList.sort((a, b) => b.timestamp - a.timestamp);
    await writeFile('/app/data/image-list.json', JSON.stringify(imageList, null, 2));
    await sendLog('Image list saved successfully', false, '💾');
  } catch (error) {
    await sendLog(`Error saving image list: ${error.message}`, true);
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

// Helper function to get Discord message URL
function getMessageUrl(message) {
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

// Function to register commands
async function registerCommands() {
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    await sendLog('Successfully registered application commands.', false, '✨');
  } catch (error) {
    await sendLog(`Error registering commands: ${error.message}`, true);
  }
}

// Update reaction handler to handle reaction removals
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  // Ignore bot's own reactions
  if (user.id === client.user.id) return;
  
  // Only process reactions in the photo channel
  if (reaction.message.channelId !== photoChannelId) return;
  
  // Check for removal reactions
  if (reaction.emoji.name === '❌' || reaction.emoji.name === '❎') {
    const message = reaction.message;
    const attachment = message.attachments.first();
    
    if (attachment) {
      // Find and remove the image from the list
      const imageIndex = imageList.findIndex(img => img.originalUrl === attachment.url);
      if (imageIndex !== -1) {
        const removedImage = imageList.splice(imageIndex, 1)[0];
        await saveImageList();
        
        // Remove only the bot's checkmark reaction
        const checkmarkReaction = message.reactions.cache.find(r => 
          r.emoji.name === '✅' && r.users.cache.has(client.user.id)
        );
        if (checkmarkReaction) {
          await checkmarkReaction.users.remove(client.user.id);
        }
        
        const messageUrl = getMessageUrl(message);
        await sendLog(`Image ${removedImage.filename} removed by user ${user.tag} ${messageUrl}`, false, '🗑️');
      }
    }
  }
});

// Add handler for reaction removals
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  // Ignore bot's own reactions
  if (user.id === client.user.id) return;
  
  // Only process reactions in the photo channel
  if (reaction.message.channelId !== photoChannelId) return;
  
  // Check if an X reaction was removed
  if (reaction.emoji.name === '❌' || reaction.emoji.name === '❎') {
    const message = reaction.message;
    const attachment = message.attachments.first();
    
    if (attachment) {
      // Check if image is not already in the list
      const exists = imageList.some(img => img.originalUrl === attachment.url);
      if (!exists) {
        try {
          const messageUrl = getMessageUrl(message);
          await sendLog(`Re-adding image: ${attachment.name} ${messageUrl}`, false, '📥');
          
          const imageUrl = getResizedDiscordUrl(attachment.url);
          const imageBuffer = await downloadImage(imageUrl);
          
          const fileTimestamp = parseVRChatTimestamp(attachment.name);
          const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
          const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
          
          // Add image back to the list
          imageList.push({
            originalUrl: attachment.url,
            resizedUrl: getResizedDiscordUrl(attachment.url),
            filename: attachment.name,
            messageId: message.id,
            messageUrl: messageUrl,
            size: imageBuffer.length,
            timestamp: finalTimestamp,
            'timestamp-readable': formatReadableTimestamp(finalTimestamp),
            dimensions: {
              width: (await sharp(imageBuffer).metadata()).width,
              height: (await sharp(imageBuffer).metadata()).height
            }
          });
          
          await saveImageList();
          
          // Re-add the checkmark reaction
          await message.react('✅');
          
          await sendLog(`Successfully re-added: ${attachment.name} ${messageUrl}`, false, '✅');
        } catch (error) {
          await sendLog(`Error re-adding ${attachment.name}: ${error.message}`, true);
        }
      }
    }
  }
});

// Update markImageAsProcessed to not remove existing ❌ and ❎
async function markImageAsProcessed(message, attachment) {
  try {
    // Only add ✅ if there are no removal reactions
    const hasRemovalReaction = message.reactions.cache.some(r => 
      r.emoji.name === '❌' || r.emoji.name === '❎'
    );
    
    if (!hasRemovalReaction) {
      // Add ✅ if it's not already there
      const existingReactions = message.reactions.cache.find(r => r.emoji.name === '✅');
      if (!existingReactions) {
        await message.react('✅');
      }
    }
  } catch (error) {
    await sendLog(`Unable to manage reactions for ${attachment.name}: ${error.message}`, true);
  }
}

// Update validateImageList to respect removal reactions
async function validateImageList(channel) {
  await sendLog('Starting image list validation...', false, '🔍');
  const validImages = [];
  let removedCount = 0;

  for (const image of imageList) {
    try {
      const messages = await channel.messages.fetch({ around: image.messageId, limit: 1 });
      const message = messages.first();
      
      if (message) {
        // Check for removal reactions
        const hasRemovalReaction = message.reactions.cache.some(r => 
          r.emoji.name === '❌' || r.emoji.name === '❎'
        );
        
        if (hasRemovalReaction || !message.attachments.some(att => att.url === image.originalUrl)) {
          await sendLog(`Removing ${hasRemovalReaction ? 'marked' : 'invalid'} image: ${image.filename}`, false, '🗑️');
          // Don't remove reactions, let them stay as a record
          removedCount++;
          continue;
        }
        
        validImages.push(image);
        await markImageAsProcessed(message, message.attachments.first());
      } else {
        await sendLog(`Unable to find message for ${image.filename}, removing from list`, true);
        removedCount++;
      }
    } catch (error) {
      await sendLog(`Error validating ${image.filename}: ${error.message}`, true);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    imageList.length = 0;
    imageList.push(...validImages);
    await saveImageList();
    await sendLog(`Removed ${removedCount} images from list`, false, '♻️');
  } else {
    await sendLog('All images in list are valid', false, '✨');
  }
}

// Update the fetchChannelHistory function
async function fetchChannelHistory() {
  try {
    await sendLog('Starting channel history fetch...', false, '📚');
    const channel = await client.channels.fetch(photoChannelId);
    if (!channel) {
      await sendLog('Photo channel not found!', true);
      return;
    }

    await sendLog('Fetching channel messages...', false, '🔄');
    let messages = await channel.messages.fetch({ limit: 100 });
    let processedCount = 0;
    
    while (messages.size > 0) {
      for (const message of messages.values()) {
        for (const attachment of message.attachments.values()) {
          if (!attachment.contentType?.startsWith('image/')) continue;
          
          if (!imageList.some(img => img.originalUrl === attachment.url)) {
            try {
              const messageUrl = getMessageUrl(message);
              await sendLog(`Processing historical image: ${attachment.name} ${messageUrl}`, false, '📥');
              const imageUrl = getResizedDiscordUrl(attachment.url);
              const imageBuffer = await downloadImage(imageUrl);
              
              const fileTimestamp = parseVRChatTimestamp(attachment.name);
              const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
              const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
              
              imageList.push({
                originalUrl: attachment.url,
                resizedUrl: getResizedDiscordUrl(attachment.url),
                filename: attachment.name,
                messageId: message.id,
                messageUrl: messageUrl,
                size: imageBuffer.length,
                timestamp: finalTimestamp,
                'timestamp-readable': formatReadableTimestamp(finalTimestamp),
                dimensions: {
                  width: (await sharp(imageBuffer).metadata()).width,
                  height: (await sharp(imageBuffer).metadata()).height
                }
              });
              
              await markImageAsProcessed(message, attachment);
              processedCount++;
            } catch (error) {
              await sendLog(`Error processing ${attachment.name}: ${error.message}`, true);
            }
          } else {
            // Image already in list, just add reaction if missing
            await markImageAsProcessed(message, attachment);
          }
        }
      }
      
      const lastMessage = messages.last();
      messages = await channel.messages.fetch({ 
        limit: 100,
        before: lastMessage.id 
      });
    }
    
    await saveImageList();
    await sendLog(`Channel history complete! Processed ${processedCount} new images.`, false, '📊');
    
    // Validate existing images
    await validateImageList(channel);
    
  } catch (error) {
    await sendLog(`Error in history fetch: ${error.message}`, true);
  }
}

// Update the client ready event to use the public IP
client.once(Events.ClientReady, async () => {
  await sendLog('Bot is starting up...', false, '🚀');
  await registerCommands();
  
  logChannel = await client.channels.fetch(logChannelId);
  if (logChannel) {
    const publicIp = '212.227.57.140';  // Use the public IP
    const port = process.env.PORT || 3000;
    await sendLog('Bot is ready and connected to log channel!', false, '🤖');
    await sendLog(`JSON API endpoint: http://${publicIp}:${port}/image-list.json`, false, '📁');
  } else {
    await sendLog('Could not connect to log channel!', true);
  }
  
  await fetchChannelHistory();
});

// Update the sendLog function to always log to console
async function sendLog(message, error = false, emoji = null) {
  // Use console.error for errors, console.log for normal messages
  if (error) {
    console.error(message);
  } else {
    console.log(message);
  }
  
  if (logChannel) {
    const messageEmoji = emoji || (error ? '❌' : '');
    await logChannel.send(`${messageEmoji} ${message}`);
  }
}

// Update process termination handling
process.on('SIGINT', async () => {
  await sendLog('Bot is shutting down...', false, '🛑');
  await saveImageList();
  process.exit(0);
});

// Add command handler
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'fotogalerie') {
    await fotogalerieCommand.execute(interaction, { 
      photoChannelId, 
      logChannelId, 
      logChannel 
    });
  }
});

// Update the message event handler
client.on(Events.MessageCreate, async (message) => {
  if (message.channelId !== photoChannelId) return;
  
  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    
    try {
      const messageUrl = getMessageUrl(message);
      await sendLog(`New image detected: ${attachment.name} ${messageUrl}`, false, '📸');
      const imageUrl = getResizedDiscordUrl(attachment.url);
      const imageBuffer = await downloadImage(imageUrl);
      
      const fileTimestamp = parseVRChatTimestamp(attachment.name);
      const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
      const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
      
      imageList.push({
        originalUrl: attachment.url,
        resizedUrl: getResizedDiscordUrl(attachment.url),
        filename: attachment.name,
        messageId: message.id,
        messageUrl: messageUrl,
        size: imageBuffer.length,
        timestamp: finalTimestamp,
        'timestamp-readable': formatReadableTimestamp(finalTimestamp),
        dimensions: {
          width: (await sharp(imageBuffer).metadata()).width,
          height: (await sharp(imageBuffer).metadata()).height
        }
      });
      
      await markImageAsProcessed(message, attachment);
      await saveImageList();
      await sendLog(`Successfully processed: ${attachment.name} ${messageUrl}`, false, '✅');
    } catch (error) {
      await sendLog(`Error processing ${attachment.name}: ${error.message}`, true);
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);

console.log('Starting Discord bot...');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Update the web server part
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Add a health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Update JSON endpoint with better error handling
app.get('/image-list.json', async (req, res) => {
  try {
    await sendLog('Received request for image-list.json', false, '🌐');
    const jsonData = await readFile('/app/data/image-list.json', 'utf8');
    res.json(JSON.parse(jsonData));
    await sendLog('Successfully served image-list.json', false, '✅');
  } catch (error) {
    await sendLog(`Error serving image-list.json: ${error.message}`, true);
    res.status(500).json({ 
      error: 'Could not read image list',
      details: error.message 
    });
  }
});

// New endpoint for simplified URL list in txt format
app.get('/image-urls.txt', async (req, res) => {
  try {
    await sendLog('Received request for image-urls.txt', false, '🌐');
    const jsonData = await readFile('/app/data/image-list.json', 'utf8');
    const imageList = JSON.parse(jsonData);
    const urlList = imageList.map(img => img.resizedUrl).join('\n');
    res.header('Content-Type', 'text/plain');
    res.send(urlList);
    await sendLog('Successfully served image-urls.txt', false, '✅');
  } catch (error) {
    await sendLog(`Error serving image-urls.txt: ${error.message}`, true);
    res.status(500).send('Could not generate URL list');
  }
});

// Function to generate a placeholder image with a color based on the number
async function generatePlaceholderImage(number) {
  try {
    // Generate different colors based on the number
    const colors = [
      '#FFD700', // Gold
      '#98FB98', // Pale Green
      '#87CEEB', // Sky Blue
      '#DDA0DD', // Plum
      '#F08080', // Light Coral
      '#B0C4DE', // Light Steel Blue
      '#FFB6C4', // Light Pink
      '#98FF98', // Mint Green
      '#FFA07A', // Light Salmon
      '#87CEFA'  // Light Sky Blue
    ];
    
    const color = colors[number % colors.length];
    
    // Create a new image with the color
    return await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: color
      }
    })
    .png()
    .toBuffer();
  } catch (error) {
    throw new Error(`Failed to generate placeholder: ${error.message}`);
  }
}

// Function to fetch and process image from URL
async function fetchAndProcessImage(url) {
  try {
    const imageBuffer = await downloadImage(url);
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    
    // Create a Sharp instance
    let sharpInstance = sharp(imageBuffer);
    
    // Resize if needed
    if (metadata.width > MAX_RESOLUTION || metadata.height > MAX_RESOLUTION) {
      sharpInstance = sharpInstance.resize(MAX_RESOLUTION, MAX_RESOLUTION, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Always convert to PNG with maximum quality
    return sharpInstance
      .png({
        quality: 100,
        compressionLevel: 9,
        palette: true
      })
      .toBuffer();
  } catch (error) {
    throw new Error(`Failed to process image: ${error.message}`);
  }
}

// New endpoint for numbered image redirects
app.get('/image:number.png', async (req, res) => {
  try {
    const imageNumber = parseInt(req.params.number);
    if (isNaN(imageNumber) || imageNumber < 1) {
      res.status(400).send('Invalid image number');
      return;
    }

    const jsonData = await readFile('/app/data/image-list.json', 'utf8');
    const imageList = JSON.parse(jsonData);
    
    // Convert to 0-based index
    const index = imageNumber - 1;
    
    // If the requested number is beyond our image list, serve a placeholder
    if (index >= imageList.length) {
      const placeholderBuffer = await generatePlaceholderImage(imageNumber);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(placeholderBuffer);
      await sendLog(`Served placeholder image${imageNumber}.png`, false, '🎨');
      return;
    }

    // Fetch and process the image
    const imageUrl = imageList[index].resizedUrl;
    const processedImageBuffer = await fetchAndProcessImage(imageUrl);
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Send the processed image
    res.send(processedImageBuffer);
    
    await sendLog(`Served image${imageNumber}.png directly from position ${index + 1}`, false, '🎨');
  } catch (error) {
    await sendLog(`Error serving image${req.params.number}.png: ${error.message}`, true);
    res.status(500).send('Could not serve image');
  }
});

// Update server startup logging
app.listen(PORT, '0.0.0.0', () => {
  const publicIp = '212.227.57.140';  // Use the public IP
  console.log(`Web server listening on port ${PORT}`);
  console.log(`Health check: http://${publicIp}:${PORT}/health`);
  console.log(`JSON endpoint: http://${publicIp}:${PORT}/image-list.json`);
  console.log(`Text URL list: http://${publicIp}:${PORT}/image-urls.txt`);
  console.log(`Numbered images: http://${publicIp}:${PORT}/image1.png, /image2.png, etc.`);
});