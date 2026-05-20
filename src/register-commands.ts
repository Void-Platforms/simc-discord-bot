import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const token = requireEnv('DISCORD_TOKEN');
const appId = requireEnv('DISCORD_APP_ID');
const guildId = process.env.DISCORD_DEV_GUILD_ID;

const command = new SlashCommandBuilder()
  .setName('sim')
  .setDescription('Run a SimulationCraft sim through Simmit.')
  .addStringOption((option) =>
    option
      .setName('region')
      .setDescription('Battle.net region.')
      .setRequired(true)
      .addChoices(
        { name: 'US', value: 'us' },
        { name: 'EU', value: 'eu' },
        { name: 'KR', value: 'kr' },
        { name: 'TW', value: 'tw' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('realm')
      .setDescription('Realm slug, lowercase and hyphenated (e.g. area-52).')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('character')
      .setDescription('Character name.')
      .setRequired(true),
  )
  .toJSON();

const rest = new REST({ version: '10' }).setToken(token);

const route = guildId
  ? Routes.applicationGuildCommands(appId, guildId)
  : Routes.applicationCommands(appId);

await rest.put(route, { body: [command] });

console.log(
  guildId
    ? `registered /sim to guild ${guildId}`
    : 'registered /sim globally (may take up to an hour to propagate)',
);
