export class CreateClienteDocDto {
  tipo: string;
  folio?: string;
  titulo?: string;
  nombre: string;
  cargo?: string;
  empresa: string;
  email: string;
  remitente?: string;
  nda_aceptado?: boolean;
  datos?: Record<string, unknown>;
  html: string;
  fechaStr?: string;
  timestamp?: string;
  documento?: string;
}
