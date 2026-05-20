import "dotenv/config";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const DISCORD_TOKEN = requireEnv("DISCORD_TOKEN");
const SIMMIT_SECRET_KEY = requireEnv("SIMMIT_SECRET_KEY");
const BNET_CLIENT_ID = requireEnv("BNET_CLIENT_ID");
const BNET_CLIENT_SECRET = requireEnv("BNET_CLIENT_SECRET");

const API = "https://api.simmit.com/v1";
const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);
const POLL_INTERVAL_MS = 5_000;

const COLOR_PROGRESS = 0x5865f2;
const COLOR_SUCCESS = 0x57f287;
const COLOR_FAILURE = 0xed4245;

type JobStatus = {
  status: string;
  queue: { estimatedStartSeconds: number | null } | null;
  progress: { percent: number | null } | null;
};

type Field = { name: string; value: string; inline?: boolean };

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", (c) => {
  console.log(`logged in as ${c.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "sim") return;
  await handleSim(interaction);
});

async function handleSim(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const region = interaction.options.getString("region", true);
  const realm = interaction.options.getString("realm", true);
  const character = interaction.options.getString("character", true);
  const profileText = `target_error=0.05
armory=${region},${realm},${character}
`;
  const baseEmbed = () =>
    new EmbedBuilder().setTitle(`${character} · ${realm} (${region})`);

  try {
    const submitRes = await fetch(`${API}/simc/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SIMMIT_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        build: { channel: "latest" },
        profile: { text: profileText },
        credentials: {
          bnetClientId: BNET_CLIENT_ID,
          bnetClientSecret: BNET_CLIENT_SECRET,
        },
        artifacts: { html: true },
        // Reserved credits scale with maxRuntimeSeconds, so cap low when sims will be fast.
        runtime: { maxRuntimeSeconds: 120 },
      }),
    });
    if (!submitRes.ok) {
      throw new Error(
        `submit failed (${submitRes.status}): ${await submitRes.text()}`,
      );
    }
    const { id } = (await submitRes.json()) as { id: string };
    console.log(`[sim] submitted ${id}`);
    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setColor(COLOR_PROGRESS)
          .addFields(
            { name: "Status", value: "submitted", inline: true },
            { name: "Job", value: `\`${id}\``, inline: true },
          ),
      ],
    });

    let status = "";
    while (!TERMINAL.has(status)) {
      await sleep(POLL_INTERVAL_MS);
      const statusRes = await fetch(`${API}/simc/jobs/${id}/status`, {
        headers: { Authorization: `Bearer ${SIMMIT_SECRET_KEY}` },
      });
      if (!statusRes.ok) {
        throw new Error(
          `status failed (${statusRes.status}): ${await statusRes.text()}`,
        );
      }
      const body = (await statusRes.json()) as JobStatus;
      status = body.status;
      if (!TERMINAL.has(status)) {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setColor(COLOR_PROGRESS)
              .addFields(statusFields(id, body)),
          ],
        });
      }
    }
    console.log(`[sim] ${id} ${status}`);

    const resultRes = await fetch(`${API}/simc/jobs/${id}/result`, {
      headers: { Authorization: `Bearer ${SIMMIT_SECRET_KEY}` },
    });
    if (!resultRes.ok) {
      throw new Error(
        `result failed (${resultRes.status}): ${await resultRes.text()}`,
      );
    }
    const { result } = (await resultRes.json()) as {
      result: {
        summary?: { mainActor: { mean: number } };
        artifacts: { kind: string; url: string }[];
      };
    };

    if (status !== "completed") {
      const log =
        result.artifacts.find((a) => a.kind === "stderr_log") ??
        result.artifacts.find((a) => a.kind === "stdout_log");
      const fields: Field[] = [
        { name: "Status", value: status, inline: true },
        { name: "Job", value: `\`${id}\``, inline: true },
      ];
      if (log)
        fields.push({
          name: "Error Log",
          value: `[View log](${log.url})`,
          inline: false,
        });
      await interaction.editReply({
        embeds: [baseEmbed().setColor(COLOR_FAILURE).addFields(fields)],
      });
      return;
    }

    const dps = Math.round(result.summary!.mainActor.mean).toLocaleString(
      "en-US",
    );
    const html = result.artifacts.find((a) => a.kind === "html_report");
    if (!html) throw new Error("no HTML artifact returned");
    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setColor(COLOR_SUCCESS)
          .addFields(
            { name: "DPS", value: dps, inline: true },
            { name: "Job", value: `\`${id}\``, inline: true },
            {
              name: "SimC Report",
              value: `[View report](${html.url})`,
              inline: false,
            },
          ),
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sim] error:", err);
    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setColor(COLOR_FAILURE)
          .setDescription(message.slice(0, 4000)),
      ],
    });
  }
}

function statusFields(id: string, body: JobStatus): Field[] {
  const fields: Field[] = [
    { name: "Status", value: body.status, inline: true },
  ];
  if (body.status === "queued" && body.queue?.estimatedStartSeconds != null) {
    fields.push({
      name: "ETA",
      value: `~${Math.round(body.queue.estimatedStartSeconds)}s`,
      inline: true,
    });
  } else if (body.status === "running" && body.progress?.percent != null) {
    fields.push({
      name: "Progress",
      value: `${Math.round(body.progress.percent)}%`,
      inline: true,
    });
  }
  fields.push({ name: "Job", value: `\`${id}\``, inline: true });
  return fields;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await client.login(DISCORD_TOKEN);
