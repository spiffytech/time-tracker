import {
  Client as Discord,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import { Temporal } from "temporal-polyfill";

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

const getLatestTimeRecord = async (): Promise<TimeRecord> => {
  const records = await getTimeRecords();
  return records.at(-1)!;
};

const stopTimer = async (record: TimeRecord) => {
  record = { ...record, t2: new Date().getTime() / 1_000 };
  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
    body: JSON.stringify([record]),
  });
};

const createRecord = async (description: string) => {
  const record: Omit<TimeRecord, "st"> = {
    key: Bun.randomUUIDv7(),
    ds: description,
    t1: new Date().getTime() / 1_000,
    t2: new Date().getTime() / 1_000,
    mt: new Date().getTime() / 1_000,
  };
  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
    body: JSON.stringify([record]),
  });
};

function randomSampleTime(mean = 15, stdDev = 2) {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Convert to minutes, centered on mean with given standard deviation
  return mean + z * stdDev;
}

const enqueueNextMessage = () => {
  const offsetMinutes = randomSampleTime();
  const offsetMs = offsetMinutes * 60 * 1000;
  setTimeout(() => interrogateUser(), offsetMs);
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

let outstandingMessages = 0;
const interrogateUser = async () => {
  if (outstandingMessages > 3) {
    console.warn(
      "User is idle, skipping interrogation until they start answering messages."
    );
    return;
  }

  const currentActivity = await getLatestTimeRecord();

  const message = await user.send(
    `What have you been working on?\nCurrent activity: ${currentActivity.ds}`
  );
  const reactionCollector = message.createReactionCollector();
  reactionCollector.on("collect", async (reaction) => {
    console.log(reaction.emoji.name);
    switch (reaction.emoji.name) {
      case "🛑":
        await stopTimer(currentActivity);
        await message.reply("Timer stopped.");
        outstandingMessages = 0;
        break;
      case "➡️":
        await message.reply("Continuing current activity.");
        outstandingMessages = 0;
        break;
    }
  });

  outstandingMessages += 1;
  enqueueNextMessage();
};

discord.on("messageCreate", async (message) => {
  if (message.author.id === discord.user!.id) return;
  console.log(message.content);
  outstandingMessages = 0;
  await createRecord(message.content);
  await message.reply("Record created.");
});

enqueueNextMessage();
