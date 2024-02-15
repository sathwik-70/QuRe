export enum UserRole {
  PATIENT = 'PATIENT',
  HOSPITAL = 'HOSPITAL',
  ADMIN = 'ADMIN'
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  qr_identifier: string;
  drive_folder_id?: string;
  is_verified?: boolean;
  created_at?: string;
}

export interface HospitalRegistryEntry {
  email: string;
  hospital_name: string;
  created_at: string;
  created_by?: string;
}

export interface MedicalRecord {
  id: string;
  patient_id: string;
  title: string;
  category: 'Lab Result' | 'Imaging' | 'Prescription' | 'Clinical Note' | 'Vaccination';
  drive_file_id: string;
  file_extension: string;
  mime_type: string;
  created_at: string;
  summary?: string;
  storage_provider?: 'GOOGLE_DRIVE' | 'SUPABASE';
}

export interface AccessLog {
  id: string;
  hospital_id: string;
  patient_id: string;
  hospital_name: string;
  accessed_at: string;
}

export interface GeminiResponse {
  text: string;
  sources?: { title: string; uri: string }[];
}