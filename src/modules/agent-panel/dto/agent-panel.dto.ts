import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class CreateSkillDto {
  @IsString()
  name: string;

  @IsString()
  trigger_condition: string;

  @IsOptional()
  @IsString()
  response_instructions?: string;

  @IsOptional()
  @IsString()
  example_conversation?: string;

  @IsOptional()
  @IsString()
  action_type?: string;

  @IsOptional()
  @IsObject()
  action_config?: Record<string, string>;

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
  action_type?: string;

  @IsOptional()
  @IsObject()
  action_config?: Record<string, string>;

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

export class TestMessageDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  history?: { role: string; content: string }[];

  @IsOptional()
  @IsString()
  phone?: string;
}

export class CreateCaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  linea?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  disposition?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateCaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  linea?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  disposition?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateClassificationDto {
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
  message_text?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  caso?: string;

  @IsOptional()
  @IsString()
  feedback?: string;
}

export class CreateDeliverableDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsString()
  offer_text: string;

  @IsArray()
  questions: { field: string; question: string; order: number }[];

  @IsArray()
  sections: { title: string; prompt: string }[];

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateDeliverableDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  offer_text?: string;

  @IsOptional()
  @IsArray()
  questions?: { field: string; question: string; order: number }[];

  @IsOptional()
  @IsArray()
  sections?: { title: string; prompt: string }[];

  @IsOptional()
  @IsString()
  status?: string;
}
