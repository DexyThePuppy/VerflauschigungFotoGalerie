import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('fotogalerie')
    .setDescription('Manage Fotogalerie settings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('photosid')
        .setDescription('Set the channel ID for photos')
        .addStringOption(option =>
          option
            .setName('channelid')
            .setDescription('The channel ID to use for photos')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('logsid')
        .setDescription('Set the channel ID for logs')
        .addStringOption(option =>
          option
            .setName('channelid')
            .setDescription('The channel ID to use for logs')
            .setRequired(true))),

  async execute(interaction, { photoChannelId, logChannelId, logChannel }) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
      return await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command!',
        ephemeral: true 
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const newChannelId = interaction.options.getString('channelid');

    try {
      // Verify the channel exists and bot has access
      const channel = await interaction.client.channels.fetch(newChannelId);
      if (!channel) throw new Error('Channel not found');

      if (subcommand === 'photosid') {
        photoChannelId = newChannelId;
        await interaction.reply(`✅ Photo channel updated to: ${channel.name} (${newChannelId})`);
        if (logChannel) {
          await logChannel.send(`📸 Photo channel changed to: ${channel.name} (${newChannelId})`);
        }
      } else if (subcommand === 'logsid') {
        logChannelId = newChannelId;
        const newLogChannel = channel;
        logChannel = newLogChannel;
        await interaction.reply(`✅ Log channel updated to: ${channel.name} (${newChannelId})`);
        await newLogChannel.send(`📝 This channel is now set as the log channel`);
      }
    } catch (error) {
      await interaction.reply({ 
        content: `❌ Error: ${error.message}. Make sure the channel ID is valid and the bot has access to it.`,
        ephemeral: true 
      });
    }
  },
}; 