import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } from 'discord.js';
import sharp from 'sharp';
import { writeFile } from 'fs/promises';
import { get } from 'https';
import 'dotenv/config';
import fotogalerieCommand from './commands/fotogalerie.js';

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
    // Sort imageList by timestamp (newest first)
    imageList.sort((a, b) => b.timestamp - a.timestamp);
    await writeFile('/app/data/image-list.json', JSON.stringify(imageList, null, 2));
    console.log('Image list saved to /app/data/image-list.json');
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
    console.log('Successfully registered application commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Update reaction handler to not remove reactions
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
        
        const messageUrl = getMessageUrl(message);
        await sendLog(`🗑️ Image ${removedImage.filename} removed by user ${user.tag}\n${messageUrl}`, false, '🗑️');
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
  await sendLog('🔍 Starting image list validation...');
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
          await sendLog(`🗑️ Removing ${hasRemovalReaction ? 'marked' : 'invalid'} image: ${image.filename}`, false, '🗑️');
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
    await sendLog(`♻️ Removed ${removedCount} images from list`);
  } else {
    await sendLog('✨ All images in list are valid');
  }
}

// Update the fetchChannelHistory function
async function fetchChannelHistory() {
  try {
    await sendLog('📚 Starting channel history fetch...', false, '📚');
    const channel = await client.channels.fetch(photoChannelId);
    if (!channel) {
      await sendLog('❌ Photo channel not found!', true);
      return;
    }

    await sendLog('🔄 Fetching channel messages...', false, '🔄');
    let messages = await channel.messages.fetch({ limit: 100 });
    let processedCount = 0;
    
    while (messages.size > 0) {
      for (const message of messages.values()) {
        for (const attachment of message.attachments.values()) {
          if (!attachment.contentType?.startsWith('image/')) continue;
          
          if (!imageList.some(img => img.originalUrl === attachment.url)) {
            try {
              const messageUrl = getMessageUrl(message);
              await sendLog(`📥 Processing historical image: ${attachment.name}\n${messageUrl}`, false, '📥');
              const imageUrl = getResizedDiscordUrl(attachment.url);
              const imageBuffer = await downloadImage(imageUrl);
              
              const fileTimestamp = parseVRChatTimestamp(attachment.name);
              const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
              const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
              
              imageList.push({
                originalUrl: attachment.url,
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
    await sendLog(`📊 Channel history complete! Processed ${processedCount} new images.`);
    
    // Validate existing images
    await validateImageList(channel);
    
  } catch (error) {
    await sendLog(`Error in history fetch: ${error.message}`, true);
  }
}

// Update the client ready event
client.once(Events.ClientReady, async () => {
  await sendLog('🚀 Bot is starting up...', false, '🚀');
  await registerCommands();
  
  logChannel = await client.channels.fetch(logChannelId);
  if (logChannel) {
    await sendLog('🤖 Bot is ready and connected to log channel!');
  } else {
    console.error('❌ Could not connect to log channel!');
  }
  
  await fetchChannelHistory();
});

// Update the sendLog function to support custom emojis
async function sendLog(message, error = false, emoji = null) {
  console.log(message);
  if (logChannel) {
    const defaultEmoji = error ? '❌' : '✅';
    const messageEmoji = emoji || defaultEmoji;
    await logChannel.send(`${messageEmoji} ${message}`);
  }
}

// Update process termination handling
process.on('SIGINT', async () => {
  await sendLog('🛑 Bot is shutting down...', false, '🛑');
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
      await sendLog(`📸 New image detected: ${attachment.name}\n${messageUrl}`, false, '📸');
      const imageUrl = getResizedDiscordUrl(attachment.url);
      const imageBuffer = await downloadImage(imageUrl);
      
      const fileTimestamp = parseVRChatTimestamp(attachment.name);
      const urlTimestamp = parseDiscordUrlTimestamp(attachment.url);
      const finalTimestamp = fileTimestamp || urlTimestamp || message.createdTimestamp;
      
      imageList.push({
        originalUrl: attachment.url,
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
      await sendLog(`✅ Successfully processed: ${attachment.name}\n${messageUrl}`);
    } catch (error) {
      await sendLog(`❌ Error processing ${attachment.name}: ${error.message}`, true);
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);

console.log('Starting Discord bot...');