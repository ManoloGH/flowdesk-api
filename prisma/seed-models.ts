import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MODELS = [
  { provider: 'openai', model_id: 'openai/gpt-4o-mini', display_name: 'GPT-4o mini', tier: 'economy' },
  { provider: 'openai', model_id: 'openai/gpt-4o', display_name: 'GPT-4o', tier: 'capable' },
  { provider: 'anthropic', model_id: 'anthropic/claude-haiku-4-5', display_name: 'Claude Haiku 4.5', tier: 'economy' },
  { provider: 'anthropic', model_id: 'anthropic/claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', tier: 'capable' },
  { provider: 'anthropic', model_id: 'anthropic/claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', tier: 'capable' },
  { provider: 'google', model_id: 'google/gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', tier: 'economy' },
  { provider: 'moonshotai', model_id: 'moonshotai/kimi-k2', display_name: 'KIMI K2 (Moonshot)', tier: 'capable' },
];

async function main() {
  console.log('Seeding AvailableModel...');
  for (const model of MODELS) {
    await prisma.availableModel.upsert({
      where: { model_id: model.model_id },
      update: {},
      create: { ...model, active: true },
    });
  }
  console.log(`Seeded ${MODELS.length} models.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
