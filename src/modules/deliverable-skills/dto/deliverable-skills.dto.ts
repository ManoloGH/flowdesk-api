export class IntakeFieldDto {
  field: string;
  label: string;
  type: string; // 'text' | 'textarea' | 'date' | 'select' | 'html'
  placeholder?: string;
  required: boolean;
  default_value?: string;
  section?: string; // agrupación visual opcional
  options?: string[]; // para type 'select'
}

export class BusinessRuleDto {
  condition: string;
  action: string;
}

export class CreateDeliverableSkillDto {
  name: string;
  description?: string;
  doc_type: string;
  output_format?: string;
  intake_schema: IntakeFieldDto[];
  business_rules?: BusinessRuleDto[];
  html_template?: string;
  fixed_fields?: Record<string, string>;
  spec_md?: string;
  status?: string;
}

export class UpdateDeliverableSkillDto {
  name?: string;
  description?: string;
  doc_type?: string;
  output_format?: string;
  intake_schema?: IntakeFieldDto[];
  business_rules?: BusinessRuleDto[];
  html_template?: string;
  fixed_fields?: Record<string, string>;
  spec_md?: string;
  status?: string;
}

export class GenerateDocumentDto {
  intake_data: Record<string, string>;
  client_ref?: string;
}
