-- QuRe V3.3: Hybrid Security (Registry + Request)

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp" with schema public;

-- 2. TABLES
create table if not exists public.profiles (
  id text primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('PATIENT', 'HOSPITAL', 'ADMIN')),
  qr_identifier text unique not null,
  drive_folder_id text,
  is_verified boolean default false,
  created_at timestamptz default now()
);

-- MIGRATION: Clean up old column if exists
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'temp_password') then
    alter table public.profiles drop column temp_password;
  end if;
end $$;

-- Registry table for Pre-Authorized Hospitals
create table if not exists public.hospital_allowlist (
  email text primary key,
  hospital_name text not null,
  created_at timestamptz default now(),
  created_by text
);

create table if not exists public.reports (
  id uuid default public.uuid_generate_v4() primary key,
  patient_id text not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null,
  drive_file_id text not null,
  file_extension text,
  mime_type text,
  summary text,
  storage_provider text default 'GOOGLE_DRIVE' check (storage_provider in ('GOOGLE_DRIVE', 'SUPABASE')),
  created_at timestamptz default now()
);

create table if not exists public.access_logs (
  id uuid default public.uuid_generate_v4() primary key,
  hospital_id text references public.profiles(id) on delete set null,
  patient_id text not null references public.profiles(id) on delete cascade,
  hospital_name text,
  accessed_at timestamptz default now()
);

-- STORAGE
insert into storage.buckets (id, name, public) 
values ('hospital_uploads', 'hospital_uploads', false) 
on conflict (id) do nothing;

-- 3. RLS ENABLE
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.access_logs enable row level security;
alter table public.hospital_allowlist enable row level security;

-- CLEANUP OLD POLICIES
drop policy if exists "Self Read" on public.profiles;
drop policy if exists "Self Update" on public.profiles;
drop policy if exists "Self Insert" on public.profiles;
drop policy if exists "Admin Select" on public.profiles;
drop policy if exists "Admin Insert" on public.profiles;
drop policy if exists "Admin Update" on public.profiles;
drop policy if exists "Admin Delete" on public.profiles;
drop policy if exists "Patient Own" on public.reports;
drop policy if exists "Admin View" on public.reports;
drop policy if exists "Log Creation" on public.access_logs;
drop policy if exists "Patient View Log" on public.access_logs;
drop policy if exists "Admin View Log" on public.access_logs;
drop policy if exists "Read Own Profile" on public.profiles;
drop policy if exists "Admin Read All Profiles" on public.profiles;
drop policy if exists "Admin Update Profiles" on public.profiles;
drop policy if exists "Admin Delete Profiles" on public.profiles;
drop policy if exists "Update Own Profile" on public.profiles;
drop policy if exists "Patient Read Own Reports" on public.reports;
drop policy if exists "Hospital Read Active Session Reports" on public.reports;
drop policy if exists "Admin Read All Reports" on public.reports;
drop policy if exists "Hospital Create Report" on public.reports;
drop policy if exists "Patient Delete Own Reports" on public.reports;
drop policy if exists "Insert Access Log" on public.access_logs;
drop policy if exists "Patient See Logs" on public.access_logs;
drop policy if exists "Hospital See Own Logs" on public.access_logs;
drop policy if exists "Admin See All Logs" on public.access_logs;
drop policy if exists "Admin Manage Allowlist" on public.hospital_allowlist;
drop policy if exists "Admin Allowlist Select" on public.hospital_allowlist;
drop policy if exists "Admin Allowlist Insert" on public.hospital_allowlist;
drop policy if exists "Admin Allowlist Update" on public.hospital_allowlist;
drop policy if exists "Admin Allowlist Delete" on public.hospital_allowlist;

-- 4. RBAC HELPER
create or replace function public.get_my_role()
returns text as $$
  select role from public.profiles where id = auth.uid()::text;
$$ language sql security definer stable set search_path = public;

-- 5. RLS POLICIES

-- ALLOWLIST (Admin Only)
create policy "Admin Allowlist Select" on public.hospital_allowlist for select using (public.get_my_role() = 'ADMIN');
create policy "Admin Allowlist Insert" on public.hospital_allowlist for insert with check (public.get_my_role() = 'ADMIN');
create policy "Admin Allowlist Update" on public.hospital_allowlist for update using (public.get_my_role() = 'ADMIN');
create policy "Admin Allowlist Delete" on public.hospital_allowlist for delete using (public.get_my_role() = 'ADMIN');

-- PROFILES
create policy "Read Own Profile" on public.profiles for select using (auth.uid()::text = id);
create policy "Admin Read All Profiles" on public.profiles for select using (public.get_my_role() = 'ADMIN');
create policy "Admin Update Profiles" on public.profiles for update using (public.get_my_role() = 'ADMIN');
create policy "Admin Delete Profiles" on public.profiles for delete using (public.get_my_role() = 'ADMIN');
create policy "Update Own Profile" on public.profiles for update using (auth.uid()::text = id);

-- REPORTS
create policy "Patient Read Own Reports" on public.reports for select using (patient_id = auth.uid()::text);
create policy "Hospital Read Active Session Reports" on public.reports for select 
using (
  public.get_my_role() = 'HOSPITAL' and
  exists (
    select 1 from public.access_logs 
    where hospital_id = auth.uid()::text 
    and patient_id = public.reports.patient_id 
    and accessed_at > now() - interval '24 hours'
  )
);
create policy "Admin Read All Reports" on public.reports for select using (public.get_my_role() = 'ADMIN');
create policy "Hospital Create Report" on public.reports for insert 
with check (public.get_my_role() = 'HOSPITAL');
create policy "Patient Delete Own Reports" on public.reports for delete using (patient_id = auth.uid()::text);

-- ACCESS LOGS
create policy "Insert Access Log" on public.access_logs for insert with check (auth.uid()::text = hospital_id);
create policy "Patient See Logs" on public.access_logs for select using (patient_id = auth.uid()::text);
create policy "Hospital See Own Logs" on public.access_logs for select using (hospital_id = auth.uid()::text);
create policy "Admin See All Logs" on public.access_logs for select using (public.get_my_role() = 'ADMIN');

-- STORAGE
drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "Authenticated Read" on storage.objects;

create policy "Authenticated Upload" on storage.objects for insert 
with check ( bucket_id = 'hospital_uploads' and auth.role() = 'authenticated' );

create policy "Authenticated Read" on storage.objects for select 
using ( bucket_id = 'hospital_uploads' and auth.role() = 'authenticated' );

-- 6. RPC FUNCTIONS

-- Admin Delete User (Deletes from auth.users and profiles)
create or replace function admin_delete_user(target_user_id text)
returns void as $$
begin
  if public.get_my_role() = 'ADMIN' then
    delete from public.profiles where id = target_user_id;
    delete from auth.users where id = target_user_id::uuid;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$ language plpgsql security definer;

-- Recover Missing Profile
create or replace function sync_my_profile()
returns void as $$
declare
  v_email text;
  v_meta jsonb;
  allowlist_entry public.hospital_allowlist%ROWTYPE;
  final_role text;
  is_verified_status boolean;
begin
  select email, raw_user_meta_data into v_email, v_meta from auth.users where id = auth.uid();
  
  if v_email is null then return; end if;

  select * into allowlist_entry from public.hospital_allowlist where email = v_email;
  
  if v_email = 'botmale09o@gmail.com' then
    final_role := 'ADMIN';
    is_verified_status := true;
  elsif allowlist_entry.email is not null then
    final_role := 'HOSPITAL';
    is_verified_status := true;
  elsif v_meta->>'role_request' = 'HOSPITAL' then
    final_role := 'HOSPITAL';
    is_verified_status := false;
  else
    final_role := 'PATIENT';
    is_verified_status := true;
  end if;

  insert into public.profiles (id, email, full_name, role, qr_identifier, is_verified)
  values (
    auth.uid()::text,
    v_email,
    coalesce(allowlist_entry.hospital_name, v_meta->>'full_name', 'User'),
    final_role,
    'qure-' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 6),
    is_verified_status
  ) on conflict (id) do nothing;
end;
$$ language plpgsql security definer;

-- Secure Patient Lookup (QR Handshake)
create or replace function resolve_patient_qr(p_qr_identifier text)
returns json as $$
declare
  v_profile public.profiles;
begin
  if public.get_my_role() not in ('HOSPITAL', 'ADMIN') then
    raise exception 'Access Denied';
  end if;

  select * into v_profile from public.profiles where qr_identifier = p_qr_identifier;
  if found then
    return row_to_json(v_profile);
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Secure Report Creation
create or replace function create_clinical_report(
  p_patient_id text,
  p_title text,
  p_category text,
  p_drive_file_id text,
  p_file_extension text,
  p_mime_type text
)
returns json as $$
declare
  v_report_id uuid;
  v_record json;
begin
  if public.get_my_role() <> 'HOSPITAL' then
    raise exception 'Only Hospitals can submit clinical reports';
  end if;

  insert into public.reports (
    patient_id, title, category, drive_file_id, file_extension, mime_type, storage_provider
  ) values (
    p_patient_id, p_title, p_category, p_drive_file_id, p_file_extension, p_mime_type, 'SUPABASE'
  ) returning id into v_report_id;

  select row_to_json(r) into v_record from public.reports r where id = v_report_id;
  return v_record;
end;
$$ language plpgsql security definer;

-- Fetch Hospital Reports
create or replace function fetch_hospital_view_reports(p_patient_id text)
returns setof public.reports as $$
begin
  if public.get_my_role() <> 'HOSPITAL' then
    return;
  end if;
  
  if not exists (
    select 1 from public.access_logs 
    where hospital_id = auth.uid()::text 
    and patient_id = p_patient_id 
    and accessed_at > now() - interval '24 hours'
  ) then
    return;
  end if;

  return query select * from public.reports where patient_id = p_patient_id order by created_at desc;
end;
$$ language plpgsql security definer;

-- 7. TRIGGERS (UPDATED FOR HYBRID WORKFLOW)
create or replace function public.handle_new_user() returns trigger as $$
declare
  is_admin boolean;
  req_role text;
  final_role text;
  is_verified_status boolean;
  allowlist_entry public.hospital_allowlist%ROWTYPE;
begin
  is_admin := new.email = 'botmale09o@gmail.com';
  req_role := new.raw_user_meta_data->>'role_request';
  
  -- Check Allowlist
  select * into allowlist_entry from public.hospital_allowlist where email = new.email;
  
  -- Determine Role and Verification Status
  if is_admin then
    final_role := 'ADMIN';
    is_verified_status := true;
  elsif allowlist_entry.email is not null then
    final_role := 'HOSPITAL';
    is_verified_status := true; -- Pre-authorized by Admin
  elsif req_role = 'HOSPITAL' then
    final_role := 'HOSPITAL';
    is_verified_status := false; -- Must be approved by Admin
  else
    final_role := 'PATIENT';
    is_verified_status := true; -- Patients auto-verify
  end if;

  -- Clean up conflicts
  delete from public.profiles where email = new.email;
  if is_admin then
    delete from public.profiles where qr_identifier = 'sys-admin';
  end if;

  insert into public.profiles (id, email, full_name, role, qr_identifier, is_verified)
  values (
    new.id::text,
    new.email,
    coalesce(allowlist_entry.hospital_name, new.raw_user_meta_data->>'full_name', 'User'),
    final_role,
    case when is_admin then 'sys-admin' else 'qure-' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 6) end,
    is_verified_status
  )
  on conflict (id) do update
  set email = excluded.email,
      role = excluded.role;
      
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
