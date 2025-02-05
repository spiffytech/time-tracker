import {
  Client as Discord,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";

interface TimeRecord {
  key: string; // a unique string identifier for this record. When creating new record, it is the responsibility of the client to generate this key with a good random generator.
  t1: number; // the record start time as an integer Unix timestamp.
  t2: number; // the record stop time as an integer Unix timestamp.
  ds: string; // the record description (can be empty).
  mt: number; // the modified time (set by the client).
  st: number; // the server time (set by the server when storing a record). Clients should set this to 0.0 for new records.
}

const getTimeRecords = async (): Promise<TimeRecord[]> => {
  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
  });

  return (await response.json()).records as TimeRecord[];
};

console.log((await getTimeRecords()).at(-1));

const discord = new Discord({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

await discord.login(process.env.discordApiKey!);
const user = await discord.users.fetch(process.env.discordUserId!);
const message = await user.send("What have you been working on?");
const reactionCollector = message.createReactionCollector();
reactionCollector.on("collect", (reaction) => {
  console.log(reaction.emoji.name);
});
discord.on(Events.InteractionCreate, async (interaction) => {
  console.log(interaction);
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
  }
});

discord.on("messageCreate", (message) => {
  console.log(message.content);
});
