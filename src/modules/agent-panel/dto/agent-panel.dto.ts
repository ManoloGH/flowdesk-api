import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateSkillDto {
  @IsString()
  name: string;

  @IsString()
  trigger_condition: string;

  @IsString()
  response_instructions: string;

  @IsOptional()
  @IsString()
  example_conversation?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  trigger_condition?: string;

  @IsOptional()
  @IsString()
  response_instructions?: string;

  @IsOptional()
  @IsString()
  example_conversation?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateCorrectionDto {
  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsOptional()
  @IsString()
  message_id?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  verdict?: string;

  @IsOptional()
  @IsString()
  original_text?: string;

  @IsOptional()
  @IsString()
  corrected_text?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateAgentConfigDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  ai_provider?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsOptional()
  @IsString()
  stt_provider?: string;

  @IsOptional()
  @IsString()
  stt_model?: string;

  @IsOptional()
  @IsString()
  tts_provider?: string;

  @IsOptional()
  @IsString()
  tts_model?: string;

  @IsOptional()
  @IsString()
  tts_voice_id?: string;

  // Journey / agente comercial
  @IsOptional()
  @IsString()
  instance_name?: string;

  @IsOptional()
  @IsString()
  cal_com_url?: string;

  @IsOptional()
  @IsString()
  pitch?: string;

  @IsOptional()
  @IsArray()
  qualifying_questions?: string[];

  @IsOptional()
  @IsString()
  good_lead_criteria?: string;

  @IsOptional()
  @IsString()
  bad_lead_criteria?: string;

  // Entregable
  @IsOptional()
  @IsString()
  deliverable_type?: string;

  @IsOptional()
  @IsString()
  deliverable_url?: string;

  @IsOptional()
  @IsString()
  deliverable_description?: string;
}
