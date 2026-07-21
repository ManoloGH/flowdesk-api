export class CreateSkillDto {
  name: string;
  trigger_condition: string;
  response_instructions: string;
  example_conversation?: string;
  status?: string;
}

export class UpdateSkillDto {
  name?: string;
  trigger_condition?: string;
  response_instructions?: string;
  example_conversation?: string;
  status?: string;
}

export class CreateCorrectionDto {
  conversation_id?: string;
  message_id?: string;
  source?: string;
  verdict?: string;
  original_text?: string;
  corrected_text?: string;
  note?: string;
}

export class UpdateAgentConfigDto {
  model?: string;
  ai_provider?: string;
  instructions?: string;
  nombre?: string;
  personality?: string;
  stt_provider?: string;
  stt_model?: string;
  tts_provider?: string;
  tts_model?: string;
  tts_voice_id?: string;
  [key: string]: unknown;
}
