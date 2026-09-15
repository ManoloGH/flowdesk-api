export class CreateSenseiProjectDto {
  name: string;
  description?: string;
  who_does_it?: string;
  frequency?: string;
  output_type?: string;
  task_type?: string;
  target_agent?: string;
  max_iterations?: number;
}

export class UpdateSenseiProjectDto {
  name?: string;
  description?: string;
  who_does_it?: string;
  frequency?: string;
  output_type?: string;
  task_type?: string;
  target_agent?: string;
  max_iterations?: number;
  phase?: string;
}

export class AddEvidenceDto {
  type: string; // document | loom_link | video
  label?: string;
  url?: string;
  filename?: string;
  size_bytes?: number;
}

export class SendMessageDto {
  content: string;
}

export class RunIterationDto {
  input_data: Record<string, string>;
}

export class IterationFeedbackDto {
  feedback: string;
  score: number;
  approved: boolean;
}

export class CertifySkillDto {
  deliverable_skill_id?: string; // si ya existe la skill de documento
}
